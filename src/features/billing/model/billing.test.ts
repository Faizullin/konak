import assert from "node:assert/strict";
import { test } from "node:test";
import {
  balanceMinor,
  BillingError,
  chargedMinor,
  FolioStatus,
  paidMinor,
  PaymentStatus,
  priceLine,
  refuseClose,
  refusePosting,
  taxOn,
} from "./index";

/**
 * The arithmetic, and when a bill may close. Both without a database, because
 * both are the kind of thing a hotelier checks against their own sums.
 */

const line = (amountMinor: number, voided = false) => ({
  amountMinor,
  voidedAt: voided ? new Date() : null,
});
const paid = (amountMinor: number, status: string = PaymentStatus.CAPTURED) => ({
  amountMinor,
  status,
});

test("tax is basis points, and rounds away from zero at the half", () => {
  assert.equal(taxOn(10_000, 2000), 2000); // 20% of 100.00
  assert.equal(taxOn(999, 2000), 200); // 199.8 → 200
  assert.equal(taxOn(0, 2000), 0);
  assert.equal(taxOn(10_000, 0), 0);

  // Away from zero, not `Math.round`: a discount's tax must come off by the
  // same amount a charge's went on, or a bill is out by one at the boundary.
  assert.equal(taxOn(5, 5000), 3);
  assert.equal(taxOn(-5, 5000), -3);
});

test("a line's parts add up, and a discount is an ordinary line", () => {
  assert.deepEqual(priceLine({ quantity: 3, unitPriceMinor: 2500, taxRateBp: 2000 }), {
    netMinor: 7500,
    taxAmountMinor: 1500,
    amountMinor: 9000,
  });

  // Negative unit price, no second code path, and the tax comes off with it.
  assert.deepEqual(priceLine({ quantity: 1, unitPriceMinor: -1000, taxRateBp: 2000 }), {
    netMinor: -1000,
    taxAmountMinor: -200,
    amountMinor: -1200,
  });

  assert.equal(priceLine({ quantity: 2, unitPriceMinor: 1250 }).amountMinor, 2500);
});

test("a void is a correction, not a deletion", () => {
  assert.equal(chargedMinor([line(1000), line(500)]), 1500);
  assert.equal(chargedMinor([line(1000), line(500, true)]), 1000);
});

test("only money actually taken counts as paid", () => {
  assert.equal(paidMinor([paid(1000), paid(500)]), 1500);
  assert.equal(paidMinor([paid(1000), paid(500, PaymentStatus.PENDING)]), 1000);
  assert.equal(paidMinor([paid(1000), paid(500, PaymentStatus.FAILED)]), 1000);

  // A refund is a REFUNDED payment, so it stops counting by itself.
  assert.equal(paidMinor([paid(1000, PaymentStatus.REFUNDED)]), 0);
});

test("a folio closes only when it balances exactly", () => {
  const lines = [line(9000)];

  // Not "near enough": a folio closing with a balance is a debt the hotel has
  // stopped tracking, or money it has taken and not accounted for.
  const short = refuseClose({ status: FolioStatus.OPEN, lines, payments: [paid(8999)] });
  assert.equal(short?.code, BillingError.FOLIO_UNBALANCED);
  assert.equal(short?.values?.balance, 1);

  const over = refuseClose({ status: FolioStatus.OPEN, lines, payments: [paid(9001)] });
  assert.equal(over?.values?.balance, -1);

  assert.equal(refuseClose({ status: FolioStatus.OPEN, lines, payments: [paid(9000)] }), null);
});

test("a closed folio is a record, not a working document", () => {
  const settled = { lines: [line(0)], payments: [] };

  assert.equal(
    refuseClose({ status: FolioStatus.CLOSED, ...settled })?.code,
    BillingError.FOLIO_CLOSED
  );
  assert.equal(
    refuseClose({ status: FolioStatus.VOID, ...settled })?.code,
    BillingError.FOLIO_VOID
  );

  assert.equal(refusePosting(FolioStatus.OPEN), null);
  assert.equal(refusePosting(FolioStatus.CLOSED)?.code, BillingError.FOLIO_CLOSED);
  assert.equal(refusePosting(FolioStatus.VOID)?.code, BillingError.FOLIO_VOID);
});

test("an empty folio balances, so a stay with nothing on it can still close", () => {
  // A booking that was never charged is finished, not stuck open for ever.
  assert.equal(balanceMinor([], []), 0);
  assert.equal(refuseClose({ status: FolioStatus.OPEN, lines: [], payments: [] }), null);
});
