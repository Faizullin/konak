import assert from "node:assert/strict";
import { test } from "node:test";

import { OrgRole } from "@/features/organizations";
import {
  blankToNull,
  canArchivePeople,
  canManageCompanies,
  canManagePeople,
  canReadDirectory,
  createPersonSchema,
  directoryCan,
  normalizeEmail,
  parseCustomFields,
  personDisplayName,
  serializeCustomFields,
} from "./index";

/**
 * `model/` is the half both sides agree on: the router validates against these
 * and the forms resolve against them, so a disagreement here is a field the UI
 * offers and the server refuses.
 */

test("email is normalised before it reaches the unique index", () => {
  // `@@unique([organizationId, email])` is case-sensitive. Without this,
  // "Ada@x.com" and "ada@x.com" are two guests with one inbox.
  assert.equal(normalizeEmail("  Ada@Example.COM "), "ada@example.com");
  assert.equal(normalizeEmail(""), null);
  assert.equal(normalizeEmail("   "), null);
  assert.equal(normalizeEmail(undefined), null);
});

test("a blank form field is stored as null, not an empty string", () => {
  // Two representations of "unset" means two code paths everywhere after it.
  assert.equal(blankToNull("  "), null);
  assert.equal(blankToNull(""), null);
  assert.equal(blankToNull(" Acme "), "Acme");
});

test("custom fields survive anything the column can hold", () => {
  // SQLite has no Json type, so this is a String a migration or a hand-edited
  // row can put anything into. A profile page must not 500 over it.
  assert.deepEqual(parseCustomFields('{"loyaltyTier":"gold","visits":3}'), {
    loyaltyTier: "gold",
    visits: 3,
  });
  for (const bad of [null, undefined, "", "not json", "[1,2]", '{"nested":{"a":1}}']) {
    assert.deepEqual(parseCustomFields(bad), {}, `${bad} should read as empty`);
  }
});

test("an empty custom-field set leaves the column null", () => {
  assert.equal(serializeCustomFields({}), null);
  assert.equal(serializeCustomFields(undefined), null);
  assert.equal(serializeCustomFields({ a: "b" }), '{"a":"b"}');
});

test("a display name is one definition, not one per screen", () => {
  assert.equal(personDisplayName({ firstName: "Ada", lastName: "Lovelace" }), "Ada Lovelace");
  assert.equal(personDisplayName({ firstName: " Ada ", lastName: "" }), "Ada");
});

test("the create schema rejects what the form would never produce", () => {
  const ok = createPersonSchema.safeParse({
    organizationId: 1,
    firstName: "Ada",
    lastName: "Lovelace",
  });
  assert.equal(ok.success, true);

  assert.equal(
    createPersonSchema.safeParse({ organizationId: 1, firstName: "", lastName: "L" }).success,
    false
  );
  assert.equal(
    createPersonSchema.safeParse({
      organizationId: 1,
      firstName: "A",
      lastName: "L",
      email: "nope",
    }).success,
    false
  );
});

test("a receptionist keeps the guest book; a manager archives it", () => {
  // MEMBER is the front desk: creating and editing guests is the job. Archiving
  // and the commercial records are not.
  assert.equal(canManagePeople(OrgRole.MEMBER), true);
  assert.equal(canArchivePeople(OrgRole.MEMBER), false);
  assert.equal(canManageCompanies(OrgRole.MEMBER), false);

  for (const role of [OrgRole.OWNER, OrgRole.ADMIN]) {
    assert.equal(canArchivePeople(role), true);
    assert.equal(canManageCompanies(role), true);
  }
});

test("an unrecognised role is denied, not thrown at", () => {
  // Organization role is a plain string column; a hand-edited row cannot escalate.
  assert.equal(canReadDirectory("SUPERUSER"), false);
  assert.equal(canReadDirectory(""), false);
});

test("verbs are AND-ed, so holding one of two is not enough", () => {
  assert.equal(directoryCan(OrgRole.MEMBER, { person: ["create", "archive"] }), false);
  assert.equal(directoryCan(OrgRole.MEMBER, { person: ["create", "update"] }), true);
});
