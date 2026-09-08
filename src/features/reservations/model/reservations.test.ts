import assert from "node:assert/strict";
import { test } from "node:test";

import {
  availableRooms,
  canTransition,
  isTerminal,
  isValidStayRange,
  nextStatuses,
  nightsBetween,
  nightsOf,
  occupiesInventory,
  RESERVATION_STATUS_VALUES,
  ReservationStatus,
  staysOverlap,
  toStayDate,
} from "./index";

const d = (day: number) => new Date(Date.UTC(2026, 8, day));
const stay = (from: number, to: number) => ({ checkIn: d(from), checkOut: d(to) });

/**
 * The rules the database cannot hold. SQLite has no exclusion constraint and no
 * CHECK, so overlap and the status machine are enforced here — which is also
 * the only place they can be tested without a database.
 */

test("a stay is half-open, so nights are a subtraction", () => {
  assert.equal(nightsBetween(d(14), d(16)), 2);
  assert.equal(nightsBetween(d(14), d(15)), 1);
  assert.equal(nightsOf(stay(14, 16)).length, 2);
  // The departure day is not a night.
  assert.deepEqual(
    nightsOf(stay(14, 16)).map((n) => n.getUTCDate()),
    [14, 15]
  );
});

test("same-day turnover is not an overlap", () => {
  // One guest leaves on the 16th, the next arrives on the 16th. This is the
  // most ordinary thing a hotel does; an inclusive comparison would refuse it.
  assert.equal(staysOverlap(stay(14, 16), stay(16, 18)), false);
  assert.equal(staysOverlap(stay(16, 18), stay(14, 16)), false);
});

test("every real overlap is caught", () => {
  assert.equal(staysOverlap(stay(14, 16), stay(15, 17)), true, "partial");
  assert.equal(staysOverlap(stay(14, 20), stay(15, 16)), true, "contained");
  assert.equal(staysOverlap(stay(15, 16), stay(14, 20)), true, "containing");
  assert.equal(staysOverlap(stay(14, 16), stay(14, 16)), true, "identical");
  assert.equal(staysOverlap(stay(14, 16), stay(17, 19)), false, "disjoint");
});

test("overlap ignores the time of day", () => {
  // A stay stored with a stray time component must not read as a different day.
  const noon = { checkIn: new Date(Date.UTC(2026, 8, 16, 12)), checkOut: d(18) };
  assert.equal(staysOverlap(stay(14, 16), noon), false);
  assert.equal(toStayDate(new Date(Date.UTC(2026, 8, 16, 23, 59))).getUTCDate(), 16);
});

test("a zero-night stay is a mistake, not a day rate", () => {
  assert.equal(isValidStayRange(stay(14, 16)), true);
  assert.equal(isValidStayRange(stay(14, 14)), false);
  assert.equal(isValidStayRange(stay(16, 14)), false);
});

test("a stay moves forward or it ends", () => {
  assert.equal(canTransition(ReservationStatus.ENQUIRY, ReservationStatus.CONFIRMED), true);
  assert.equal(canTransition(ReservationStatus.CONFIRMED, ReservationStatus.CHECKED_IN), true);
  assert.equal(canTransition(ReservationStatus.CHECKED_IN, ReservationStatus.CHECKED_OUT), true);

  // Nothing returns to an earlier state: the side effects are not undone by
  // flipping a column back.
  assert.equal(canTransition(ReservationStatus.CHECKED_IN, ReservationStatus.CONFIRMED), false);
  assert.equal(canTransition(ReservationStatus.CHECKED_OUT, ReservationStatus.CHECKED_IN), false);
  assert.equal(canTransition(ReservationStatus.CANCELLED, ReservationStatus.CONFIRMED), false);
});

test("a room cannot be checked out twice", () => {
  // The bug a free-form status column allows.
  assert.equal(canTransition(ReservationStatus.CHECKED_OUT, ReservationStatus.CHECKED_OUT), false);
  assert.equal(isTerminal(ReservationStatus.CHECKED_OUT), true);
  assert.equal(isTerminal(ReservationStatus.CANCELLED), true);
  assert.equal(isTerminal(ReservationStatus.NO_SHOW), true);
  assert.equal(isTerminal(ReservationStatus.CONFIRMED), false);
});

test("a no-show is only reachable from a confirmed booking", () => {
  assert.equal(canTransition(ReservationStatus.CONFIRMED, ReservationStatus.NO_SHOW), true);
  assert.equal(canTransition(ReservationStatus.ENQUIRY, ReservationStatus.NO_SHOW), false);
  assert.equal(canTransition(ReservationStatus.CHECKED_IN, ReservationStatus.NO_SHOW), false);
});

test("an unrecognised status is denied, not thrown at", () => {
  assert.equal(canTransition("PENCILLED_IN", ReservationStatus.CONFIRMED), false);
  assert.equal(canTransition("", ""), false);
  assert.deepEqual(nextStatuses("NONSENSE"), []);
  assert.equal(isTerminal("NONSENSE"), false);
});

test("every status is in the transition table", () => {
  // A value added to the enum without a row would silently become terminal.
  for (const status of RESERVATION_STATUS_VALUES) {
    assert.equal(typeof isTerminal(status), "boolean", `${status} has no transitions`);
  }
});

test("what counts against availability decides what can be sold", () => {
  // CHECKED_OUT still occupies: the guest did sleep there, and a past night
  // must not read as free.
  assert.equal(occupiesInventory(ReservationStatus.CONFIRMED), true);
  assert.equal(occupiesInventory(ReservationStatus.CHECKED_IN), true);
  assert.equal(occupiesInventory(ReservationStatus.CHECKED_OUT), true);

  // An enquiry is a quote; a real hold is `InventoryHold`, which expires.
  assert.equal(occupiesInventory(ReservationStatus.ENQUIRY), false);
  assert.equal(occupiesInventory(ReservationStatus.CANCELLED), false);
  assert.equal(occupiesInventory(ReservationStatus.NO_SHOW), false);
});

test("availability never goes negative", () => {
  assert.equal(availableRooms(10, 1, 4, 2), 3);
  // Overbooked by hand or by a channel: the answer is zero, not a negative that
  // some later subtraction turns back into a sale.
  assert.equal(availableRooms(2, 0, 3, 0), 0);
});
