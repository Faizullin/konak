import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { TRPCError } from "@trpc/server";
import { callerFor, createFixture, domainCodeOf, prisma, type Fixture } from "./harness";
import { ReservationError } from "@/features/reservations";
import { nextSeriesNumber } from "@/features/reservations/server/service";

/**
 * Availability and the booking transaction, against a real database — the half
 * `model/` cannot answer, including the exclusion constraint.
 */

let fx: Fixture;
let propertyId: number;
let roomTypeId: number;
let roomIds: number[] = [];

const day = (offset: number) => new Date(Date.UTC(2027, 0, 10 + offset));
/** The property's timezone is UTC, so its day is this one. */
const today = (offset: number) => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offset));
};
const code = (e: unknown) => (e instanceof TRPCError ? e.code : String(e));
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const field = (e: unknown) =>
  e instanceof TRPCError && e.cause && "field" in e.cause
    ? (e.cause as { field: string }).field
    : null;

before(async () => {
  fx = await createFixture();

  const property = await prisma.property.create({
    data: {
      organizationId: fx.org.id,
      name: `Hotel ${fx.tag}`,
      slug: `hotel-${fx.tag}`,
      currencyCode: "EUR",
      // Both, because a departure needs both: a booking takes a reference and
      // the bill it becomes takes a folio number. A property with only one of
      // them can be booked into and never checked out of.
      numberSeries: {
        create: [
          {
            organizationId: fx.org.id,
            kind: "RESERVATION",
            prefix: "R-",
            period: "2027",
            counter: 0,
          },
          {
            organizationId: fx.org.id,
            kind: "FOLIO",
            prefix: "R-F-",
            period: "2027",
            counter: 0,
          },
        ],
      },
      roomTypes: {
        create: { name: "Double", code: "DBL", maxOccupancy: 2 },
      },
    },
    include: { roomTypes: true },
  });
  propertyId = property.id;
  roomTypeId = property.roomTypes[0]!.id;

  // Two rooms, so "sold out" is reachable in two bookings rather than a crowd.
  const rooms = await prisma.$transaction([
    prisma.room.create({ data: { propertyId, roomTypeId, number: `A-${fx.tag}` } }),
    prisma.room.create({ data: { propertyId, roomTypeId, number: `B-${fx.tag}` } }),
  ]);
  roomIds = rooms.map((r) => r.id);

  // No inventory rows: two rooms exist, so every night has two. The tests that
  // need nights no earlier test has spent pick far-apart days below — a hold
  // left behind by one must not be what another one measures.
});

after(async () => {
  // `Room` and `RoomStay` reference `RoomType` with onDelete: Restrict, so the
  // cascade from Property cannot get through them. Delete inward first.
  await prisma.reservation.deleteMany({ where: { propertyId } });
  await prisma.room.deleteMany({ where: { propertyId } });
  await prisma.roomType.deleteMany({ where: { propertyId } });
  await prisma.property.deleteMany({ where: { organizationId: fx.org.id } });
  await fx.cleanup();
  await prisma.$disconnect();
});

describe("availability", () => {
  /**
   * The bug this replaced: a night with no row used to read as **nought
   * rooms**, so a property set up through the app — which writes no rows at all
   * — was sold out on every night for ever, and the demo stopped selling the
   * day its seeded horizon ran out.
   *
   * How many rooms exist is a fact about the `Room` table. It is counted now,
   * and a night nobody has touched is every room.
   */
  test("a night nobody declared is every room, because the rooms are what is counted", async () => {
    const far = await callerFor(fx.owner).reservation.availability({
      propertyId,
      roomTypeId,
      from: day(20),
      to: day(21),
    });
    assert.equal(far[0]?.total, 2);
    assert.equal(far[0]?.available, 2);
  });

  test("a block holds rooms back, and clearing it gives them back", async () => {
    const caller = callerFor(fx.owner);
    const range = { propertyId, roomTypeId, from: day(80), to: day(82) };

    const blocked = await caller.property.setBlock({ ...range, blockedRooms: 1, reason: "Refit" });
    assert.equal(blocked.nights, 2);

    const during = await caller.reservation.availability(range);
    assert.deepEqual(
      during.map((n) => [n.total, n.blocked, n.available]),
      [
        [2, 1, 1],
        [2, 1, 1],
      ]
    );

    // The night after the range is untouched — a block covers what it says.
    const after = await caller.reservation.availability({
      propertyId,
      roomTypeId,
      from: day(82),
      to: day(83),
    });
    assert.equal(after[0]?.available, 2);

    // Zero reopens the floor, and the rows go rather than sitting at zero: the
    // table means "somebody held rooms back here".
    const cleared = await caller.property.setBlock({ ...range, blockedRooms: 0 });
    assert.equal(cleared.cleared, 2);

    const reopened = await caller.reservation.availability(range);
    assert.deepEqual(
      reopened.map((n) => n.available),
      [2, 2]
    );
  });

  test("a block cannot hold back more rooms than the type has", async () => {
    const error = await callerFor(fx.owner)
      .property.setBlock({
        propertyId,
        roomTypeId,
        from: day(85),
        to: day(86),
        blockedRooms: 3,
      })
      .then(() => null)
      .catch((e) => e);

    assert.equal(domainCodeOf(error), "block.over_total");
  });

  test("a confirmed stay takes a room from the nights it occupies, and no others", async () => {
    const before = await callerFor(fx.owner).reservation.availability({
      propertyId,
      roomTypeId,
      from: day(0),
      to: day(3),
    });
    assert.deepEqual(
      before.map((n) => n.available),
      [2, 2, 2]
    );

    await callerFor(fx.owner).reservation.create({
      propertyId,
      roomTypeId,
      checkIn: day(0),
      checkOut: day(2),
      adults: 2,
      children: 0,
      source: "DIRECT",
    });

    const after = await callerFor(fx.owner).reservation.availability({
      propertyId,
      roomTypeId,
      from: day(0),
      to: day(3),
    });
    // Two nights consumed; the departure night untouched.
    assert.deepEqual(
      after.map((n) => n.available),
      [1, 1, 2]
    );
  });

  test("a sold-out night is refused with the date, not a generic error", async () => {
    await callerFor(fx.owner).reservation.create({
      propertyId,
      roomTypeId,
      checkIn: day(0),
      checkOut: day(1),
      adults: 1,
      children: 0,
      source: "DIRECT",
    });

    await assert.rejects(
      () =>
        callerFor(fx.owner).reservation.create({
          propertyId,
          roomTypeId,
          checkIn: day(0),
          checkOut: day(1),
          adults: 1,
          children: 0,
          source: "DIRECT",
        }),
      (e) => code(e) === "CONFLICT" && field(e) === "checkIn"
    );
  });
});

describe("check-out and the floor", () => {
  // Today's inventory is two rooms and later tests need it back. A booking
  // that stays checked out holds its nights for ever — that is the point of
  // `occupiesInventory` — so these give them up deliberately.
  const spent: number[] = [];
  after(async () => {
    if (spent.length > 0) await prisma.reservation.deleteMany({ where: { id: { in: spent } } });
  });

  test("a departure leaves the room dirty, without anyone remembering", async () => {
    const caller = callerFor(fx.owner);
    const roomId = roomIds[0]!;

    await prisma.room.update({ where: { id: roomId }, data: { status: "CLEAN" } });

    const booking = await caller.reservation.create({
      propertyId,
      roomTypeId,
      checkIn: today(0),
      checkOut: today(1),
      adults: 1,
      children: 0,
      source: "DIRECT",
      roomId,
    });
    spent.push(booking.id);

    await caller.reservation.setStatus({ propertyId, id: booking.id, status: "CHECKED_IN" });
    await caller.reservation.setStatus({ propertyId, id: booking.id, status: "CHECKED_OUT" });

    const room = await prisma.room.findUniqueOrThrow({ where: { id: roomId } });
    assert.equal(room.status, "DIRTY");

    // And the bill became real. Three things follow from one departure, and
    // all three are written by the transaction that records it.
    const folio = await prisma.folio.findFirst({
      where: { reservationId: booking.id },
      include: { lines: true },
    });
    assert.ok(folio, "a departure opens the bill");
    assert.match(folio.number, /^R-F-/);

    // And the floor is owed the work. Two things follow from one event, and a
    // board that has to be told separately is a board that goes stale.
    const tasks = await prisma.housekeepingTask.findMany({
      where: { roomId, type: "DEPARTURE_CLEAN" },
    });
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0]?.status, "PENDING");
  });

  test("out of order survives a departure", async () => {
    // The one housekeeping state with a commercial consequence, set by somebody
    // who found a fault. A check-out is not news about the fault.
    const caller = callerFor(fx.owner);
    const roomId = roomIds[1]!;

    await prisma.room.update({ where: { id: roomId }, data: { status: "CLEAN" } });

    const booking = await caller.reservation.create({
      propertyId,
      roomTypeId,
      checkIn: today(0),
      checkOut: today(1),
      adults: 1,
      children: 0,
      source: "DIRECT",
      roomId,
    });
    spent.push(booking.id);
    await caller.reservation.setStatus({ propertyId, id: booking.id, status: "CHECKED_IN" });

    await prisma.room.update({ where: { id: roomId }, data: { status: "OUT_OF_ORDER" } });
    await caller.reservation.setStatus({ propertyId, id: booking.id, status: "CHECKED_OUT" });

    const room = await prisma.room.findUniqueOrThrow({ where: { id: roomId } });
    assert.equal(room.status, "OUT_OF_ORDER");
  });
});

describe("holds", () => {
  test("a hold is half-open, like the stay it will become", async () => {
    const caller = callerFor(fx.owner);
    const holdKey = `hold-${fx.tag}-a`;

    await caller.reservation.hold({
      propertyId,
      roomTypeId,
      checkIn: day(40),
      checkOut: day(42),
      quantity: 1,
      holdKey,
      minutes: 15,
    });

    const nights = await caller.reservation.availability({
      propertyId,
      roomTypeId,
      from: day(40),
      to: day(43),
    });
    // Two nights held and the departure night untouched. A hold that counted
    // its last day would take a night off sale that the booking never uses.
    assert.deepEqual(
      nights.map((n) => n.held),
      [1, 1, 0]
    );
    assert.deepEqual(
      nights.map((n) => n.available),
      [1, 1, 2]
    );
  });

  test("a booking is not refused by its own hold", async () => {
    // The bug this prevents: taking a hold made booking strictly harder than
    // not taking one, because the search counted the searcher's own claim.
    const caller = callerFor(fx.owner);
    const holdKey = `hold-${fx.tag}-b`;

    await caller.reservation.hold({
      propertyId,
      roomTypeId,
      checkIn: day(50),
      checkOut: day(52),
      quantity: 2,
      holdKey,
      minutes: 15,
    });

    const heldOut = await caller.reservation.availability({
      propertyId,
      roomTypeId,
      from: day(50),
      to: day(52),
    });
    assert.deepEqual(
      heldOut.map((n) => n.available),
      [0, 0]
    );

    const booking = await caller.reservation.create({
      propertyId,
      roomTypeId,
      checkIn: day(50),
      checkOut: day(52),
      adults: 2,
      children: 0,
      source: "DIRECT",
      holdKey,
    });
    assert.ok(booking.reference);
  });

  test("the hold dies with the booking it became", async () => {
    const caller = callerFor(fx.owner);
    const holdKey = `hold-${fx.tag}-c`;

    await caller.reservation.hold({
      propertyId,
      roomTypeId,
      checkIn: day(60),
      checkOut: day(61),
      quantity: 1,
      holdKey,
      minutes: 15,
    });
    await caller.reservation.create({
      propertyId,
      roomTypeId,
      checkIn: day(60),
      checkOut: day(61),
      adults: 1,
      children: 0,
      source: "DIRECT",
      holdKey,
    });

    // A hold outliving its booking is a room nobody can sell for fifteen
    // minutes, and the stay is already counted against the same night.
    assert.equal(await prisma.inventoryHold.count({ where: { holdKey } }), 0);

    const nights = await caller.reservation.availability({
      propertyId,
      roomTypeId,
      from: day(60),
      to: day(61),
    });
    assert.equal(nights[0]?.available, 1);
  });

  test("releasing a hold is idempotent, because an abandoned search may never return", async () => {
    const caller = callerFor(fx.owner);
    const holdKey = `hold-${fx.tag}-d`;

    await caller.reservation.hold({
      propertyId,
      roomTypeId,
      checkIn: day(70),
      checkOut: day(71),
      quantity: 1,
      holdKey,
      minutes: 15,
    });
    await caller.reservation.releaseHold({ propertyId, holdKey });
    await caller.reservation.releaseHold({ propertyId, holdKey });

    const nights = await caller.reservation.availability({
      propertyId,
      roomTypeId,
      from: day(70),
      to: day(71),
    });
    assert.equal(nights[0]?.available, 2);
  });
});

describe("the booking transaction", () => {
  test("references come from the series and never repeat", async () => {
    const a = await callerFor(fx.owner).reservation.create({
      propertyId,
      roomTypeId,
      checkIn: day(3),
      checkOut: day(4),
      adults: 1,
      children: 0,
      source: "DIRECT",
    });
    const b = await callerFor(fx.owner).reservation.create({
      propertyId,
      roomTypeId,
      checkIn: day(3),
      checkOut: day(4),
      adults: 1,
      children: 0,
      source: "DIRECT",
    });

    assert.ok(a.reference.startsWith("R-"));
    assert.notEqual(a.reference, b.reference);
    assert.match(a.reference, /^R-\d{5}$/);
  });

  /**
   * The test above books twice in a row, which the *broken* implementation
   * passed: reading a counter and writing back what you computed is correct
   * right up until somebody else is doing it too.
   *
   * Two transactions at once is the case that matters — two receptionists
   * checking guests out on a Saturday morning — and what it produced was a
   * duplicate folio number and a rolled-back departure.
   */
  /**
   * The race the room-type lock exists for.
   *
   * Two rooms of the type, three bookings sent together: exactly two may
   * survive. Before the lock all three passed a check made *before* any of them
   * wrote, and the exclusion constraint could not catch it — its clause is
   * `WHERE ("roomId" IS NOT NULL …)`, and these are unassigned, which is the
   * normal case for an advance booking and for everything a channel sends.
   */
  test("three bookings at once for two rooms: one is refused, not oversold", async () => {
    const caller = callerFor(fx.owner);
    const night = { checkIn: day(90), checkOut: day(91), adults: 1, children: 0 };

    const results = await Promise.allSettled(
      [0, 1, 2].map(() =>
        caller.reservation.create({
          propertyId,
          roomTypeId,
          source: "DIRECT",
          ...night,
        })
      )
    );

    const taken = results.filter((r) => r.status === "fulfilled");
    const refused = results.filter((r) => r.status === "rejected");

    assert.equal(taken.length, 2, "both rooms should sell");
    assert.equal(refused.length, 1, "the third should be refused, not oversold");

    // Refused with the reason, not with a constraint violation a screen cannot
    // read: the desk has to be able to say *why*.
    assert.equal(
      domainCodeOf((refused[0] as PromiseRejectedResult).reason),
      ReservationError.STAY_SOLD_OUT
    );

    // And the truth in the database matches what was told to the callers.
    const stays = await prisma.roomStay.count({
      where: { roomTypeId, checkIn: day(90) },
    });
    assert.equal(stays, 2);
  });

  test("two transactions taking a number at once take different ones", async () => {
    const args = { organizationId: fx.org.id, propertyId, kind: "RESERVATION" };

    const [a, b] = await Promise.all([
      prisma.$transaction((tx) => nextSeriesNumber(tx, args)),
      prisma.$transaction((tx) => nextSeriesNumber(tx, args)),
    ]);

    assert.notEqual(a, b);
  });

  test("more people than the type sleeps is refused, on the field", async () => {
    await assert.rejects(
      () =>
        callerFor(fx.owner).reservation.create({
          propertyId,
          roomTypeId,
          checkIn: day(4),
          checkOut: day(5),
          adults: 5,
          children: 0,
          source: "DIRECT",
        }),
      (e) => code(e) === "BAD_REQUEST" && field(e) === "adults"
    );
  });

  test("a property in another tenant is not found, not forbidden", async () => {
    await assert.rejects(
      () =>
        callerFor(fx.outsider).reservation.availability({
          propertyId,
          from: day(0),
          to: day(1),
        }),
      (e) => code(e) === "FORBIDDEN"
    );
  });
});

describe("status and rooms", () => {
  test("only legal transitions are accepted", async () => {
    const r = await callerFor(fx.owner).reservation.create({
      propertyId,
      roomTypeId,
      checkIn: day(2),
      checkOut: day(3),
      adults: 1,
      children: 0,
      source: "DIRECT",
    });

    await assert.rejects(
      () =>
        callerFor(fx.owner).reservation.setStatus({
          propertyId,
          id: r.id,
          status: "CHECKED_OUT",
        }),
      (e) => code(e) === "BAD_REQUEST"
    );
  });

  test("a guest checks in on the day, into a room", async () => {
    const r = await callerFor(fx.owner).reservation.create({
      propertyId,
      roomTypeId,
      checkIn: today(0),
      checkOut: today(1),
      adults: 1,
      children: 0,
      source: "DIRECT",
    });

    // The dates are right, but nothing has been assigned yet — which is the
    // ordinary state of a booking until someone works out which room.
    await assert.rejects(
      () =>
        callerFor(fx.owner).reservation.setStatus({ propertyId, id: r.id, status: "CHECKED_IN" }),
      (e) => code(e) === "BAD_REQUEST" && /assign a room/i.test(message(e))
    );

    const stay = await prisma.roomStay.findFirstOrThrow({ where: { reservationId: r.id } });
    await callerFor(fx.owner).reservation.assignRoom({
      propertyId,
      stayId: stay.id,
      roomId: roomIds[0]!,
    });

    const inHouse = await callerFor(fx.owner).reservation.setStatus({
      propertyId,
      id: r.id,
      status: "CHECKED_IN",
    });
    assert.equal(inHouse.status, "CHECKED_IN");

    const out = await callerFor(fx.owner).reservation.setStatus({
      propertyId,
      id: r.id,
      status: "CHECKED_OUT",
    });
    assert.equal(out.status, "CHECKED_OUT");

    // The stay carries the status too, because the overlap constraint reads it.
    const moved = await prisma.roomStay.findFirstOrThrow({ where: { id: stay.id } });
    assert.equal(moved.status, "CHECKED_OUT");
  });

  test("a booking that has not arrived cannot check in or be a no-show", async () => {
    const r = await callerFor(fx.owner).reservation.create({
      propertyId,
      roomTypeId,
      checkIn: day(30),
      checkOut: day(31),
      adults: 1,
      children: 0,
      roomId: roomIds[1],
      source: "DIRECT",
    });

    for (const status of ["CHECKED_IN", "NO_SHOW"] as const) {
      await assert.rejects(
        () => callerFor(fx.owner).reservation.setStatus({ propertyId, id: r.id, status }),
        (e) => code(e) === "BAD_REQUEST" && domainCodeOf(e) === ReservationError.ARRIVES_LATER
      );
    }
  });

  test("cancelling releases the nights it held", async () => {
    const r = await callerFor(fx.owner).reservation.create({
      propertyId,
      roomTypeId,
      checkIn: day(4),
      checkOut: day(5),
      adults: 1,
      children: 0,
      source: "DIRECT",
    });
    const held = await callerFor(fx.owner).reservation.availability({
      propertyId,
      roomTypeId,
      from: day(4),
      to: day(5),
    });

    await callerFor(fx.owner).reservation.setStatus({
      propertyId,
      id: r.id,
      status: "CANCELLED",
      reason: "guest changed plans",
    });

    const released = await callerFor(fx.owner).reservation.availability({
      propertyId,
      roomTypeId,
      from: day(4),
      to: day(5),
    });
    assert.equal(released[0]!.available, held[0]!.available + 1);
  });

  test("the database refuses two stays in one room on the same night", async () => {
    // The exclusion constraint, surfaced as a field message rather than a 500.
    // Nights of their own: the earlier tests have spent the first block, and
    // availability would refuse the second booking before the constraint ever
    // got a chance to.
    const first = await callerFor(fx.owner).reservation.create({
      propertyId,
      roomTypeId,
      checkIn: day(10),
      checkOut: day(11),
      adults: 1,
      children: 0,
      source: "DIRECT",
    });
    const second = await callerFor(fx.owner).reservation.create({
      propertyId,
      roomTypeId,
      checkIn: day(10),
      checkOut: day(11),
      adults: 1,
      children: 0,
      source: "DIRECT",
    });

    await callerFor(fx.owner).reservation.assignRoom({
      propertyId,
      stayId: first.stays[0]!.id,
      roomId: roomIds[0]!,
    });

    await assert.rejects(
      () =>
        callerFor(fx.owner).reservation.assignRoom({
          propertyId,
          stayId: second.stays[0]!.id,
          roomId: roomIds[0]!,
        }),
      (e) => code(e) === "CONFLICT" && field(e) === "roomId"
    );
  });
});

/**
 * Phase 7.5 — `room_stays_bed_no_overlap`, the bed-level twin of the
 * room-level constraint above. No procedure assigns a bed yet (that is Phase
 * 8's booking engine), so these write `RoomStay` rows directly — the same
 * database guarantee the application will eventually call through.
 */
describe("beds", () => {
  let dormTypeId: number;
  let dormRoomId: number;
  let bedAId: number;
  let bedBId: number;
  const reservationIds: number[] = [];

  before(async () => {
    const dormType = await prisma.roomType.create({
      data: {
        propertyId,
        name: `Dorm ${fx.tag}`,
        code: `DORM-${fx.tag}`,
        unit: "BED",
        baseOccupancy: 1,
        maxOccupancy: 1,
        maxAdults: 1,
      },
    });
    dormTypeId = dormType.id;

    const dormRoom = await prisma.room.create({
      data: { propertyId, roomTypeId: dormTypeId, number: `Dorm-${fx.tag}` },
    });
    dormRoomId = dormRoom.id;

    const [bedA, bedB] = await prisma.$transaction([
      prisma.bed.create({ data: { roomId: dormRoomId, label: "Bed A" } }),
      prisma.bed.create({ data: { roomId: dormRoomId, label: "Bed B" } }),
    ]);
    bedAId = bedA.id;
    bedBId = bedB.id;
  });

  after(async () => {
    await prisma.reservation.deleteMany({ where: { id: { in: reservationIds } } });
    await prisma.room.deleteMany({ where: { id: dormRoomId } });
    await prisma.roomType.deleteMany({ where: { id: dormTypeId } });
  });

  const mkReservation = async (reference: string) => {
    const r = await prisma.reservation.create({
      data: { propertyId, reference, currencyCode: "EUR", status: "CONFIRMED" },
    });
    reservationIds.push(r.id);
    return r;
  };

  const mkStay = (reservationId: number, bedId: number, checkIn: Date, checkOut: Date) =>
    prisma.roomStay.create({
      data: {
        reservationId,
        propertyId,
        roomTypeId: dormTypeId,
        bedId,
        status: "CONFIRMED",
        checkIn,
        checkOut,
        currencyCode: "EUR",
      },
    });

  test("two guests hold two beds in one room across overlapping dates", async () => {
    const guestA = await mkReservation(`BED-A-${fx.tag}`);
    const guestB = await mkReservation(`BED-B-${fx.tag}`);

    // Same room, same nights, different beds — the room-level constraint
    // never sees these rows because roomId is null on both.
    const stayA = await mkStay(guestA.id, bedAId, day(100), day(102));
    const stayB = await mkStay(guestB.id, bedBId, day(101), day(103));

    assert.equal(stayA.roomId, null);
    assert.equal(stayB.roomId, null);
  });

  test("the database — not the application — refuses a third stay on a bed already held", async () => {
    const guestC = await mkReservation(`BED-C-${fx.tag}`);

    await assert.rejects(
      () => mkStay(guestC.id, bedAId, day(101), day(104)),
      (e) => {
        const err = e as { code?: string; message?: string };
        return err.code === "P2039" && /room_stays_bed_no_overlap/.test(err.message ?? "");
      }
    );
  });

  test("the same bed on a later, non-overlapping date is free again", async () => {
    const guestD = await mkReservation(`BED-D-${fx.tag}`);
    const stay = await mkStay(guestD.id, bedAId, day(102), day(103));
    assert.equal(stay.bedId, bedAId);
  });
});
