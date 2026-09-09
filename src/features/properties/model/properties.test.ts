import assert from "node:assert/strict";
import { test } from "node:test";

import {
  compareRoomNumbers,
  formatDayMinutes,
  isRoomSellable,
  listRoomsSchema,
  propertySlugSchema,
  ROOM_STATUS_VALUES,
  RoomStatus,
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
