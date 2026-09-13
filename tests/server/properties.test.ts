import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { TRPCError } from "@trpc/server";
import { callerFor, createFixture, domainCodeOf, prisma, type Fixture } from "./harness";

/**
 * The axes the front desk is drawn against: which hotels an organization runs,
 * and which rooms are in one. What `model/` cannot answer here is the scope —
 * that another tenant's property is not readable, and that the guard every
 * property-scoped router now shares actually refuses.
 */

let fx: Fixture;
let propertyId: number;
let otherPropertyId: number;
let roomTypeIds: number[] = [];

const code = (e: unknown) => (e instanceof TRPCError ? e.code : String(e));

before(async () => {
  fx = await createFixture();

  const property = await prisma.property.create({
    data: {
      organizationId: fx.org.id,
      name: `Riverside ${fx.tag}`,
      slug: `riverside-${fx.tag}`,
      currencyCode: "EUR",
      roomTypes: {
        create: [
          { name: "Double", code: `DBL-${fx.tag}`, position: 1 },
          { name: "Suite", code: `SUI-${fx.tag}`, position: 0 },
        ],
      },
    },
    include: { roomTypes: true },
  });
  propertyId = property.id;
  roomTypeIds = property.roomTypes.map((t) => t.id);

  // Numbers that a lexical sort gets wrong, and one room off the board.
  await prisma.room.createMany({
    data: [
      { propertyId, roomTypeId: roomTypeIds[0]!, number: "10" },
      { propertyId, roomTypeId: roomTypeIds[0]!, number: "2" },
      { propertyId, roomTypeId: roomTypeIds[0]!, number: "101" },
      { propertyId, roomTypeId: roomTypeIds[1]!, number: "1", status: "OUT_OF_ORDER" },
      { propertyId, roomTypeId: roomTypeIds[1]!, number: "9", archivedAt: new Date() },
    ],
  });

  const other = await prisma.property.create({
    data: {
      organizationId: fx.otherOrg.id,
      name: `Elsewhere ${fx.tag}`,
      slug: `elsewhere-${fx.tag}`,
    },
  });
  otherPropertyId = other.id;

  // An archived property of our own: it exists, and lists leave it out.
  await prisma.property.create({
    data: {
      organizationId: fx.org.id,
      name: `Closed ${fx.tag}`,
      slug: `closed-${fx.tag}`,
      archivedAt: new Date(),
    },
  });
});

after(async () => {
  await prisma.room.deleteMany({ where: { propertyId } });
  await prisma.roomType.deleteMany({ where: { propertyId } });
  await prisma.property.deleteMany({
    where: { organizationId: { in: [fx.org.id, fx.otherOrg.id] } },
  });
  await fx.cleanup();
  await prisma.$disconnect();
});

describe("listing properties", () => {
  test("a member sees the organization's live properties", async () => {
    const properties = await callerFor(fx.member).property.list({ organizationId: fx.org.id });
    assert.deepEqual(
      properties.map((p) => p.slug),
      [`riverside-${fx.tag}`]
    );
    assert.equal(properties[0]!.currencyCode, "EUR");
  });

  test("archived properties are asked for by name", async () => {
    const properties = await callerFor(fx.owner).property.list({
      organizationId: fx.org.id,
      includeArchived: true,
    });
    assert.equal(properties.length, 2);
  });

  test("an outsider cannot list another organization's properties", async () => {
    await assert.rejects(
      () => callerFor(fx.outsider).property.list({ organizationId: fx.org.id }),
      (e) => code(e) === "FORBIDDEN"
    );
  });

  test("a slug resolves within its organization, and only there", async () => {
    const property = await callerFor(fx.owner).property.getBySlug({
      organizationId: fx.org.id,
      slug: `riverside-${fx.tag}`,
    });
    assert.equal(property.id, propertyId);

    // The other tenant's slug is absent here rather than forbidden: within an
    // organization the caller may look, and that row is simply not one of ours.
    await assert.rejects(
      () =>
        callerFor(fx.owner).property.getBySlug({
          organizationId: fx.org.id,
          slug: `elsewhere-${fx.tag}`,
        }),
      (e) => code(e) === "NOT_FOUND"
    );
  });
});

describe("the room axis", () => {
  test("rooms come back in corridor order, not lexical", async () => {
    const rooms = await callerFor(fx.member).property.listRooms({ propertyId });
    assert.deepEqual(
      rooms.map((r) => r.number),
      ["1", "2", "10", "101"]
    );
  });

  test("an archived room is off the board", async () => {
    const rooms = await callerFor(fx.member).property.listRooms({ propertyId });
    assert.equal(
      rooms.some((r) => r.number === "9"),
      false
    );

    const all = await callerFor(fx.member).property.listRooms({
      propertyId,
      includeArchived: true,
    });
    assert.equal(all.length, 5);
  });

  test("rooms filter by type and by housekeeping state", async () => {
    const member = callerFor(fx.member);
    const doubles = await member.property.listRooms({ propertyId, roomTypeId: roomTypeIds[0]! });
    assert.equal(doubles.length, 3);

    const offline = await member.property.listRooms({ propertyId, status: "OUT_OF_ORDER" });
    assert.deepEqual(
      offline.map((r) => r.number),
      ["1"]
    );
  });

  test("room types come back in the order the property arranges them", async () => {
    const types = await callerFor(fx.member).property.listRoomTypes({ propertyId });
    assert.deepEqual(
      types.map((t) => t.name),
      ["Suite", "Double"]
    );
  });
});

describe("the property guard", () => {
  test("an unknown property and another tenant's are refused differently", async () => {
    // No row at all is NOT_FOUND; a row that is not yours is FORBIDDEN. The
    // second is the honest answer to "you are signed in, and this is not
    // yours", and it is the distinction every property-scoped router inherits.
    await assert.rejects(
      () => callerFor(fx.owner).property.listRooms({ propertyId: 0 }),
      (e) => code(e) === "NOT_FOUND"
    );
    await assert.rejects(
      () => callerFor(fx.owner).property.listRooms({ propertyId: otherPropertyId }),
      (e) => code(e) === "FORBIDDEN"
    );
  });

  test("the guard reservations and rates now share refuses the same way", async () => {
    // One helper, three routers: assert it through another one so a change to
    // it cannot pass with only the properties tests green.
    await assert.rejects(
      () =>
        callerFor(fx.owner).reservation.availability({
          propertyId: otherPropertyId,
          from: new Date(Date.UTC(2027, 0, 1)),
          to: new Date(Date.UTC(2027, 0, 3)),
        }),
      (e) => code(e) === "FORBIDDEN"
    );

    await assert.rejects(
      () => callerFor(fx.outsider).property.listRoomTypes({ propertyId }),
      (e) => code(e) === "FORBIDDEN"
    );
  });
});

describe("adding a hotel", () => {
  test("a new property gets both number series, or it cannot be operated", async () => {
    const caller = callerFor(fx.owner);
    const slug = `new-${fx.tag}`;

    const created = await caller.property.create({
      organizationId: fx.org.id,
      name: "The New One",
      slug,
      timezone: "Europe/Berlin",
      currencyCode: "EUR",
      checkInMinutes: 840,
      checkOutMinutes: 660,
    });

    // A booking takes a reference and the bill it becomes takes a folio number.
    // A property with one of them can be booked into and never checked out of,
    // which is how the gap was found.
    const series = await prisma.numberSeries.findMany({
      where: { propertyId: created.id },
      select: { kind: true, counter: true },
      orderBy: { kind: "asc" },
    });
    assert.deepEqual(
      series.map((s) => s.kind),
      ["FOLIO", "RESERVATION"]
    );
    assert.ok(series.every((s) => s.counter === 0));

    await prisma.property.delete({ where: { id: created.id } });
  });

  test("a slug is taken once per organization, not once per install", async () => {
    const caller = callerFor(fx.owner);
    const slug = `twice-${fx.tag}`;

    const first = await caller.property.create({
      organizationId: fx.org.id,
      name: "First",
      slug,
      timezone: "UTC",
      currencyCode: "EUR",
      checkInMinutes: 840,
      checkOutMinutes: 660,
    });

    await assert.rejects(
      caller.property.create({
        organizationId: fx.org.id,
        name: "Second",
        slug,
        timezone: "UTC",
        currencyCode: "EUR",
        checkInMinutes: 840,
        checkOutMinutes: 660,
      }),
      (e) => domainCodeOf(e) === "property.slug_taken"
    );

    // Another company may have a "riverside" of its own.
    const other = await createFixture();
    try {
      const theirs = await callerFor(other.owner).property.create({
        organizationId: other.org.id,
        name: "Theirs",
        slug,
        timezone: "UTC",
        currencyCode: "EUR",
        checkInMinutes: 840,
        checkOutMinutes: 660,
      });
      await prisma.property.delete({ where: { id: theirs.id } });
    } finally {
      await other.cleanup();
    }

    await prisma.property.delete({ where: { id: first.id } });
  });

  test("a receptionist does not add hotels", async () => {
    await assert.rejects(
      callerFor(fx.member).property.create({
        organizationId: fx.org.id,
        name: "Nope",
        slug: `member-${fx.tag}`,
        timezone: "UTC",
        currencyCode: "EUR",
        checkInMinutes: 840,
        checkOutMinutes: 660,
      }),
      (e) => domainCodeOf(e) === "property.manager_required"
    );
  });
});
