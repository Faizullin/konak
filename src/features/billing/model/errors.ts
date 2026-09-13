/**
 * What billing refuses, as codes. The sentence is the translation's job — see
 * `architecture.md` § A refusal is a code, not only a sentence.
 */
export const BillingError = {
  FOLIO_NOT_FOUND: "folio.not_found",
  FOLIO_CLOSED: "folio.closed",
  FOLIO_VOID: "folio.void",
  FOLIO_UNBALANCED: "folio.unbalanced",
  FOLIO_CURRENCY_MISMATCH: "folio.currency_mismatch",
  LINE_NOT_FOUND: "folio_line.not_found",
  LINE_ALREADY_VOID: "folio_line.already_void",
  PAYMENT_NOT_FOUND: "payment.not_found",
  PAYMENT_NOT_CAPTURED: "payment.not_captured",
  PAYMENT_AMOUNT_INVALID: "payment.amount_invalid",
} as const;

export type BillingError = (typeof BillingError)[keyof typeof BillingError];
