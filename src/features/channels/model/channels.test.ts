import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_OVERBOOKING,
  nightsToClose,
  nightsToPush,
  OverbookingPolicy,
  sellableForChannel,
  type NightState,
  type PushedState,
} from "./index";

/**
 * The two rules distribution turns on, without a channel: what to send, and how
 * much to say is free.
 */

const day = (n: number) => new Date(Date.UTC(2027, 5, n));

const night = (over: Partial<NightState> = {}): NightState => ({
  roomTypeId: 1,
  date: day(1),
  availability: 3,
  priceMinor: 12_000,
  restrictions: null,
  ...over,
});

const told = (over: Partial<PushedState> = {}): PushedState => ({
  ...night(),
  lastError: null,
  ...over,
});

test("a night the channel was never told is always sent", () => {
  assert.equal(nightsToPush([night()], []).length, 1);
});

test("a night that has not changed is not sent again", () => {
  // The whole point: sending everything every time is how rate limits are hit
  // and how a busy afternoon falls behind.
  assert.deepEqual(nightsToPush([night()], [told()]), []);
});

test("any of the three fields changing is a reason to send", () => {
  assert.equal(nightsToPush([night({ availability: 2 })], [told()]).length, 1);
  assert.equal(nightsToPush([night({ priceMinor: 13_000 })], [told()]).length, 1);
  assert.equal(nightsToPush([night({ restrictions: "MINLOS=2" })], [told()]).length, 1);

  // A price that went to nothing is a change, not an absence.
  assert.equal(nightsToPush([night({ priceMinor: null })], [told()]).length, 1);
});

test("a night whose last push failed is sent again, identical or not", () => {
  // The mirror records what the channel *accepted*. A row carrying an error is
  // a night the channel does not have even though the numbers match, and
  // skipping it would leave the disagreement for ever.
  assert.equal(nightsToPush([night()], [told({ lastError: "rate limited" })]).length, 1);
});

test("only the nights that moved are sent", () => {
  const current = [night(), night({ date: day(2), availability: 1 }), night({ date: day(3) })];
  const pushed = [told(), told({ date: day(2), availability: 3 }), told({ date: day(3) })];

  assert.deepEqual(
    nightsToPush(current, pushed).map((n) => n.date.getUTCDate()),
    [2]
  );
});

test("a night we no longer sell is closed rather than left open", () => {
  // A room type withdrawn, or a window that moved past. Left alone the channel
  // is still selling something the hotel stopped offering.
  const stale = told({ date: day(9), availability: 2 });
  assert.deepEqual(nightsToClose([night()], [told(), stale]), [stale]);

  // Nothing to close if the channel already has none.
  assert.deepEqual(nightsToClose([night()], [told({ date: day(9), availability: 0 })]), []);
});

test("by default a channel is told exactly what is free", () => {
  assert.equal(sellableForChannel(3), 3);
  assert.equal(sellableForChannel(3, DEFAULT_OVERBOOKING), 3);

  // Never below zero: a negative is not a quantity, and a channel either
  // rejects it or does something worse with it.
  assert.equal(sellableForChannel(-2), 0);
});

test("a fixed policy sells beyond the count, but never reopens a sold-out night", () => {
  const policy = { policy: OverbookingPolicy.FIXED, extraRooms: 2 };

  assert.equal(sellableForChannel(3, policy), 5);

  // Overbooking adds to what is free, not to what is gone. A policy that
  // reopened a closed night would be the hotel walking a guest by arithmetic
  // rather than by decision.
  assert.equal(sellableForChannel(0, policy), 0);

  // A nonsensical setting is not a way to close rooms.
  assert.equal(sellableForChannel(3, { policy: OverbookingPolicy.FIXED, extraRooms: -5 }), 3);
});
