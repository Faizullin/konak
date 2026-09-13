import { z } from "zod";

/**
 * How many rooms of a type may be sold beyond the count, and what happens when
 * it bites.
 *
 * **Written down rather than discovered** — `product-shape.md` § 14. A hotel
 * that never overbooks leaves money on the table; one that overbooks without a
 * policy walks guests without a plan. So the number is a setting with a default
 * of zero, and the default is the safe one: a property that has not thought
 * about this does not overbook.
 *
 * The distinction that matters: **this applies to what a channel is told, never
 * to what the desk can sell.** The desk's availability is derived from stays
 * and is the truth; overbooking is a deliberate lie told outward, and the
 * moment it stops being a lie the desk has to walk somebody.
 */

export const OverbookingPolicy = {
  /** Tell the channel exactly what is free. The default, and the safe one. */
  NONE: "NONE",
  /** Sell a fixed number beyond the count, per room type per night. */
  FIXED: "FIXED",
} as const;

export type OverbookingPolicy = (typeof OverbookingPolicy)[keyof typeof OverbookingPolicy];

export const OVERBOOKING_POLICY_VALUES = Object.values(OverbookingPolicy);

export const overbookingPolicySchema = z.enum(OVERBOOKING_POLICY_VALUES);

export type OverbookingSettings = {
  policy: string;
  /** Rooms beyond the count, when the policy is `FIXED`. */
  extraRooms: number;
};

export const DEFAULT_OVERBOOKING: OverbookingSettings = {
  policy: OverbookingPolicy.NONE,
  extraRooms: 0,
};

/**
 * What to tell the channel a type has free on a night.
 *
 * Never below zero: a negative number is not a quantity, and a channel that
 * receives one either rejects the push or does something worse with it.
 *
 * **A sold-out night stays sold out.** Overbooking adds to what is free, not to
 * what is gone — a type with nothing left is closed, and a policy that reopened
 * it would be the hotel walking a guest by arithmetic rather than by decision.
 */
export function sellableForChannel(
  availableRooms: number,
  settings: OverbookingSettings = DEFAULT_OVERBOOKING
): number {
  const free = Math.max(0, availableRooms);
  if (settings.policy !== OverbookingPolicy.FIXED) return free;
  if (free === 0) return 0;
  return free + Math.max(0, settings.extraRooms);
}
