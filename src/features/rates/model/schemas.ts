import { z } from "zod";
// The same bound, not a second number: "how far may one request reach" is one
// question, and two answers would drift.
import { boundedRange } from "@/features/reservations";

export const rateDateSchema = z.coerce.date();

export const quoteInputSchema = z.object({
  propertyId: z.number(),
  roomTypeId: z.number(),
  ratePlanId: z.number(),
  checkIn: rateDateSchema,
  checkOut: rateDateSchema,
  adults: z.number().min(1).max(20).default(1),
  children: z.number().min(0).max(20).default(0),
});

export type QuoteInput = z.infer<typeof quoteInputSchema>;

export const rateCalendarInputSchema = boundedRange(
  z.object({
    propertyId: z.number(),
    ratePlanId: z.number(),
    roomTypeId: z.number(),
    from: rateDateSchema,
    to: rateDateSchema,
  })
);

export type RateCalendarInput = z.infer<typeof rateCalendarInputSchema>;

/**
 * One price for a run of days — how a rate is actually edited.
 *
 * Bounded for a sharper reason than the reads: this range becomes a
 * `deleteMany`, one insert per night and a channel push, **in one transaction**.
 * A decade typed by accident was 3,653 of each.
 */
export const setRatesSchema = boundedRange(
  z.object({
    propertyId: z.number(),
    ratePlanId: z.number(),
    roomTypeId: z.number(),
    from: rateDateSchema,
    to: rateDateSchema,
    priceMinor: z.number().min(0),
  })
);

export type SetRatesInput = z.infer<typeof setRatesSchema>;

export const setRestrictionsSchema = boundedRange(
  z.object({
    propertyId: z.number(),
    ratePlanId: z.number(),
    roomTypeId: z.number(),
    from: rateDateSchema,
    to: rateDateSchema,
    minLengthOfStay: z.number().min(1).max(365).nullable().optional(),
    maxLengthOfStay: z.number().min(1).max(365).nullable().optional(),
    closed: z.boolean().optional(),
    closedToArrival: z.boolean().optional(),
    closedToDeparture: z.boolean().optional(),
  })
);

export type SetRestrictionsInput = z.infer<typeof setRestrictionsSchema>;
