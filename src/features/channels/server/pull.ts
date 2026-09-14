import "server-only";
import prisma from "@/server/db";
import type { OutboxHandler, OutboxHandlers } from "@/features/platform/server/outbox";
import { ChannelError } from "../model";
import { adapterFor } from "./adapter";
import { resolveChannelSecret } from "./credentials";
import { applyInboundReservation } from "./inbound";

/**
 * Fetching what was booked somewhere else.
 *
 * **Pulled rather than waited for.** A webhook that fails is a booking nobody
 * hears about; a poll that fails is a poll that runs again in a minute. The two
 * directions are not symmetrical, and this is the one where being slow is
 * survivable and being lossy is not.
 *
 * `since` comes from the connection's own `lastSyncedAt` and is deliberately
 * generous — re-reading a reservation costs nothing, because applying one twice
 * produces one booking.
 */

export const CHANNEL_PULL = "channel.pull";

export type ChannelPullPayload = { connectionId: number };

/** Overlap on purpose: a clock skew of a few seconds must not drop a booking. */
const OVERLAP_MS = 5 * 60_000;

const pullReservations: OutboxHandler = async (payload) => {
  const { connectionId } = payload as unknown as ChannelPullPayload;

  const connection = await prisma.channelConnection.findUnique({
    where: { id: connectionId },
    select: {
      id: true,
      provider: true,
      status: true,
      propertyId: true,
      channelCode: true,
      credentialsRef: true,
      externalPropertyId: true,
      lastSyncedAt: true,
      property: { select: { organizationId: true } },
      mappings: {
        where: { isActive: true },
        select: { externalRoomTypeId: true, roomTypeId: true, ratePlanId: true },
      },
    },
  });
  if (!connection) {
    throw new Error(`${ChannelError.CONNECTION_NOT_FOUND}: connection ${connectionId}`);
  }
  if (connection.status !== "ACTIVE") {
    throw new Error(`${ChannelError.CONNECTION_PAUSED}: connection ${connectionId}`);
  }

  const adapter = adapterFor(connection.provider);
  if (!adapter) {
    throw new Error(`no adapter for provider "${connection.provider}"`);
  }

  const since = connection.lastSyncedAt
    ? new Date(connection.lastSyncedAt.getTime() - OVERLAP_MS)
    : new Date(Date.now() - 24 * 60 * 60_000);

  const secret = await resolveChannelSecret(connection.credentialsRef);

  const arrivals = await adapter.pull(
    { secret, externalPropertyId: connection.externalPropertyId },
    since
  );

  const mappingsByExternal = new Map(
    connection.mappings.map((m) => [
      m.externalRoomTypeId,
      { roomTypeId: m.roomTypeId, ratePlanId: m.ratePlanId },
    ])
  );

  const scope = {
    id: connection.id,
    propertyId: connection.propertyId,
    channelCode: connection.channelCode,
    organizationId: connection.property.organizationId,
    mappings: mappingsByExternal,
  };

  /**
   * One bad reservation does not lose the rest of the batch.
   *
   * A channel selling a type this property no longer maps is a real thing that
   * happens, and throwing on the first one would leave every booking behind it
   * unapplied until somebody noticed. Each failure is recorded on the
   * connection; the batch finishes.
   */
  const failures: string[] = [];
  for (const arrival of arrivals) {
    try {
      await applyInboundReservation(scope, arrival);
    } catch (error) {
      failures.push(`${arrival.externalRef}: ${error instanceof Error ? error.message : error}`);
    }
  }

  await prisma.channelConnection.update({
    where: { id: connectionId },
    data: {
      // Only moved on a clean pass. A window that half-failed is a window
      // worth reading again, and re-reading costs nothing.
      lastSyncedAt: failures.length === 0 ? new Date() : connection.lastSyncedAt,
      lastError: failures.length > 0 ? failures.slice(0, 3).join(" · ") : null,
    },
  });

  if (failures.length > 0) {
    throw new Error(`${failures.length} reservation(s) could not be applied`);
  }
};

export const PULL_HANDLERS: OutboxHandlers = {
  [CHANNEL_PULL]: pullReservations,
};
