import { z } from "zod";

/**
 * What a charge comes to.
 *
 * Every number here is an integer of the currency's smallest unit, and the
 * arithmetic never leaves them — `product-shape.md` § 12: money is never a
 * float, and never divided by a hundred by assumption.
 */

export const LineType = {
  /** A night of a stay, at the plan's price. */
  ROOM: "ROOM",
  EXTRA: "EXTRA",
  SERVICE: "SERVICE",
  TAX: "TAX",
  DISCOUNT: "DISCOUNT",
  /** A levy the hotel collects for somebody else. */
  CITY_TAX: "CITY_TAX",
} as const;

export type LineType = (typeof LineType)[keyof typeof LineType];

export const LINE_TYPE_VALUES = Object.values(LineType);

export const lineTypeSchema = z.enum(LINE_TYPE_VALUES);

/** Basis points: 2000 is 20%. Ten thousand of them make the whole. */
export const BASIS_POINTS = 10_000;

/**
 * Tax on a net amount, rounded half away from zero.
 *
 * Half **away from zero**, not `Math.round`, which rounds −0.5 up to −0.0 and
 * would make a discount's tax disagree with a charge's by one unit at exactly
 * the boundary. A bill that is out by one is a bill somebody has to explain.
 */
export function taxOn(netMinor: number, taxRateBp: number): number {
  const exact = (netMinor * taxRateBp) / BASIS_POINTS;
  return Math.sign(exact) * Math.round(Math.abs(exact));
}

export type LineAmounts = {
  netMinor: number;
  taxAmountMinor: number;
  amountMinor: number;
};

/**
 * A line, priced.
 *
 * Tax is computed from the net rather than stored as a third independent
 * number, so a line cannot be posted whose parts do not add up. A **discount**
 * is an ordinary line with a negative unit price — there is no second code
 * path, and its tax comes off with it.
 */
export function priceLine(args: {
  quantity: number;
  unitPriceMinor: number;
  taxRateBp?: number;
}): LineAmounts {
  const netMinor = args.quantity * args.unitPriceMinor;
  const taxAmountMinor = taxOn(netMinor, args.taxRateBp ?? 0);
  return { netMinor, taxAmountMinor, amountMinor: netMinor + taxAmountMinor };
}
