import { expect, test } from "./lib/fixtures";
import { storageStateFor } from "./fixtures/auth";

/**
 * The language switch, which has no server test and cannot have one.
 *
 * Every string comes from a message file and two tests already hold the two
 * locales to the same keys — but neither can see a screen that renders English
 * because a formatter was pinned, or a word that arrives untranslated because
 * it was a template literal rather than a `t()` call. Both have happened here.
 */

test.use({ storageState: storageStateFor("admin") });

test("the desk moves into Russian, and back", async ({ grid, page }) => {
  await grid.open();

  // The counts row a hotelier reads first, in both languages.
  await expect(page.getByText("Sold", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Free", { exact: true }).first()).toBeVisible();

  await switchLanguage(page, "Русский");
  await grid.open();

  await expect(page.getByText("Занято", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Свободно", { exact: true }).first()).toBeVisible();
  // The band is the reference product's own words, and the piece most grids omit.
  await expect(page.getByText("Не выбран номер").first()).toBeVisible();

  await switchLanguage(page, "English");
  await grid.open();
  await expect(page.getByText("Sold", { exact: true }).first()).toBeVisible();
});

test("dates follow the language, not only the words", async ({ page, grid }) => {
  // Navigate first: the menu the switcher lives in is on a page.
  await grid.open();
  await switchLanguage(page, "Русский");
  await grid.open();

  // Six formatters were pinned to "en" at module scope. A screen whose words
  // move while its dates stay put reads as half-translated.
  await expect(page.getByText(/сентябр|октябр|ноябр|декабр/i).first()).toBeVisible();

  await switchLanguage(page, "English");
});

test("a refusal is refused in Russian", async ({ page, grid, bookings }) => {
  // Tomorrow, and no room: two reasons the desk refuses, both worded from a
  // domain code rather than a sentence the server wrote.
  const booking = await bookings.create({ arrivesIn: 1, roomId: null });

  await grid.open();
  await switchLanguage(page, "Русский");
  await grid.open();
  await grid.select(booking.guestName);

  const checkIn = grid.action("Заселить");
  await expect(checkIn).toBeDisabled();
  // Cyrillic, not the server's English fallback — which is what every refusal
  // showed while `errors.json` was flat and `t.has()` answered false.
  await expect(checkIn).toHaveAttribute("title", /[Ѐ-ӿ]/);

  await switchLanguage(page, "English");
});

/** The switcher lives in the sidebar's user menu; there is no locale in the URL. */
async function switchLanguage(page: import("@playwright/test").Page, label: string) {
  await page.getByRole("button", { name: /@konak\.dev/ }).click();
  await page.getByRole("menuitem", { name: label }).click();
  await page.waitForLoadState("networkidle").catch(() => {});
}
