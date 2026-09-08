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
