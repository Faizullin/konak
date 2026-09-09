// First, and before any `@/` import: `env.mjs` validates `process.env` the
// moment it is reached, and nothing has populated it in a bare tsx process.
// The harness does this too, but only for files that import it first.
import "dotenv/config";
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { randomUUID } from "node:crypto";
import {
  claimOutboxBatch,
  drainOutbox,
  enqueueOutbox,
  type OutboxHandlers,
} from "@/features/platform/server";
import { OUTBOX_LEASE_MS, OUTBOX_MAX_ATTEMPTS } from "@/features/platform";
import { prisma } from "./harness";

/**
 * The outbox worker.
 *
 * `model/` proves the backoff curve and the dead-letter threshold. What needs a
 * database is the part that cannot be proved without one: that a claim is
 * atomic, that a lease expires, and that a failure lands where the model said
 * it would.
 */

/** Types are namespaced per run so a claim only ever sees this test's work. */
const tag = randomUUID().slice(0, 8);
const typeName = (name: string) => `test.${tag}.${name}`;

const enqueue = (name: string, extra: { availableAt?: Date; idempotencyKey?: string } = {}) =>
  enqueueOutbox(prisma, { type: typeName(name), payload: { name }, ...extra });

/** Claim only this run's rows: `claimOutboxBatch` deliberately takes everything due. */
async function claimMine(limit = 10) {
  const claimed = await claimOutboxBatch(limit);
  const mine = claimed.filter((task) => task.type.startsWith(`test.${tag}.`));
  // Anything else this grabbed belongs to another run; put it straight back.
  for (const other of claimed.filter((task) => !task.type.startsWith(`test.${tag}.`))) {
    await prisma.outboxTask.update({
      where: { id: other.id },
      data: { status: "PENDING", lockedAt: null, attempts: other.attempts - 1 },
    });
  }
  return mine;
}

before(async () => {
  // A clean queue, so a stray row from a previous run cannot be claimed here.
  await prisma.outboxTask.deleteMany({ where: { type: { startsWith: "test." } } });
});

after(async () => {
  await prisma.outboxTask.deleteMany({ where: { type: { startsWith: `test.${tag}.` } } });
  await prisma.$disconnect();
});

describe("enqueuing", () => {
  test("a task is written waiting, and due immediately", async () => {
    const task = await enqueue("plain");
    const row = await prisma.outboxTask.findUniqueOrThrow({ where: { id: task.id } });

    assert.equal(row.status, "PENDING");
    assert.equal(row.attempts, 0);
    assert.equal(row.availableAt <= new Date(), true);
    assert.deepEqual(JSON.parse(row.payloadJson), { name: "plain" });
  });

  test("the same idempotency key is one task, not two", async () => {
    const key = `idem-${tag}`;
    const first = await enqueue("idem", { idempotencyKey: key });
    const second = await enqueue("idem", { idempotencyKey: key });

    assert.equal(first.id, second.id);
    const count = await prisma.outboxTask.count({ where: { idempotencyKey: key } });
    assert.equal(count, 1);
  });

  test("work can be scheduled for later", async () => {
    const later = new Date(Date.now() + 3_600_000);
    const task = await enqueue("deferred", { availableAt: later });

    const row = await prisma.outboxTask.findUniqueOrThrow({ where: { id: task.id } });
    assert.equal(row.availableAt.getTime(), later.getTime());
  });
});

describe("claiming", () => {
  test("a claim spends an attempt and takes the lock", async () => {
    const task = await enqueue("claimable");
    const claimed = await claimMine();
    const mine = claimed.find((row) => row.id === task.id);

    assert.notEqual(mine, undefined);
    assert.equal(mine?.status, "RUNNING");
    // Spent on the claim, not on the failure: a worker killed mid-handler
    // still costs one, or a crashing task retries forever.
    assert.equal(mine?.attempts, 1);
    assert.notEqual(mine?.lockedAt, null);
  });

  test("a task that is not due yet is left alone", async () => {
    const task = await enqueue("not-yet", { availableAt: new Date(Date.now() + 3_600_000) });
    const claimed = await claimMine();

    assert.equal(
      claimed.some((row) => row.id === task.id),
      false
    );
  });

  test("a second claim does not take what the first is holding", async () => {
    await enqueue("contested");
    const first = await claimMine();
    const second = await claimMine();

    const overlap = second.filter((row) => first.some((held) => held.id === row.id));
    assert.deepEqual(overlap, []);
  });

  test("a worker that died loses its task once the lease is up", async () => {
    const task = await enqueue("abandoned");
    await prisma.outboxTask.update({
      where: { id: task.id },
      data: {
        status: "RUNNING",
        lockedAt: new Date(Date.now() - OUTBOX_LEASE_MS - 1000),
        attempts: 1,
      },
    });

    const claimed = await claimMine();
    const reclaimed = claimed.find((row) => row.id === task.id);
    assert.notEqual(reclaimed, undefined);
    assert.equal(reclaimed?.attempts, 2);
  });

  test("finished work is never claimed again", async () => {
    const done = await enqueue("done");
    const dead = await enqueue("dead");
    await prisma.outboxTask.update({ where: { id: done.id }, data: { status: "DONE" } });
    await prisma.outboxTask.update({ where: { id: dead.id }, data: { status: "FAILED" } });

    const claimed = await claimMine();
    assert.equal(
      claimed.some((row) => row.id === done.id || row.id === dead.id),
      false
    );
  });
});

describe("draining", () => {
  /** Only this run's types, so a drain cannot pick up another suite's work. */
  const only = (name: string, handler: OutboxHandlers[string]): OutboxHandlers => ({
    [typeName(name)]: handler,
  });

  /**
   * `drainOutbox` takes everything due, which is the point of a worker and the
   * reason each test here starts from an empty queue: otherwise one test's
   * leftovers are claimed by the next one's drain, and which assertion fails
   * depends on the order.
   */
  const onlyTask = async (name: string) => {
    await prisma.outboxTask.deleteMany({ where: { type: { startsWith: "test." } } });
    return enqueue(name);
  };

  test("a handler that returns marks the task done", async () => {
    const task = await onlyTask("succeeds");
    const seen: Record<string, unknown>[] = [];

    const result = await drainOutbox({
      handlers: only("succeeds", async (payload) => {
        seen.push(payload);
      }),
    });

    assert.equal(result.claimed, 1);
    assert.equal(result.done, 1);
    assert.deepEqual(seen, [{ name: "succeeds" }]);

    const row = await prisma.outboxTask.findUniqueOrThrow({ where: { id: task.id } });
    assert.equal(row.status, "DONE");
    assert.notEqual(row.completedAt, null);
    assert.equal(row.lockedAt, null);
  });

  test("a handler that throws puts the task back, later", async () => {
    const task = await onlyTask("throws");

    await drainOutbox({
      handlers: only("throws", async () => {
        throw new Error("the channel said no");
      }),
    });

    const row = await prisma.outboxTask.findUniqueOrThrow({ where: { id: task.id } });
    assert.equal(row.status, "PENDING");
    assert.equal(row.attempts, 1);
    assert.match(row.lastError ?? "", /the channel said no/);
    // Backed off: it is not due again immediately.
    assert.equal(row.availableAt > new Date(), true);
  });

  test("a type nobody handles dead-letters at once, because waiting cannot help", async () => {
    const task = await onlyTask("unhandled");

    const result = await drainOutbox({ handlers: {} });
    assert.equal(result.claimed, 1);
    assert.equal(result.deadLettered, 1);

    const row = await prisma.outboxTask.findUniqueOrThrow({ where: { id: task.id } });
    assert.equal(row.status, "FAILED");
    assert.equal(row.attempts, 1);
    assert.match(row.lastError ?? "", /No handler registered/);
  });

  test("a task that keeps failing eventually stops being retried", async () => {
    const task = await onlyTask("always-fails");
    await prisma.outboxTask.update({
      where: { id: task.id },
      data: { attempts: OUTBOX_MAX_ATTEMPTS - 1 },
    });

    await drainOutbox({
      handlers: only("always-fails", async () => {
        throw new Error("still no");
      }),
    });

    const row = await prisma.outboxTask.findUniqueOrThrow({ where: { id: task.id } });
    assert.equal(row.attempts, OUTBOX_MAX_ATTEMPTS);
    assert.equal(row.status, "FAILED");
    assert.notEqual(row.completedAt, null);
  });

  test("a drain with nothing due does nothing and says so", async () => {
    await prisma.outboxTask.deleteMany({ where: { type: { startsWith: "test." } } });
    const result = await drainOutbox({ handlers: {} });
    assert.equal(result.claimed, 0);
    assert.equal(result.done, 0);
  });
});
