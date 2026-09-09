import type { StorageCapabilities } from "@/lib/storage/provider";
import type { Refused } from "@/lib/refusal";
import { PlatformError } from "./errors";
import { ATTACHMENT_KINDS } from "./schemas";

/**
 * What a kind of file needs of wherever it is stored.
 *
 * The storage adapters are in `lib/`, which may not import a feature — so the
 * capabilities are declared there and this, the domain half, is here. A
 * provider says what it *can* do; this says what a passport scan *requires*;
 * `refuseProviderForKind` is the only place the two meet.
 *
 * The point is that a misconfiguration is a boot failure with a sentence rather
 * than an identity document quietly sitting on a public CDN.
 */
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

export const KIND_REQUIRES: Record<AttachmentKind, Partial<StorageCapabilities>> = {
  /** A room photograph. A CDN is the right home for it. */
  FILE: {},
  CONSENT: { privateObjects: true },
  CONTRACT: { privateObjects: true },
  /**
   * `signedReads` as well as privacy: a passport scan is shown to a receptionist
   * through a URL that stops working, never one that can be pasted into a chat.
   */
  IDENTITY_DOCUMENT: { privateObjects: true, signedReads: true },
};

/**
 * Whether this provider may hold this kind. Pure, so the same answer serves the
 * startup check and a test.
 *
 * Refuses on the first capability that falls short, naming it — a message that
 * says which flag is wrong is the difference between a five-minute fix and an
 * afternoon.
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

  if (required.signedReads && !capabilities.signedReads) {
    return {
      code: PlatformError.ATTACHMENT_PROVIDER_UNSIGNED,
      values: { kind },
      message: "this storage provider cannot issue expiring read URLs",
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
