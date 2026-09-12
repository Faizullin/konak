import { test as setup } from "@playwright/test";
import { DEMO_USERS, signIn, storageStateFor, type DemoRole } from "./fixtures/auth";

/**
 * Sign in once per role and keep the cookies, rather than signing in inside
 * every test.
 *
 * A setup project is Playwright's own answer to this, and it is the difference
 * between a suite that spends its time on journeys and one that spends it on a
 * login form. The form itself is still tested — in `auth.e2e.ts`, once.
 */

for (const role of Object.keys(DEMO_USERS) as DemoRole[]) {
  setup(`authenticate as ${role}`, async ({ page }) => {
    await signIn(page, role);
    await page.context().storageState({ path: storageStateFor(role) });
  });
}
