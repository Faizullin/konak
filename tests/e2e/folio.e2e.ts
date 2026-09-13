import { expect, test } from "./lib/fixtures";
import { storageStateFor } from "./fixtures/auth";
import { query } from "./lib/db";

/**
 * Phase 6's **Done when**, in a browser: a stay produces a bill that balances,
 * is settled and closed.
 *
 * The desk does not open the bill by hand — checking out does, because a
 * departure is when there is something to number. What a person does here is
 * add what the guest actually had, take the money, and close it.
 */

test.use({ storageState: storageStateFor("admin") });

test("a departure opens the bill, and the desk settles and closes it", async ({
  grid,
  page,
  bookings,
  property,
}) => {
  const booking = await bookings.create({ arrivesIn: 0, nights: 1, roomId: "free" });

  await grid.open();
  await grid.select(booking.guestName);
  await grid.action("Check in").click();

  // Wait for the arrival to land. Clicking straight through sends check-out
  // against a booking that is still CONFIRMED, which is refused — and the
  // symptom is this test failing three assertions later, on a missing bill.
  await expect(grid.action("Check out")).toBeEnabled();
  await grid.action("Check out").click();

  // And for the departure. Navigating while the mutation is still in flight
  // loads the card before the folio exists, and the bill looks unopened.
  await expect(grid.action("Check out")).toBeHidden();

  await page.goto(`${property.deskPath}/bookings/${booking.publicId}`);

  // Opened by the departure, not by a button: the number was taken when there
  // was something to number.
  await expect(page.getByText("Bill", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open the bill" })).toBeHidden();

  // Something the guest actually had, on top of the room.
  await page.getByPlaceholder("What it is for").fill("Minibar");
  await page.getByPlaceholder("Minor units").fill("450");
  await page.getByRole("button", { name: "Post", exact: true }).click();
  await expect(page.getByText("Minibar")).toBeVisible();

  // A bill closes only when it balances, and it says so before the press.
  const close = page.getByRole("button", { name: "Close the bill" });
  await expect(close).toBeDisabled();
  await expect(page.getByText("A bill closes only when it balances.")).toBeVisible();

  await page.getByRole("button", { name: "Take the balance" }).click();
  await expect(close).toBeEnabled();

  await close.click();
  await expect(page.getByText("Closed", { exact: true })).toBeVisible();

  // And a closed bill is a record: no more charges.
  await expect(page.getByRole("button", { name: "Post", exact: true })).toBeHidden();

  await cleanUp(booking.id, booking.roomId!);
});

test("a void is struck through, not removed", async ({ page, property, bookings }) => {
  const booking = await bookings.create({ arrivesIn: 0, nights: 1, roomId: "free" });

  await page.goto(`${property.deskPath}/bookings/${booking.publicId}`);
  await page.getByRole("button", { name: "Open the bill" }).click();

  await page.getByPlaceholder("What it is for").fill("Charged in error");
  await page.getByPlaceholder("Minor units").fill("900");
  await page.getByRole("button", { name: "Post", exact: true }).click();

  const line = page.getByText("Charged in error");
  await expect(line).toBeVisible();

  await page.getByRole("button", { name: "Void" }).click();

  // Still there, struck through: a bill somebody has already seen is a record,
  // and a correction is a new line rather than an edit.
  await expect(line).toBeVisible();
  await expect(line).toHaveCSS("text-decoration-line", /line-through/);

  await cleanUp(booking.id, booking.roomId!);
});

/** The bill, the task and the room state this journey created. */
async function cleanUp(reservationId: number, roomId: number) {
  await query(`delete from payments where "reservationId" = $1`, [reservationId]);
  await query(`delete from folios where "reservationId" = $1`, [reservationId]);
  await query(`delete from housekeeping_tasks where "roomId" = $1`, [roomId]);
  await query(`update rooms set status = 'CLEAN' where id = $1`, [roomId]);
}
