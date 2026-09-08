import { z } from "zod";

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

export const rateCalendarInputSchema = z.object({
  propertyId: z.number(),
  ratePlanId: z.number(),
  roomTypeId: z.number(),
  from: rateDateSchema,
  to: rateDateSchema,
});

export type RateCalendarInput = z.infer<typeof rateCalendarInputSchema>;

/** One price for a run of days — how a rate is actually edited. */
export const setRatesSchema = z.object({
  propertyId: z.number(),
  ratePlanId: z.number(),
  roomTypeId: z.number(),
  from: rateDateSchema,
  to: rateDateSchema,
  priceMinor: z.number().min(0),
});

export type SetRatesInput = z.infer<typeof setRatesSchema>;

export const setRestrictionsSchema = z.object({
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
});

export type SetRestrictionsInput = z.infer<typeof setRestrictionsSchema>;
