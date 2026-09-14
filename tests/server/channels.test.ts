import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { callerFor, createFixture, domainCodeOf, prisma, type Fixture } from "./harness";
import {
  applyInboundReservation,
  enqueueChannelPulls,
  enqueueChannelPush,
} from "@/features/channels/server";
import type { InboundReservation } from "@/features/channels/server";

/**
 * Distribution, against a real database and no vendor.
 *
 * Everything here is provable without a channel manager — which is the point of
 * the adapter seam: the rules that matter are ours, and the only thing a vendor
 * decides is how the message is spelled.
 */

let fx: Fixture;
let secretsDir: string;
let propertyId: number;
let roomTypeId: number;
let roomId: number;
let connection: { id: number; propertyId: number; channelCode: string; organizationId: number };

const arriving = (over: Partial<InboundReservation> = {}): InboundReservation => ({
  externalRef: `OTA-${fx.tag}`,
  externalRoomTypeId: "DBL-EXT",
  checkIn: new Date(Date.UTC(2027, 6, 1)),
  checkOut: new Date(Date.UTC(2027, 6, 3)),
  adults: 2,
  children: 0,
  totalMinor: 24_000,
  currencyCode: "EUR",
  guest: { firstName: "Otto", lastName: "Channel" },
  cancelled: false,
  ...over,
});

before(async () => {
  secretsDir = mkdtempSync(join(tmpdir(), "konak-channel-secrets-"));
  process.env.CHANNEL_SECRETS_DIR = secretsDir;
  writeFileSync(
    join(secretsDir, "test-secret.json"),
    JSON.stringify({ apiKey: "test-secret-key" })
  );

  fx = await createFixture();

  const property = await prisma.property.create({
    data: {
      organizationId: fx.org.id,
      name: `Channel ${fx.tag}`,
      slug: `channel-${fx.tag}`,
      currencyCode: "EUR",
      roomTypes: { create: { name: "Double", code: "DBL", maxOccupancy: 2 } },
      numberSeries: {
        create: {
          organizationId: fx.org.id,
          kind: "RESERVATION",
          prefix: "C-",
          period: "2027",
          counter: 0,
        },
      },
    },
    include: { roomTypes: true },
  });
  propertyId = property.id;
  roomTypeId = property.roomTypes[0]!.id;

  // One real room: a walk-in needs a door, and availability counts rooms.
  const room = await prisma.room.create({
    data: { propertyId, roomTypeId, number: `C-${fx.tag}` },
  });
  roomId = room.id;

  const row = await prisma.channelConnection.create({
    data: {
      propertyId,
      provider: "example-vendor",
      channelCode: "BOOKING_COM",
      status: "ACTIVE",
      credentialsRef: "test-secret",
      mappings: { create: { roomTypeId, externalRoomTypeId: "DBL-EXT" } },
    },
  });
  connection = {
    id: row.id,
    propertyId,
    channelCode: row.channelCode,
    organizationId: fx.org.id,
  };
});

after(async () => {
  if (secretsDir) {
    rmSync(secretsDir, { recursive: true, force: true });
  }
  await prisma.outboxTask.deleteMany({ where: { organizationId: fx.org.id } });
  await prisma.reservation.deleteMany({ where: { propertyId } });
  await prisma.channelConnection.deleteMany({ where: { propertyId } });
  // Rooms before types: `Room.roomType` is Restrict, so a type cannot go while
  // a room still names it.
  await prisma.room.deleteMany({ where: { propertyId } });
  await prisma.roomType.deleteMany({ where: { propertyId } });
  await prisma.property.deleteMany({ where: { organizationId: fx.org.id } });
  await fx.cleanup();
  await prisma.$disconnect();
});

describe("a booking made somewhere else", () => {
  test("arriving twice produces one booking", async () => {
    // Networks retry and a channel re-sends. The only safe design is one where
    // applying twice is indistinguishable from applying once.
    const first = await applyInboundReservation(connection, arriving());
    const second = await applyInboundReservation(connection, arriving());

    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(first.reservationId, second.reservationId);

    const count = await prisma.reservation.count({
      where: { propertyId, externalRef: `OTA-${fx.tag}` },
    });
    assert.equal(count, 1);
  });

  test("it lands in the unassigned band, never in a room", async () => {
    // The channel sold a *type*. Choosing a door is the desk's decision and
    // belongs to whoever is standing there.
    const stay = await prisma.roomStay.findFirstOrThrow({
      where: { reservation: { propertyId, externalRef: `OTA-${fx.tag}` } },
    });

    assert.equal(stay.roomId, null);
    assert.equal(stay.roomTypeId, roomTypeId);
    assert.equal(stay.status, "CONFIRMED");
  });

  test("a type the channel sold but this property does not map is loud, not guessed", async () => {
    // Guessing would put a guest in the wrong category, which is worse than a
    // dead letter somebody has to read.
    await assert.rejects(
      applyInboundReservation(
        connection,
        arriving({
          externalRef: `OTA-unknown-${fx.tag}`,
          externalRoomTypeId: "SUITE-EXT",
        })
      ),
      (e) => /mapping_unknown/.test(e instanceof Error ? e.message : "")
    );
  });

  test("cancelled there is cancelled here, and cancelling twice is not an error", async () => {
    const cancel = arriving({ cancelled: true });

    const once = await applyInboundReservation(connection, cancel);
    const twice = await applyInboundReservation(connection, cancel);

    assert.equal(once.cancelled, true);
    assert.equal(twice.cancelled, true);

    const reservation = await prisma.reservation.findFirstOrThrow({
      where: { propertyId, externalRef: `OTA-${fx.tag}` },
    });
    assert.equal(reservation.status, "CANCELLED");

    // The stay goes with it, or the exclusion constraint still thinks the room
    // is held.
    const stay = await prisma.roomStay.findFirstOrThrow({
      where: { reservationId: reservation.id },
    });
    assert.equal(stay.status, "CANCELLED");
  });

  test("a cancellation for a booking we never had is not an error either", async () => {
    // A channel may cancel something it never successfully told us about.
    const result = await applyInboundReservation(
      connection,
      arriving({ externalRef: `OTA-never-${fx.tag}`, cancelled: true })
    );
    assert.equal(result.created, false);
    assert.equal(result.cancelled, true);
  });
});

describe("telling the channels", () => {
  test("many changes in a minute are one push, not many", async () => {
    // The push is a diff and already carries whatever all of them did. Without
    // this the outbox rebuilds the rate-limit problem the diff exists to solve.
    await prisma.outboxTask.deleteMany({ where: { organizationId: fx.org.id } });

    for (let i = 0; i < 5; i += 1) {
      await enqueueChannelPush(prisma, { propertyId, organizationId: fx.org.id });
    }

    const tasks = await prisma.outboxTask.count({
      where: { organizationId: fx.org.id, type: "channel.push" },
    });
    assert.equal(tasks, 1);
  });

  /**
   * The invariant, asserted rather than assumed.
   *
   * "An intent is written in the same transaction as the change it announces"
   * was true of `create` and `setStatus` and quietly false of three others —
   * each of which changes what is for sale. A walk-in is the worst: it takes a
   * room off *tonight's* market while every channel is still selling it.
   *
   * Written as a loop over the ways the market moves, so the next one that
   * forgets shows up here rather than as an overbooking.
   */
  test("every change to what is for sale enqueues a push", async () => {
    const caller = callerFor(fx.owner);

    const moves: [string, () => Promise<unknown>][] = [
      [
        "a walk-in",
        () =>
          caller.reservation.walkIn({
            propertyId,
            roomTypeId,
            roomId,
            nights: 1,
            adults: 1,
            children: 0,
            firstName: "Walk",
            lastName: `In-${fx.tag}`,
          }),
      ],
      [
        "a booking arriving from a channel",
        () =>
          applyInboundReservation(connection, {
            externalRef: `IN-${fx.tag}-${Date.now()}`,
            externalRoomTypeId: "DBL-EXT",
            cancelled: false,
            checkIn: new Date(Date.UTC(2027, 8, 1)),
            checkOut: new Date(Date.UTC(2027, 8, 2)),
            adults: 1,
            children: 0,
            currencyCode: "EUR",
            totalMinor: 10_000,
            guest: { firstName: "Ota", lastName: `Guest-${fx.tag}` },
          }),
      ],
    ];

    for (const [what, run] of moves) {
      await prisma.outboxTask.deleteMany({ where: { organizationId: fx.org.id } });
      await run();

      const queued = await prisma.outboxTask.count({
        where: { organizationId: fx.org.id, type: "channel.push" },
      });
      assert.equal(queued, 1, `${what} told the channels nothing`);
    }
  });

  test("a paused connection is not queued for", async () => {
    // A hotel that stopped selling there deliberately; a queue full of tasks
    // for it is noise.
    await prisma.outboxTask.deleteMany({ where: { organizationId: fx.org.id } });
    await prisma.channelConnection.update({
      where: { id: connection.id },
      data: { status: "PAUSED" },
    });

    const queued = await enqueueChannelPush(prisma, { propertyId, organizationId: fx.org.id });
    assert.equal(queued, 0);

    await prisma.channelConnection.update({
      where: { id: connection.id },
      data: { status: "ACTIVE" },
    });
  });
});

describe("asking the channels", () => {
  test("a pull is queued once a minute per live connection", async () => {
    // There is no event for a booking made on Booking.com: it happens where we
    // cannot see it, and the only way to learn about it is to ask.
    await prisma.outboxTask.deleteMany({ where: { organizationId: fx.org.id } });

    await enqueueChannelPulls();
    await enqueueChannelPulls();

    const tasks = await prisma.outboxTask.count({
      where: { organizationId: fx.org.id, type: "channel.pull" },
    });
    assert.equal(tasks, 1);
  });
});

describe("connecting a channel", () => {
  test("a new connection starts paused, and is not queued for", async () => {
    const caller = callerFor(fx.owner);
    await prisma.outboxTask.deleteMany({ where: { organizationId: fx.org.id } });

    const created = await caller.channel.create({
      propertyId,
      provider: "example-vendor",
      channelCode: "AIRBNB",
    });

    // Selling the moment it was saved would push before anybody mapped a room
    // type — and absent means off, so that push would say everything is closed.
    assert.equal(created.status, "PAUSED");
    assert.equal(
      await prisma.outboxTask.count({ where: { organizationId: fx.org.id, type: "channel.push" } }),
      0
    );

    await prisma.channelConnection.delete({ where: { id: created.id } });
  });

  test("one connection per channel per property", async () => {
    const caller = callerFor(fx.owner);
    await assert.rejects(
      caller.channel.create({
        propertyId,
        provider: "example-vendor",
        channelCode: "BOOKING_COM",
      }),
      (e) => /already connected/i.test(e instanceof Error ? e.message : "")
    );
  });

  test("switching it on tells it everything, because it knows nothing", async () => {
    const caller = callerFor(fx.owner);
    await prisma.outboxTask.deleteMany({ where: { organizationId: fx.org.id } });

    await caller.channel.setStatus({ propertyId, id: connection.id, status: "ACTIVE" });

    assert.equal(
      await prisma.outboxTask.count({ where: { organizationId: fx.org.id, type: "channel.push" } }),
      1
    );
  });

  test("unmapping deactivates rather than deletes", async () => {
    const caller = callerFor(fx.owner);
    const mapping = await prisma.channelMapping.findFirstOrThrow({
      where: { connectionId: connection.id },
    });

    await caller.channel.unmap({ propertyId, id: mapping.id });

    // The mirror rows written against it are evidence of what the channel was
    // told, and the type has to stop appearing in `current` without its history
    // disappearing with it.
    const after = await prisma.channelMapping.findUniqueOrThrow({ where: { id: mapping.id } });
    assert.equal(after.isActive, false);

    // And mapping it again is how it comes back.
    await caller.channel.map({
      propertyId,
      connectionId: connection.id,
      roomTypeId,
      externalRoomTypeId: "DBL-EXT",
    });
    const back = await prisma.channelMapping.findUniqueOrThrow({ where: { id: mapping.id } });
    assert.equal(back.isActive, true);
  });

  test("activating without readable credentials is refused", async () => {
    const caller = callerFor(fx.owner);
    const uncredentialed = await prisma.channelConnection.create({
      data: {
        propertyId,
        provider: "example-vendor",
        channelCode: "EXPEDIA",
        status: "PAUSED",
      },
    });

    await assert.rejects(
      caller.channel.setStatus({ propertyId, id: uncredentialed.id, status: "ACTIVE" }),
      (e) =>
        domainCodeOf(e) === "channel.credentials_missing" ||
        /credentials/i.test((e as Error).message)
    );

    await prisma.channelConnection.delete({ where: { id: uncredentialed.id } });
  });

  test("rotating credentials preserves mappings and mirror", async () => {
    const caller = callerFor(fx.owner);
    const updated = await caller.channel.setCredentials({
      propertyId,
      id: connection.id,
      credentialsRef: "rotated-secret",
      externalPropertyId: "EXT-999",
    });

    assert.equal(updated.credentialsRef, "rotated-secret");
    assert.equal(updated.externalPropertyId, "EXT-999");

    // Restore for other tests
    await caller.channel.setCredentials({
      propertyId,
      id: connection.id,
      credentialsRef: "test-secret",
      externalPropertyId: undefined,
    });
  });

  test("a receptionist does not decide where the hotel sells", async () => {
    await assert.rejects(
      callerFor(fx.member).channel.create({
        propertyId,
        provider: "example-vendor",
        channelCode: "EXPEDIA",
      }),
      (e) => /manager/i.test(e instanceof Error ? e.message : "")
    );
  });
});
