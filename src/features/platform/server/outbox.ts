import "server-only";
import { Prisma } from "@/generated/prisma/client";
import prisma from "@/server/db";
import {
  enqueueOutboxSchema,
  isDeadLettered,
  OUTBOX_LEASE_MS,
  outcomeOfFailure,
  OutboxStatus,
  type EnqueueOutboxInput,
} from "../model";
import { STORAGE_HANDLERS } from "./storage-sweep";
import { isUniqueViolation } from "@/server/errors";

/**
 * The outbox worker: claiming work, running it, and deciding what a failure
 * means.
 *
 * This has a service because it owns a multi-step transaction and an invariant
 * — the threshold `architecture.md` states. The invariant is that a task is
 * claimed by exactly one worker, and it is held by the database rather than by
 * this code.
 *
 * Every *when* decision — the backoff curve, the lease, the dead-letter
 * threshold — is in `model/outbox.ts` and proved without a database.
 */

export type OutboxTaskRow = {
  id: number;
  organizationId: number | null;
  type: string;
  payloadJson: string;
  status: string;
  attempts: number;
  availableAt: Date;
  lockedAt: Date | null;
};

/** What a handler is given: the parsed payload, and the task it came from. */
export type OutboxHandler = (
  payload: Record<string, unknown>,
  task: OutboxTaskRow
) => Promise<void>;

export type OutboxHandlers = Record<string, OutboxHandler>;

/**
 * Every type the worker can run.
 *
 * A type with no handler dead-letters immediately rather than retrying, because
 * retrying cannot make a handler appear. Code that enqueues a type ships with
 * the handler for it, and this is where an absent one is found — at the first
 * drain, not in production a week later.
 *
 * `storage-sweep` imports only *types* from here, so composing its handlers
 * into this object is not a cycle at runtime.
 *
 * **A feature whose handlers need `enqueueOutbox` cannot be composed here** —
 * that is a cycle, and `channels` is the first one: it enqueues its own work.
 * Those are composed by the worker instead, which is the right layer anyway.
 * Infrastructure knowing the name of a feature is backwards.
 */
export const OUTBOX_HANDLERS: OutboxHandlers = {
  ...STORAGE_HANDLERS,
};

/** The client a caller's transaction hands us, or the plain one. */
type Enqueuer = Pick<Prisma.TransactionClient, "outboxTask">;

/**
 * Write the intent inside the transaction that caused it.
 *
 * The whole point of an outbox: a reservation and the push announcing it commit
 * together or not at all. An HTTP call made inside that transaction would hold
 * it open and still be lost by a rollback.
 *
 * Re-enqueuing the same `idempotencyKey` returns the existing task rather than
 * a second one, which is what lets a caller retry without first asking whether
 * it already succeeded.
 */
export async function enqueueOutbox(db: Enqueuer, input: EnqueueOutboxInput) {
  const parsed = enqueueOutboxSchema.parse(input);

  if (parsed.idempotencyKey) {
    const existing = await db.outboxTask.findUnique({
      where: { idempotencyKey: parsed.idempotencyKey },
      select: { id: true, type: true, status: true },
    });
    if (existing) return existing;
  }

  try {
    return await db.outboxTask.create({
      data: {
        type: parsed.type,
        payloadJson: JSON.stringify(parsed.payload),
        organizationId: parsed.organizationId ?? null,
        idempotencyKey: parsed.idempotencyKey ?? null,
        availableAt: parsed.availableAt ?? new Date(),
      },
      select: { id: true, type: true, status: true },
    });
  } catch (error) {
    /**
     * Somebody filed the same key between the read above and this write.
     *
     * That is precisely what the key *means* — "this has already been said" —
     * so it is the answer, not a failure. But the read and the create are two
     * statements and the gap is wide enough to matter: `pushKey` is
     * minute-grained, so two cancellations in the same minute compute the same
     * key, both miss, and the loser's `INSERT` raised P2002 and **took its
     * whole transaction with it**. The booking rolled back because the message
     * announcing it was already queued.
     *
     * Only recoverable when a key was given. Without one there is nothing to
     * recover to, and a violation means something else is wrong.
     */
    if (!parsed.idempotencyKey || !isUniqueViolation(error)) throw error;

    return db.outboxTask.findUniqueOrThrow({
      where: { idempotencyKey: parsed.idempotencyKey },
      select: { id: true, type: true, status: true },
    });
  }
}

/**
 * Take up to `limit` due tasks, atomically.
 *
 * Raw SQL, and the one place in the tree that earns it: `FOR UPDATE SKIP
 * LOCKED` is what lets two workers drain the same queue without either waiting
 * on the other or both taking the same row, and Prisma's query API cannot
 * express it. Doing this as read-then-update would hand the same task to both.
 *
 * `attempts` is spent on the claim rather than on the failure, so a worker
 * killed mid-handler still costs one — otherwise a task that crashes the
 * process retries forever, taking every worker with it.
 */
export async function claimOutboxBatch(limit: number): Promise<OutboxTaskRow[]> {
  // One clock, and it is the application's.
  //
  // `availableAt` is written with `new Date()`, and every model function reasons
  // about it in those terms. Comparing it against Postgres's `now()` mixed two
  // clocks — and `now()` is *transaction start* time, so a task enqueued a
  // moment ago could read as not yet due and silently fail to be claimed.
  const now = new Date();
  const staleBefore = new Date(now.getTime() - OUTBOX_LEASE_MS);

  return prisma.$queryRaw<OutboxTaskRow[]>`
    UPDATE "outbox_tasks"
    SET "status" = ${OutboxStatus.RUNNING},
        "lockedAt" = ${now},
        "attempts" = "attempts" + 1
    WHERE "id" IN (
      SELECT "id" FROM "outbox_tasks"
      WHERE "availableAt" <= ${now}
        AND (
          "status" = ${OutboxStatus.PENDING}
          OR ("status" = ${OutboxStatus.RUNNING} AND "lockedAt" < ${staleBefore})
        )
      ORDER BY "availableAt" ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING "id", "organizationId", "type", "payloadJson", "status", "attempts",
              "availableAt", "lockedAt"
  `;
}

export async function completeOutboxTask(id: number) {
  await prisma.outboxTask.update({
    where: { id },
    data: {
      status: OutboxStatus.DONE,
      completedAt: new Date(),
      lockedAt: null,
      lastError: null,
    },
  });
}

/**
 * Put a failed task back, or stop retrying it.
 *
 * `permanent` is for failures that a retry cannot fix — an unknown type, a
 * payload that will not parse. Waiting an hour to fail the same way is not
 * resilience, it is delay.
 */
export async function failOutboxTask(
  task: { id: number; attempts: number },
  error: string,
  options: { permanent?: boolean } = {}
) {
  const now = new Date();
  const outcome = options.permanent
    ? { status: OutboxStatus.FAILED, availableAt: now }
    : outcomeOfFailure(task.attempts, now);

  await prisma.outboxTask.update({
    where: { id: task.id },
    data: {
      status: outcome.status,
      availableAt: outcome.availableAt,
      lockedAt: null,
      // Truncated: a stack trace from a vendor SDK can be enormous, and the
      // first lines are the ones anybody reads.
      lastError: error.slice(0, 2000),
      ...(outcome.status === OutboxStatus.FAILED ? { completedAt: now } : {}),
    },
  });
}

export type DrainResult = {
  claimed: number;
  done: number;
  retried: number;
  deadLettered: number;
};

/**
 * Run one pass over the queue.
 *
 * One pass, not a loop: how often to call this is the caller's decision — a
 * script's `--interval`, a cron, or a test calling it once. A drain that owned
 * its own loop could not be tested without waiting.
 */
export async function drainOutbox(
  options: { limit?: number; handlers?: OutboxHandlers } = {}
): Promise<DrainResult> {
  const handlers = options.handlers ?? OUTBOX_HANDLERS;
  const tasks = await claimOutboxBatch(options.limit ?? 20);

  const result: DrainResult = {
    claimed: tasks.length,
    done: 0,
    retried: 0,
    deadLettered: 0,
  };

  for (const task of tasks) {
    const handler = handlers[task.type];
    if (!handler) {
      await failOutboxTask(task, `No handler registered for "${task.type}"`, { permanent: true });
      result.deadLettered += 1;
      continue;
    }

    try {
      await handler(JSON.parse(task.payloadJson) as Record<string, unknown>, task);
      await completeOutboxTask(task.id);
      result.done += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await failOutboxTask(task, message);
      if (isDeadLettered(task.attempts)) {
        result.deadLettered += 1;
      } else {
        result.retried += 1;
      }
    }
  }

  return result;
}

/**
 * How many tasks a drain would take right now, claiming none of them.
 *
 * The same predicate as `claimOutboxBatch`, which is a duplication worth
 * accepting: a dry run that claimed work to count it would not be a dry run.
 */
export async function countDueOutbox(): Promise<number> {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - OUTBOX_LEASE_MS);

  return prisma.outboxTask.count({
    where: {
      availableAt: { lte: now },
      OR: [
        { status: OutboxStatus.PENDING },
        { status: OutboxStatus.RUNNING, lockedAt: { lt: staleBefore } },
      ],
    },
  });
}

/** What is waiting, what is stuck, and what gave up — for a dry run or a screen. */
export async function outboxSummary() {
  const rows = await prisma.outboxTask.groupBy({
    by: ["status"],
    _count: { _all: true },
  });
  return Object.fromEntries(rows.map((row) => [row.status, row._count._all])) as Partial<
    Record<OutboxStatus, number>
  >;
}
