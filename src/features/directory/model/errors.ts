/**
 * What this feature refuses, as codes rather than sentences.
 *
 * Same arrangement as `reservations/model/errors.ts`: the server throws these
 * through `DomainError`, the client reads them back as `AppError.domainCode`,
 * and a message can be reworded or translated without either noticing.
 */
export const DirectoryError = {
  /** The role may not read the directory at all. */
  NO_ACCESS: "directory.no_access",

  PERSON_NOT_FOUND: "person.not_found",
  PERSON_CREATE_FORBIDDEN: "person.create_forbidden",
  PERSON_UPDATE_FORBIDDEN: "person.update_forbidden",
  PERSON_ARCHIVE_FORBIDDEN: "person.archive_forbidden",
  /** Another person in the organization already holds that email. */
  PERSON_EMAIL_TAKEN: "person.email_taken",

  COMPANY_NOT_FOUND: "company.not_found",
  COMPANY_CREATE_FORBIDDEN: "company.create_forbidden",
  COMPANY_UPDATE_FORBIDDEN: "company.update_forbidden",
  COMPANY_TAX_ID_TAKEN: "company.tax_id_taken",

  LINK_FORBIDDEN: "directory.link_forbidden",
  /** One side of a person↔company link is missing. */
  LINK_SUBJECT_NOT_FOUND: "directory.link_subject_not_found",
} as const;

export type DirectoryError = (typeof DirectoryError)[keyof typeof DirectoryError];
