import assert from "node:assert/strict";
import { test } from "node:test";

import {
  backoffMs,
  hasExactlyOneSubject,
  isClaimable,
  isDeadLettered,
  OUTBOX_LEASE_MS,
  OUTBOX_MAX_ATTEMPTS,
  OUTBOX_MAX_BACKOFF_MS,
  OUTBOX_STATUS_LABELS,
  OUTBOX_STATUS_VALUES,
  outcomeOfFailure,
  OutboxStatus,
  subjectOf,
  subjectsOf,
  normaliseTagName,
} from "./index";

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

test("a backoff doubles, and stops doubling", () => {
  assert.equal(backoffMs(1), 60_000);
  assert.equal(backoffMs(2), 120_000);
  assert.equal(backoffMs(3), 240_000);
  // Capped, so a task that has failed all day is still retried within the hour.
  assert.equal(backoffMs(20), OUTBOX_MAX_BACKOFF_MS);
  // A task that has never been tried waits the base, not zero.
  assert.equal(backoffMs(0), 60_000);
});

test("a task is dead-lettered only once its attempts are spent", () => {
  assert.equal(isDeadLettered(OUTBOX_MAX_ATTEMPTS - 1), false);
  assert.equal(isDeadLettered(OUTBOX_MAX_ATTEMPTS), true);
  assert.equal(isDeadLettered(OUTBOX_MAX_ATTEMPTS + 1), true);
});

test("a failure either goes back in the queue or to a person", () => {
  const now = new Date(Date.UTC(2027, 0, 1, 12, 0, 0));

  const retried = outcomeOfFailure(2, now);
  assert.equal(retried.status, OutboxStatus.PENDING);
  assert.equal(retried.availableAt.getTime(), now.getTime() + 120_000);

  const dead = outcomeOfFailure(OUTBOX_MAX_ATTEMPTS, now);
  assert.equal(dead.status, OutboxStatus.FAILED);
  // Dead letters are not scheduled: nothing will pick this up again.
  assert.equal(dead.availableAt.getTime(), now.getTime());
});

test("a claim waits for the due time, whatever the status says", () => {
  const now = new Date(Date.UTC(2027, 0, 1, 12, 0, 0));
  const later = new Date(now.getTime() + 60_000);

  assert.equal(isClaimable({ status: "PENDING", availableAt: later, lockedAt: null }, now), false);
  assert.equal(isClaimable({ status: "PENDING", availableAt: now, lockedAt: null }, now), true);
});

test("a worker that died does not keep the task forever", () => {
  const now = new Date(Date.UTC(2027, 0, 1, 12, 0, 0));
  const running = (heldForMs: number) => ({
    status: "RUNNING",
    availableAt: now,
    lockedAt: new Date(now.getTime() - heldForMs),
  });

  // Still working, or at least still within its lease.
  assert.equal(isClaimable(running(OUTBOX_LEASE_MS - 1), now), false);
  // Gone quiet for longer than any handler should take.
  assert.equal(isClaimable(running(OUTBOX_LEASE_MS), now), true);
  // A RUNNING row with no lock at all is a bug, not a free task.
  assert.equal(isClaimable({ status: "RUNNING", availableAt: now, lockedAt: null }, now), false);
});

test("finished work is never claimed again", () => {
  const now = new Date(Date.UTC(2027, 0, 1, 12, 0, 0));
  for (const status of [OutboxStatus.DONE, OutboxStatus.FAILED]) {
    assert.equal(isClaimable({ status, availableAt: now, lockedAt: null }, now), false, status);
  }
});

test("every outbox status has a label", () => {
  for (const status of OUTBOX_STATUS_VALUES) {
    assert.equal(typeof OUTBOX_STATUS_LABELS[status], "string", status);
  }
});

test("a tag name is compared the way a person would compare it", () => {
  // `@@unique([organizationId, name])` compares exactly, so an untrimmed name
  // is a second tag that looks identical in a list and matches different people.
  assert.equal(normaliseTagName("  VIP  "), "VIP");
  assert.equal(normaliseTagName("Allergic  to   feathers"), "Allergic to feathers");
  assert.equal(normaliseTagName("\tHigh floor\n"), "High floor");

  // Case is kept: a hotel that wrote "Allergic to feathers" did not mean
  // "allergic to feathers".
  assert.equal(normaliseTagName("VIP"), "VIP");
  assert.notEqual(normaliseTagName("vip"), normaliseTagName("VIP"));

  // Whitespace alone is not a name; the schema refuses it after the transform.
  assert.equal(normaliseTagName("   "), "");
});
