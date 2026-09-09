import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { TRPCError } from "@trpc/server";
import { callerFor, createFixture, prisma, type Fixture } from "./harness";

/**
 * Setting a property up: room types, rooms and rate plans.
 *
 * `model/` proves the occupancy arithmetic and the cancellation terms. What
 * needs a database is the rest — that a code is unique inside its property and
 * not across the install, that an id from another tenant is not editable, and
 * that nothing is archived out from under a booking.
 */

let fx: Fixture;
let propertyId: number;
let otherPropertyId: number;
let doubleId: number;

const code = (e: unknown) => (e instanceof TRPCError ? e.code : String(e));
const MS_PER_DAY = 86_400_000;
const now = new Date();
const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
const fromToday = (n: number) => new Date(today.getTime() + n * MS_PER_DAY);

const occupancy = { baseOccupancy: 2, maxOccupancy: 4, maxAdults: 3, maxChildren: 2 };

before(async () => {
  fx = await createFixture();

  const property = await prisma.property.create({
    data: {
      organizationId: fx.org.id,
      name: `Setup ${fx.tag}`,
      slug: `setup-${fx.tag}`,
      currencyCode: "EUR",
      timezone: "UTC",
      roomTypes: { create: { name: "Double", code: "DBL", maxOccupancy: 4, position: 0 } },
    },
    include: { roomTypes: true },
  });
  propertyId = property.id;
  doubleId = property.roomTypes[0]!.id;

  // A second hotel in the same tenant: a code is unique per property, and an id
  // from one must not be editable through the other.
  const other = await prisma.property.create({
    data: {
      organizationId: fx.org.id,
      name: `Other ${fx.tag}`,
      slug: `other-setup-${fx.tag}`,
      currencyCode: "EUR",
      roomTypes: { create: { name: "Single", code: "SGL", position: 0 } },
    },
  });
  otherPropertyId = other.id;
});

after(async () => {
  await prisma.reservation.deleteMany({ where: { propertyId } });
  await prisma.room.deleteMany({ where: { propertyId: { in: [propertyId, otherPropertyId] } } });
  await prisma.ratePlan.deleteMany({
    where: { propertyId: { in: [propertyId, otherPropertyId] } },
  });
  await prisma.roomType.deleteMany({
    where: { propertyId: { in: [propertyId, otherPropertyId] } },
  });
  await prisma.property.deleteMany({ where: { organizationId: fx.org.id } });
  await fx.cleanup();
  await prisma.$disconnect();
});

describe("room types", () => {
  test("a code is unique inside a property, not across the install", async () => {
    const owner = callerFor(fx.owner);

    // "SGL" already exists — in the other hotel, which is not this one.
    const created = await owner.property.createRoomType({
      propertyId,
      name: "Single",
      code: "SGL",
      position: 1,
      ...occupancy,
      maxAdults: 1,
      baseOccupancy: 1,
    });
    assert.equal(created.code, "SGL");

    await assert.rejects(
      () =>
        owner.property.createRoomType({
          propertyId,
          name: "Single again",
          code: "SGL",
          position: 2,
          ...occupancy,
        }),
      (e) => code(e) === "CONFLICT"
    );
  });

  test("an occupancy that cannot be honoured is refused before the insert", async () => {
    await assert.rejects(
      () =>
        callerFor(fx.owner).property.createRoomType({
          propertyId,
          name: "Impossible",
          code: "IMP",
          position: 9,
          baseOccupancy: 6,
          maxOccupancy: 2,
          maxAdults: 2,
          maxChildren: 0,
        }),
      (e) => code(e) === "BAD_REQUEST"
    );
  });

  test("a receptionist reads the types and does not add one", async () => {
    await assert.rejects(
      () =>
        callerFor(fx.member).property.createRoomType({
          propertyId,
          name: "Member's",
          code: "MEM",
          position: 8,
          ...occupancy,
        }),
      (e) => code(e) === "FORBIDDEN"
    );

    // Reading is still theirs.
    const types = await callerFor(fx.member).property.listRoomTypes({ propertyId });
    assert.equal(types.length > 0, true);
  });

  test("a type from another property is not editable through this one", async () => {
    const other = await prisma.roomType.findFirstOrThrow({
      where: { propertyId: otherPropertyId },
      select: { id: true },
    });

    await assert.rejects(
      () =>
        callerFor(fx.owner).property.updateRoomType({
          propertyId,
          id: other.id,
          name: "Stolen",
          code: "STL",
          position: 0,
          ...occupancy,
        }),
      (e) => code(e) === "NOT_FOUND"
    );
  });

  test("a type with rooms on it is not withdrawn, it is hidden — so it is refused", async () => {
    const owner = callerFor(fx.owner);
    const type = await owner.property.createRoomType({
      propertyId,
      name: "Twin",
      code: "TWN",
      position: 3,
      ...occupancy,
    });
    const room = await owner.property.createRoom({
      propertyId,
      roomTypeId: type.id,
      number: "T1",
      status: "CLEAN",
    });

    await assert.rejects(
      () => owner.property.archiveRoomType({ propertyId, id: type.id, archived: true }),
      (e) => code(e) === "CONFLICT"
    );

    // Archive the room, and the type follows.
    await owner.property.archiveRoom({ propertyId, id: room.id, archived: true });
    const archived = await owner.property.archiveRoomType({
      propertyId,
      id: type.id,
      archived: true,
    });
    assert.notEqual(archived.archivedAt, null);

    // And archiving is reversible, which is why it is a value not a procedure.
    const restored = await owner.property.archiveRoomType({
      propertyId,
      id: type.id,
      archived: false,
    });
    assert.equal(restored.archivedAt, null);
  });
});

describe("rooms", () => {
  test("a room number is unique inside its property", async () => {
    const owner = callerFor(fx.owner);
    await owner.property.createRoom({
      propertyId,
      roomTypeId: doubleId,
      number: "101",
      status: "CLEAN",
    });

    await assert.rejects(
      () =>
        owner.property.createRoom({
          propertyId,
          roomTypeId: doubleId,
          number: "101",
          status: "CLEAN",
        }),
      (e) => code(e) === "CONFLICT"
    );
  });

  test("a room type from another property cannot be built into this one", async () => {
    const other = await prisma.roomType.findFirstOrThrow({
      where: { propertyId: otherPropertyId },
      select: { id: true },
    });

    await assert.rejects(
      () =>
        callerFor(fx.owner).property.createRoom({
          propertyId,
          roomTypeId: other.id,
          number: "999",
          status: "CLEAN",
        }),
      (e) => code(e) === "NOT_FOUND"
    );
  });

  test("a room that still owes someone a night is neither retyped nor archived", async () => {
    const owner = callerFor(fx.owner);
    const spare = await owner.property.createRoomType({
      propertyId,
      name: "Spare",
      code: "SPR",
      position: 5,
      ...occupancy,
    });
    const room = await owner.property.createRoom({
      propertyId,
      roomTypeId: doubleId,
      number: "202",
      status: "CLEAN",
    });

    await prisma.reservation.create({
      data: {
        propertyId,
        reference: `INV-${fx.tag}-1`,
        currencyCode: "EUR",
        status: "CONFIRMED",
        stays: {
          create: {
            roomTypeId: doubleId,
            roomId: room.id,
            status: "CONFIRMED",
            checkIn: fromToday(2),
            checkOut: fromToday(4),
            currencyCode: "EUR",
          },
        },
      },
    });

    await assert.rejects(
      () =>
        owner.property.updateRoom({
          propertyId,
          id: room.id,
          roomTypeId: spare.id,
          number: "202",
          status: "CLEAN",
        }),
      (e) => code(e) === "CONFLICT"
    );

    await assert.rejects(
      () => owner.property.archiveRoom({ propertyId, id: room.id, archived: true }),
      (e) => code(e) === "CONFLICT"
    );

    // Renaming it is fine — the booking is on the room, not on its number.
    const renamed = await owner.property.updateRoom({
      propertyId,
      id: room.id,
      roomTypeId: doubleId,
      number: "202A",
      status: "DIRTY",
    });
    assert.equal(renamed.number, "202A");
    assert.equal(renamed.status, "DIRTY");
  });

  test("a departed booking does not block anything", async () => {
    const owner = callerFor(fx.owner);
    const room = await owner.property.createRoom({
      propertyId,
      roomTypeId: doubleId,
      number: "303",
      status: "CLEAN",
    });

    await prisma.reservation.create({
      data: {
        propertyId,
        reference: `INV-${fx.tag}-2`,
        currencyCode: "EUR",
        status: "CHECKED_OUT",
        stays: {
          create: {
            roomTypeId: doubleId,
            roomId: room.id,
            status: "CHECKED_OUT",
            checkIn: fromToday(-5),
            checkOut: fromToday(-3),
            currencyCode: "EUR",
          },
        },
      },
    });

    const archived = await owner.property.archiveRoom({
      propertyId,
      id: room.id,
      archived: true,
    });
    assert.notEqual(archived.archivedAt, null);
  });
});

describe("rate plans", () => {
  const plan = {
    name: "Flexible",
    code: "FLEX",
    currencyCode: "EUR",
    mealPlan: "BREAKFAST" as const,
    isRefundable: true,
    cancellationCutoffHours: 48,
    extraAdultMinor: 2500,
    extraChildMinor: 1000,
    defaultMinLengthOfStay: 1,
  };

  test("a plan is created, listed and updated", async () => {
    const owner = callerFor(fx.owner);
    const created = await owner.rate.createPlan({ propertyId, roomTypeId: null, ...plan });
    assert.equal(created.mealPlan, "BREAKFAST");

    const listed = await owner.rate.listPlans({ propertyId });
    assert.equal(
      listed.some((p) => p.id === created.id),
      true
    );

    const updated = await owner.rate.updatePlan({
      propertyId,
      id: created.id,
      roomTypeId: doubleId,
      ...plan,
      name: "Flexible rate",
    });
    assert.equal(updated.name, "Flexible rate");
    assert.equal(updated.roomTypeId, doubleId);
  });

  test("a non-refundable plan with a free window is refused on the field", async () => {
    await assert.rejects(
      () =>
        callerFor(fx.owner).rate.createPlan({
          propertyId,
          roomTypeId: null,
          ...plan,
          code: "NONREF",
          isRefundable: false,
          cancellationCutoffHours: 24,
        }),
      (e) => code(e) === "BAD_REQUEST"
    );

    // Without the window it is an ordinary non-refundable plan.
    const created = await callerFor(fx.owner).rate.createPlan({
      propertyId,
      roomTypeId: null,
      ...plan,
      code: "NONREF",
      isRefundable: false,
      cancellationCutoffHours: null,
    });
    assert.equal(created.isRefundable, false);
  });

  test("a plan cannot be scoped to another property's room type", async () => {
    const other = await prisma.roomType.findFirstOrThrow({
      where: { propertyId: otherPropertyId },
      select: { id: true },
    });

    await assert.rejects(
      () =>
        callerFor(fx.owner).rate.createPlan({
          propertyId,
          roomTypeId: other.id,
          ...plan,
          code: "WRONG",
        }),
      (e) => code(e) === "NOT_FOUND"
    );
  });

  test("a receptionist reads plans and writes no prices", async () => {
    const member = callerFor(fx.member);

    const listed = await member.rate.listPlans({ propertyId });
    assert.equal(Array.isArray(listed), true);

    await assert.rejects(
      () => member.rate.createPlan({ propertyId, roomTypeId: null, ...plan, code: "MEMPLAN" }),
      (e) => code(e) === "FORBIDDEN"
    );

    const target = listed[0];
    if (target) {
      await assert.rejects(
        () =>
          member.rate.setRates({
            propertyId,
            ratePlanId: target.id,
            roomTypeId: doubleId,
            from: fromToday(1),
            to: fromToday(3),
            priceMinor: 10000,
          }),
        (e) => code(e) === "FORBIDDEN"
      );
    }
  });
});
