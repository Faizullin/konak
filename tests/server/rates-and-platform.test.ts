// First, and before anything that reaches `env.mjs`: these imports execute in
// order, and `@/lib/storage` validates the environment the moment it loads.
import "dotenv/config";
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { TRPCError } from "@trpc/server";
import { GET } from "@/app/api/uploads/[...key]/route";
import {
  drainOutbox,
  sweepExpiredRetention,
  sweepExpiredUploads,
} from "@/features/platform/server";
import { storage } from "@/lib/storage";
import { callerFor, createFixture, domainCodeOf, prisma, type Fixture } from "./harness";

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

  /**
   * Three real rooms.
   *
   * This fixture used to declare `totalRooms: 3` and create **no rooms at all**
   * — and every booking in the file passed, because inventory was a number
   * somebody typed rather than a fact about the hotel. It is counted from these
   * rows now, so the declaration is gone and the rooms are real.
   */
  await prisma.room.createMany({
    data: ["1", "2", "3"].map((number) => ({
      propertyId,
      roomTypeId,
      number: `${number}-${fx.tag}`,
    })),
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
  const PDF_BYTES = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(200, 0x20)]);
  const JPEG_BYTES = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 0)]);

  type UploadRequest = Parameters<ReturnType<typeof callerFor>["platform"]["requestUpload"]>[0];

  /** Ask for somewhere to put a file, exactly as a client would. */
  const request = (over: Partial<UploadRequest> = {}) =>
    callerFor(fx.owner).platform.requestUpload({
      organizationId: fx.org.id,
      personId,
      kind: "CONSENT",
      fileName: "Marketing Consent.PDF",
      mimeType: "application/pdf",
      sizeBytes: PDF_BYTES.byteLength,
      ...over,
    });

  /** What the route handler does with the body, without the HTTP. */
  async function upload(storageKey: string, bytes: Buffer) {
    const store = await storage();
    await store.put(storageKey, bytes, { mimeType: "application/octet-stream" });
  }

  async function setQuota(bytes: number) {
    await prisma.organization.update({
      where: { id: fx.org.id },
      data: { storageQuotaBytes: BigInt(bytes) },
    });
  }

  after(async () => {
    await setQuota(5 * 1024 * 1024 * 1024);
    // Removal tasks left PENDING would be claimed by the outbox suite's next
    // run, which isolates itself by type prefix and cannot see these.
    await drainOutbox({ limit: 100 });
  });

  test("the storage key is generated server-side and is unguessable", async () => {
    const a = await request();
    const b = await request();

    // A caller cannot supply the key, so it can never be built from an id.
    assert.notEqual(a.storageKey, b.storageKey);
    assert.match(a.storageKey, /^org\/\d+\/attachments\/[0-9a-f-]{36}\/marketing-consent\.pdf$/);
  });

  test("a reservation is not a file: it is pending, and listAttachments hides it", async () => {
    const { attachmentId, storageKey } = await request();

    const row = await prisma.attachment.findUniqueOrThrow({ where: { id: attachmentId } });
    assert.equal(row.status, "PENDING");
    assert.ok(row.releaseAt, "a pending row holds its reservation for a bounded time");
    assert.equal(row.reservedBytes, PDF_BYTES.byteLength);

    const listed = await callerFor(fx.owner).platform.listAttachments({
      organizationId: fx.org.id,
      personId,
    });
    assert.ok(!listed.some((r) => r.storageKey === storageKey));
  });

  test("confirming records what storage reports, not what the caller claimed", async () => {
    // Claim 9 MB; upload 209 bytes. The row must end up saying 209.
    const { attachmentId, storageKey } = await request({ sizeBytes: 9 * 1024 * 1024 });
    await upload(storageKey, PDF_BYTES);

    await callerFor(fx.owner).platform.confirmUpload({ organizationId: fx.org.id, storageKey });

    const row = await prisma.attachment.findUniqueOrThrow({ where: { id: attachmentId } });
    assert.equal(row.status, "READY");
    assert.equal(row.sizeBytes, PDF_BYTES.byteLength);
    assert.equal(row.mimeType, "application/pdf");
    assert.equal(row.reservedBytes, 0, "the reservation is settled, not left holding quota");
    assert.equal(row.releaseAt, null);
    assert.ok(row.uploadedAt);
  });

  test("a file whose bytes are not what was claimed is refused and removed", async () => {
    // A contract must be a PDF. The claim says so; the bytes are a JPEG.
    const { attachmentId, storageKey } = await request({
      kind: "CONTRACT",
      fileName: "signed.pdf",
      mimeType: "application/pdf",
      sizeBytes: JPEG_BYTES.byteLength,
    });
    await upload(storageKey, JPEG_BYTES);

    await assert.rejects(
      () => callerFor(fx.owner).platform.confirmUpload({ organizationId: fx.org.id, storageKey }),
      (e) => domainCodeOf(e) === "attachment.type_refused"
    );

    const row = await prisma.attachment.findUnique({ where: { id: attachmentId } });
    assert.equal(row, null, "the row is gone");
    const store = await storage();
    assert.equal(await store.stat(storageKey), null, "and so are the bytes");
  });

  test("confirming without uploading anything is refused", async () => {
    const { storageKey } = await request();
    await assert.rejects(
      () => callerFor(fx.owner).platform.confirmUpload({ organizationId: fx.org.id, storageKey }),
      (e) => domainCodeOf(e) === "attachment.missing_object"
    );
  });

  test("confirming twice is refused", async () => {
    const { storageKey } = await request();
    await upload(storageKey, PDF_BYTES);
    const owner = callerFor(fx.owner);

    await owner.platform.confirmUpload({ organizationId: fx.org.id, storageKey });
    await assert.rejects(
      () => owner.platform.confirmUpload({ organizationId: fx.org.id, storageKey }),
      (e) => domainCodeOf(e) === "attachment.not_pending"
    );
  });

  test("the quota is checked when the ticket is issued, not after the bytes land", async () => {
    const usage = await callerFor(fx.owner).platform.storageUsage({ organizationId: fx.org.id });
    await setQuota(usage.usedBytes + 100);

    await assert.rejects(
      () => request({ sizeBytes: 5000 }),
      (e) => domainCodeOf(e) === "attachment.quota_exceeded"
    );
  });

  test("unconfirmed reservations count against the quota", async () => {
    // Otherwise a thousand simultaneous requests each see room and all succeed.
    const usage = await callerFor(fx.owner).platform.storageUsage({ organizationId: fx.org.id });
    await setQuota(usage.usedBytes + 1000);

    await request({ sizeBytes: 900 });
    await assert.rejects(
      () => request({ sizeBytes: 900 }),
      (e) => domainCodeOf(e) === "attachment.quota_exceeded"
    );
  });

  test("a sweep releases an abandoned reservation, and its bytes", async () => {
    await setQuota(5 * 1024 * 1024 * 1024);
    const { attachmentId, storageKey } = await request();
    await upload(storageKey, PDF_BYTES);

    const before = await callerFor(fx.owner).platform.storageUsage({ organizationId: fx.org.id });

    // The window passes.
    await prisma.attachment.update({
      where: { id: attachmentId },
      data: { releaseAt: new Date(Date.now() - 1000) },
    });

    const result = await sweepExpiredUploads();
    assert.ok(result.removed >= 1);

    assert.equal(await prisma.attachment.findUnique({ where: { id: attachmentId } }), null);
    const store = await storage();
    assert.equal(await store.stat(storageKey), null);

    const after_ = await callerFor(fx.owner).platform.storageUsage({ organizationId: fx.org.id });
    assert.ok(after_.usedBytes < before.usedBytes, "the reservation stopped costing quota");
  });

  test("a confirmed file is not swept", async () => {
    const { attachmentId, storageKey } = await request();
    await upload(storageKey, PDF_BYTES);
    await callerFor(fx.owner).platform.confirmUpload({ organizationId: fx.org.id, storageKey });

    await sweepExpiredUploads();
    assert.ok(await prisma.attachment.findUnique({ where: { id: attachmentId } }));
  });

  test("retention deletes the file, not just the row's visibility", async () => {
    const { attachmentId, storageKey } = await request();
    await upload(storageKey, PDF_BYTES);
    await callerFor(fx.owner).platform.confirmUpload({ organizationId: fx.org.id, storageKey });

    await prisma.attachment.update({
      where: { id: attachmentId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await sweepExpiredRetention();

    assert.equal(await prisma.attachment.findUnique({ where: { id: attachmentId } }), null);
    const store = await storage();
    assert.equal(await store.stat(storageKey), null);
  });

  test("deleting a file files the intent to remove its bytes", async () => {
    const { attachmentId, storageKey } = await request();
    await upload(storageKey, PDF_BYTES);
    await callerFor(fx.owner).platform.confirmUpload({ organizationId: fx.org.id, storageKey });

    await callerFor(fx.owner).platform.deleteAttachment({
      organizationId: fx.org.id,
      id: attachmentId,
    });

    const task = await prisma.outboxTask.findFirst({
      where: { type: "storage.remove", idempotencyKey: `storage.remove:${attachmentId}` },
    });
    assert.ok(task, "a removal task was written in the same transaction as the delete");

    // And the worker actually removes them.
    await drainOutbox({ limit: 50 });
    const store = await storage();
    assert.equal(await store.stat(storageKey), null);
  });

  test("a removal task outlives the organization it belonged to", async () => {
    // `OutboxTask.organizationId` cascades from `Organization`, so a task filed
    // against the organization being deleted would vanish with it — and the
    // bytes would be unreachable forever.
    const { attachmentId, storageKey } = await request();
    await upload(storageKey, PDF_BYTES);
    await callerFor(fx.owner).platform.confirmUpload({ organizationId: fx.org.id, storageKey });

    await callerFor(fx.owner).platform.deleteAttachment({
      organizationId: fx.org.id,
      id: attachmentId,
    });

    const task = await prisma.outboxTask.findFirstOrThrow({
      where: { idempotencyKey: `storage.remove:${attachmentId}` },
    });
    assert.equal(task.organizationId, null);
  });

  test("listing filters by kind, so two panels on one person do not overlap", async () => {
    const owner = callerFor(fx.owner);

    const consent = await request({ kind: "CONSENT", fileName: "consent.pdf" });
    await upload(consent.storageKey, PDF_BYTES);
    await owner.platform.confirmUpload({
      organizationId: fx.org.id,
      storageKey: consent.storageKey,
    });

    const contract = await request({ kind: "CONTRACT", fileName: "contract.pdf" });
    await upload(contract.storageKey, PDF_BYTES);
    await owner.platform.confirmUpload({
      organizationId: fx.org.id,
      storageKey: contract.storageKey,
    });

    const consents = await owner.platform.listAttachments({
      organizationId: fx.org.id,
      personId,
      kind: "CONSENT",
    });
    assert.ok(consents.some((row) => row.id === consent.attachmentId));
    assert.ok(!consents.some((row) => row.id === contract.attachmentId));

    // Without a kind it is every file on the subject, which is what a screen
    // showing one combined list would ask for.
    const all = await owner.platform.listAttachments({ organizationId: fx.org.id, personId });
    assert.ok(all.some((row) => row.id === contract.attachmentId));
  });

  test("a member attaches a file but cannot delete one", async () => {
    // Uploading is part of checking a guest in; deleting takes the bytes with
    // it and cannot be undone, so the two are not the same right.
    const { attachmentId, storageKey } = await callerFor(fx.member).platform.requestUpload({
      organizationId: fx.org.id,
      personId,
      kind: "CONSENT",
      fileName: "member-consent.pdf",
      mimeType: "application/pdf",
      sizeBytes: PDF_BYTES.byteLength,
    });
    await upload(storageKey, PDF_BYTES);
    await callerFor(fx.member).platform.confirmUpload({ organizationId: fx.org.id, storageKey });

    await assert.rejects(
      () =>
        callerFor(fx.member).platform.deleteAttachment({
          organizationId: fx.org.id,
          id: attachmentId,
        }),
      (e) => domainCodeOf(e) === "attachment.delete_forbidden"
    );

    // The owner can, and the row goes.
    await callerFor(fx.owner).platform.deleteAttachment({
      organizationId: fx.org.id,
      id: attachmentId,
    });
    assert.equal(await prisma.attachment.findUnique({ where: { id: attachmentId } }), null);
  });

  test("the read route refuses a caller with no session", async () => {
    const { storageKey } = await request();
    const response = await GET(new Request(`http://localhost/api/uploads/${storageKey}`), {
      params: Promise.resolve({ key: storageKey.split("/") }),
    });

    assert.equal(response.status, 401);
  });

  test("the read route does not confirm that an unknown key exists", async () => {
    const response = await GET(new Request("http://localhost/api/uploads/org/1/nope"), {
      params: Promise.resolve({ key: ["org", "1", "nope"] }),
    });

    // 404 rather than 401: a different answer here would let anyone probe keys.
    assert.equal(response.status, 404);
  });
});

describe("tags", () => {
  test("a tag is created once, however it was typed", async () => {
    const caller = callerFor(fx.owner);

    const first = await caller.platform.createTag({
      organizationId: fx.org.id,
      name: `VIP ${fx.tag}`,
    });

    // Untrimmed and double-spaced is the same word to a person, and
    // `@@unique([organizationId, name])` compares exactly — so the normalising
    // has to happen before the duplicate check, not after it.
    await assert.rejects(
      caller.platform.createTag({
        organizationId: fx.org.id,
        name: `  VIP   ${fx.tag}  `,
      }),
      (e) => /already exists/i.test(e instanceof Error ? e.message : "")
    );

    await prisma.tag.delete({ where: { id: first.id } });
  });

  test("a person's tags are read back, and only theirs", async () => {
    const caller = callerFor(fx.owner);

    const [tag, person, other] = await Promise.all([
      caller.platform.createTag({ organizationId: fx.org.id, name: `High floor ${fx.tag}` }),
      prisma.person.create({
        data: { organizationId: fx.org.id, firstName: "Tagged", lastName: fx.tag },
      }),
      prisma.person.create({
        data: { organizationId: fx.org.id, firstName: "Untagged", lastName: fx.tag },
      }),
    ]);

    await caller.platform.attachTag({
      organizationId: fx.org.id,
      tagId: tag.id,
      personId: person.id,
    });

    const mine = await caller.platform.listSubjectTags({
      organizationId: fx.org.id,
      personId: person.id,
    });
    assert.deepEqual(
      mine.map((t) => t.name),
      [`High floor ${fx.tag}`]
    );

    const theirs = await caller.platform.listSubjectTags({
      organizationId: fx.org.id,
      personId: other.id,
    });
    assert.deepEqual(theirs, []);

    await caller.platform.detachTag({
      organizationId: fx.org.id,
      tagId: tag.id,
      personId: person.id,
    });
    assert.deepEqual(
      await caller.platform.listSubjectTags({ organizationId: fx.org.id, personId: person.id }),
      []
    );

    await prisma.person.deleteMany({ where: { id: { in: [person.id, other.id] } } });
    await prisma.tag.delete({ where: { id: tag.id } });
  });
});
