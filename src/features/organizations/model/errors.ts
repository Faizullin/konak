/**
 * What this feature refuses, as codes rather than sentences. Same arrangement
 * as `reservations/model/errors.ts`.
 */
export const OrganizationError = {
  NOT_FOUND: "organization.not_found",
  SLUG_TAKEN: "organization.slug_taken",
  /** The organization has this module switched off. */
  MODULE_DISABLED: "organization.module_disabled",
  /** The owner has to hand the organization on before they can leave it. */
  OWNER_CANNOT_LEAVE: "organization.owner_cannot_leave",
  ALREADY_OWNER: "organization.already_owner",

  MEMBER_NOT_FOUND: "member.not_found",
  /** Nobody has signed up with that email yet, so there is nobody to add. */
  MEMBER_NO_ACCOUNT: "member.no_account",
  MEMBER_ALREADY: "member.already",
  /** The owner's role moves only by transferring ownership. */
  MEMBER_OWNER_ROLE_LOCKED: "member.owner_role_locked",
  /** Removing yourself is "leave", which is a different decision. */
  MEMBER_REMOVE_SELF: "member.remove_self",
  MEMBER_OWNER_NOT_REMOVABLE: "member.owner_not_removable",
} as const;

export type OrganizationError = (typeof OrganizationError)[keyof typeof OrganizationError];
