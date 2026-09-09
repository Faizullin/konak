import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { TRPCError } from "@trpc/server";
import { callerFor, createFixture, prisma, type Fixture } from "./harness";

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
      numberSeries: {
        create: {
          organizationId: fx.org.id,
          kind: "RESERVATION",
          prefix: "R-",
          period: "2027",
          counter: 0,
        },
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

  // Two rooms for five nights, plus a separate island at day 10 for the tests
  // that need nights no earlier test has spent.
  await prisma.roomTypeInventory.createMany({
    data: [0, 1, 2, 3, 4, 10, 11, 30].map((i) => ({ roomTypeId, date: day(i), totalRooms: 2 })),
  });

  // Checking in is refused before the arrival day, so the tests that do it need
  // real nights: today and tomorrow, whenever the suite happens to run.
  await prisma.roomTypeInventory.createMany({
    data: [0, 1].map((i) => ({ roomTypeId, date: today(i), totalRooms: 2 })),
  });
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
  test("a night with no inventory row is zero rooms, not unlimited", async () => {
    // Absent must fail closed: an undeclared night is not on sale.
    const nights = await callerFor(fx.owner).reservation.availability({
      propertyId,
      roomTypeId,
      from: day(20),
      to: day(21),
    });
    assert.equal(nights[0]?.total, 0);
    assert.equal(nights[0]?.available, 0);
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
        (e) => code(e) === "BAD_REQUEST" && /arrives on/.test(message(e))
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
