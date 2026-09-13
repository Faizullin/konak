import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { createFixture, prisma, type Fixture } from "./harness";
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
let propertyId: number;
let roomTypeId: number;
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

  const row = await prisma.channelConnection.create({
    data: {
      propertyId,
      provider: "example-vendor",
      channelCode: "BOOKING_COM",
      status: "ACTIVE",
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
  await prisma.outboxTask.deleteMany({ where: { organizationId: fx.org.id } });
  await prisma.reservation.deleteMany({ where: { propertyId } });
  await prisma.channelConnection.deleteMany({ where: { propertyId } });
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
