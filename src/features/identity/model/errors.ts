/**
 * What this feature refuses, as codes rather than sentences. Same arrangement
 * as `reservations/model/errors.ts`.
 */
export const IdentityError = {
  /**
   * Demoting the last administrator locks everyone out of the install, and
   * there is no way back from inside the app.
   */
  LAST_ADMIN: "user.last_admin",
} as const;

export type IdentityError = (typeof IdentityError)[keyof typeof IdentityError];
