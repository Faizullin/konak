import assert from "node:assert/strict";
import { test } from "node:test";

import { OrgRole } from "@/features/organizations";
import {
  MAX_BLOCK_NIGHTS,
  RoomSaleState,
  roomSaleState,
  PropertyError,
  refuseBlock,
  canArchiveRoomTypes,
  canManageRoomTypes,
  canManageRooms,
  canReadInventory,
  compareRoomNumbers,
  formatDayMinutes,
  isRoomSellable,
  listRoomsSchema,
  propertySlugSchema,
  inventoryCodeSchema,
  refuseOccupancy,
  ROOM_STATUS_VALUES,
  RoomStatus,
  statusAfterCheckOut,
} from "./index";

/**
 * The room axis, before there is a grid to draw it on. Ordering and sellability
 * decide what a receptionist sees and what may be assigned, and neither needs a
 * database to be wrong.
 */

test("room numbers order the way a corridor runs, not lexically", () => {
  const numbers = ["10", "2", "101", "1", "20"];
  assert.deepEqual(numbers.toSorted(compareRoomNumbers), ["1", "2", "10", "20", "101"]);
});

test("a suffix sorts after the bare number, and a prefix groups", () => {
  assert.ok(compareRoomNumbers("101", "101A") < 0);
  assert.deepEqual(["B2", "A10", "A2"].toSorted(compareRoomNumbers), ["A2", "A10", "B2"]);
  assert.equal(compareRoomNumbers("101", "101"), 0);
});

test("only OUT_OF_ORDER cannot hold a guest", () => {
  // A dirty room is sold and cleaned before arrival — that separation is the
  // reason housekeeping state is not availability.
  for (const status of ROOM_STATUS_VALUES) {
    assert.equal(isRoomSellable(status), status !== RoomStatus.OUT_OF_ORDER, status);
  }
});

test("an unrecognised status fails closed", () => {
  // The column is a string, so a value from an older release or a bad import
  // must not read as sellable.
  assert.equal(isRoomSellable("RENOVATING"), false);
  assert.equal(isRoomSellable(""), false);
});

test("check-in minutes read back as a clock time", () => {
  assert.equal(formatDayMinutes(840), "14:00");
  assert.equal(formatDayMinutes(660), "11:00");
  assert.equal(formatDayMinutes(0), "00:00");
  // Past midnight, as a late-night check-in is stored.
  assert.equal(formatDayMinutes(1500), "01:00");
});

test("a property slug is URL-safe or it is refused", () => {
  assert.equal(propertySlugSchema.safeParse("riverside-2").success, true);
  assert.equal(propertySlugSchema.safeParse("Riverside").success, false);
  assert.equal(propertySlugSchema.safeParse("river side").success, false);
  assert.equal(propertySlugSchema.safeParse("r").success, false);
});

test("listing rooms is unfiltered by default", () => {
  const parsed = listRoomsSchema.parse({ propertyId: 1 });
  assert.equal(parsed.roomTypeId, undefined);
  assert.equal(parsed.status, undefined);
  assert.equal(parsed.includeArchived, undefined);
  assert.equal(listRoomsSchema.safeParse({ propertyId: 1, status: "SPOTLESS" }).success, false);
});

const occupancy = { baseOccupancy: 2, maxOccupancy: 4, maxAdults: 3, maxChildren: 2 };

test("an occupancy a room type cannot honour is refused with the pair that clashes", () => {
  assert.equal(refuseOccupancy(occupancy), null);

  assert.equal(
    refuseOccupancy({ ...occupancy, baseOccupancy: 5 })?.code,
    "room_type.base_over_max"
  );
  assert.equal(refuseOccupancy({ ...occupancy, maxAdults: 5 })?.code, "room_type.adults_over_max");
  assert.equal(
    refuseOccupancy({ ...occupancy, maxChildren: 5 })?.code,
    "room_type.children_over_max"
  );
  assert.equal(refuseOccupancy({ ...occupancy, maxAdults: 0 })?.code, "room_type.needs_one_adult");
});

test("base may equal max, and children may fill the room", () => {
  // Neither is a mistake: a double sold as a double, and a family room whose
  // maximum is reached by children.
  assert.equal(refuseOccupancy({ ...occupancy, baseOccupancy: 4 }), null);
  assert.equal(refuseOccupancy({ ...occupancy, maxChildren: 4 }), null);
});

test("an inventory code survives the systems it travels through", () => {
  assert.equal(inventoryCodeSchema.safeParse("DBL").success, true);
  assert.equal(inventoryCodeSchema.safeParse("FAM-2").success, true);
  // A space or lower case would not survive a channel mapping.
  assert.equal(inventoryCodeSchema.safeParse("DBL ROOM").success, false);
  assert.equal(inventoryCodeSchema.safeParse("dbl").success, false);
  assert.equal(inventoryCodeSchema.safeParse("D").success, false);
});

test("a receptionist reads the inventory and does not set it up", () => {
  assert.equal(canReadInventory(OrgRole.MEMBER), true);
  assert.equal(canManageRooms(OrgRole.MEMBER), false);
  assert.equal(canManageRoomTypes(OrgRole.MEMBER), false);
  assert.equal(canArchiveRoomTypes(OrgRole.MEMBER), false);

  for (const role of [OrgRole.OWNER, OrgRole.ADMIN]) {
    assert.equal(canManageRooms(role), true, role);
    assert.equal(canManageRoomTypes(role), true, role);
    assert.equal(canArchiveRoomTypes(role), true, role);
  }
});

test("a role nobody granted reads as no", () => {
  assert.equal(canReadInventory("GUEST"), false);
  assert.equal(canManageRooms(""), false);
});

test("check-out is what makes a room dirty, and out of order survives it", () => {
  // The event that creates the work. A receptionist who also has to remember
  // is how a housekeeping board goes stale — `product-shape.md` § 10.
  assert.equal(statusAfterCheckOut(RoomStatus.CLEAN), RoomStatus.DIRTY);
  assert.equal(statusAfterCheckOut(RoomStatus.INSPECTED), RoomStatus.DIRTY);
  assert.equal(statusAfterCheckOut(RoomStatus.IN_PROGRESS), RoomStatus.DIRTY);

  // Already dirty is not a change, and writing it again is not news.
  assert.equal(statusAfterCheckOut(RoomStatus.DIRTY), null);

  // The one state with a commercial consequence, set by someone who found a
  // fault. A departure is not news about the fault.
  assert.equal(statusAfterCheckOut(RoomStatus.OUT_OF_ORDER), null);
});

test("a block cannot hold back more rooms than exist, and may hold back all of them", () => {
  // The normal case: a floor of four closed out of ten.
  assert.equal(refuseBlock({ blockedRooms: 4, totalRooms: 10, nights: 30 }), null);

  // Closing a type entirely is a real thing — a refit — and refusing it would
  // leave no honest way to say so.
  assert.equal(refuseBlock({ blockedRooms: 10, totalRooms: 10, nights: 30 }), null);

  // One more than exists is arithmetic nobody meant.
  assert.equal(
    refuseBlock({ blockedRooms: 11, totalRooms: 10, nights: 1 })?.code,
    PropertyError.BLOCK_OVER_TOTAL
  );

  // Zero is how a floor reopens, and is legal against any total.
  assert.equal(refuseBlock({ blockedRooms: 0, totalRooms: 0, nights: 1 }), null);
});

test("a block covers between one night and two years", () => {
  assert.equal(refuseBlock({ blockedRooms: 1, totalRooms: 2, nights: 1 }), null);
  assert.equal(refuseBlock({ blockedRooms: 1, totalRooms: 2, nights: MAX_BLOCK_NIGHTS }), null);

  // Nought nights is a range somebody got backwards.
  assert.equal(
    refuseBlock({ blockedRooms: 1, totalRooms: 2, nights: 0 })?.code,
    PropertyError.BLOCK_RANGE_INVALID
  );

  // The cap is not politeness: one request past it is tens of thousands of
  // upserts and a channel push, from a typo in a year.
  assert.equal(
    refuseBlock({ blockedRooms: 1, totalRooms: 2, nights: MAX_BLOCK_NIGHTS + 1 })?.code,
    PropertyError.BLOCK_RANGE_INVALID
  );
});

test("a room is occupied, booked or free — and a guest in it outranks a guest expected", () => {
  assert.equal(roomSaleState([]), RoomSaleState.FREE);
  assert.equal(roomSaleState([{ status: "CONFIRMED" }]), RoomSaleState.BOOKED);
  assert.equal(roomSaleState([{ status: "CHECKED_IN" }]), RoomSaleState.OCCUPIED);

  // A turnover day: this morning's guest has gone, tonight's is expected. The
  // room is booked for tonight, and the stay that ended does not decide it.
  assert.equal(
    roomSaleState([{ status: "CHECKED_OUT" }, { status: "CONFIRMED" }]),
    RoomSaleState.BOOKED
  );

  // Departed and nobody following: the room is for sale again.
  assert.equal(roomSaleState([{ status: "CHECKED_OUT" }]), RoomSaleState.FREE);

  // An enquiry is a question, not a claim — it holds no inventory anywhere
  // else either, and a room it names is still sellable.
  assert.equal(roomSaleState([{ status: "ENQUIRY" }]), RoomSaleState.FREE);

  // Someone in the room outranks anything else on the same night.
  assert.equal(
    roomSaleState([{ status: "CONFIRMED" }, { status: "CHECKED_IN" }]),
    RoomSaleState.OCCUPIED
  );
});
