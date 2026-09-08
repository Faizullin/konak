import assert from "node:assert/strict";
import { test } from "node:test";

import { hasExactlyOneSubject, subjectOf, subjectsOf } from "./index";

/**
 * Activities, tags and attachments carry one nullable foreign key per subject.
 * SQLite has no CHECK constraint, so "exactly one" is enforced here.
 */

test("exactly one subject, or the row is refused", () => {
  assert.equal(hasExactlyOneSubject({ personId: 1 }), true);
  assert.equal(hasExactlyOneSubject({ companyId: 2 }), true);

  // An orphan: attached to nothing, findable from nothing.
  assert.equal(hasExactlyOneSubject({}), false);
  // Ambiguous: which timeline does it belong to?
  assert.equal(hasExactlyOneSubject({ personId: 1, companyId: 2 }), false);
  assert.equal(hasExactlyOneSubject({ personId: 1, companyId: 2, propertyId: 3 }), false);
});

test("null and undefined both mean unset", () => {
  // Prisma returns null; a form returns undefined. They must not disagree.
  assert.equal(hasExactlyOneSubject({ personId: 1, companyId: null }), true);
  assert.equal(hasExactlyOneSubject({ personId: 1, companyId: undefined }), true);
  assert.equal(hasExactlyOneSubject({ personId: null, companyId: null }), false);
});

test("id zero is a set subject, not an absent one", () => {
  // The bug a falsy check would introduce.
  assert.equal(hasExactlyOneSubject({ personId: 0 }), true);
  assert.deepEqual(subjectOf({ personId: 0 }), { kind: "person", id: 0 });
});

test("the subject can be named once it is unambiguous", () => {
  assert.deepEqual(subjectOf({ propertyId: 7 }), { kind: "property", id: 7 });
  assert.equal(subjectOf({}), null);
  assert.equal(subjectOf({ personId: 1, propertyId: 2 }), null);
  assert.equal(subjectsOf({ personId: 1, propertyId: 2 }).length, 2);
});
