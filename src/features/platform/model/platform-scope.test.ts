import assert from "node:assert/strict";
import { test } from "node:test";

import {
  conflictingScopes,
  isUnguessableStorageKey,
  newStorageKey,
  safeFileName,
  sameScope,
} from "./index";

test("rows that name two properties are refused", () => {
  // A RoomStay names a reservation, a room type, a room and a rate plan. The
  // database cannot stop them disagreeing; this can.
  assert.equal(sameScope(1, 1, 1), true);
  assert.equal(sameScope(1, 2), false);
  assert.deepEqual(conflictingScopes(1, 2, 1), [1, 2]);
});

test("an unset reference is not a conflict", () => {
  // `roomId` is null until check-in; that must not read as a clash.
  assert.equal(sameScope(1, null, undefined), true);
  assert.equal(sameScope(null, undefined), true);
  assert.equal(sameScope(), true);
});

test("a storage key is random, never derived from ids", () => {
  const key = newStorageKey("org/1/attachments", "Passport Scan.PDF");
  assert.equal(isUnguessableStorageKey(key), true);
  assert.ok(key.endsWith("/passport-scan.pdf"));

  // The failure this exists to prevent: a path built out of integers.
  assert.equal(isUnguessableStorageKey("org/1/attachments/7/passport.pdf"), false);
});

test("two keys for the same file never collide", () => {
  const a = newStorageKey("s", "a.pdf");
  const b = newStorageKey("s", "a.pdf");
  assert.notEqual(a, b);
});

test("file names cannot escape a path or a header", () => {
  assert.equal(safeFileName("../../etc/passwd"), "etc-passwd");
  assert.equal(safeFileName('re"port .pdf'), "re-port-.pdf");
  assert.equal(safeFileName("   "), "file");
});
