/**
 * What this feature refuses, as codes rather than sentences. Same arrangement
 * as `reservations/model/errors.ts`.
 *
 * `ROOM_NOT_FOUND` and `ROOM_TYPE_NOT_FOUND` deliberately share their values
 * with the reservations catalogue: it is the same fact about the same row, and
 * a client comparing the string should get the same answer whichever router
 * refused it.
 */
export const PropertyError = {
  NOT_FOUND: "property.not_found",
  /** Adding or renaming a hotel is a decision, not a shift's work. */
  MANAGER_REQUIRED: "property.manager_required",
  SLUG_TAKEN: "property.slug_taken",

  ROOM_TYPE_NOT_FOUND: "room_type.not_found",
  ROOM_TYPE_CODE_TAKEN: "room_type.code_taken",
  /** The four occupancy numbers cannot all be true at once. */
  ROOM_TYPE_NEEDS_ONE_ADULT: "room_type.needs_one_adult",
  ROOM_TYPE_BASE_OVER_MAX: "room_type.base_over_max",
  ROOM_TYPE_ADULTS_OVER_MAX: "room_type.adults_over_max",
  ROOM_TYPE_CHILDREN_OVER_MAX: "room_type.children_over_max",
  /** A type with rooms on it is not withdrawn from sale, it is hidden. */
  ROOM_TYPE_HAS_ROOMS: "room_type.has_rooms",
  ROOM_TYPE_CREATE_FORBIDDEN: "room_type.create_forbidden",
  ROOM_TYPE_UPDATE_FORBIDDEN: "room_type.update_forbidden",
  ROOM_TYPE_ARCHIVE_FORBIDDEN: "room_type.archive_forbidden",

  ROOM_NOT_FOUND: "room.not_found",
  ROOM_NUMBER_TAKEN: "room.number_taken",
  /** Retyping a sold room would break the pairing `assignRoom` enforces. */
  ROOM_RETYPE_BLOCKED: "room.retype_blocked",
  ROOM_ARCHIVE_BLOCKED: "room.archive_blocked",
  ROOM_CREATE_FORBIDDEN: "room.create_forbidden",
  ROOM_UPDATE_FORBIDDEN: "room.update_forbidden",
  ROOM_ARCHIVE_FORBIDDEN: "room.archive_forbidden",
} as const;

export type PropertyError = (typeof PropertyError)[keyof typeof PropertyError];
