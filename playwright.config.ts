import { defineConfig, devices } from "@playwright/test";
import "dotenv/config";

/**
 * End-to-end: a real browser, a real server, a real database.
 *
 * The layer `model/` and `tests/server/` cannot reach — that a person can do
 * the thing, not that a rule is right or a procedure asks the right question.
 * It stays small on purpose; anything provable without a browser is proved
 * without one.
 *
 * **Its own database.** `tests/server` shares the dev one and survives by
 * tagging every fixture uniquely; a browser reads the same seeded demo a
 * developer is looking at, and a test that checks somebody in would change what
 * they see. `scripts/e2e-db.mts` creates and seeds it.
 */

export const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? "postgresql://konak:konak@localhost:5433/konak_e2e?schema=public";

const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /.*\.e2e\.ts/,

  fullyParallel: true,
  forbidOnly: !!process.env.CI,

  // On CI only. A retry locally hides a flake from the person who wrote it.
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,

  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],

  // A default timeout makes every failure look the same. These say which kind.
  timeout: 60_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,

    // Artefacts only for the runs that need them.
    trace: "retain-on-failure",
    video: "retain-on-failure",
    screenshot: "only-on-failure",

    // Motion arrives in Phase 12; the seam for turning it off exists first, so
    // a transition never decides whether an assertion was early.
    contextOptions: { reducedMotion: "reduce" },
  },

  /**
   * Split by *kind*, not by browser — which is what cal.com and documenso both
   * do, and neither fans its main suite across engines. Chromium is the honest
   * default; add another when a real bug makes the case.
   */
  projects: [
    {
      name: "setup",
      testMatch: /.*\.setup\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "journeys",
      dependencies: ["setup"],
      // Both deliverables are excluded by directory. A new one that is not
      // listed here is picked up by this project and run with its settings —
      // which is silent, because a capture pass asserts almost nothing.
      testIgnore: /(report|mvp)\//,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      // The screenshot pass. Its own project because it is a deliverable rather
      // than a test: it asserts little and is expected to take every shot.
      name: "report",
      dependencies: ["setup"],
      testMatch: /report\/.*\.e2e\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      // The client's report: the desk only, in Russian, in light, with crops
      // and actions. `scripts/mvp-report.mts` turns what this writes into
      // `docs/reports/mvp-report.ru.md`.
      name: "mvp",
      dependencies: ["setup"],
      testMatch: /mvp\/.*\.e2e\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],

  webServer: {
    // Dev rather than a build: the server has to read a different
    // `DATABASE_URL`, and a dev server reads env at request time.
    command: "npm run dev",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: "ignore",
    stderr: "pipe",
    env: {
      DATABASE_URL: E2E_DATABASE_URL,
      PORT: String(PORT),
      // Better Auth checks the origin against its own `baseURL`, so a server on
      // a different port has to be told where it is — otherwise every sign-in
      // is refused with "Invalid origin" and the form simply does nothing.
      BETTER_AUTH_URL: baseURL,
      // Uploads land beside the e2e database, not in the developer's.
      STORAGE_FS_ROOT: ".storage-e2e",
    },
  },
});
