import { z } from "zod";
import { nightsBetween } from "./stay";
import { reservationStatusSchema } from "./status";

/** A date-only value. The client sends a day; the server stores UTC midnight. */
export const stayDateSchema = z.coerce.date();

/**
 * The longest run of nights one request may ask about.
 *
 * A little over a year, so "this date next year" is reachable in one go and a
 * season can be read whole. `GRID_MAX_NIGHTS` is much smaller because a grid is
 * a *screen*; this bounds the underlying question.
 *
 * The cap is not politeness. `availability()` builds a row per room type per
 * night in memory, so `from: 2020, to: 2120` is thirty-six thousand of them per
 * type — asked for by any signed-in member, for free. `model/grid.ts` states the
 * principle and applied it to the grid alone; this is the rest.
 */
export const MAX_RANGE_NIGHTS = 400;

/**
 * A date range that covers at least one night and no more than the cap.
 *
 * Applied as a refinement rather than checked in each procedure, so a range
 * nobody meant is refused by the schema the router and the form already share —
 * and refused **on `to`**, which is the field somebody mistyped.
 */
export function boundedRange<T extends z.ZodType>(schema: T) {
  return schema.superRefine((value, ctx) => {
    const { from, to } = value as { from: Date; to: Date };
    const nights = nightsBetween(from, to);

    if (nights < 1 || nights > MAX_RANGE_NIGHTS) {
      ctx.addIssue({ code: "custom", path: ["to"], message: "range_out_of_bounds" });
    }
  });
}

export const availabilityInputSchema = boundedRange(
  z.object({
    propertyId: z.number(),
    roomTypeId: z.number().optional(),
    from: stayDateSchema,
    to: stayDateSchema,
  })
);

export type AvailabilityInput = z.infer<typeof availabilityInputSchema>;

export const createReservationSchema = z.object({
  propertyId: z.number(),
  roomTypeId: z.number(),
  ratePlanId: z.number().optional(),
  checkIn: stayDateSchema,
  checkOut: stayDateSchema,
  adults: z.number().min(1).max(20).default(1),
  children: z.number().min(0).max(20).default(0),
  bookerPersonId: z.number().optional(),
  /**
   * A guest who is not in the directory yet, named here instead.
   *
   * The same pair a walk-in takes, and written the same way — most bookings are
   * for somebody the hotel has never met, and making the desk create a person
   * first is a second form for no reason.
   */
  firstName: z.string().min(1, "first_name_required").max(80).optional(),
  lastName: z.string().min(1, "last_name_required").max(80).optional(),
  email: z.email("email_invalid").optional().or(z.literal("")),
  phone: z.string().max(40).optional(),
  companyId: z.number().optional(),
  /** Assigned now only if the desk already knows the room. */
  roomId: z.number().optional(),
  /**
   * The hold this booking is consuming, if the desk took one while searching.
   *
   * Discounted from the availability check and deleted in the same transaction
   * that writes the booking — a hold that outlives the thing it was held for is
   * a room nobody can sell for the next fifteen minutes.
   */
  holdKey: z.string().min(8).max(128).optional(),
  notes: z.string().max(2000).optional(),
  source: z.enum(["DIRECT", "WIDGET", "PHONE", "WALK_IN", "OTA"]).default("DIRECT"),
});

export type CreateReservationInput = z.infer<typeof createReservationSchema>;

/**
 * The booking dialog's half: the property comes from the route, the source is
 * always the desk, and the hold key is the dialog's own bookkeeping.
 *
 * Defaults are re-declared rather than inherited. A Zod `.default()` beats
 * `useForm`'s `defaultValues` and resets the field as it is typed into — so a
 * form schema derived from one has to strip it.
 */
export const bookingFormSchema = createReservationSchema
  .omit({ propertyId: true, source: true, holdKey: true, adults: true, children: true })
  .extend({
    adults: z.number().min(1).max(20),
    children: z.number().min(0).max(20),
  });

export type BookingFormInput = z.infer<typeof bookingFormSchema>;

export const setReservationStatusSchema = z.object({
  propertyId: z.number(),
  id: z.number(),
  status: reservationStatusSchema,
  reason: z.string().max(500).optional(),
});

export type SetReservationStatusInput = z.infer<typeof setReservationStatusSchema>;

export const assignRoomSchema = z.object({
  propertyId: z.number(),
  stayId: z.number(),
  /** `null` unassigns — a stay may go back to being a room type. */
  roomId: z.number().nullable(),
});

export type AssignRoomInput = z.infer<typeof assignRoomSchema>;

export const holdInputSchema = z.object({
  propertyId: z.number(),
  roomTypeId: z.number(),
  checkIn: stayDateSchema,
  checkOut: stayDateSchema,
  quantity: z.number().min(1).max(20).default(1),
  /** The checkout session. Reusing it extends the same hold rather than taking a second room. */
  holdKey: z.string().min(8).max(128),
  minutes: z.number().min(1).max(120).default(15),
});

export type HoldInput = z.infer<typeof holdInputSchema>;

export const releaseHoldSchema = z.object({
  propertyId: z.number(),
  holdKey: z.string().min(8).max(128),
});

export type ReleaseHoldInput = z.infer<typeof releaseHoldSchema>;

/**
 * A walk-in: a guest standing at the desk, booked and checked in at once.
 *
 * `checkIn` is absent on purpose — a walk-in arrives on the property's own day,
 * which the server knows and the browser does not. A room is required rather
 * than optional because checking in is what this does, and the status rules
 * refuse a guest checked into a room type.
 */
export const walkInSchema = z.object({
  propertyId: z.number(),
  roomTypeId: z.number(),
  roomId: z.number(),
  ratePlanId: z.number().optional(),
  nights: z.number().min(1).max(60),
  adults: z.number().min(1).max(20),
  children: z.number().min(0).max(20),
  firstName: z.string().min(1, "first_name_required").max(80),
  lastName: z.string().min(1, "last_name_required").max(80),
  email: z.email("email_invalid").optional().or(z.literal("")),
  phone: z.string().max(40).optional(),
  notes: z.string().max(2000).optional(),
});

export type WalkInInput = z.infer<typeof walkInSchema>;

/** The dialog's half: the property comes from the route, not a field. */
export const walkInFormSchema = walkInSchema.omit({ propertyId: true });

export type WalkInFormInput = z.infer<typeof walkInFormSchema>;

/**
 * Moving a stay: new nights, and optionally a new room in the same drag.
 *
 * Both land in one procedure because a grid drag changes both at once, and two
 * calls would let the room move while the dates were refused.
 */
export const moveStaySchema = z.object({
  propertyId: z.number(),
  stayId: z.number(),
  checkIn: stayDateSchema,
  checkOut: stayDateSchema,
  /** Absent leaves the room alone; `null` unassigns it. */
  roomId: z.number().nullable().optional(),
});

export type MoveStayInput = z.infer<typeof moveStaySchema>;
