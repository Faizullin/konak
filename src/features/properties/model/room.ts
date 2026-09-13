import { z } from "zod";
import type { Refused } from "@/lib/refusal";
import { PropertyError } from "./errors";

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
 * What check-out leaves behind.
 *
 * A departure is the event that creates the cleaning, and expecting a
 * receptionist to also remember is how a housekeeping board goes stale —
 * `product-shape.md` § 10. Returns the new status, or `null` when there is
 * nothing to change.
 *
 * **Out of order is not overwritten.** It is the one housekeeping state with a
 * commercial consequence, set by someone who found a fault, and a departure is
 * not news about the fault. Anything else becomes dirty, including `DIRTY`
 * itself — which answers `null`, because writing it again is not a change.
 */
export function statusAfterCheckOut(current: string): RoomStatus | null {
  if (current === RoomStatus.OUT_OF_ORDER) return null;
  if (current === RoomStatus.DIRTY) return null;
  return RoomStatus.DIRTY;
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
}): Refused {
  if (type.maxAdults < 1) {
    return {
      code: PropertyError.ROOM_TYPE_NEEDS_ONE_ADULT,
      message: "A room type sleeps at least one adult",
    };
  }
  if (type.baseOccupancy > type.maxOccupancy) {
    return {
      code: PropertyError.ROOM_TYPE_BASE_OVER_MAX,
      message: "The base occupancy is above the maximum",
    };
  }
  if (type.maxAdults > type.maxOccupancy) {
    return {
      code: PropertyError.ROOM_TYPE_ADULTS_OVER_MAX,
      message: "More adults than the type sleeps",
    };
  }
  if (type.maxChildren > type.maxOccupancy) {
    return {
      code: PropertyError.ROOM_TYPE_CHILDREN_OVER_MAX,
      message: "More children than the type sleeps",
    };
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
  .min(2, "code_too_short")
  .max(16, "code_too_long")
  .regex(/^[A-Z0-9-]+$/, "code_format");

const occupancyField = z.number().int().min(0).max(20);

export const createRoomTypeSchema = z.object({
  propertyId: z.number(),
  name: z.string().min(1, "name_required").max(120),
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
  number: z.string().min(1, "room_number_required").max(24),
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

/**
 * The longest run of nights one act may block.
 *
 * Two years, which is further ahead than a hotel plans a refit and far short of
 * the range a typo produces. The cap is not politeness: without one a single
 * request becomes seven hundred upserts and a channel push, and `from: 2020,
 * to: 2120` becomes thirty-six thousand — the same argument `GRID_MAX_NIGHTS`
 * makes about the window.
 */
export const MAX_BLOCK_NIGHTS = 730;

export const setRoomBlockSchema = z.object({
  propertyId: z.number(),
  roomTypeId: z.number(),
  from: z.coerce.date(),
  to: z.coerce.date(),
  /** Zero clears the block, which is how a floor reopens. */
  blockedRooms: z.number().int().min(0).max(9999),
  reason: z.string().max(200).optional(),
});

export type SetRoomBlockInput = z.infer<typeof setRoomBlockSchema>;

/**
 * Why a block cannot be taken, or `null`.
 *
 * Pure, so the screen can grey the button out with the same sentence the server
 * would refuse with — and so the arithmetic is testable without a database.
 *
 * **Blocking every room is legal**; blocking more than exist is not. A type
 * closed entirely is a real thing — a floor out for a refit — and refusing it
 * would make the honest way of saying so impossible.
 */
export function refuseBlock(args: {
  blockedRooms: number;
  totalRooms: number;
  nights: number;
}): { code: string; message: string } | null {
  if (args.nights < 1 || args.nights > MAX_BLOCK_NIGHTS) {
    return {
      code: PropertyError.BLOCK_RANGE_INVALID,
      message: `A block covers between one and ${MAX_BLOCK_NIGHTS} nights`,
    };
  }

  if (args.blockedRooms > args.totalRooms) {
    return {
      code: PropertyError.BLOCK_OVER_TOTAL,
      message: `Only ${args.totalRooms} room(s) of that type exist`,
    };
  }

  return null;
}

/**
 * Whether a room is for sale tonight — the client's fourth MVP item,
 * «свободен, забронирован, занят».
 *
 * **Commercial state, not housekeeping state**, and the two are genuinely
 * different questions about the same room. `RoomStatus` answers *is it clean*;
 * this answers *can I sell it tonight*. A room can be clean and sold, or dirty
 * and free, and a screen that shows only one of them answers the wrong half.
 *
 * Derived from the stay that covers the night, never stored — the same rule
 * everything else here follows: a column would need updating every time a
 * booking moved, and would be wrong between the move and the update.
 */
export const RoomSaleState = {
  FREE: "FREE",
  BOOKED: "BOOKED",
  OCCUPIED: "OCCUPIED",
} as const;

export type RoomSaleState = (typeof RoomSaleState)[keyof typeof RoomSaleState];

export const ROOM_SALE_STATE_VALUES = Object.values(RoomSaleState);

/**
 * `stays` is every stay on this room that covers the night, which is normally
 * nought or one — and exactly two on a turnover day, where somebody leaves in
 * the morning and somebody else arrives in the afternoon.
 *
 * A guest in the room outranks a guest expected: on a turnover the room is
 * **booked** for tonight even though this morning's guest has not gone far, and
 * the arriving booking is the one that decides. So a departing `CHECKED_OUT`
 * stay never makes a room occupied — it has ended, and the night belongs to
 * whoever comes next or to nobody.
 */
export function roomSaleState(stays: readonly { status: string }[]): RoomSaleState {
  if (stays.some((stay) => stay.status === "CHECKED_IN")) return RoomSaleState.OCCUPIED;
  if (stays.some((stay) => stay.status === "CONFIRMED")) return RoomSaleState.BOOKED;

  // ENQUIRY holds nothing — it is a question, and the room is still sellable.
  // CHECKED_OUT is a stay that is over.
  return RoomSaleState.FREE;
}
