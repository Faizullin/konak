import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

/**
 * Signing in, once per role.
 *
 * The seed writes three accounts with one known password, so a test asks for a
 * role rather than knowing an address. Which role matters more here than it
 * looks: the split the product cares about is *uploading versus deleting*
 * (`product-shape.md` § 2), and a MEMBER seeing a delete button is a bug only a
 * browser can see.
 */

export const DEMO_PASSWORD = "konak-demo-pw";

export const DEMO_USERS = {
  admin: { email: "admin@konak.dev", name: "Ada Admin" },
  moderator: { email: "mod@konak.dev", name: "Mo Moderator" },
  user: { email: "user@konak.dev", name: "Uma User" },
} as const;

export type DemoRole = keyof typeof DEMO_USERS;

/** Where `auth.setup.ts` leaves each role's cookies. */
export const storageStateFor = (role: DemoRole) => `tests/e2e/.auth/${role}.json`;

/**
 * The form, filled the way a person fills it.
 *
 * Deliberately not an API call: this is the one place the sign-in screen itself
 * is exercised, and `authClient` *returns* `{ data, error }` rather than
 * throwing — the trap `CLAUDE.md` names — so a wrong password reading as
 * success is exactly the failure this has to be able to catch.
 */
export async function signIn(page: Page, role: DemoRole) {
  const { email } = DEMO_USERS[role];

  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();

  // The redirect is the assertion: a form that silently did nothing leaves the
  // URL where it was.
  await expect(page).toHaveURL(/\/dashboard/);
}
