import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { TRPCError } from "@trpc/server";
import { callerFor, createFixture, prisma, type Fixture } from "./harness";

let fx: Fixture;
let propertyId: number;
let roomTypeId: number;
let ratePlanId: number;
let personId: number;

const day = (offset: number) => new Date(Date.UTC(2027, 5, 1 + offset));
const code = (e: unknown) => (e instanceof TRPCError ? e.code : String(e));
const field = (e: unknown) =>
  e instanceof TRPCError && e.cause && "field" in e.cause
    ? (e.cause as { field: string }).field
    : null;

before(async () => {
  fx = await createFixture();

  const property = await prisma.property.create({
    data: {
      organizationId: fx.org.id,
      name: `Rates ${fx.tag}`,
      slug: `rates-${fx.tag}`,
      currencyCode: "EUR",
      numberSeries: {
        create: {
          organizationId: fx.org.id,
          kind: "RESERVATION",
          prefix: "Q-",
          period: "2027",
          counter: 0,
        },
      },
      roomTypes: {
        create: { name: "Twin", code: "TWN", baseOccupancy: 2, maxOccupancy: 4 },
      },
      ratePlans: {
        create: {
          name: "Flexible",
          code: "FLEX",
          currencyCode: "EUR",
          extraAdultMinor: 2000,
          extraChildMinor: 1000,
        },
      },
    },
    include: { roomTypes: true, ratePlans: true },
  });
  propertyId = property.id;
  roomTypeId = property.roomTypes[0]!.id;
  ratePlanId = property.ratePlans[0]!.id;

  await prisma.roomTypeInventory.createMany({
    data: [0, 1, 2, 3].map((i) => ({ roomTypeId, date: day(i), totalRooms: 3 })),
  });

  const person = await callerFor(fx.owner).directory.createPerson({
    organizationId: fx.org.id,
    firstName: "Quote",
    lastName: "Subject",
  });
  personId = person.id;
});

after(async () => {
  await prisma.reservation.deleteMany({ where: { propertyId } });
  await prisma.room.deleteMany({ where: { propertyId } });
  await prisma.roomType.deleteMany({ where: { propertyId } });
  await prisma.property.deleteMany({ where: { organizationId: fx.org.id } });
  await fx.cleanup();
  await prisma.$disconnect();
});

describe("quoting", () => {
  test("a range price is written per day and quoted back", async () => {
    const owner = callerFor(fx.owner);
    const written = await owner.rate.setRates({
      propertyId,
      ratePlanId,
      roomTypeId,
      from: day(0),
      to: day(3),
      priceMinor: 10000,
    });
    assert.equal(written.days, 3);

    const quote = await owner.rate.quote({
      propertyId,
      roomTypeId,
      ratePlanId,
      checkIn: day(0),
      checkOut: day(2),
      adults: 2,
      children: 0,
    });
    assert.equal(quote.refusal, null);
    assert.equal(quote.nightCount, 2);
    assert.equal(quote.totalMinor, 20000);
  });

  test("people beyond the base occupancy are charged per night", async () => {
    // Two nights, one extra adult and one child at 2000 + 1000 a night.
    const quote = await callerFor(fx.owner).rate.quote({
      propertyId,
      roomTypeId,
      ratePlanId,
      checkIn: day(0),
      checkOut: day(2),
      adults: 3,
      children: 1,
    });
    assert.equal(quote.totalMinor, 20000 + 2 * (2000 + 1000));
  });

  test("a night with no price refuses rather than quoting zero", async () => {
    const quote = await callerFor(fx.owner).rate.quote({
      propertyId,
      roomTypeId,
      ratePlanId,
      checkIn: day(10),
      checkOut: day(11),
      adults: 1,
      children: 0,
    });
    assert.equal(quote.refusal, "NO_PRICE");
    assert.equal(quote.totalMinor, null);
  });

  test("a minimum stay refuses a shorter one, and allows the exact length", async () => {
    const owner = callerFor(fx.owner);
    await owner.rate.setRestrictions({
      propertyId,
      ratePlanId,
      roomTypeId,
      from: day(0),
      to: day(1),
      minLengthOfStay: 2,
    });

    const short = await owner.rate.quote({
      propertyId,
      roomTypeId,
      ratePlanId,
      checkIn: day(0),
      checkOut: day(1),
      adults: 1,
      children: 0,
    });
    assert.equal(short.refusal, "MIN_STAY");

    const exact = await owner.rate.quote({
      propertyId,
      roomTypeId,
      ratePlanId,
      checkIn: day(0),
      checkOut: day(2),
      adults: 1,
      children: 0,
    });
    assert.equal(exact.refusal, null);
  });

  test("a booking on a refused rate is refused, with the reason", async () => {
    await assert.rejects(
      () =>
        callerFor(fx.owner).reservation.create({
          propertyId,
          roomTypeId,
          ratePlanId,
          checkIn: day(0),
          checkOut: day(1),
          adults: 1,
          children: 0,
          source: "DIRECT",
        }),
      (e) => code(e) === "CONFLICT" && field(e) === "ratePlanId"
    );
  });

  test("a priced booking stores the quote, not zero", async () => {
    const r = await callerFor(fx.owner).reservation.create({
      propertyId,
      roomTypeId,
      ratePlanId,
      checkIn: day(1),
      checkOut: day(3),
      adults: 2,
      children: 0,
      source: "DIRECT",
    });
    assert.equal(r.totalMinor, 20000);
    assert.equal(r.currencyCode, "EUR");
    assert.equal(r.stays[0]!.totalMinor, 20000);
  });
});

describe("holds", () => {
  test("a hold removes a room from availability and gives it back", async () => {
    const owner = callerFor(fx.owner);
    const before = await owner.reservation.availability({
      propertyId,
      roomTypeId,
      from: day(2),
      to: day(3),
    });

    await owner.reservation.hold({
      propertyId,
      roomTypeId,
      checkIn: day(2),
      checkOut: day(3),
      quantity: 1,
      holdKey: `hold-${fx.tag}`,
      minutes: 15,
    });

    const during = await owner.reservation.availability({
      propertyId,
      roomTypeId,
      from: day(2),
      to: day(3),
    });
    assert.equal(during[0]!.available, before[0]!.available - 1);
    assert.equal(during[0]!.held, 1);

    await owner.reservation.releaseHold({ propertyId, holdKey: `hold-${fx.tag}` });
    const after = await owner.reservation.availability({
      propertyId,
      roomTypeId,
      from: day(2),
      to: day(3),
    });
    assert.equal(after[0]!.available, before[0]!.available);
  });

  test("reusing a key extends the hold rather than taking a second room", async () => {
    const owner = callerFor(fx.owner);
    const key = `same-${fx.tag}`;
    for (let i = 0; i < 3; i += 1) {
      await owner.reservation.hold({
        propertyId,
        roomTypeId,
        checkIn: day(2),
        checkOut: day(3),
        quantity: 1,
        holdKey: key,
        minutes: 15,
      });
    }

    const nights = await owner.reservation.availability({
      propertyId,
      roomTypeId,
      from: day(2),
      to: day(3),
    });
    assert.equal(nights[0]!.held, 1);
    await owner.reservation.releaseHold({ propertyId, holdKey: key });
  });

  test("releasing twice is not an error", async () => {
    // An abandoned checkout may release late, or twice, or never.
    const owner = callerFor(fx.owner);
    await owner.reservation.releaseHold({ propertyId, holdKey: `never-${fx.tag}` });
    await owner.reservation.releaseHold({ propertyId, holdKey: `never-${fx.tag}` });
  });
});

describe("platform", () => {
  test("an activity needs exactly one subject", async () => {
    const owner = callerFor(fx.owner);

    await assert.rejects(
      () =>
        owner.platform.createActivity({
          organizationId: fx.org.id,
          type: "NOTE",
          subject: "orphan",
        }),
      (e) => code(e) === "BAD_REQUEST"
    );

    await assert.rejects(
      () =>
        owner.platform.createActivity({
          organizationId: fx.org.id,
          type: "NOTE",
          subject: "ambiguous",
          personId,
          propertyId,
        }),
      (e) => code(e) === "BAD_REQUEST"
    );
  });

  test("the same clientEventId writes one row", async () => {
    const owner = callerFor(fx.owner);
    const key = `evt-${fx.tag}`;
    const a = await owner.platform.createActivity({
      organizationId: fx.org.id,
      type: "NOTE",
      subject: "Prefers a quiet room",
      personId,
      clientEventId: key,
    });
    const b = await owner.platform.createActivity({
      organizationId: fx.org.id,
      type: "NOTE",
      subject: "Prefers a quiet room",
      personId,
      clientEventId: key,
    });
    assert.equal(a.id, b.id);
  });

  test("a subject from another tenant is not found", async () => {
    const foreign = await callerFor(fx.outsider).directory.createPerson({
      organizationId: fx.otherOrg.id,
      firstName: "Foreign",
      lastName: "Person",
    });

    await assert.rejects(
      () =>
        callerFor(fx.owner).platform.createActivity({
          organizationId: fx.org.id,
          type: "NOTE",
          subject: "cross tenant",
          personId: foreign.id,
        }),
      (e) => code(e) === "NOT_FOUND"
    );
  });

  test("a tag attaches once and detaches cleanly", async () => {
    const owner = callerFor(fx.owner);
    const tag = await owner.platform.createTag({
      organizationId: fx.org.id,
      name: `VIP-${fx.tag}`,
    });

    const first = await owner.platform.attachTag({
      organizationId: fx.org.id,
      tagId: tag.id,
      personId,
    });
    const again = await owner.platform.attachTag({
      organizationId: fx.org.id,
      tagId: tag.id,
      personId,
    });
    assert.equal(first.id, again.id);

    await owner.platform.detachTag({ organizationId: fx.org.id, tagId: tag.id, personId });
    const remaining = await prisma.entityTag.count({ where: { tagId: tag.id } });
    assert.equal(remaining, 0);
  });

  test("a duplicate tag name is refused on the field", async () => {
    const owner = callerFor(fx.owner);
    const name = `Dup-${fx.tag}`;
    await owner.platform.createTag({ organizationId: fx.org.id, name });
    await assert.rejects(
      () => owner.platform.createTag({ organizationId: fx.org.id, name }),
      (e) => code(e) === "CONFLICT" && field(e) === "name"
    );
  });
});

describe("attachments", () => {
  test("the storage key is generated server-side and is unguessable", async () => {
    const owner = callerFor(fx.owner);
    const a = await owner.platform.createAttachment({
      organizationId: fx.org.id,
      personId,
      kind: "CONSENT",
      fileName: "Marketing Consent.PDF",
    });
    const b = await owner.platform.createAttachment({
      organizationId: fx.org.id,
      personId,
      kind: "CONSENT",
      fileName: "Marketing Consent.PDF",
    });

    // A caller cannot supply the key, so it can never be built from an id.
    assert.notEqual(a.storageKey, b.storageKey);
    assert.match(a.storageKey, /^org\/\d+\/attachments\/[0-9a-f-]{36}\/marketing-consent\.pdf$/);

    const listed = await owner.platform.listAttachments({
      organizationId: fx.org.id,
      personId,
    });
    assert.ok(listed.some((row) => row.id === a.id));
  });
});
