import assert from "node:assert/strict";
import { test } from "node:test";
import { formatMoney } from "./money";

/**
 * Asserted on the digits rather than on the whole string: symbol placement and
 * the space before it move between ICU versions, and the exponent is the part
 * that would be a wrong price.
 */

test("two minor digits is the common case", () => {
  assert.match(formatMoney(123_456, "USD", "en"), /1,234\.56/);
});

test("a currency with no minor unit is not divided", () => {
  const yen = formatMoney(123_456, "JPY", "en");
  assert.match(yen, /123,456/);
  assert.doesNotMatch(yen, /\./);
});

test("three minor digits are three, not two", () => {
  assert.match(formatMoney(1_234_567, "KWD", "en"), /1,234\.567/);
});

test("zero is a value", () => {
  assert.match(formatMoney(0, "USD", "en"), /0\.00/);
});

test("a refund keeps its sign", () => {
  assert.match(formatMoney(-5_000, "USD", "en"), /-|\(/);
});

test("a code Intl refuses falls back to what is stored", () => {
  assert.equal(formatMoney(4_200, "not-a-code", "en"), "4200 not-a-code");
});
