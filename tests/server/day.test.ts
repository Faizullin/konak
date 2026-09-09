import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { TRPCError } from "@trpc/server";
import { callerFor, createFixture, domainCodeOf, prisma, type Fixture } from "./harness";
import { ReservationError } from "@/features/reservations";

/**
 * The day a receptionist works: three lists for a date, and the walk-in that
 * books and checks in at once.
 *
 * `model/` proves which list a stay belongs to. What needs a database is that
 * the query finds every stay touching the day and no released one, and that a
 * walk-in is one transaction rather than three writes that can half-succeed.
 */

let fx: Fixture;
let propertyId: number;
let doubleId: number;
let suiteId: number;
const rooms: Record<string, number> = {};

const day = (n: number) => new Date(Date.UTC(2027, 2, n));
const code = (e: unknown) => (e instanceof TRPCError ? e.code : String(e));

/** Real today, because a walk-in arrives on the property's own day. */
const MS_PER_DAY = 86_400_000;
const now = new Date();
const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
const fromToday = (n: number) => new Date(today.getTime() + n * MS_PER_DAY);

before(async () => {
  fx = await createFixture();

  const property = await prisma.property.create({
    data: {
      organizationId: fx.org.id,
      name: `Day ${fx.tag}`,
      slug: `day-${fx.tag}`,
      currencyCode: "EUR",
      timezone: "UTC",
      numberSeries: {
        create: {
          organizationId: fx.org.id,
          kind: "RESERVATION",
          prefix: `W-${fx.tag}-`,
          period: String(new Date().getUTCFullYear()),
          counter: 0,
        },
      },
      roomTypes: {
        create: [
          { name: "Double", code: `DBL-${fx.tag}`, maxOccupancy: 2, position: 0 },
          { name: "Suite", code: `SUI-${fx.tag}`, maxOccupancy: 4, position: 1 },
        ],
      },
    },
    include: { roomTypes: true },
  });
  propertyId = property.id;
  doubleId = property.roomTypes.find((t) => t.name === "Double")!.id;
  suiteId = property.roomTypes.find((t) => t.name === "Suite")!.id;

  for (const [number, roomTypeId, status] of [
    ["10", doubleId, "CLEAN"],
    ["2", doubleId, "DIRTY"],
    ["3", doubleId, "OUT_OF_ORDER"],
    ["1", suiteId, "CLEAN"],
  ] as const) {
    const room = await prisma.room.create({
      data: { propertyId, roomTypeId, number, status },
    });
    rooms[number] = room.id;
  }

  // Enough declared inventory that a walk-in is never refused for the wrong
  // reason; the tests that refuse one say why themselves.
  await prisma.roomTypeInventory.createMany({
    data: [doubleId, suiteId].flatMap((roomTypeId) =>
      Array.from({ length: 15 }, (_, n) => ({
        roomTypeId,
        date: fromToday(n),
        totalRooms: 3,
      }))
    ),
  });

  const booker = await prisma.person.create({
    data: { organizationId: fx.org.id, firstName: "Grace", lastName: "Hopper" },
  });

  let sequence = 0;
  const book = (args: {
    roomTypeId: number;
    roomId?: number;
    checkIn: Date;
    checkOut: Date;
    status: string;
    bookerPersonId?: number;
  }) =>
    prisma.reservation.create({
      data: {
        propertyId,
        reference: `D-${fx.tag}-${++sequence}`,
        currencyCode: "EUR",
        status: args.status,
        bookerPersonId: args.bookerPersonId,
        stays: {
          create: {
            roomTypeId: args.roomTypeId,
            roomId: args.roomId,
            status: args.status,
            checkIn: args.checkIn,
            checkOut: args.checkOut,
            currencyCode: "EUR",
          },
        },
      },
    });

  // Arrives on the 3rd, in a room.
  await book({
    roomTypeId: doubleId,
    roomId: rooms["10"],
    checkIn: day(3),
    checkOut: day(6),
    status: "CONFIRMED",
    bookerPersonId: booker.id,
  });
  // Departs on the 3rd — the same room, a turnover the constraint permits.
  await book({
    roomTypeId: doubleId,
    roomId: rooms["2"],
    checkIn: day(1),
    checkOut: day(3),
    status: "CHECKED_IN",
  });
  // In house on the 3rd: arrived before it, leaves after it.
  await book({
    roomTypeId: suiteId,
    roomId: rooms["1"],
    checkIn: day(2),
    checkOut: day(9),
    status: "CHECKED_IN",
  });
  // Arrives on the 3rd with no room yet — the work the list exists for.
  await book({ roomTypeId: suiteId, checkIn: day(3), checkOut: day(4), status: "CONFIRMED" });
  // Cancelled on the 3rd: it released the room, so it is not the desk's work.
  await book({ roomTypeId: doubleId, checkIn: day(3), checkOut: day(5), status: "CANCELLED" });

  // Tonight's occupant of room 10, so a walk-in into it collides.
  await book({
    roomTypeId: doubleId,
    roomId: rooms["10"],
    checkIn: today,
    checkOut: fromToday(2),
    status: "CHECKED_IN",
  });
});

after(async () => {
  await prisma.reservation.deleteMany({ where: { propertyId } });
  await prisma.room.deleteMany({ where: { propertyId } });
  await prisma.roomTypeInventory.deleteMany({
    where: { roomTypeId: { in: [doubleId, suiteId] } },
  });
  await prisma.roomType.deleteMany({ where: { propertyId } });
  await prisma.property.deleteMany({ where: { organizationId: fx.org.id } });
  await prisma.person.deleteMany({ where: { organizationId: fx.org.id } });
  await fx.cleanup();
  await prisma.$disconnect();
});

describe("the day's three lists", () => {
  test("a stay lands in exactly one list, by its dates", async () => {
    const desk = await callerFor(fx.member).reservation.day({ propertyId, day: day(3) });

    assert.deepEqual(
      desk.arrivals.map((s) => s.roomNumber),
      [null, "10"]
    );
    assert.deepEqual(
      desk.departures.map((s) => s.roomNumber),
      ["2"]
    );
    assert.deepEqual(
      desk.inHouse.map((s) => s.roomNumber),
      ["1"]
    );
  });

  test("an unassigned arrival sorts first, because it is the work", async () => {
    const desk = await callerFor(fx.member).reservation.day({ propertyId, day: day(3) });

    assert.equal(desk.arrivals[0]?.roomNumber, null);
    assert.equal(desk.arrivals[0]?.roomTypeName, "Suite");
  });

  test("a cancelled booking is on no list — it released the room", async () => {
    const desk = await callerFor(fx.member).reservation.day({ propertyId, day: day(3) });
    const every = [...desk.arrivals, ...desk.departures, ...desk.inHouse];

    assert.equal(
      every.some((stay) => stay.status === "CANCELLED"),
      false
    );
  });

  test("a day nothing touches is three empty lists, not an error", async () => {
    const desk = await callerFor(fx.member).reservation.day({ propertyId, day: day(20) });

    assert.deepEqual([desk.arrivals, desk.departures, desk.inHouse], [[], [], []]);
  });

  test("the guest and the nights come with the row, so the list needs no second call", async () => {
    const desk = await callerFor(fx.member).reservation.day({ propertyId, day: day(3) });
    const assigned = desk.arrivals.find((stay) => stay.roomNumber === "10");

    assert.equal(assigned?.guestName, "Grace Hopper");
    assert.equal(assigned?.nights, 3);
    assert.equal(assigned?.roomTypeName, "Double");
  });

  test("another tenant's property is not readable", async () => {
    await assert.rejects(
      () => callerFor(fx.outsider).reservation.day({ propertyId, day: day(3) }),
      (e) => code(e) === "FORBIDDEN"
    );
  });
});

describe("the walk-in", () => {
  const guest = {
    roomTypeId: 0,
    roomId: 0,
    nights: 1,
    adults: 1,
    children: 0,
    firstName: "Ada",
    lastName: "Lovelace",
  };

  test("books, assigns and checks in, in one action", async () => {
    const created = await callerFor(fx.member).reservation.walkIn({
      ...guest,
      propertyId,
      roomTypeId: suiteId,
      roomId: rooms["1"],
      nights: 2,
      adults: 2,
      email: "ada@example.test",
    });

    assert.equal(created.status, "CHECKED_IN");
    assert.equal(created.source, "WALK_IN");
    assert.equal(created.stays[0]?.status, "CHECKED_IN");
    assert.equal(created.stays[0]?.roomId, rooms["1"]);
    // The property's today, not the caller's clock.
    assert.equal(created.stays[0]?.checkIn.getTime(), today.getTime());
    assert.equal(created.stays[0]?.checkOut.getTime(), fromToday(2).getTime());

    // The guest was written with the booking, and is findable afterwards.
    const person = await prisma.person.findFirst({
      where: { organizationId: fx.org.id, email: "ada@example.test" },
      select: { id: true, firstName: true },
    });
    assert.equal(person?.id, created.bookerPersonId);
    assert.equal(person?.firstName, "Ada");
  });

  test("a room of another type is refused on the field", async () => {
    await assert.rejects(
      () =>
        callerFor(fx.member).reservation.walkIn({
          ...guest,
          propertyId,
          roomTypeId: suiteId,
          roomId: rooms["2"],
        }),
      // The code, not the sentence: the wording is free to change, and a
      // translation will replace it entirely.
      (e) => code(e) === "BAD_REQUEST" && domainCodeOf(e) === ReservationError.ROOM_WRONG_TYPE
    );
  });

  test("an out-of-order room cannot be sold, however free it looks", async () => {
    await assert.rejects(
      () =>
        callerFor(fx.member).reservation.walkIn({
          ...guest,
          propertyId,
          roomTypeId: doubleId,
          roomId: rooms["3"],
        }),
      (e) => code(e) === "CONFLICT" && domainCodeOf(e) === ReservationError.ROOM_OUT_OF_ORDER
    );
  });

  test("more people than the type sleeps is refused", async () => {
    await assert.rejects(
      () =>
        callerFor(fx.member).reservation.walkIn({
          ...guest,
          propertyId,
          roomTypeId: doubleId,
          roomId: rooms["2"],
          adults: 3,
        }),
      (e) => code(e) === "BAD_REQUEST"
    );
  });

  test("a room occupied tonight is refused by the constraint, not a 500", async () => {
    await assert.rejects(
      () =>
        callerFor(fx.member).reservation.walkIn({
          ...guest,
          propertyId,
          roomTypeId: doubleId,
          roomId: rooms["10"],
        }),
      (e) => code(e) === "CONFLICT" && domainCodeOf(e) === ReservationError.ROOM_TAKEN
    );
  });

  test("a failed walk-in writes no guest — the person is inside the transaction", async () => {
    await assert.rejects(() =>
      callerFor(fx.member).reservation.walkIn({
        ...guest,
        propertyId,
        roomTypeId: doubleId,
        roomId: rooms["10"],
        firstName: "Rejected",
        lastName: "Guest",
      })
    );

    const orphan = await prisma.person.findFirst({
      where: { organizationId: fx.org.id, firstName: "Rejected" },
      select: { id: true },
    });
    assert.equal(orphan, null);
  });

  test("an outsider cannot book into this property", async () => {
    await assert.rejects(
      () =>
        callerFor(fx.outsider).reservation.walkIn({
          ...guest,
          propertyId,
          roomTypeId: suiteId,
          roomId: rooms["1"],
        }),
      (e) => code(e) === "FORBIDDEN"
    );
  });
});

describe("moving a stay's dates", () => {
  let movable: number;
  let occupied: number;

  before(async () => {
    // Its own room, so the other suites' bookings cannot decide the outcome.
    const room = await prisma.room.create({
      data: { propertyId, roomTypeId: doubleId, number: "20", status: "CLEAN" },
    });
    rooms["20"] = room.id;

    const booking = await prisma.reservation.create({
      data: {
        propertyId,
        reference: `M-${fx.tag}-1`,
        currencyCode: "EUR",
        status: "CONFIRMED",
        stays: {
          create: {
            roomTypeId: doubleId,
            roomId: room.id,
            status: "CONFIRMED",
            checkIn: fromToday(5),
            checkOut: fromToday(7),
            currencyCode: "EUR",
          },
        },
      },
      include: { stays: true },
    });
    movable = booking.stays[0]!.id;

    // Room 10 already holds a checked-in guest for tonight and tomorrow.
    const clash = await prisma.reservation.create({
      data: {
        propertyId,
        reference: `M-${fx.tag}-2`,
        currencyCode: "EUR",
        status: "CONFIRMED",
        stays: {
          create: {
            roomTypeId: doubleId,
            roomId: rooms["10"],
            status: "CONFIRMED",
            checkIn: fromToday(8),
            checkOut: fromToday(9),
            currencyCode: "EUR",
          },
        },
      },
      include: { stays: true },
    });
    occupied = clash.stays[0]!.id;
  });

  test("a shift keeps the room and the number of nights", async () => {
    const moved = await callerFor(fx.member).reservation.moveStay({
      propertyId,
      stayId: movable,
      checkIn: fromToday(6),
      checkOut: fromToday(8),
    });

    assert.equal(moved.checkIn.getTime(), fromToday(6).getTime());
    assert.equal(moved.checkOut.getTime(), fromToday(8).getTime());
    assert.equal(moved.roomId, rooms["20"]);
  });

  test("an edge moves on its own, which is what a resize is", async () => {
    const moved = await callerFor(fx.member).reservation.moveStay({
      propertyId,
      stayId: movable,
      checkIn: fromToday(6),
      checkOut: fromToday(11),
    });

    assert.equal(moved.checkIn.getTime(), fromToday(6).getTime());
    assert.equal(moved.checkOut.getTime(), fromToday(11).getTime());
  });

  test("the room and the nights move together, in one call", async () => {
    const moved = await callerFor(fx.member).reservation.moveStay({
      propertyId,
      stayId: movable,
      checkIn: fromToday(12),
      checkOut: fromToday(14),
      roomId: rooms["2"],
    });

    assert.equal(moved.roomId, rooms["2"]);
    assert.equal(moved.checkIn.getTime(), fromToday(12).getTime());
  });

  test("a room taken for part of those nights is refused by the constraint", async () => {
    await assert.rejects(
      () =>
        callerFor(fx.member).reservation.moveStay({
          propertyId,
          stayId: occupied,
          checkIn: fromToday(12),
          checkOut: fromToday(14),
          roomId: rooms["2"],
        }),
      (e) => code(e) === "CONFLICT"
    );
  });

  test("a zero-night move is refused before the database sees it", async () => {
    await assert.rejects(
      () =>
        callerFor(fx.member).reservation.moveStay({
          propertyId,
          stayId: movable,
          checkIn: fromToday(12),
          checkOut: fromToday(12),
        }),
      (e) => code(e) === "BAD_REQUEST" && domainCodeOf(e) === ReservationError.STAY_TOO_SHORT
    );
  });

  test("a room of another type cannot be moved into", async () => {
    await assert.rejects(
      () =>
        callerFor(fx.member).reservation.moveStay({
          propertyId,
          stayId: movable,
          checkIn: fromToday(12),
          checkOut: fromToday(14),
          roomId: rooms["1"],
        }),
      (e) => code(e) === "BAD_REQUEST"
    );
  });

  test("an arrived guest's arrival does not move", async () => {
    const arrived = await prisma.reservation.create({
      data: {
        propertyId,
        reference: `M-${fx.tag}-3`,
        currencyCode: "EUR",
        status: "CHECKED_IN",
        stays: {
          create: {
            roomTypeId: doubleId,
            roomId: rooms["20"],
            status: "CHECKED_IN",
            checkIn: today,
            checkOut: fromToday(3),
            currencyCode: "EUR",
          },
        },
      },
      include: { stays: true },
    });

    await assert.rejects(
      () =>
        callerFor(fx.member).reservation.moveStay({
          propertyId,
          stayId: arrived.stays[0]!.id,
          checkIn: fromToday(1),
          checkOut: fromToday(4),
        }),
      (e) => code(e) === "BAD_REQUEST"
    );

    // The departure alone still moves — extending a stay is ordinary work.
    const extended = await callerFor(fx.member).reservation.moveStay({
      propertyId,
      stayId: arrived.stays[0]!.id,
      checkIn: today,
      checkOut: fromToday(4),
    });
    assert.equal(extended.checkOut.getTime(), fromToday(4).getTime());
  });

  test("another tenant cannot move a stay", async () => {
    await assert.rejects(
      () =>
        callerFor(fx.outsider).reservation.moveStay({
          propertyId,
          stayId: movable,
          checkIn: fromToday(12),
          checkOut: fromToday(14),
        }),
      (e) => code(e) === "FORBIDDEN"
    );
  });
});
