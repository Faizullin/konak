import { z } from "zod";
import { inventoryCodeSchema } from "@/features/properties";

/**
 * A rate plan: what a room type costs, and on what terms.
 *
 * The nightly amounts live in `RateCalendar` — a plan is the contract around
 * them. Meal plan and cancellation terms are here because they are what a guest
 * is actually choosing between when two plans quote the same room.
 */

export const MealPlan = {
  ROOM_ONLY: "ROOM_ONLY",
  BREAKFAST: "BREAKFAST",
  HALF_BOARD: "HALF_BOARD",
  FULL_BOARD: "FULL_BOARD",
  ALL_INCLUSIVE: "ALL_INCLUSIVE",
} as const;

export type MealPlan = (typeof MealPlan)[keyof typeof MealPlan];

export const MEAL_PLAN_VALUES = Object.values(MealPlan);

export const mealPlanSchema = z.enum(MEAL_PLAN_VALUES);

export const MEAL_PLAN_LABELS: Record<MealPlan, string> = {
  ROOM_ONLY: "Room only",
  BREAKFAST: "Breakfast",
  HALF_BOARD: "Half board",
  FULL_BOARD: "Full board",
  ALL_INCLUSIVE: "All inclusive",
};

/**
 * Why these cancellation terms cannot both be true, or `null`.
 *
 * `cancellationCutoffHours` is when free cancellation *ends*, so it only means
 * anything on a refundable plan. Set on a non-refundable one it reads as a free
 * window that does not exist — which is the kind of contradiction a guest finds
 * at the worst moment.
 */
export function refuseCancellationTerms(plan: {
  isRefundable: boolean;
  cancellationCutoffHours?: number | null;
}): string | null {
  const cutoff = plan.cancellationCutoffHours;
  if (!plan.isRefundable && cutoff !== null && cutoff !== undefined) {
    return "A non-refundable plan has no free-cancellation window";
  }
  return null;
}

export const createRatePlanSchema = z.object({
  propertyId: z.number(),
  /** Absent applies the plan to every room type in the property. */
  roomTypeId: z.number().nullable(),
  name: z.string().min(1, "A name is required").max(120),
  code: inventoryCodeSchema,
  currencyCode: z.string().length(3, "A three-letter currency code"),
  mealPlan: mealPlanSchema,
  isRefundable: z.boolean(),
  cancellationCutoffHours: z.number().int().min(0).max(8760).nullable(),
  cancellationPolicy: z.string().max(2000).optional(),
  extraAdultMinor: z.number().int().min(0),
  extraChildMinor: z.number().int().min(0),
  defaultMinLengthOfStay: z.number().int().min(1).max(365),
});

export type CreateRatePlanInput = z.infer<typeof createRatePlanSchema>;

/** The dialog's half: the property comes from the route, not a field. */
export const ratePlanFormSchema = createRatePlanSchema.omit({ propertyId: true });

export type RatePlanFormInput = z.infer<typeof ratePlanFormSchema>;

export const updateRatePlanSchema = ratePlanFormSchema.extend({
  propertyId: z.number(),
  id: z.number(),
});

export type UpdateRatePlanInput = z.infer<typeof updateRatePlanSchema>;

export const listRatePlansSchema = z.object({
  propertyId: z.number(),
  includeArchived: z.boolean().optional(),
});

export type ListRatePlansInput = z.infer<typeof listRatePlansSchema>;

export const archiveRatePlanSchema = z.object({
  propertyId: z.number(),
  id: z.number(),
  archived: z.boolean(),
});

export type ArchiveRatePlanInput = z.infer<typeof archiveRatePlanSchema>;
