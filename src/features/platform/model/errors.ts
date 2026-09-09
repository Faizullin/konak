/**
 * What this feature refuses, as codes rather than sentences. Same arrangement
 * as `reservations/model/errors.ts`.
 */
export const PlatformError = {
  /** Activities, tags and attachments hang off exactly one subject. */
  SUBJECT_AMBIGUOUS: "platform.subject_ambiguous",
  SUBJECT_NOT_FOUND: "platform.subject_not_found",
  TAG_NOT_FOUND: "tag.not_found",
  TAG_NAME_TAKEN: "tag.name_taken",

  /** Refused at startup, not at upload — see `model/attachment.ts`. */
  ATTACHMENT_PROVIDER_PUBLIC: "attachment.provider_public",

  ATTACHMENT_NOT_FOUND: "attachment.not_found",
  ATTACHMENT_EMPTY: "attachment.empty",
  ATTACHMENT_TOO_LARGE: "attachment.too_large",
  ATTACHMENT_TYPE_REFUSED: "attachment.type_refused",
  ATTACHMENT_QUOTA_EXCEEDED: "attachment.quota_exceeded",
  /** Confirming a row that was already confirmed, or already swept. */
  ATTACHMENT_NOT_PENDING: "attachment.not_pending",
  /** A ticket was issued and nothing was ever uploaded against it. */
  ATTACHMENT_MISSING_OBJECT: "attachment.missing_object",
} as const;

export type PlatformError = (typeof PlatformError)[keyof typeof PlatformError];
