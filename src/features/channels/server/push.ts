import "server-only";
import prisma from "@/server/db";
import type { OutboxHandler, OutboxHandlers } from "@/features/platform/server/outbox";
// The service module, not `@/features/reservations/server` — that barrel
// re-exports the router, the router enqueues a channel push, and importing it
// from here closes a cycle Node refuses to instantiate. The barrel is the
// convention; a cycle is the exception to it.
import { availability } from "@/features/reservations/server/service";
import {
  ChannelError,
  nightsToPush,
  sellableForChannel,
  type NightState,
  type PushedState,
} from "../model";
import { adapterFor, type PushNight } from "./adapter";

/**
 * Telling a channel what changed.
 *
 * Enqueued rather than called: an intent to tell an outside system is recorded
 * in the same transaction as the thing it announces, then carried out
 * afterwards — `product-shape.md` § 14. A booking and the message announcing it
 * commit together or not at all, otherwise a network failure produces a booking
 * nobody hears about, or an announcement of a booking that rolled back.
 */

export const CHANNEL_PUSH = "channel.push";

export type ChannelPushPayload = {
  connectionId: number;
  /** The window to reconcile, as ISO days. A task is a range, not a night. */
  from: string;
  to: string;
};

const pushAvailability: OutboxHandler = async (payload) => {
  const { connectionId, from, to } = payload as unknown as ChannelPushPayload;

  const connection = await prisma.channelConnection.findUnique({
    where: { id: connectionId },
    select: {
      id: true,
      provider: true,
      status: true,
      propertyId: true,
      credentialsRef: true,
      externalPropertyId: true,
      mappings: {
        where: { isActive: true },
        select: { roomTypeId: true, externalRoomTypeId: true, externalRatePlanId: true },
      },
    },
  });
  if (!connection) {
    // Dead-letter rather than retry: the connection is gone and will not return.
    throw new Error(`${ChannelError.CONNECTION_NOT_FOUND}: connection ${connectionId}`);
  }
  if (connection.status !== "ACTIVE") {
    throw new Error(`${ChannelError.CONNECTION_PAUSED}: connection ${connectionId}`);
  }

  const adapter = adapterFor(connection.provider);
  if (!adapter) {
    // Loud, like an unimplemented storage provider: a connection naming a
    // vendor nothing implements must not silently do nothing.
    throw new Error(`no adapter for provider "${connection.provider}"`);
  }

  // Absent means off: a room type with no mapping row is simply not
  // distributed, so a new one is never accidentally on sale everywhere.
  const mapped = new Map(connection.mappings.map((m) => [m.roomTypeId, m]));
  if (mapped.size === 0) return;

  const window = { from: new Date(from), to: new Date(to) };

  const [nights, mirror] = await Promise.all([
    availability({ propertyId: connection.propertyId, ...window }),
    prisma.channelSyncState.findMany({
      where: { connectionId, date: { gte: window.from, lt: window.to } },
      select: {
        roomTypeId: true,
        date: true,
        pushedAvailability: true,
        pushedPriceMinor: true,
        pushedRestrictionsJson: true,
        lastError: true,
      },
    }),
  ]);

  const current: NightState[] = nights
    .filter((night) => mapped.has(night.roomTypeId))
    .map((night) => ({
      roomTypeId: night.roomTypeId,
      date: night.date,
      // What the channel is told, which is not what the desk can sell.
      availability: sellableForChannel(night.available),
      priceMinor: null,
      restrictions: null,
    }));

  const pushed: PushedState[] = mirror.map((row) => ({
    roomTypeId: row.roomTypeId,
    date: row.date,
    availability: row.pushedAvailability ?? 0,
    priceMinor: row.pushedPriceMinor,
    restrictions: row.pushedRestrictionsJson,
    lastError: row.lastError,
  }));

  const changed = nightsToPush(current, pushed);
  if (changed.length === 0) return;

  const outgoing: PushNight[] = changed.map((night) => {
    const mapping = mapped.get(night.roomTypeId)!;
    return {
      ...night,
      externalRoomTypeId: mapping.externalRoomTypeId,
      externalRatePlanId: mapping.externalRatePlanId,
    };
  });

  const result = await adapter.push(
    {
      credentialsRef: connection.credentialsRef,
      externalPropertyId: connection.externalPropertyId,
    },
    outgoing
  );

  /**
   * Only what the channel accepted updates the mirror.
   *
   * The mirror is a cache of *their* belief, so writing a rejected night into
   * it would make the next diff skip a night they never received — the
   * disagreement would then be permanent and invisible.
   */
  await prisma.$transaction([
    ...result.accepted.map((night) =>
      prisma.channelSyncState.upsert({
        where: {
          connectionId_roomTypeId_date: {
            connectionId,
            roomTypeId: night.roomTypeId,
            date: night.date,
          },
        },
        update: {
          pushedAvailability: night.availability,
          pushedPriceMinor: night.priceMinor,
          pushedRestrictionsJson: night.restrictions,
          pushedAt: new Date(),
          lastError: null,
        },
        create: {
          connectionId,
          roomTypeId: night.roomTypeId,
          date: night.date,
          pushedAvailability: night.availability,
          pushedPriceMinor: night.priceMinor,
          pushedRestrictionsJson: night.restrictions,
        },
      })
    ),
    ...result.rejected.map(({ night, reason }) =>
      prisma.channelSyncState.upsert({
        where: {
          connectionId_roomTypeId_date: {
            connectionId,
            roomTypeId: night.roomTypeId,
            date: night.date,
          },
        },
        // The numbers are *not* written: only the error is, so the next diff
        // sends this night again.
        update: { lastError: reason },
        create: {
          connectionId,
          roomTypeId: night.roomTypeId,
          date: night.date,
          lastError: reason,
        },
      })
    ),
  ]);

  await prisma.channelConnection.update({
    where: { id: connectionId },
    data: {
      lastSyncedAt: new Date(),
      lastError: result.rejected.length > 0 ? `${result.rejected.length} night(s) rejected` : null,
    },
  });
};

export const PUSH_HANDLERS: OutboxHandlers = {
  [CHANNEL_PUSH]: pushAvailability,
};
