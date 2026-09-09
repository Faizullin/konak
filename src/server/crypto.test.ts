import "dotenv/config";
import assert from "node:assert/strict";
import { test } from "node:test";
import { decryptField, encryptField, isEncryptedField, lastFour, secretsMatch } from "./crypto";

/**
 * Field encryption. Everything here runs against the real key from `.env`,
 * because a crypto helper mocked into agreement proves nothing.
 */

test("what goes in comes back out", () => {
  const number = "AB1234567";
  assert.equal(decryptField(encryptField(number)), number);
});

test("the same value encrypts differently every time", () => {
  const a = encryptField("AB1234567");
  const b = encryptField("AB1234567");

  // Not deterministic, so a ciphertext cannot be used to find equal values —
  // which is also why searching is `numberLast4`'s job, not this column's.
  assert.notEqual(a, b);
  assert.equal(decryptField(a), decryptField(b));
});

test("non-ASCII survives the round trip", () => {
  // Passport names and numbers are not all Latin-1.
  const value = "Ыбрай-42 · 张伟";
  assert.equal(decryptField(encryptField(value)), value);
});

test("an empty string is a value, not an absence", () => {
  assert.equal(decryptField(encryptField("")), "");
});

test("a tampered ciphertext refuses to decrypt", () => {
  const envelope = encryptField("AB1234567");
  const parts = envelope.split(".");

  // Flip a character in the ciphertext. GCM's tag is what catches it; without
  // the tag this would decrypt to a different number and nobody would know.
  const body = parts[3]!;
  const flipped = (body[0] === "A" ? "B" : "A") + body.slice(1);
  const tampered = [parts[0], parts[1], parts[2], flipped].join(".");

  assert.throws(() => decryptField(tampered));
});

test("a tampered tag refuses too", () => {
  const parts = encryptField("AB1234567").split(".");
  const tag = parts[2]!;
  const flipped = (tag[0] === "A" ? "B" : "A") + tag.slice(1);

  assert.throws(() => decryptField([parts[0], parts[1], flipped, parts[3]].join(".")));
});

test("anything that is not an envelope is refused, not guessed at", () => {
  for (const value of ["", "AB1234567", "v1.", "v1.a.b", "v2.a.b.c", "not.an.envelope.at.all"]) {
    let refused = false;
    try {
      decryptField(value);
    } catch {
      refused = true;
    }
    assert.equal(refused, true, `should refuse: ${value}`);
  }
});

test("plaintext is recognisable as plaintext", () => {
  // The guard the column's name depends on: a writer that stored a number in
  // clear produces something this answers `false` to.
  assert.equal(isEncryptedField("AB1234567"), false);
  assert.equal(isEncryptedField(""), false);
  assert.equal(isEncryptedField("v1.short.tag.body"), false);
  assert.equal(isEncryptedField(encryptField("AB1234567")), true);
});

test("last four is the tail, and short values are not padded", () => {
  assert.equal(lastFour("AB1234567"), "4567");
  assert.equal(lastFour("123"), "123");
  assert.equal(lastFour(""), "");
});

test("secrets compare by value, and a length difference is not an error", () => {
  assert.equal(secretsMatch("abc", "abc"), true);
  assert.equal(secretsMatch("abc", "abd"), false);
  // `timingSafeEqual` throws on unequal lengths; this must answer false.
  assert.equal(secretsMatch("abc", "abcd"), false);
  assert.equal(secretsMatch("", ""), true);
});
