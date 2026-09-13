import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "../lib/fixtures";
import { storageStateFor } from "../fixtures/auth";
import { one } from "../lib/db";
import { THEME_STORAGE_KEY } from "@/config/surfaces";
import { STEPS, type Context, type Step } from "./steps";

/**
 * The client's report, photographed.
 *
 * A spec rather than a standalone script, for the same reason
 * `report/capture.e2e.ts` is one: it inherits the sign-in, the seeded property,
 * the `webServer` and the traces. Its own project, so `npm run test:e2e` does
 * not take fifteen pictures on the way to asserting six journeys.
 *
 * The differences from the other pass are the whole point. This one is the
 * **desk only, in Russian, in light**, and most of its shots are *crops* — a
 * 1440px page scaled into a document shows a person nothing, and the subject of
 * "sold and free per night" is four numbers. It also performs actions: a dialog
 * that nobody opened is not in the picture.
 *
 * It asserts three things and no more: the page is not a 5xx, the data has
 * drawn, and **the thing it is about to photograph is on screen and has a
 * size**. The last is the one that matters here — a locator that silently moves
 * produces a confident picture of the wrong element, which is worse than a
 * failed run.
 */

export const SHOTS_DIR = join("docs", "reports", "screens");
export const ROWS_DIR = process.env.MVP_ROWS_DIR ?? join("reports", "mvp", "rows");

/** The script's own files, and the only ones it may delete. */
const GENERATED = /^gen-.*\.png$/;

test.use({ storageState: storageStateFor("admin") });

/**
 * Serial, against the other pass's parallel.
 *
 * Fifteen shots is a minute, and the first thing this does is delete the
 * previous set — which is a race the moment two workers share the directory.
 */
test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  mkdirSync(SHOTS_DIR, { recursive: true });
  mkdirSync(ROWS_DIR, { recursive: true });

  // Only `gen-*`. A photograph somebody put in this folder by hand survives
  // every run — `docs/reports/index.md` promises that — and a step removed from
  // the manifest cannot leave a stale picture behind.
  for (const file of readdirSync(SHOTS_DIR)) {
    if (GENERATED.test(file)) rmSync(join(SHOTS_DIR, file));
  }
  for (const file of readdirSync(ROWS_DIR)) {
    if (file.endsWith(".json")) rmSync(join(ROWS_DIR, file));
  }
});

/** `gen-01-grid.png` — the number is the order in the document. */
const fileFor = (step: Step) => `gen-${String(step.order).padStart(2, "0")}-${step.id}.png`;

test.beforeEach(async ({ context }) => {
  // The language is a cookie the server reads; there is no locale in the URL.
  // By domain rather than by `url`: a page that has not navigated is
  // `about:blank`, and a blank page cannot hold a cookie.
  await context.addCookies([{ name: "konak.locale", value: "ru", domain: "localhost", path: "/" }]);

  // Light, through the product's own preference rather than a class injected
  // here — an init script because `next-themes` reads it before first paint.
  await context.addInitScript(([key, value]) => window.localStorage.setItem(key, value), [
    THEME_STORAGE_KEY,
    "light",
  ] as const);
});

for (const step of STEPS) {
  test(`${step.order} ${step.id}`, async ({ page, property }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];

    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));

    // Мария Иванова: the guest the report's history section is about. Read
    // rather than assumed, because `demo.mts` owns who she is.
    const regular = await one<{ id: number }>(
      `select id from people
        where "organizationId" = $1 and "firstName" = $2 and "lastName" = $3
        order by id limit 1`,
      [property.organizationId, "Мария", "Иванова"]
    );

    const context: Context = { page, property, regularPersonId: regular.id };
    const path = step.path(context);

    // Not `networkidle`: the desk polls every thirty seconds, so the network is
    // never idle on the one screen this report exists for.
    const response = await page.goto(path, { waitUntil: "load" });
    expect(response?.status() ?? 0, `${path} returned a server error`).toBeLessThan(500);

    // Every loading state in the product is the same component, so the honest
    // signal that the data has arrived is that none of them is on screen.
    await expect(page.locator('[data-slot="skeleton"]')).toHaveCount(0, { timeout: 15_000 });

    await step.act?.(context);

    const file = fileFor(step);
    const destination = join(SHOTS_DIR, file);

    if (step.frame.kind === "page") {
      await page.screenshot({ path: destination });
    } else {
      const target = step.frame.locate(context);

      // The assertion this pass exists to make. A locator that has moved finds
      // nothing, or finds something with no box — either way the run stops
      // rather than filing a picture of the wrong thing.
      await expect(target, `${step.id}: nothing to photograph`).toBeVisible();
      const box = await target.boundingBox();
      expect(box, `${step.id}: the target has no box`).not.toBeNull();
      expect(box!.width * box!.height, `${step.id}: the target is empty`).toBeGreaterThan(0);

      if (step.frame.kind === "element") {
        await target.screenshot({ path: destination });
      } else {
        const { pad } = step.frame;
        const viewport = page.viewportSize() ?? { width: 1440, height: 900 };

        // Clipped to the viewport: a rectangle that runs off the page is an
        // error in Playwright, and the padding is deliberately generous so the
        // crop survives a layout that shifts by a few pixels.
        const x = Math.max(0, box!.x - (pad.left ?? 0));
        const y = Math.max(0, box!.y - (pad.top ?? 0));
        await page.screenshot({
          path: destination,
          clip: {
            x,
            y,
            width: Math.min(viewport.width - x, box!.width + (pad.left ?? 0) + (pad.right ?? 0)),
            height: Math.min(viewport.height - y, box!.height + (pad.top ?? 0) + (pad.bottom ?? 0)),
          },
        });
      }
    }

    // One file per row rather than one shared manifest: the same reason the
    // other pass gives, and cheap enough to keep even while this one is serial.
    writeFileSync(
      join(ROWS_DIR, `${step.id}.json`),
      JSON.stringify(
        {
          id: step.id,
          order: step.order,
          caption: step.caption,
          path,
          file,
          status: response?.status() ?? null,
          consoleErrors,
          pageErrors,
        },
        null,
        2
      )
    );
  });
}
