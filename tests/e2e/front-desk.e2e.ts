import { expect, test } from "./lib/fixtures";
import { storageStateFor } from "./fixtures/auth";

/**
 * A desk runs a day.
 *
 * Phase 4's **Done when**, asserted end to end: a receptionist can see what is
 * happening, open a booking, and move it through its states — without SQL and
 * without a developer. Six procedures and three screens are crossed on the way.
 */

test.use({ storageState: storageStateFor("admin") });

test("the grid draws a booking, and it opens as a card", async ({ grid, bookings, page }) => {
  const booking = await bookings.create({ arrivesIn: 1, nights: 2 });

  await grid.open();
  await grid.select(booking.guestName);

  // The action bar answers for the chip; the card answers for the reservation.
  await expect(grid.openCard).toBeVisible();
  await grid.openCard.click();

  await expect(page).toHaveURL(new RegExp(`/bookings/${booking.publicId}`));
  await expect(page.getByRole("heading", { name: booking.guestName })).toBeVisible();

  // A route rather than a dialog was the point: it survives a reload.
  await page.reload();
  await expect(page.getByRole("heading", { name: booking.guestName })).toBeVisible();
});

test("a booking that has not arrived cannot check in, and the button says why", async ({
  grid,
  bookings,
}) => {
  // Tomorrow. The desk refuses more than the machine does, and this is the
  // rule most easily lost: a greyed-out button with no reason teaches nothing.
  const booking = await bookings.create({ arrivesIn: 1, roomId: null });

  await grid.open();
  await grid.select(booking.guestName);

  const checkIn = grid.action("Check in");
  await expect(checkIn).toBeDisabled();
  await expect(checkIn).toHaveAttribute("title", /room|arrive/i);
});

test("a guest arriving today, in a room, checks in", async ({ grid, bookings, property, page }) => {
  // The second room: the seed's own booking holds the first for these nights,
  // and the exclusion constraint is right to refuse a second guest in it.
  const booking = await bookings.create({ arrivesIn: 0, roomId: property.roomIds[1] });

  await grid.open();
  await grid.select(booking.guestName);

  const checkIn = grid.action("Check in");
  await expect(checkIn).toBeEnabled();
  await checkIn.click();

  // The day lists and the grid read the same booking; neither may keep the old
  // answer. `In house` is the list it lands in.
  await expect(page.getByText(booking.guestName).first()).toBeVisible();
  await expect(grid.action("Check out")).toBeEnabled();
});

test("an unassigned booking is drawn in its type's band, not in a room", async ({
  grid,
  bookings,
  page,
}) => {
  const booking = await bookings.create({ arrivesIn: 2, roomId: null });

  await grid.open();

  // The band is the piece most naive grids omit, and the reason a booking can
  // exist before a door is chosen.
  const band = page.getByText("Unassigned").first();
  await expect(band).toBeVisible();
  await expect(grid.chip(booking.guestName)).toBeVisible();
});

test("the window is an anchor, so a date is reached in one act", async ({ grid, bookings }) => {
  // Forty days out — unreachable in the calendar-month grid this replaced, and
  // inside the seed's ninety-night horizon.
  const booking = await bookings.create({ arrivesIn: 40, nights: 2 });
  const on = booking.checkIn.toISOString().slice(0, 10);

  await grid.open(on);

  await expect(grid.jumpToDate).toHaveValue(on);
  await expect(grid.chip(booking.guestName)).toBeVisible();
});

test("cancelling asks first, and releases the nights", async ({ grid, bookings, page }) => {
  const booking = await bookings.create({ arrivesIn: 3, status: "CONFIRMED" });

  await grid.open();
  await grid.select(booking.guestName);
  await grid.action("Cancel booking").click();

  // The two that end a booking ask first, wherever they are offered.
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel booking" }).click();

  // Cancelled and no-show are not drawn: a chip left behind would say a free
  // room is taken.
  await expect(grid.chip(booking.guestName)).toBeHidden();
});
