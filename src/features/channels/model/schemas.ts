import { z } from "zod";

/**
 * Connecting a channel, and telling it what our rooms are called.
 *
 * **Credentials are never an input here.** `credentialsRef` is a pointer into
 * whatever holds secrets, so a row in this table — and every form that writes
 * one — is safe to read in a support session.
 */

export const ChannelStatus = {
  ACTIVE: "ACTIVE",
  /** Deliberately stopped selling there. Not an error, and not queued for. */
  PAUSED: "PAUSED",
  ERROR: "ERROR",
} as const;

export type ChannelStatus = (typeof ChannelStatus)[keyof typeof ChannelStatus];

export const CHANNEL_STATUS_VALUES = Object.values(ChannelStatus);

export const channelStatusSchema = z.enum(CHANNEL_STATUS_VALUES);

/** The OTAs a connection can stand for. The vendor is the `provider`. */
export const CHANNEL_CODES = [
  "BOOKING_COM",
  "AIRBNB",
  "EXPEDIA",
  "OSTROVOK",
  "YANDEX_TRAVEL",
  "OTHER",
] as const;

export const channelCodeSchema = z.enum(CHANNEL_CODES);

export const listConnectionsSchema = z.object({ propertyId: z.number() });

export const createConnectionSchema = z.object({
  propertyId: z.number(),
  provider: z.string().min(1, "name_required").max(64),
  channelCode: channelCodeSchema,
  externalPropertyId: z.string().max(120).optional(),
  /** A pointer, never a secret. */
  credentialsRef: z.string().max(200).optional(),
});

export type CreateConnectionInput = z.infer<typeof createConnectionSchema>;

export const setConnectionStatusSchema = z.object({
  propertyId: z.number(),
  id: z.number(),
  status: channelStatusSchema,
});

export type SetConnectionStatusInput = z.infer<typeof setConnectionStatusSchema>;

export const mapRoomTypeSchema = z.object({
  propertyId: z.number(),
  connectionId: z.number(),
  roomTypeId: z.number(),
  ratePlanId: z.number().optional(),
  externalRoomTypeId: z.string().min(1, "name_required").max(120),
  externalRatePlanId: z.string().max(120).optional(),
});

export type MapRoomTypeInput = z.infer<typeof mapRoomTypeSchema>;

export const unmapRoomTypeSchema = z.object({
  propertyId: z.number(),
  id: z.number(),
});

export type UnmapRoomTypeInput = z.infer<typeof unmapRoomTypeSchema>;
