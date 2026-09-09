/**
 * What this feature refuses, as codes rather than sentences. Same arrangement
 * as `reservations/model/errors.ts`.
 */
export const RateError = {
  PLAN_NOT_FOUND: "rate_plan.not_found",
  /** A quote names both; which one is missing is not worth two round trips. */
  PLAN_OR_TYPE_NOT_FOUND: "rate_plan.or_room_type_not_found",
  PLAN_CODE_TAKEN: "rate_plan.code_taken",
  /** Non-refundable and a free-cancellation window cannot both be true. */
  PLAN_TERMS_INVALID: "rate_plan.terms_invalid",
  /** A plan scoped to a room type that belongs to another property. */
  PLAN_ROOM_TYPE_MISMATCH: "rate_plan.room_type_mismatch",
  PLAN_CREATE_FORBIDDEN: "rate_plan.create_forbidden",
  PLAN_UPDATE_FORBIDDEN: "rate_plan.update_forbidden",
  PLAN_ARCHIVE_FORBIDDEN: "rate_plan.archive_forbidden",

  /** A date range covering no days at all. */
  RANGE_INVALID: "rate.range_invalid",
  PRICES_FORBIDDEN: "rate.prices_forbidden",
  RESTRICTIONS_FORBIDDEN: "rate.restrictions_forbidden",
} as const;

export type RateError = (typeof RateError)[keyof typeof RateError];
