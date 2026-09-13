import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { enqueueOutbox } from "@/features/platform/server/outbox";
import { PUSH_HORIZON_NIGHTS, pushKey } from "../model";
import { CHANNEL_PUSH, type ChannelPushPayload } from "./push";

/**
 * "Tell the channels something moved."
 *
 * Recorded in the same transaction as the thing it announces — a booking and
 * the message announcing it commit together or not at all, otherwise a network
 * failure produces a booking nobody hears about, or an announcement of a
 * booking that rolled back (`product-shape.md` § 14).
 *
 * Cheap by design: **it does not compute the diff.** It records that the window
 * is worth re-reconciling, and the worker works out what actually changed —
 * so a caller never has to know what a channel was last told.
 */

type Tx = Pick<Prisma.TransactionClient, "channelConnection" | "outboxTask">;

export async function enqueueChannelPush(
  tx: Tx,
  args: { propertyId: number; organizationId?: number; from?: Date }
): Promise<number> {
  // Only live ones. A paused connection is a hotel that has deliberately
  // stopped selling there, and a queue full of tasks for it is noise.
  const connections = await tx.channelConnection.findMany({
    where: { propertyId: args.propertyId, status: "ACTIVE" },
    select: { id: true },
  });
  if (connections.length === 0) return 0;

  const now = new Date();
  const from =
    args.from ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const to = new Date(from.getTime() + PUSH_HORIZON_NIGHTS * 86_400_000);

  for (const connection of connections) {
    const payload: ChannelPushPayload = {
      connectionId: connection.id,
      from: from.toISOString(),
      to: to.toISOString(),
    };

    await enqueueOutbox(tx, {
      type: CHANNEL_PUSH,
      payload: payload as unknown as Record<string, unknown>,
      organizationId: args.organizationId,
      // Ten changes in a minute are one message: the push is a diff and
      // already carries what all of them did.
      idempotencyKey: pushKey(connection.id, from, now),
    });
  }

  return connections.length;
}
