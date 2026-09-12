import { randomUUID } from "node:crypto";
import { one, query } from "../lib/db";

/**
 * Bookings a test made, and the promise to remove them.
 *
 * cal.com's shape: the factory keeps a store of what it created and exposes
 * `deleteAll()`, so a spec reads `await bookings.create()` and the cleanup is
 * not the spec's problem. Without it the demo fills with a test's leftovers and
 * the screenshot report photographs them.
 *
 * Arranged by writing rows rather than by clicking: getting a booking into a
 * given state is *setup*, and setting it up through the UI makes every test
 * depend on the screen it is not testing. What is asserted is still only ever
 * what the screen shows.
 */

/** The three the exclusion constraint counts, spelled as the migration spells them. */
export const HOLDING_STATUSES = ["CONFIRMED", "CHECKED_IN", "CHECKED_OUT"] as const;

export type BookingSeed = {
  /** Nights from the property's today. `0` arrives today, which is what check-in needs. */
  arrivesIn?: number;
  nights?: number;
  status?: string;
  /** A door, or `null` to leave it in the unassigned band. */
  roomId?: number | null;
  guest?: { firstName: string; lastName: string };
};

/** UTC midnight, the way `toStayDate` in `model/stay.ts` defines a stay date. */
const stayDate = (offsetDays: number) => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offsetDays));
};

export function createBookingsFixture(context: {
  propertyId: number;
  organizationId: number;
  roomTypeId: number;
}) {
  const reservations: number[] = [];
  const people: number[] = [];

  /**
   * Every test's guests share one tag, and no two tests share the tag.
   *
   * The suite is `fullyParallel` against a single seeded property, so six tests
   * draw on one grid at once — and a chip's accessible name is its guest name.
   * Without this, "Test Guest 1" matches another test's booking and an
   * assertion passes against work it did not do.
   */
  const tag = randomUUID().slice(0, 8);

  return {
    async create(seed: BookingSeed = {}) {
      const {
        arrivesIn = 0,
        nights = 2,
        status = "CONFIRMED",
        roomId = null,
        guest = { firstName: "Test", lastName: `${tag}-${reservations.length + 1}` },
      } = seed;

      const checkIn = stayDate(arrivesIn);
      const checkOut = stayDate(arrivesIn + nights);

      const person = await one<{ id: number }>(
        `insert into people ("organizationId", "firstName", "lastName", "updatedAt")
         values ($1, $2, $3, now()) returning id`,
        [context.organizationId, guest.firstName, guest.lastName]
      );
      people.push(person.id);

      // The tag, not the clock: `(propertyId, reference)` is unique, and two
      // parallel workers creating their first booking in the same millisecond
      // collide on it. Still readable enough to find by hand after a failure.
      const reference = `E2E-${tag}-${reservations.length}`;
      const publicId = randomUUID();

      const reservation = await one<{ id: number }>(
        `insert into reservations
           ("propertyId", "publicId", reference, status, source,
            "bookerPersonId", "currencyCode", "totalMinor", "updatedAt")
         values ($1, $2, $3, $4, 'DIRECT', $5, 'EUR', 0, now())
         returning id`,
        [context.propertyId, publicId, reference, status, person.id]
      );
      reservations.push(reservation.id);

      await query(
        `insert into room_stays
           ("reservationId", "roomTypeId", "roomId", status,
            "checkIn", "checkOut", adults, "currencyCode", "totalMinor", "updatedAt")
         values ($1, $2, $3, $4, $5, $6, 1, 'EUR', 0, now())`,
        [reservation.id, context.roomTypeId, roomId, status, checkIn, checkOut]
      );

      return {
        id: reservation.id,
        publicId,
        reference,
        guestName: `${guest.firstName} ${guest.lastName}`,
        checkIn,
        checkOut,
      };
    },

    /** Idempotent, and ordered: a stay references a person with `onDelete: Restrict`. */
    async deleteAll() {
      if (reservations.length > 0) {
        await query(`delete from reservations where id = any($1::int[])`, [reservations]);
        reservations.length = 0;
      }
      if (people.length > 0) {
        await query(`delete from people where id = any($1::int[])`, [people]);
        people.length = 0;
      }
    },
  };
}
