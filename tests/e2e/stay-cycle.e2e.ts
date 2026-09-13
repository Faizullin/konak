import { expect, test } from "./lib/fixtures";
import { storageStateFor } from "./fixtures/auth";
import { query } from "./lib/db";

/**
 * Phase 5's **Done when**, in one journey.
 *
 * *A full stay cycle happens in the app: booked, arrived, occupied, departed,
 * cleaned.* Two screens and five states, and the only assertions are things a
 * person can see — the point being that nobody had to open a database or
 * remember to tell the floor.
 */

test.use({ storageState: storageStateFor("admin") });

test("a stay goes from booked to cleaned, without anyone being told twice", async ({
  grid,
  page,
  bookings,
  property,
}) => {
  // Booked: arriving today, in a room, so check-in is legal.
  const booking = await bookings.create({ arrivesIn: 0, nights: 1, roomId: property.roomIds[1] });
  const room = await roomNumber(property.roomIds[1]!);

  await grid.open();
  await grid.select(booking.guestName);

  // Arrived.
  await grid.action("Check in").click();
  await expect(grid.action("Check out")).toBeEnabled();

  // Departed. The desk does one thing; two follow from it.
  await grid.action("Check out").click();
  await expect(grid.action("Check out")).toBeHidden();

  // The floor was told. Nobody typed this — check-out is the event that creates
  // the work, and a board that has to be told separately goes stale.
  await page.goto(`${property.deskPath}/housekeeping`);

  const card = page.getByRole("listitem").filter({ hasText: room });
  await expect(card.getByText("Dirty")).toBeVisible();
  await expect(card.getByText("Departure clean")).toBeVisible();

  // Cleaned.
  await card.getByRole("button", { name: "Start" }).click();
  await expect(card.getByText("Being cleaned").first()).toBeVisible();

  await card.getByRole("button", { name: "Mark clean" }).click();
  await expect(card.getByText("Clean", { exact: true })).toBeVisible();
  await expect(card.getByText("Nothing owed")).toBeVisible();

  await cleanTasks(property.roomIds[1]!);
});

test("a blocking fault takes the room out of sale, from the floor", async ({ page, property }) => {
  const roomId = property.roomIds[0]!;
  const room = await roomNumber(roomId);

  await page.goto(`${property.deskPath}/housekeeping`);
  const card = page.getByRole("listitem").filter({ hasText: room });

  await card.getByRole("button", { name: "Report a fault" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  await dialog.getByLabel("What is wrong").fill("Shower will not drain");
  await dialog.getByLabel("How bad").click();
  await page.getByRole("option", { name: "Room unusable" }).click();

  // Said before it is sent, not discovered afterwards.
  await expect(dialog.getByText("This takes the room out of sale.")).toBeVisible();
  await dialog.getByRole("button", { name: "Report it" }).click();
  await expect(dialog).toBeHidden();

  await expect(card.getByText("Out of order")).toBeVisible();

  // Fixed is not cleaned: somebody still has to go in.
  await card.getByRole("button", { name: "Fixed" }).click();
  await expect(card.getByText("Dirty")).toBeVisible();

  await query(`delete from maintenance_issues where "roomId" = $1`, [roomId]);
  await query(`update rooms set status = 'CLEAN' where id = $1`, [roomId]);
});

async function roomNumber(id: number) {
  const [row] = await query<{ number: string }>(`select number from rooms where id = $1`, [id]);
  return row!.number;
}

/** The tasks this journey created are its own to remove. */
async function cleanTasks(roomId: number) {
  await query(`delete from housekeeping_tasks where "roomId" = $1`, [roomId]);
  await query(`update rooms set status = 'CLEAN' where id = $1`, [roomId]);
}
