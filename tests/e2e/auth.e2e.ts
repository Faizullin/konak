import { expect, test } from "./lib/fixtures";
import { DEMO_PASSWORD, DEMO_USERS, signIn } from "./fixtures/auth";

/**
 * The sign-in form, and the one failure a browser exists to catch.
 *
 * No stored state here: this is the screen that creates it.
 */
test.use({ storageState: { cookies: [], origins: [] } });

test("a known account reaches the dashboard", async ({ page }) => {
  await signIn(page, "admin");
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
});

test("a wrong password is refused, and says so", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(DEMO_USERS.admin.email);
  await page.getByLabel("Password").fill(`${DEMO_PASSWORD}-wrong`);
  await page.getByRole("button", { name: "Sign in" }).click();

  // The trap `CLAUDE.md` names: `authClient` *returns* `{ data, error }` rather
  // than throwing, so a handler that assumed a throw would send this to the
  // dashboard. Staying put is the assertion; a message is the courtesy.
  await expect(page).toHaveURL(/\/sign-in/);
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});

test("the dashboard is not reachable signed out", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/sign-in/);
});
