import { expect, test } from "./lib/fixtures";
import { storageStateFor } from "./fixtures/auth";

/**
 * Every dialog opens.
 *
 * The cheapest test in the suite and the one with the best record: all seven
 * form dialogs in the product rendered outside `NextIntlClientProvider` and
 * threw the moment they opened, and nothing noticed because nothing had ever
 * opened one. `confirm()` kept working and hid it — that one takes its words as
 * props, so it never reaches for a translator.
 *
 * Each of these asserts almost nothing beyond "it drew, with its own words in
 * it". That is the assertion that would have caught it.
 */

test.use({ storageState: storageStateFor("admin") });

const dialog = (page: import("@playwright/test").Page) => page.getByRole("dialog");

test("the walk-in dialog opens", async ({ grid, page }) => {
  await grid.open();
  await page.getByRole("button", { name: "Walk-in" }).click();

  await expect(dialog(page)).toBeVisible();
  // A translated string, not a key and not a crash.
  await expect(dialog(page).getByText("Books tonight, assigns the room")).toBeVisible();
});

test("the new-booking dialog opens", async ({ grid, page }) => {
  await grid.open();
  await grid.newBooking.click();

  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).getByText("Pick the nights, see what is free")).toBeVisible();
});

test("the room type, room and rate plan dialogs open", async ({ page, property }) => {
  await page.goto(`${property.deskPath}/setup`);

  for (const [button, heading] of [
    ["New type", "New room type"],
    ["New room", "New room"],
    ["New plan", "New rate plan"],
  ] as const) {
    await page.getByRole("button", { name: button, exact: true }).click();
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page).getByText(heading, { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog(page)).toBeHidden();
  }
});

test("the organization dialog opens", async ({ page }) => {
  await page.goto("/dashboard/orgs");
  await page.getByRole("button", { name: "New organization" }).first().click();

  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).getByLabel("Slug")).toBeVisible();
});

test("the attachment dialog opens", async ({ page, property }) => {
  await page.goto(`${property.deskPath}/setup`);

  // The panel's own upload entry — the same `uploadAttachment()` any feature
  // can open from anywhere, which is why it is worth one test of its own.
  const panel = page.getByText("Photographs and documents");
  await expect(panel).toBeVisible();
  await expect(page.getByText("Drop a file here").first()).toBeVisible();
});
