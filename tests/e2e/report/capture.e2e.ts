import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "../lib/fixtures";
import { storageStateFor } from "../fixtures/auth";
import { THEME_STORAGE_KEY } from "@/config/surfaces";
import { LOCALES, SCREENS, THEMES, type Screen } from "./screens";

/**
 * The screenshot report's capture pass.
 *
 * A spec rather than a standalone script, so it inherits the auth fixture, the
 * seeded property, the `webServer` and the traces — and its own project, so
 * `npm run test:e2e` does not photograph forty screens on the way to asserting
 * six journeys.
 *
 * It asserts almost nothing on purpose. What makes this a *report* rather than
 * a slideshow is the three arrays it records beside each shot: a screen that
 * looks right while its console throws is a broken screen, and the manifest
 * says so where a picture cannot.
 */

export const OUT_DIR = process.env.REPORT_DIR ?? join("reports", "latest");

/**
 * One file per shot rather than one shared manifest.
 *
 * The pass runs parallel, and two workers appending to one JSON file is a race
 * that loses rows silently. `scripts/report.mts` reads the directory.
 */
function writeRow(row: Record<string, unknown>, name: string) {
  const dir = join(OUT_DIR, "rows");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.json`), JSON.stringify(row, null, 2));
}

test.describe.configure({ mode: "parallel" });

for (const locale of LOCALES) {
  for (const theme of THEMES) {
    test.describe(`${locale} · ${theme}`, () => {
      for (const screen of SCREENS) {
        test(`${screen.shot}`, async ({ page, property, context }) => {
          const name = `${screen.shot}__${locale}__${theme}`;

          // Everything the page said while it drew. Collected before the first
          // navigation, or the earliest errors are missed.
          const consoleErrors: string[] = [];
          const pageErrors: string[] = [];
          const failedRequests: string[] = [];

          page.on("console", (message) => {
            if (message.type() === "error") consoleErrors.push(message.text());
          });
          page.on("pageerror", (error) => pageErrors.push(error.message));
          page.on("requestfailed", (request) => {
            const failure = request.failure()?.errorText ?? "failed";
            failedRequests.push(`${request.method()} ${request.url()} — ${failure}`);
          });

          // The language is a cookie the server reads; there is no locale in
          // the URL, which is the whole design in `lib/i18n.ts`. By domain
          // rather than by `url`: a page that has not navigated is
          // `about:blank`, and a blank page cannot hold a cookie.
          await context.addCookies([
            { name: "konak.locale", value: locale, domain: "localhost", path: "/" },
          ]);

          /**
           * The theme is the product's own preference now, not a class this
           * pass injects.
           *
           * It used to do `classList.add("dark")` after load, with a comment
           * saying nothing in the product set it — true until P6. Writing what
           * `next-themes` reads instead means these shots prove the feature
           * rather than illustrate the tokens: if the provider stopped working,
           * the dark shots would come back light and the report would say so.
           *
           * An init script rather than a `localStorage` write, because the
           * library reads it in a blocking script before first paint.
           */
          await context.addInitScript(([key, value]) => window.localStorage.setItem(key, value), [
            THEME_STORAGE_KEY,
            theme,
          ] as const);

          const path = screen.path
            .replace(":org", property.organizationSlug)
            .replace(":property", property.propertySlug)
            .replace(":booking", property.bookingPublicId);

          const started = Date.now();
          // Not `networkidle`: the desk polls every thirty seconds, so the
          // network is never idle and the wait runs to its timeout on the one
          // screen the report exists for.
          const response = await page.goto(path, { waitUntil: "load" });
          await page.waitForLoadState("domcontentloaded");
          const ms = Date.now() - started;

          // Set before the first navigation, and `page.goto` is below.

          /**
           * And wait for the data, which is the whole subject.
           *
           * `load` fires while every query is still in flight, and the шахматка
           * photographed at that moment is an empty grey box — the one screen
           * the report exists for, showing nothing. `networkidle` cannot be the
           * answer either: the desk polls every thirty seconds, so the network
           * is never idle.
           *
           * Every loading state in the product is the same component, so the
           * honest signal is that none of them is on screen any more. Recorded
           * rather than thrown: a shot that timed out here is still worth
           * having, and the manifest says it is not finished.
           */
          const skeletons = page.locator('[data-slot="skeleton"]');
          let loaded = true;
          try {
            await expect(skeletons).toHaveCount(0, { timeout: 15_000 });
          } catch {
            loaded = false;
          }

          // A signed-in screen that bounced to sign-in is a finding, not a
          // shot to quietly keep.
          const redirectedToSignIn = page.url().includes("/sign-in") && !screen.anonymous;

          /**
           * A server error is the one thing this pass does assert.
           *
           * It asserts little by design — but sixty green shots while every
           * desk screen was a 500 is the report lying, and that happened: the
           * manifest recorded it and the suite still passed. A picture of an
           * error page is worth nothing, so this fails rather than files it.
           */
          expect(response?.status() ?? 0, `${path} returned a server error`).toBeLessThan(500);

          mkdirSync(OUT_DIR, { recursive: true });
          const file = `${name}.png`;
          await page.screenshot({ path: join(OUT_DIR, file), fullPage: true });

          writeRow(
            {
              shot: screen.shot,
              title: screen.title,
              description: screen.description,
              path,
              locale,
              theme,
              viewport: "desktop",
              file,
              status: response?.status() ?? null,
              ms,
              loaded,
              redirectedToSignIn,
              consoleErrors,
              pageErrors,
              failedRequests,
            },
            name
          );
        });
      }
    });
  }
}

/** Signed in as a manager: the setup screen does not exist for anyone else. */
test.use({ storageState: storageStateFor("admin") });

export type { Screen };
