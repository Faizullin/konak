import assert from "node:assert/strict";
import { test } from "node:test";

import { auditDiff, AUDITED_FIELDS } from "./audit";

test("a diff carries only the fields that entity is allowed to record", () => {
  const before = { role: "MEMBER", name: "Ada", secretToken: "shh" };
  const after = { role: "ADMIN", name: "Ada", secretToken: "different" };

  const diff = JSON.parse(auditDiff("OrganizationMember", before, after)!);

  // `role` is on the list for this entity.
  assert.deepEqual(diff, { role: { from: "MEMBER", to: "ADMIN" } });

  /**
   * `secretToken` changed too, and is nowhere. That is the whole point: a diff
   * built from whatever the row happens to hold would write a passport number
   * in clear into an unencrypted column, in the table nothing is supposed to
   * delete from.
   */
  assert.equal("secretToken" in diff, false);
  assert.equal("name" in diff, false, "unchanged fields are not a change");
});

test("an entity nobody has listed records no diff at all", () => {
  // The safe default: silent until somebody decides what about it is safe to
  // keep. A missing entry must never mean "record everything".
  assert.equal("Reservation" in AUDITED_FIELDS, false);
  assert.equal(auditDiff("Reservation", { guestPassport: "X" }, { guestPassport: "Y" }), null);
});

test("no change is null rather than an empty object", () => {
  // So a row with no diff reads as "this act had no field changes" — a
  // deletion, a view — rather than as somebody having forgotten to pass one.
  assert.equal(auditDiff("OrganizationMember", { role: "ADMIN" }, { role: "ADMIN" }), null);
  assert.equal(auditDiff("Organization", null, null), null);
});

test("a partial row is not read as fields being cleared", () => {
  /**
   * The record `identity.updateRole` actually wrote before this: the caller
   * passed the whole user as `before` and `{ role }` as `after`, and the trail
   * reported that the admin had cleared the user's email address. It had not
   * been touched. A log that invents acts is worse than no log.
   */
  const before = { role: "USER", email: "ada@example.test" };
  const after = { role: "ADMIN" }; // half a row

  assert.deepEqual(JSON.parse(auditDiff("User", before, after)!), {
    role: { from: "USER", to: "ADMIN" },
  });
});

test("a whole missing side still means created or removed", () => {
  // The distinction that makes the rule above safe: no `before` at all is a
  // creation, and every field really is new.
  assert.deepEqual(JSON.parse(auditDiff("OrganizationMember", null, { role: "OWNER" })!), {
    role: { from: null, to: "OWNER" },
  });
  assert.deepEqual(JSON.parse(auditDiff("OrganizationMember", { role: "OWNER" }, null)!), {
    role: { from: "OWNER", to: null },
  });
});

test("a field genuinely set to null is still a change", () => {
  // Present-but-null differs from absent, which is why the check is `in`.
  assert.deepEqual(JSON.parse(auditDiff("Organization", { name: "Acme" }, { name: null })!), {
    name: { from: "Acme", to: null },
  });
});
