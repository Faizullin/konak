import { z } from "zod";
import { reservationStatusSchema } from "./status";

/** A date-only value. The client sends a day; the server stores UTC midnight. */
export const stayDateSchema = z.coerce.date();

export const availabilityInputSchema = z.object({
  propertyId: z.number(),
  roomTypeId: z.number().optional(),
  from: stayDateSchema,
  to: stayDateSchema,
});

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
  companyId: z.number().optional(),
  /** Assigned now only if the desk already knows the room. */
  roomId: z.number().optional(),
  notes: z.string().max(2000).optional(),
  source: z.enum(["DIRECT", "WIDGET", "PHONE", "WALK_IN", "OTA"]).default("DIRECT"),
});

export type CreateReservationInput = z.infer<typeof createReservationSchema>;

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
  firstName: z.string().min(1, "First name is required").max(80),
  lastName: z.string().min(1, "Last name is required").max(80),
  email: z.email("Enter a valid email address").optional().or(z.literal("")),
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
