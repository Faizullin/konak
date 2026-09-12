import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "../lib/fixtures";
import { storageStateFor } from "../fixtures/auth";
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

          const path = screen.path
            .replace(":org", property.organizationSlug)
            .replace(":property", property.propertySlug);

          const started = Date.now();
          // Not `networkidle`: the desk polls every thirty seconds, so the
          // network is never idle and the wait runs to its timeout on the one
          // screen the report exists for.
          const response = await page.goto(path, { waitUntil: "load" });
          await page.waitForLoadState("domcontentloaded");
          const ms = Date.now() - started;

          // Dark mode is a class variant and nothing in the product sets it
          // yet. Setting it here is not a shortcut — it is the only way to
          // photograph the dark tokens, and `ui-patterns.md` requires them to
          // exist because front desks run dim.
          if (theme === "dark") {
            await page.evaluate(() => document.documentElement.classList.add("dark"));
          }

          // A signed-in screen that bounced to sign-in is a finding, not a
          // shot to quietly keep.
          const redirectedToSignIn = page.url().includes("/sign-in") && !screen.anonymous;

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
