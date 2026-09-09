import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { TRPCError } from "@trpc/server";
import { callerFor, createFixture, prisma, type Fixture } from "./harness";

/**
 * The front desk grid, in one call. `model/` proves the span arithmetic; what
 * needs a database is that the query returns the right stays at all — every one
 * that touches the window, nothing a cancellation released, and the ones no
 * room has been chosen for yet.
 */

let fx: Fixture;
let propertyId: number;
let doubleId: number;
let suiteId: number;
let retiredId: number;
const rooms: Record<string, number> = {};

const day = (n: number) => new Date(Date.UTC(2027, 2, n));
const feb = (n: number) => new Date(Date.UTC(2027, 1, n));
const april = (n: number) => new Date(Date.UTC(2027, 3, n));
const june = (n: number) => new Date(Date.UTC(2027, 5, n));
const code = (e: unknown) => (e instanceof TRPCError ? e.code : String(e));

/** March, the month the grid is asked for. */
const march = { from: day(1), to: day(32) };

before(async () => {
  fx = await createFixture();

  const property = await prisma.property.create({
    data: {
      organizationId: fx.org.id,
      name: `Grid ${fx.tag}`,
      slug: `grid-${fx.tag}`,
      currencyCode: "EUR",
      roomTypes: {
        create: [
          { name: "Double", code: `DBL-${fx.tag}`, position: 0 },
          { name: "Suite", code: `SUI-${fx.tag}`, position: 1 },
          // Withdrawn from sale while a booking on it is still to come.
          {
            name: "Twin",
            code: `TWN-${fx.tag}`,
            position: 2,
            archivedAt: new Date(),
          },
        ],
      },
    },
    include: { roomTypes: true },
  });
  propertyId = property.id;
  doubleId = property.roomTypes.find((t) => t.name === "Double")!.id;
  suiteId = property.roomTypes.find((t) => t.name === "Suite")!.id;
  retiredId = property.roomTypes.find((t) => t.name === "Twin")!.id;

  for (const [number, roomTypeId, archivedAt] of [
    ["10", doubleId, null],
    ["2", doubleId, null],
    ["1", suiteId, null],
    ["99", suiteId, new Date()],
  ] as const) {
    const room = await prisma.room.create({
      data: { propertyId, roomTypeId, number, archivedAt },
    });
    rooms[number] = room.id;
  }

  // Two nights of declared inventory, which is all the availability row needs.
  await prisma.roomTypeInventory.createMany({
    data: [day(3), day(4)].map((date) => ({ roomTypeId: doubleId, date, totalRooms: 2 })),
  });

  const booker = await prisma.person.create({
    data: { organizationId: fx.org.id, firstName: "Ada", lastName: "Lovelace" },
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
        reference: `G-${fx.tag}-${++sequence}`,
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

  await book({
    roomTypeId: doubleId,
    roomId: rooms["10"],
    checkIn: day(3),
    checkOut: day(6),
    status: "CONFIRMED",
    bookerPersonId: booker.id,
  });
  // Departure and arrival on the 6th: a turnover, which draws on one line.
  await book({
    roomTypeId: doubleId,
    roomId: rooms["10"],
    checkIn: day(6),
    checkOut: day(8),
    status: "CONFIRMED",
  });
  // An enquiry holds nothing, so the constraint permits it over a sold night —
  // and the grid has to stack it rather than draw over the booking.
  await book({
    roomTypeId: doubleId,
    roomId: rooms["10"],
    checkIn: day(4),
    checkOut: day(5),
    status: "ENQUIRY",
  });

  await book({
    roomTypeId: doubleId,
    roomId: rooms["2"],
    checkIn: feb(26),
    checkOut: day(2),
    status: "CHECKED_OUT",
  });
  await book({
    roomTypeId: doubleId,
    roomId: rooms["2"],
    checkIn: day(30),
    checkOut: april(3),
    status: "CONFIRMED",
  });

  // Bought a type, no room chosen yet — normal for a future booking.
  await book({
    roomTypeId: suiteId,
    checkIn: day(10),
    checkOut: day(12),
    status: "CONFIRMED",
  });

  await book({
    roomTypeId: retiredId,
    checkIn: day(20),
    checkOut: day(22),
    status: "CONFIRMED",
  });

  await book({
    roomTypeId: suiteId,
    roomId: rooms["1"],
    checkIn: day(15),
    checkOut: day(17),
    status: "CANCELLED",
  });
  await book({
    roomTypeId: suiteId,
    roomId: rooms["1"],
    checkIn: april(5),
    checkOut: april(7),
    status: "CONFIRMED",
  });
});

after(async () => {
  await prisma.reservation.deleteMany({ where: { propertyId } });
  await prisma.room.deleteMany({ where: { propertyId } });
  await prisma.roomType.deleteMany({ where: { propertyId } });
  await prisma.property.deleteMany({ where: { organizationId: fx.org.id } });
  await prisma.person.deleteMany({ where: { organizationId: fx.org.id } });
  await fx.cleanup();
  await prisma.$disconnect();
});

describe("the grid's rooms", () => {
  test("one row per live room, in corridor order", async () => {
    const grid = await callerFor(fx.member).reservation.grid({ propertyId, ...march });
    assert.deepEqual(
      grid.rooms.map((r) => r.number),
      ["1", "2", "10"]
    );
    assert.equal(grid.window.nights.length, 31);
  });

  test("a stay is a span, and an overlapping one stacks instead of hiding it", async () => {
    const grid = await callerFor(fx.member).reservation.grid({ propertyId, ...march });
    const row = grid.rooms.find((r) => r.number === "10")!;

    assert.equal(row.lanes, 2);
    assert.deepEqual(
      row.stays.map((s) => [s.offset, s.nights, s.lane]),
      [
        [2, 3, 0],
        [3, 1, 1],
        // The turnover takes the departing stay's lane back on its last column.
        [5, 2, 0],
      ]
    );
    assert.equal(row.stays[0]!.guestName, "Ada Lovelace");
    assert.equal(row.stays[1]!.guestName, null);
  });

  test("a stay crossing an edge is clipped, and says which edge is not real", async () => {
    const grid = await callerFor(fx.member).reservation.grid({ propertyId, ...march });
    const row = grid.rooms.find((r) => r.number === "2")!;

    assert.equal(row.lanes, 1);
    assert.deepEqual(
      row.stays.map((s) => [s.offset, s.nights, s.continuesBefore, s.continuesAfter]),
      [
        [0, 1, true, false],
        [29, 2, false, true],
      ]
    );
  });

  test("what the window does not hold is not sent", async () => {
    const grid = await callerFor(fx.member).reservation.grid({ propertyId, ...march });
    const row = grid.rooms.find((r) => r.number === "1")!;

    // A cancellation released the room, and April is another window.
    assert.deepEqual(row.stays, []);
    assert.equal(row.lanes, 0);
  });
});

describe("the grid's other axes", () => {
  test("a stay with no room yet is a band under its type", async () => {
    const grid = await callerFor(fx.member).reservation.grid({ propertyId, ...march });

    assert.equal(grid.unassigned.length, 2);
    const band = grid.unassigned[0]!;
    assert.equal(band.roomTypeId, suiteId);
    assert.deepEqual(
      band.stays.map((s) => [s.offset, s.nights]),
      [[9, 2]]
    );
    assert.equal(band.stays[0]!.roomId, null);
  });

  test("the sell row comes with the grid, and an enquiry does not consume it", async () => {
    const grid = await callerFor(fx.member).reservation.grid({ propertyId, ...march });
    const on = (date: Date) =>
      grid.availability.find(
        (n) => n.roomTypeId === doubleId && n.date.getTime() === date.getTime()
      )!;

    // The 3rd is sold once. The 4th carries the same booking plus an enquiry,
    // which holds nothing — so both nights read the same.
    assert.deepEqual([on(day(3)).sold, on(day(3)).available], [1, 1]);
    assert.deepEqual([on(day(4)).sold, on(day(4)).available], [1, 1]);
  });

  test("room types come back in the property's order", async () => {
    const grid = await callerFor(fx.member).reservation.grid({ propertyId, ...march });
    assert.deepEqual(
      grid.roomTypes.map((t) => t.id),
      [doubleId, suiteId, retiredId]
    );
  });

  test("archiving a type does not hide the stays already sold on it", async () => {
    const grid = await callerFor(fx.member).reservation.grid({ propertyId, ...march });

    // A type the grid cannot name is a booking it cannot draw, so the type
    // comes back marked rather than filtered out.
    const retired = grid.roomTypes.find((t) => t.id === retiredId)!;
    assert.notEqual(retired.archivedAt, null);
    assert.deepEqual(
      grid.unassigned.find((b) => b.roomTypeId === retiredId)!.stays.map((s) => s.offset),
      [19]
    );

    // Archived means unsellable, so it has no availability row.
    assert.equal(
      grid.availability.some((n) => n.roomTypeId === retiredId),
      false
    );
  });
});

describe("the window", () => {
  test("a window is a screen's worth, or it is refused", async () => {
    const caller = callerFor(fx.owner);
    await assert.rejects(
      () => caller.reservation.grid({ propertyId, from: day(1), to: day(1) }),
      (e) => code(e) === "BAD_REQUEST"
    );
    // The window is what bounds the query, so the cap is enforced server-side
    // and not by whatever the screen happens to ask for.
    await assert.rejects(
      () => caller.reservation.grid({ propertyId, from: day(1), to: june(3) }),
      (e) => code(e) === "BAD_REQUEST"
    );
  });
});
