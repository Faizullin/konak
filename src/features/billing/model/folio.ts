import { z } from "zod";
import type { Refused } from "@/lib/refusal";
import { BillingError } from "./errors";

/**
 * The bill attached to a stay, and when it is allowed to close.
 *
 * A folio is the one place the product says a number out loud to a guest, so
 * the rules here are about *not being wrong* rather than about convenience.
 */

export const FolioStatus = {
  OPEN: "OPEN",
  /** Balanced and finished. A closed folio is a record, not a working document. */
  CLOSED: "CLOSED",
  /** Raised in error. Voided rather than deleted, because it had a number. */
  VOID: "VOID",
} as const;

export type FolioStatus = (typeof FolioStatus)[keyof typeof FolioStatus];

export const FOLIO_STATUS_VALUES = Object.values(FolioStatus);

export const folioStatusSchema = z.enum(FOLIO_STATUS_VALUES);

export const PaymentStatus = {
  PENDING: "PENDING",
  CAPTURED: "CAPTURED",
  FAILED: "FAILED",
  REFUNDED: "REFUNDED",
} as const;

export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

export const PAYMENT_STATUS_VALUES = Object.values(PaymentStatus);

export const paymentStatusSchema = z.enum(PAYMENT_STATUS_VALUES);

export const PaymentMethod = {
  CASH: "CASH",
  CARD: "CARD",
  BANK_TRANSFER: "BANK_TRANSFER",
  ONLINE: "ONLINE",
  VOUCHER: "VOUCHER",
  /** Collected by the channel; the hotel is owed it, not the guest. */
  OTA_COLLECT: "OTA_COLLECT",
} as const;

export type PaymentMethod = (typeof PaymentMethod)[keyof typeof PaymentMethod];

export const PAYMENT_METHOD_VALUES = Object.values(PaymentMethod);

export const paymentMethodSchema = z.enum(PAYMENT_METHOD_VALUES);

/** Money actually taken. Pending is a promise and failed is nothing. */
export function paymentCounts(status: string): boolean {
  return status === PaymentStatus.CAPTURED;
}

export type FolioLineLike = { amountMinor: number; voidedAt: Date | null };
export type PaymentLike = { amountMinor: number; status: string };

/** Charged, less anything voided. A void is a correction, not a deletion. */
export function chargedMinor(lines: readonly FolioLineLike[]): number {
  return lines.reduce((total, line) => (line.voidedAt ? total : total + line.amountMinor), 0);
}

/** Taken. A refund is a `REFUNDED` payment, so it stops counting by itself. */
export function paidMinor(payments: readonly PaymentLike[]): number {
  return payments.reduce(
    (total, payment) => (paymentCounts(payment.status) ? total + payment.amountMinor : total),
    0
  );
}

/**
 * What is still owed. Negative means the guest is owed money back.
 */
export function balanceMinor(
  lines: readonly FolioLineLike[],
  payments: readonly PaymentLike[]
): number {
  return chargedMinor(lines) - paidMinor(payments);
}

/**
 * Why this folio may not close, or `null`.
 *
 * **Balanced means exactly zero**, not "near enough". A folio that closes with
 * a balance is a debt the hotel has stopped tracking, or money it has taken and
 * not accounted for — and the number is frozen at close, so nothing later
 * notices.
 */
export function refuseClose(args: {
  status: string;
  lines: readonly FolioLineLike[];
  payments: readonly PaymentLike[];
}): Refused {
  if (args.status === FolioStatus.CLOSED) {
    return { code: BillingError.FOLIO_CLOSED, message: "That folio is already closed" };
  }
  if (args.status === FolioStatus.VOID) {
    return { code: BillingError.FOLIO_VOID, message: "That folio was voided" };
  }

  const balance = balanceMinor(args.lines, args.payments);
  if (balance !== 0) {
    return {
      code: BillingError.FOLIO_UNBALANCED,
      values: { balance },
      message: "That folio does not balance yet",
    };
  }

  return null;
}

/** A closed or voided folio takes no more charges: it is a record now. */
export function refusePosting(status: string): Refused {
  if (status === FolioStatus.CLOSED) {
    return { code: BillingError.FOLIO_CLOSED, message: "That folio is closed" };
  }
  if (status === FolioStatus.VOID) {
    return { code: BillingError.FOLIO_VOID, message: "That folio was voided" };
  }
  return null;
}
