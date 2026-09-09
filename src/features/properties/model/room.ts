import { z } from "zod";

/**
 * Rooms and room types — the physical side of the inventory decision.
 *
 * A guest books a *room type*; a `Room` is assigned at or before check-in. That
 * is why nothing here prices or sells: a room is the vertical axis of the grid
 * and the thing housekeeping cleans.
 */

/**
 * Housekeeping state. The column is a string, so these values are the
 * definition both sides validate against — the same arrangement as
 * `ReservationStatus`.
 */
export const RoomStatus = {
  CLEAN: "CLEAN",
  DIRTY: "DIRTY",
  IN_PROGRESS: "IN_PROGRESS",
  INSPECTED: "INSPECTED",
  OUT_OF_ORDER: "OUT_OF_ORDER",
} as const;

export type RoomStatus = (typeof RoomStatus)[keyof typeof RoomStatus];

export const ROOM_STATUS_VALUES = Object.values(RoomStatus);

export const roomStatusSchema = z.enum(ROOM_STATUS_VALUES);

export const ROOM_STATUS_LABELS: Record<RoomStatus, string> = {
  CLEAN: "Clean",
  DIRTY: "Dirty",
  IN_PROGRESS: "Being cleaned",
  INSPECTED: "Inspected",
  OUT_OF_ORDER: "Out of order",
};

/**
 * Whether a room can hold a guest at all. Only `OUT_OF_ORDER` says no — a dirty
 * room is sold and cleaned before the guest arrives, which is the whole point
 * of separating housekeeping state from availability.
 *
 * An unrecognised status answers `false` rather than throwing: the column is a
 * string, and failing closed is the safe direction for "may we sell this".
 */
export function isRoomSellable(status: string): boolean {
  return status !== RoomStatus.OUT_OF_ORDER && ROOM_STATUS_VALUES.includes(status as RoomStatus);
}

/**
 * Order two room numbers the way a corridor runs.
 *
 * Room numbers are strings — "2", "10", "101A", "Cottage 3" — and Postgres
 * sorts them lexically, which puts 10 before 2. The grid's vertical axis is
 * read by someone who knows the building, so digits compare as numbers and
 * everything else compares as text.
 */
export function compareRoomNumbers(a: string, b: string): number {
  const chunks = (value: string) => value.match(/\d+|\D+/g) ?? [];
  const left = chunks(a);
  const right = chunks(b);

  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const x = left[i]!;
    const y = right[i]!;
    const bothNumeric = /^\d/.test(x) && /^\d/.test(y);

    const result = bothNumeric
      ? Number(x) - Number(y)
      : x.localeCompare(y, undefined, { sensitivity: "base" });
    if (result !== 0) return result;
  }

  return left.length - right.length;
}

export const listRoomsSchema = z.object({
  propertyId: z.number(),
  roomTypeId: z.number().optional(),
  status: roomStatusSchema.optional(),
  includeArchived: z.boolean().optional(),
});

export type ListRoomsInput = z.infer<typeof listRoomsSchema>;

export const listRoomTypesSchema = z.object({
  propertyId: z.number(),
  includeArchived: z.boolean().optional(),
});

export type ListRoomTypesInput = z.infer<typeof listRoomTypesSchema>;

/**
 * Whether the four occupancy numbers can all be true at once, or the sentence
 * saying which pair cannot.
 *
 * A room type sells `baseOccupancy` at the plan's nightly rate and prices
 * anyone beyond it as an extra person, so a base above the maximum would quote
 * a room it cannot sleep. The rest is arithmetic a form should not let someone
 * past — and it is the same sentence on the field and at the router.
 */
export function refuseOccupancy(type: {
  baseOccupancy: number;
  maxOccupancy: number;
  maxAdults: number;
  maxChildren: number;
}): string | null {
  if (type.maxAdults < 1) {
    return "A room type sleeps at least one adult";
  }
  if (type.baseOccupancy > type.maxOccupancy) {
    return "The base occupancy cannot be more than the maximum";
  }
  if (type.maxAdults > type.maxOccupancy) {
    return "More adults than the room type sleeps in total";
  }
  if (type.maxChildren > type.maxOccupancy) {
    return "More children than the room type sleeps in total";
  }
  return null;
}

/**
 * A code a channel manager maps to an OTA's own id, so it outlives renaming
 * the type. Upper case and punctuation-free for the same reason: it travels
 * through systems that will not preserve a space.
 */
export const inventoryCodeSchema = z
  .string()
  .min(2, "At least two characters")
  .max(16, "At most sixteen characters")
  .regex(/^[A-Z0-9-]+$/, "Capitals, digits and hyphens only");

const occupancyField = z.number().int().min(0).max(20);

export const createRoomTypeSchema = z.object({
  propertyId: z.number(),
  name: z.string().min(1, "A name is required").max(120),
  code: inventoryCodeSchema,
  description: z.string().max(2000).optional(),
  baseOccupancy: occupancyField,
  maxOccupancy: occupancyField,
  maxAdults: occupancyField,
  maxChildren: occupancyField,
  sizeSqm: z.number().int().min(0).max(10_000).optional(),
  position: z.number().int().min(0).max(999),
});

export type CreateRoomTypeInput = z.infer<typeof createRoomTypeSchema>;

/** The dialog's half: the property comes from the route, not a field. */
export const roomTypeFormSchema = createRoomTypeSchema.omit({ propertyId: true });

export type RoomTypeFormInput = z.infer<typeof roomTypeFormSchema>;

export const updateRoomTypeSchema = roomTypeFormSchema.extend({
  propertyId: z.number(),
  id: z.number(),
});

export type UpdateRoomTypeInput = z.infer<typeof updateRoomTypeSchema>;

export const createRoomSchema = z.object({
  propertyId: z.number(),
  roomTypeId: z.number(),
  number: z.string().min(1, "A room number is required").max(24),
  floor: z.string().max(24).optional(),
  status: roomStatusSchema,
  notes: z.string().max(2000).optional(),
});

export type CreateRoomInput = z.infer<typeof createRoomSchema>;

export const roomFormSchema = createRoomSchema.omit({ propertyId: true });

export type RoomFormInput = z.infer<typeof roomFormSchema>;

export const updateRoomSchema = roomFormSchema.extend({
  propertyId: z.number(),
  id: z.number(),
});

export type UpdateRoomInput = z.infer<typeof updateRoomSchema>;

/** Archiving is reversible, so it is a value rather than a separate procedure. */
export const archiveInventorySchema = z.object({
  propertyId: z.number(),
  id: z.number(),
  archived: z.boolean(),
});

export type ArchiveInventoryInput = z.infer<typeof archiveInventorySchema>;
