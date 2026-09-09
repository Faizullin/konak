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
} as const;

export type PlatformError = (typeof PlatformError)[keyof typeof PlatformError];
