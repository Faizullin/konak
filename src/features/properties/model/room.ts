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
