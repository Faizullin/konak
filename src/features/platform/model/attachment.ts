import { z } from "zod";
import type { StorageCapabilities } from "@/lib/storage/provider";
import type { Refused } from "@/lib/refusal";
import { PlatformError } from "./errors";
import { ATTACHMENT_KINDS, subjectInputSchema } from "./schemas";

/**
 * What a kind of file needs of wherever it is stored. Here rather than in
 * `lib/storage` because `lib/` may not import a feature, and asked at startup
 * so a misconfiguration is a sentence, not a passport scan on a public CDN.
 */
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

export const KIND_REQUIRES: Record<AttachmentKind, Partial<StorageCapabilities>> = {
  /** A room photograph. A CDN is the right home for it. */
  FILE: {},
  CONSENT: { privateObjects: true },
  CONTRACT: { privateObjects: true },
  /**
   * Privacy, and only privacy. An earlier version of this also demanded
   * `signedReads`, which refused the filesystem — the provider that serves
   * nothing publicly and checks membership on every single read. That is
   * *stricter* than an expiring link, not weaker. How a private object reaches
   * a browser is the provider's business; that it is private is ours.
   */
  IDENTITY_DOCUMENT: { privateObjects: true },
};

/**
 * One question, deliberately: can a stranger with the URL open it. Who signs
 * and who does direct upload are matters of *how*, and a rule that confuses
 * them with *may* refuses the wrong providers.
 */
export function refuseProviderForKind(
  capabilities: StorageCapabilities,
  kind: AttachmentKind
): Refused {
  const required = KIND_REQUIRES[kind];

  if (required.privateObjects && !capabilities.privateObjects) {
    return {
      code: PlatformError.ATTACHMENT_PROVIDER_PUBLIC,
      values: { kind },
      message: "this storage provider serves public URLs, and this kind must not be public",
    };
  }

  return null;
}

/**
 * Every kind this provider cannot hold. Called once at startup with the
 * configured provider, so the answer is known before a file is ever offered.
 */
export function kindsRefusedBy(capabilities: StorageCapabilities): AttachmentKind[] {
  return ATTACHMENT_KINDS.filter((kind) => refuseProviderForKind(capabilities, kind) !== null);
}

/* --- What may be uploaded ------------------------------------------------- */

/**
 * A row is PENDING from the moment a ticket is issued and READY only once
 * storage has been asked what it actually holds.
 */
export const AttachmentStatus = {
  PENDING: "PENDING",
  READY: "READY",
} as const;

export type AttachmentStatus = (typeof AttachmentStatus)[keyof typeof AttachmentStatus];

const MB = 1024 * 1024;

/**
 * A cap and an allowlist per kind — a passport scan is not a video. An
 * allowlist, because a denylist is a list of the attacks somebody thought of.
 * `image/heic` is here because that is what an iPhone photographs with.
 */
export const KIND_LIMITS: Record<
  AttachmentKind,
  { maxBytes: number; mimeTypes: readonly string[] }
> = {
  FILE: {
    maxBytes: 20 * MB,
    mimeTypes: [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/heic",
      "image/heif",
      "application/pdf",
    ],
  },
  CONSENT: {
    maxBytes: 10 * MB,
    mimeTypes: ["application/pdf", "image/jpeg", "image/png"],
  },
  /** Signed paperwork, which arrives as a PDF or it is not the signed copy. */
  CONTRACT: {
    maxBytes: 20 * MB,
    mimeTypes: ["application/pdf"],
  },
  IDENTITY_DOCUMENT: {
    maxBytes: 10 * MB,
    mimeTypes: ["image/jpeg", "image/png", "image/heic", "image/heif", "application/pdf"],
  },
};

/** The widest cap any kind allows — the cheap early rejection before the kind is known. */
export const MAX_UPLOAD_BYTES = Math.max(...Object.values(KIND_LIMITS).map((l) => l.maxBytes));

/**
 * Asked twice on purpose: with what the caller *claims*, so a doomed ticket is
 * never issued, and with what storage *reports*, which is what decides.
 */
export function refuseAttachment(file: {
  kind: AttachmentKind;
  sizeBytes: number;
  mimeType: string;
}): Refused {
  const limit = KIND_LIMITS[file.kind];

  if (file.sizeBytes <= 0) {
    return {
      code: PlatformError.ATTACHMENT_EMPTY,
      message: "an empty file is not a file",
    };
  }

  if (file.sizeBytes > limit.maxBytes) {
    return {
      code: PlatformError.ATTACHMENT_TOO_LARGE,
      values: { kind: file.kind, max: Math.floor(limit.maxBytes / MB) },
      message: "larger than this kind of file is allowed to be",
    };
  }

  // Compared bare: `image/jpeg; charset=binary` is a header, not a type.
  const type = file.mimeType.split(";")[0]!.trim().toLowerCase();
  if (!limit.mimeTypes.includes(type)) {
    return {
      code: PlatformError.ATTACHMENT_TYPE_REFUSED,
      values: { kind: file.kind },
      message: "this file type is not accepted for this kind",
    };
  }

  return null;
}

/**
 * The reservation, not the kind's cap: a ticket is signed for what the quota
 * was charged, so our own route has to refuse at the same number.
 */
export function uploadByteLimit(kind: AttachmentKind, reservedBytes: number): number {
  return Math.min(KIND_LIMITS[kind].maxBytes, reservedBytes);
}

/**
 * The `accept` attribute for a file input. **A filter, never the check.**
 *
 * Here rather than in the component so the picker offers exactly what
 * `refuseAttachment` will accept. Written at the call site instead, the two
 * drift, and the person discovers the mismatch *after* choosing the file.
 *
 * Drag-and-drop ignores `accept` entirely, `refuseAttachment` runs on every
 * file whatever route it arrived by, and the server sniffs the real bytes.
 * Three layers, and only the third is trusted.
 */
export function acceptAttribute(kind: AttachmentKind): string {
  return KIND_LIMITS[kind].mimeTypes.join(",");
}

/**
 * Types a browser renders rather than downloads.
 *
 * **HEIC is not one of them, in any browser.** `KIND_LIMITS` allows it on
 * purpose — it is what an iPhone produces, and a receptionist photographing a
 * passport will use one — so the gap between "we accept it" and "it can be
 * shown" is real and has to be answered somewhere. It is answered here, once,
 * rather than by a broken `<img>` in a table.
 */
const RENDERS_IN_BROWSER: readonly string[] = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
];

export function rendersInBrowser(mimeType: string | null | undefined): boolean {
  if (!mimeType) return false;
  return RENDERS_IN_BROWSER.includes(mimeType.split(";")[0]!.trim().toLowerCase());
}

/** Narrower: what an `<img>` can show, so a table knows a thumbnail from an icon. */
export function isThumbnailable(mimeType: string | null | undefined): boolean {
  return rendersInBrowser(mimeType) && (mimeType ?? "").toLowerCase().startsWith("image/");
}

/* --- What the organization may hold --------------------------------------- */

/**
 * `usedBytes` must already include everything reserved but unconfirmed, or a
 * thousand simultaneous requests each see room and all succeed.
 */
export function refuseQuota(usage: {
  quotaBytes: number;
  usedBytes: number;
  incomingBytes: number;
}): Refused {
  const free = usage.quotaBytes - usage.usedBytes;
  if (usage.incomingBytes <= free) return null;

  return {
    code: PlatformError.ATTACHMENT_QUOTA_EXCEEDED,
    values: {
      // Rounded for a person to read. `free` can be negative if a quota was
      // lowered below what is already stored, and "-3 MB free" is not a
      // sentence, so it floors at zero.
      available: Math.max(0, Math.floor(free / MB)),
      needed: Math.ceil(usage.incomingBytes / MB),
    },
    message: "this organization has no room left for it",
  };
}

/* --- How long an unconfirmed upload holds its reservation ----------------- */

/**
 * Fifteen minutes: long enough for a slow phone on hotel wifi to finish a 10 MB
 * scan, short enough that an abandoned tab does not hold quota for an afternoon.
 */
export const UPLOAD_WINDOW_MS = 15 * 60 * 1000;

export function uploadReleaseAt(now: Date): Date {
  return new Date(now.getTime() + UPLOAD_WINDOW_MS);
}

/* --- What a caller sends -------------------------------------------------- */

/**
 * `mimeType` and `sizeBytes` are required, unlike the row's columns: a ticket
 * cannot be sized without them. They stay **claims** — `confirmUpload`
 * overwrites both with what storage reports.
 */
export const requestUploadSchema = subjectInputSchema.extend({
  organizationId: z.number(),
  kind: z.enum(ATTACHMENT_KINDS).default("FILE"),
  fileName: z.string().min(1, "file_name_required").max(200),
  mimeType: z.string().min(1, "mime_type_required").max(120),
  sizeBytes: z.number().int().positive().max(MAX_UPLOAD_BYTES),
});

export type RequestUploadInput = z.infer<typeof requestUploadSchema>;

/** The key, not the id: it is what both routes address and it is unguessable. */
export const confirmUploadSchema = z.object({
  organizationId: z.number(),
  storageKey: z.string().min(1, "storage_key_required"),
});

export const deleteAttachmentSchema = z.object({
  organizationId: z.number(),
  id: z.number(),
});
