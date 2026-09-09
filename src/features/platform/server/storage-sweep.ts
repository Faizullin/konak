import "server-only";
import { storage } from "@/lib/storage";
import prisma from "@/server/db";
import { AttachmentStatus } from "../model";
import type { OutboxHandler, OutboxHandlers } from "./outbox";

/**
 * Deleting a row does not delete what it points at, and nothing else in the
 * tree will notice. Every path that loses an `Attachment` ends up here.
 */

/** One object, removed because the row that owned it is going or gone. */
export const STORAGE_REMOVE = "storage.remove";

export type StorageRemovePayload = {
  provider: string;
  providerId: string;
};

const removeObject: OutboxHandler = async (payload) => {
  const { provider, providerId } = payload as StorageRemovePayload;
  const store = await storage();

  // A task written when Cloudinary held the bytes cannot be honoured by the
  // filesystem. Failing loudly leaves the object findable; guessing would
  // delete the wrong thing or silently report success.
  if (provider !== store.name) {
    throw new Error(
      `task was written for provider "${provider}" but "${store.name}" is configured`
    );
  }

  await store.remove(providerId);
};

export const STORAGE_HANDLERS: OutboxHandlers = {
  [STORAGE_REMOVE]: removeObject,
};

export type SweepResult = { removed: number; failed: number };

/**
 * Bytes first: a row deleted before its object leaves an orphan nothing knows
 * the key of. The other order fails loudly and is swept again next pass.
 */
async function purge(
  rows: { id: number; storageKey: string; provider: string | null; providerId: string | null }[]
): Promise<SweepResult> {
  if (rows.length === 0) return { removed: 0, failed: 0 };

  const store = await storage();
  const result: SweepResult = { removed: 0, failed: 0 };

  for (const row of rows) {
    // Rows that never reached a provider — a reservation nothing uploaded
    // against — have no bytes to remove, only a row to release.
    const owned = row.provider === null || row.provider === store.name;
    try {
      if (owned) await store.remove(row.providerId ?? row.storageKey);
      await prisma.attachment.delete({ where: { id: row.id } });
      result.removed += 1;
    } catch {
      // Left in place on purpose: the next pass finds it again. A sweep that
      // deleted rows it could not clean up would be the leak it exists to stop.
      result.failed += 1;
    }
  }

  return result;
}

/**
 * Reservations nobody uploaded against — a ticket issued, the tab closed, and
 * quota held by a row the organization cannot see.
 */
export async function sweepExpiredUploads(now = new Date(), limit = 200): Promise<SweepResult> {
  const rows = await prisma.attachment.findMany({
    where: { status: AttachmentStatus.PENDING, releaseAt: { lte: now } },
    select: { id: true, storageKey: true, provider: true, providerId: true },
    take: limit,
  });

  return purge(rows);
}

/**
 * `expiresAt` is the legal clock. Unlike the sweep above these are files
 * somebody meant to keep; what expired is the permission to keep them.
 */
export async function sweepExpiredRetention(now = new Date(), limit = 200): Promise<SweepResult> {
  const rows = await prisma.attachment.findMany({
    where: { expiresAt: { lte: now } },
    select: { id: true, storageKey: true, provider: true, providerId: true },
    take: limit,
  });

  return purge(rows);
}

/**
 * The sweeps' predicate again, duplicated for the reason `countDueOutbox`
 * duplicates the claim's: a dry run that deleted things to count them is not one.
 */
export async function countSweepable(
  which: "uploads" | "retention",
  now = new Date()
): Promise<number> {
  return prisma.attachment.count({
    where:
      which === "uploads"
        ? { status: AttachmentStatus.PENDING, releaseAt: { lte: now } }
        : { expiresAt: { lte: now } },
  });
}

export type SweepReport = { uploads: SweepResult; retention: SweepResult };

/** One pass of both, for the worker to call beside a drain. */
export async function sweepStorage(now = new Date()): Promise<SweepReport> {
  return {
    uploads: await sweepExpiredUploads(now),
    retention: await sweepExpiredRetention(now),
  };
}
