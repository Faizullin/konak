import { expect, test } from "./lib/fixtures";
import { storageStateFor } from "./fixtures/auth";

/**
 * Finding a booking when the dates are not known.
 *
 * The grid is bounded by its window, so a guest ringing about next March cannot
 * be found on it at all. One box answers for three things a desk might know —
 * a name, a room number, a reference — because which of the three it has is
 * not the desk's problem.
 */

test.use({ storageState: storageStateFor("admin") });

const listPath = (deskPath: string) => `${deskPath}/bookings`;

test("a booking is found by guest name, whatever its dates", async ({
  page,
  property,
  bookings,
}) => {
  // Forty days out: past the grid's window and unreachable on it.
  const booking = await bookings.create({ arrivesIn: 40, nights: 3 });

  await page.goto(listPath(property.deskPath));
  await search(page, booking.guestName);

  const row = page.getByRole("link", { name: booking.guestName });
  await expect(row).toBeVisible();

  // Every row opens the card — which is why the card is a route and not a
  // dialog: a dialog opened from a grid cell has nowhere to open from here.
  await row.click();
  await expect(page).toHaveURL(new RegExp(`/bookings/${booking.publicId}`));
});

test("the tabs partition the states, so a cancelled booking leaves Current", async ({
  page,
  property,
  bookings,
}) => {
  const live = await bookings.create({ arrivesIn: 5, status: "CONFIRMED" });
  const over = await bookings.create({ arrivesIn: 5, status: "CANCELLED" });

  await page.goto(listPath(property.deskPath));
  await search(page, "Test");

  // Current is the default tab: sold, or in the building.
  await expect(page.getByRole("link", { name: live.guestName })).toBeVisible();
  await expect(page.getByRole("link", { name: over.guestName })).toBeHidden();

  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(page.getByRole("link", { name: over.guestName })).toBeVisible();
  await expect(page.getByRole("link", { name: live.guestName })).toBeHidden();
});

test("a room number finds the booking in it", async ({ page, property, bookings }) => {
  const booking = await bookings.create({ arrivesIn: 20, roomId: property.roomIds[1] });

  await page.goto(listPath(property.deskPath));
  // The desk knows "102" and nothing else — the caller on the phone said it.
  await search(page, "102");

  await expect(page.getByRole("link", { name: booking.guestName })).toBeVisible();
});

/**
 * Type, then wait for the table to have actually asked for it.
 *
 * The filter is debounced into the URL and the table keeps the previous page on
 * screen while the next loads — deliberately, so it does not blink. Clicking a
 * row before the URL settles clicks the row that was there before.
 */
async function search(page: import("@playwright/test").Page, term: string) {
  await page.getByPlaceholder(/Guest, room or reference/i).fill(term);
  await expect(page).toHaveURL(/guestName=/);
}
