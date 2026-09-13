/**
 * What billing refuses, as codes.
 *
 * Only what is actually thrown. A payment's amount is refused by the schema
 * (`.positive()`) and a currency cannot differ because a payment inherits the
 * folio's — codes for either would be promises the code does not make, and
 * multi-currency is a decision with exchange rates behind it, not a branch. The sentence is the translation's job — see
 * `architecture.md` § A refusal is a code, not only a sentence.
 */
export const BillingError = {
  FOLIO_NOT_FOUND: "folio.not_found",
  FOLIO_CLOSED: "folio.closed",
  FOLIO_VOID: "folio.void",
  FOLIO_UNBALANCED: "folio.unbalanced",
  LINE_NOT_FOUND: "folio_line.not_found",
  /** A line may only name a stay on the reservation the folio is billing. */
  LINE_STAY_FOREIGN: "folio_line.stay_foreign",
  LINE_ALREADY_VOID: "folio_line.already_void",
  PAYMENT_NOT_FOUND: "payment.not_found",
  PAYMENT_NOT_CAPTURED: "payment.not_captured",
} as const;

export type BillingError = (typeof BillingError)[keyof typeof BillingError];
