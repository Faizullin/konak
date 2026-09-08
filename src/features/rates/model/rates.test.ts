import assert from "node:assert/strict";
import { test } from "node:test";

import { extraPersonMinor, sellRefusal, stayTotalMinor } from "./index";

const pricing = { baseOccupancy: 2, extraAdultMinor: 2500, extraChildMinor: 1000 };
const night = (day: number, priceMinor = 12000) => ({
  date: new Date(Date.UTC(2026, 8, day)),
  priceMinor,
});

test("nobody beyond the base occupancy costs nothing extra", () => {
  assert.equal(extraPersonMinor({ adults: 2, children: 0 }, pricing), 0);
  assert.equal(extraPersonMinor({ adults: 1, children: 0 }, pricing), 0);
});

test("adults are charged before children", () => {
  // A room for two, taken by two adults and a child, is one extra — the child.
  assert.equal(extraPersonMinor({ adults: 2, children: 1 }, pricing), 1000);
  // Taken by three adults it is one extra adult, not a child.
  assert.equal(extraPersonMinor({ adults: 3, children: 0 }, pricing), 2500);
  // Counting children first here would undercharge every family.
  assert.equal(extraPersonMinor({ adults: 3, children: 1 }, pricing), 3500);
});

test("a stay totals every night plus that night's extra people", () => {
  const total = stayTotalMinor([night(14), night(15)], { adults: 2, children: 1 }, pricing, 2);
  assert.equal(total, 12000 + 1000 + (12000 + 1000));
});

test("a night with no price is not a free night", () => {
  // A missing calendar row is a room never put on sale. Quoting zero sells it.
  assert.equal(stayTotalMinor([night(14)], { adults: 2, children: 0 }, pricing, 2), null);
  assert.equal(stayTotalMinor([], { adults: 2, children: 0 }, pricing, 0), null);
});

test("an empty restriction calendar sells normally", () => {
  // Absent means unrestricted — the alternative is a hotel that sells nothing
  // until someone fills in every day of the year.
  assert.equal(sellRefusal({ nights: [night(14), night(15)], expectedNights: 2 }), null);
});

test("each restriction refuses for its own reason", () => {
  const nights = [night(14), night(15)];
  const base = { nights, expectedNights: 2 };

  assert.equal(sellRefusal({ ...base, nightRestrictions: [{ closed: true }] }), "CLOSED");
  assert.equal(
    sellRefusal({ ...base, arrivalRestriction: { closedToArrival: true } }),
    "CLOSED_TO_ARRIVAL"
  );
  assert.equal(
    sellRefusal({ ...base, departureRestriction: { closedToDeparture: true } }),
    "CLOSED_TO_DEPARTURE"
  );
  assert.equal(sellRefusal({ ...base, arrivalRestriction: { minLengthOfStay: 3 } }), "MIN_STAY");
  assert.equal(sellRefusal({ ...base, arrivalRestriction: { maxLengthOfStay: 1 } }), "MAX_STAY");
});

test("a stay exactly at the minimum is allowed", () => {
  // Off-by-one here closes a hotel for a night it meant to sell.
  const base = { nights: [night(14), night(15)], expectedNights: 2 };
  assert.equal(sellRefusal({ ...base, arrivalRestriction: { minLengthOfStay: 2 } }), null);
  assert.equal(sellRefusal({ ...base, arrivalRestriction: { maxLengthOfStay: 2 } }), null);
});

test("closed beats every other reason", () => {
  // The order matters for the message a receptionist reads.
  assert.equal(
    sellRefusal({
      nights: [night(14)],
      expectedNights: 1,
      nightRestrictions: [{ closed: true }],
      arrivalRestriction: { minLengthOfStay: 5, closedToArrival: true },
    }),
    "CLOSED"
  );
});
