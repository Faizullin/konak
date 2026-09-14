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
  /**
   * A door, `null` to leave it in the unassigned band, or `"free"` for any room
   * nothing else holds on those nights.
   *
   * Prefer `"free"`. A hard-coded index is how four specs came to book the
   * second room today at once, and `room_stays_no_overlap` refused three of
   * them — correctly. The constraint was never the flake; the fixture was.
   */
  roomId?: number | null | "free";
  guest?: { firstName: string; lastName: string };
};

/** Postgres says this when two stays claim one room on one night. */
const EXCLUSION_VIOLATION = "23P01";

/**
 * A room nothing holds between these dates, skipping any already tried.
 *
 * Ordered at random rather than by id: the point is that two workers asking at
 * the same moment usually get different answers, so the retry below is a rare
 * second attempt instead of the normal path.
 */
async function freeRoom(args: {
  propertyId: number;
  checkIn: Date;
  checkOut: Date;
  exclude: number[];
}): Promise<{ id: number; roomTypeId: number }> {
  return one<{ id: number; roomTypeId: number }>(
    `select r.id, r."roomTypeId"
       from rooms r
      where r."propertyId" = $1
        and r."archivedAt" is null
        and not (r.id = any($4::int[]))
        and not exists (
          select 1 from room_stays s
           where s."roomId" = r.id
             and s.status = any($5::text[])
             and s."checkIn" < $3
             and s."checkOut" > $2)
      order by random()
      limit 1`,
    [args.propertyId, args.checkIn, args.checkOut, args.exclude, [...HOLDING_STATUSES]]
  );
}

/**
 * The stay, and one more attempt if somebody took the room in between.
 *
 * Choosing and inserting are two statements, so a parallel worker can claim the
 * room in the gap. The database is the only authority on that, and it answers
 * with `23P01` — so the honest loop is to ask it again rather than to lock a
 * table the product never locks.
 */
async function insertStay(args: {
  reservationId: number;
  roomTypeId: number;
  propertyId: number;
  roomId: number | null | "free";
  status: string;
  checkIn: Date;
  checkOut: Date;
}): Promise<number | null> {
  const tried: number[] = [];

  for (let attempt = 0; ; attempt += 1) {
    // A chosen room brings its own category. Taking the property's first one
    // instead puts a Double booking in a Single room — legal in SQL, and the
    // grid then draws the chip in a group the stay does not belong to.
    const free = args.roomId === "free" ? await freeRoom({ ...args, exclude: tried }) : null;
    const roomId = free ? free.id : (args.roomId as number | null);
    const roomTypeId = free ? free.roomTypeId : args.roomTypeId;

    try {
      await query(
        `insert into room_stays
           ("reservationId", "propertyId", "roomTypeId", "roomId", status,
            "checkIn", "checkOut", adults, "currencyCode", "totalMinor", "updatedAt")
         values ($1, $2, $3, $4, $5, $6, $7, 1, 'EUR', 0, now())`,
        [
          args.reservationId,
          // The stay carries its own scope, and a composite foreign key refuses
          // it if it disagrees with the reservation's — so this is checked, not
          // merely copied.
          args.propertyId,
          roomTypeId,
          roomId,
          args.status,
          args.checkIn,
          args.checkOut,
        ]
      );
      return roomId;
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (args.roomId !== "free" || code !== EXCLUSION_VIOLATION || attempt >= 4) throw error;
      tried.push(roomId as number);
    }
  }
}

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

      const assigned = await insertStay({
        reservationId: reservation.id,
        roomTypeId: context.roomTypeId,
        propertyId: context.propertyId,
        roomId,
        status,
        checkIn,
        checkOut,
      });

      const roomNumber = assigned
        ? (await one<{ number: string }>(`select number from rooms where id = $1`, [assigned]))
            .number
        : null;

      return {
        id: reservation.id,
        roomId: assigned,
        roomNumber,
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
