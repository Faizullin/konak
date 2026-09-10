import "server-only";
import { storage } from "@/lib/storage";
import type { StorageProvider } from "@/lib/storage";
import { Prisma } from "@/generated/prisma/client";
import prisma from "@/server/db";
import { NotFoundError, PreconditionError, refused } from "@/server/errors";
import {
  AttachmentStatus,
  kindsRefusedBy,
  newStorageKey,
  PlatformError,
  refuseAttachment,
  refuseQuota,
  uploadReleaseAt,
  type AttachmentKind,
} from "../model";
import { enqueueOutbox } from "./outbox";
import { STORAGE_REMOVE } from "./storage-sweep";

/**
 * Two phases, because the bytes and the row cannot be written together —
 * `architecture.md` § File storage.
 *
 * A service rather than router code because it owns a multi-step transaction
 * and an invariant: stored plus reserved never exceeds the quota.
 */

/**
 * There is no `readUrl` here on purpose.
 *
 * The browser addresses `/api/uploads/<storageKey>` directly, and that route
 * works for every provider. A `platform.readUrl` answering `signedUrl ??
 * routeUrl` — mirroring how `requestUpload` answers `ticket ?? uploadUrl` — is
 * the right end state, and buys nothing while signing is an optimisation for
 * SDKs that are not installed. It goes back in with the first real provider.
 */

/**
 * Checked at the first upload rather than at import: a module that throws on
 * import takes down the screens that never touch a file too.
 */
let checked: Promise<StorageProvider> | null = null;

export function storageForAttachments(): Promise<StorageProvider> {
  checked ??= storage().then((store) => {
    const refusedKinds = kindsRefusedBy(store.capabilities);
    if (refusedKinds.length > 0) {
      throw new Error(
        `STORAGE_PROVIDER="${store.name}" cannot hold ${refusedKinds.join(", ")} — ` +
          `it serves public URLs. Use a provider with private objects, or stop collecting those kinds.`
      );
    }
    return store;
  });
  return checked;
}

export type StorageUsage = { quotaBytes: number; usedBytes: number; freeBytes: number };

/**
 * Summed rather than kept in a counter column, which would be a second source
 * of truth that drifts the first time a sweep and a confirm interleave.
 */
export async function storageUsage(
  db: Prisma.TransactionClient,
  organizationId: number
): Promise<StorageUsage> {
  const [organization, totals] = await Promise.all([
    db.organization.findUnique({
      where: { id: organizationId },
      select: { storageQuotaBytes: true },
    }),
    db.attachment.aggregate({
      where: { organizationId },
      _sum: { sizeBytes: true, reservedBytes: true },
    }),
  ]);

  if (!organization) {
    throw new NotFoundError(PlatformError.SUBJECT_NOT_FOUND, "Organization not found");
  }

  // BigInt on the column because 5 GiB does not fit in an Int; a number here
  // because every rule downstream is arithmetic and JS is exact to 9 PB.
  const quotaBytes = Number(organization.storageQuotaBytes);
  const usedBytes = (totals._sum.sizeBytes ?? 0) + (totals._sum.reservedBytes ?? 0);

  return { quotaBytes, usedBytes, freeBytes: Math.max(0, quotaBytes - usedBytes) };
}

/**
 * Two quota checks at once both find room, so the read that decides is
 * serialised. `claimOutboxBatch` locks for the same reason.
 */
async function lockOrganization(db: Prisma.TransactionClient, organizationId: number) {
  await db.$queryRaw`SELECT "id" FROM "organizations" WHERE "id" = ${organizationId} FOR UPDATE`;
}

export type RequestUploadInput = {
  organizationId: number;
  kind: AttachmentKind;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  personId?: number | null;
  companyId?: number | null;
  propertyId?: number | null;
  uploadedById: string;
};

export type RequestUploadResult = {
  attachmentId: number;
  storageKey: string;
  /** `null` means: post the bytes to `uploadUrl` instead. */
  ticket: Awaited<ReturnType<StorageProvider["ticket"]>>;
  uploadUrl: string;
  expiresAt: Date;
};

/**
 * The quota is checked **here**, when the ticket is issued: once a client holds
 * one the bytes reach the provider whether or not we hear about them again.
 */
export async function requestUpload(input: RequestUploadInput): Promise<RequestUploadResult> {
  const store = await storageForAttachments();

  // The caller's claims, checked before anything is written. They are checked
  // again at confirmation against what storage reports; this pass only avoids
  // handing out a ticket for a file that could never be kept.
  const refusal = refuseAttachment({
    kind: input.kind,
    sizeBytes: input.sizeBytes,
    mimeType: input.mimeType,
  });
  if (refusal) throw refused(refusal, "invalid", "fileName");

  const now = new Date();
  const storageKey = newStorageKey(`org/${input.organizationId}/attachments`, input.fileName);

  const attachment = await prisma.$transaction(async (tx) => {
    await lockOrganization(tx, input.organizationId);

    const usage = await storageUsage(tx, input.organizationId);
    const overQuota = refuseQuota({
      quotaBytes: usage.quotaBytes,
      usedBytes: usage.usedBytes,
      incomingBytes: input.sizeBytes,
    });
    if (overQuota) throw refused(overQuota, "conflict");

    return tx.attachment.create({
      data: {
        organizationId: input.organizationId,
        kind: input.kind,
        fileName: input.fileName,
        storageKey,
        status: AttachmentStatus.PENDING,
        provider: store.name,
        // Held against the quota until confirmation replaces it with the
        // observed size, or a sweep releases it.
        reservedBytes: input.sizeBytes,
        releaseAt: uploadReleaseAt(now),
        personId: input.personId ?? null,
        companyId: input.companyId ?? null,
        propertyId: input.propertyId ?? null,
        uploadedById: input.uploadedById,
      },
    });
  });

  const ticket = await store.ticket(storageKey, {
    maxBytes: input.sizeBytes,
    mimeTypes: [input.mimeType],
  });

  return {
    attachmentId: attachment.id,
    storageKey,
    ticket,
    uploadUrl: `/api/uploads/${storageKey}`,
    expiresAt: attachment.releaseAt!,
  };
}

/**
 * Where `sizeBytes` and `mimeType` stop being claims. A 40 MB video named
 * `passport.jpg` is refused here and its bytes removed with it — the claim got
 * it a ticket, not a row.
 */
export async function confirmUpload(input: { organizationId: number; storageKey: string }) {
  const store = await storageForAttachments();

  const attachment = await prisma.attachment.findUnique({
    where: { storageKey: input.storageKey },
  });
  if (!attachment || attachment.organizationId !== input.organizationId) {
    throw new NotFoundError(PlatformError.ATTACHMENT_NOT_FOUND, "Attachment not found");
  }
  if (attachment.status !== AttachmentStatus.PENDING) {
    throw new PreconditionError(
      PlatformError.ATTACHMENT_NOT_PENDING,
      "That upload was already finished"
    );
  }

  const object = await store.stat(attachment.storageKey);
  if (!object) {
    throw new PreconditionError(
      PlatformError.ATTACHMENT_MISSING_OBJECT,
      "Nothing was uploaded against that key"
    );
  }

  const refusal = refuseAttachment({
    kind: attachment.kind as AttachmentKind,
    sizeBytes: object.sizeBytes,
    mimeType: object.mimeType,
  });
  if (refusal) {
    await discard(attachment, store);
    throw refused(refusal, "invalid", "fileName");
  }

  const settled = await prisma.$transaction(async (tx) => {
    await lockOrganization(tx, attachment.organizationId);

    // The observed size may exceed what was reserved, so the quota is asked
    // again — with this row's own reservation excluded, or it would be counted
    // twice and a file could fail to confirm against the space it reserved.
    const usage = await storageUsage(tx, attachment.organizationId);
    const overQuota = refuseQuota({
      quotaBytes: usage.quotaBytes,
      usedBytes: usage.usedBytes - attachment.reservedBytes,
      incomingBytes: object.sizeBytes,
    });
    if (overQuota) return { overQuota, row: null };

    return {
      overQuota: null,
      row: await tx.attachment.update({
        where: { id: attachment.id },
        data: {
          status: AttachmentStatus.READY,
          sizeBytes: object.sizeBytes,
          mimeType: object.mimeType,
          providerId: object.providerId,
          reservedBytes: 0,
          releaseAt: null,
          uploadedAt: new Date(),
        },
      }),
    };
  });

  // Discarded out here, not in the branch above: `discard` writes on its own
  // connection, so doing it inside an open transaction holding the organization
  // row is a deadlock as soon as anyone adds a write before it.
  if (settled.overQuota) {
    await discard(attachment, store);
    throw refused(settled.overQuota, "conflict");
  }

  return settled.row;
}

/**
 * `organizationId` is deliberately **null**: `OutboxTask` cascades from
 * `Organization`, so a task filed against the organization being deleted would
 * go with it, and the bytes it named would be unreachable forever.
 */
export async function enqueueStorageRemoval(
  db: Prisma.TransactionClient,
  rows: { id: number; storageKey: string; provider: string | null; providerId: string | null }[]
) {
  for (const row of rows) {
    if (!row.provider) continue; // nothing was ever stored for it
    await enqueueOutbox(db, {
      type: STORAGE_REMOVE,
      payload: { provider: row.provider, providerId: row.providerId ?? row.storageKey },
      idempotencyKey: `${STORAGE_REMOVE}:${row.id}`,
    });
  }
}

/** Bytes and row together, for a file that was refused on arrival. */
async function discard(
  attachment: { id: number; storageKey: string; providerId: string | null },
  store: StorageProvider
) {
  await store.remove(attachment.providerId ?? attachment.storageKey);
  await prisma.attachment.delete({ where: { id: attachment.id } });
}
