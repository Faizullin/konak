import { expect, test } from "./lib/fixtures";
import { storageStateFor } from "./fixtures/auth";
import { toDayInput } from "./lib/dates";

/**
 * Booking a date that is not tonight.
 *
 * The walk-in beside it books, assigns and checks in at once — the right shape
 * for a guest already at the desk and the only shape there was, which meant the
 * product could not sell next month at all. This asks the question the other
 * way round: pick the nights, see what is actually free, then take it.
 */

test.use({ storageState: storageStateFor("admin") });

test("a booking is made for next month, against real availability", async ({
  grid,
  page,
  property,
}) => {
  const arrival = toDayInput(30);
  const departure = toDayInput(32);
  const surname = `Future-${Date.now()}`;

  await grid.open();
  await grid.newBooking.click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  await dialog.getByLabel("Arrival").fill(arrival);
  await dialog.getByLabel("Departure").fill(departure);

  // What is free is the *worst* night, not the first: a type free on four
  // nights and sold out on the fifth cannot be sold for the stay.
  const choose = dialog.getByRole("button", { name: "Choose" }).first();
  await expect(choose).toBeEnabled();
  await choose.click();

  // Choosing a type is the moment the search becomes a booking, and the hold
  // is taken then rather than on every keystroke.
  await expect(dialog.getByRole("button", { name: "Held" })).toBeVisible();

  await dialog.getByLabel("First name").fill("Nora");
  await dialog.getByLabel("Last name").fill(surname);
  await dialog.getByRole("button", { name: "Book", exact: true }).click();

  await expect(dialog).toBeHidden();

  // The booking is real, and on the grid at its own dates — a room was never
  // chosen, so it is drawn in its type's unassigned band.
  await grid.open(arrival);
  await expect(grid.chip(`Nora ${surname}`)).toBeVisible();

  await cleanUp(surname);
  await releaseHolds(property.roomTypeId);
});

test("a dialog closed without booking gives the room back", async ({ grid, page, property }) => {
  const arrival = toDayInput(45);
  const departure = toDayInput(46);

  const free = async () => {
    const nights = await freeOn(property.propertyId, property.roomTypeId, arrival);
    return nights;
  };

  const before = await free();

  await grid.open();
  await grid.newBooking.click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Arrival").fill(arrival);
  await dialog.getByLabel("Departure").fill(departure);
  await dialog.getByRole("button", { name: "Choose" }).first().click();
  await expect(dialog.getByRole("button", { name: "Held" })).toBeVisible();

  // A search that walked away must not keep a room off sale for fifteen
  // minutes — the difference between a question and a promise.
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toBeHidden();

  // Generously: `releaseHold` is fired as the dialog closes and nothing waits
  // for it — which is right for a person walking away, and means the test has
  // to wait rather than assume. Five seconds was tight enough to flake under a
  // parallel run against a dev server still compiling routes.
  await expect.poll(free, { timeout: 20_000, intervals: [250, 500, 1_000] }).toBe(before);

  // And whatever happened above, this test's claim does not outlive it: a hold
  // lasts fifteen minutes, and one left behind sells the rooms out for the run
  // after this one.
  await releaseHolds(property.roomTypeId);
});

/* --- helpers ------------------------------------------------------------- */

import { query } from "./lib/db";

async function freeOn(propertyId: number, roomTypeId: number, day: string) {
  const [row] = await query<{ held: string }>(
    `select coalesce(sum(quantity), 0)::text as held
       from inventory_holds
      where "roomTypeId" = $1 and "checkIn" <= $2::date and "checkOut" > $2::date
        and "releaseAt" > now()`,
    [roomTypeId, day]
  );
  void propertyId;
  return Number(row?.held ?? 0);
}

/** Any claim this test left, expired or not. */
async function releaseHolds(roomTypeId: number) {
  await query(`delete from inventory_holds where "roomTypeId" = $1`, [roomTypeId]);
}

/** The dialog writes a person and a reservation; both are this test's to remove. */
async function cleanUp(surname: string) {
  await query(
    `delete from reservations where "bookerPersonId" in
                 (select id from people where "lastName" = $1)`,
    [surname]
  );
  await query(`delete from people where "lastName" = $1`, [surname]);
}
