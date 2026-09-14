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

/**
 * The *name* of a secret, and it has to be only a name.
 *
 * Resolution reads one file per connection out of `CHANNEL_SECRETS_DIR`, so a
 * ref carrying a separator would name a file outside it. No `/`, no `\`, and a
 * leading character that is never a dot: `join(dir, ref)` then cannot leave the
 * directory, whatever else the name says. The resolver checks this again,
 * because a row can predate a schema.
 */
export const credentialsRefSchema = z
  .string()
  .min(1, "name_required")
  .max(64)
  .regex(/^[a-z0-9][a-z0-9._-]*$/, "secret_name_format");

export const createConnectionSchema = z.object({
  propertyId: z.number(),
  provider: z.string().min(1, "name_required").max(64),
  channelCode: channelCodeSchema,
  externalPropertyId: z.string().max(120).optional(),
  /** A pointer, never a secret. */
  credentialsRef: credentialsRefSchema.optional(),
});

export type CreateConnectionInput = z.infer<typeof createConnectionSchema>;

/** The form owns neither the property nor which channel this is. */
export const connectionFormSchema = createConnectionSchema.omit({ propertyId: true });

export type ConnectionFormInput = z.infer<typeof connectionFormSchema>;

/**
 * Where a live connection's secret now lives, and what the vendor calls this
 * property.
 *
 * Separate from `create` because rotating a secret is the ordinary case and
 * re-creating the connection to do it would discard the mappings and the
 * mirror with it.
 */
export const setConnectionCredentialsSchema = z.object({
  propertyId: z.number(),
  id: z.number(),
  externalPropertyId: z.string().max(120).optional(),
  credentialsRef: credentialsRefSchema.optional(),
});

export type SetConnectionCredentialsInput = z.infer<typeof setConnectionCredentialsSchema>;

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

/** Both ids are props the dialog is opened with, not fields anyone types. */
export const mappingFormSchema = mapRoomTypeSchema.omit({
  propertyId: true,
  connectionId: true,
});

export type MappingFormInput = z.infer<typeof mappingFormSchema>;

export const unmapRoomTypeSchema = z.object({
  propertyId: z.number(),
  id: z.number(),
});

export type UnmapRoomTypeInput = z.infer<typeof unmapRoomTypeSchema>;
