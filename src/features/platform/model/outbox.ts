import { z } from "zod";

/**
 * The outbox: work this system owes an external one.
 *
 * A row is written inside the transaction that caused it, so the intent cannot
 * survive a rollback or be lost by a failed HTTP call made mid-transaction. A
 * worker drains it afterwards. Everything here is the arithmetic that decides
 * *when* — pure, so a backoff curve is provable without waiting for it.
 */

export const OutboxStatus = {
  PENDING: "PENDING",
  RUNNING: "RUNNING",
  DONE: "DONE",
  /** Dead-lettered: out of attempts, and waiting for a person. */
  FAILED: "FAILED",
} as const;

export type OutboxStatus = (typeof OutboxStatus)[keyof typeof OutboxStatus];

export const OUTBOX_STATUS_VALUES = Object.values(OutboxStatus);

export const outboxStatusSchema = z.enum(OUTBOX_STATUS_VALUES);

export const OUTBOX_STATUS_LABELS: Record<OutboxStatus, string> = {
  PENDING: "Waiting",
  RUNNING: "Running",
  DONE: "Done",
  FAILED: "Dead-lettered",
};

/**
 * How many times a task is tried before it stops being retried and starts being
 * someone's problem. Five attempts with the curve below spans about half an
 * hour, which outlasts an ordinary deploy or a brief outage without hiding a
 * real breakage for a day.
 */
export const OUTBOX_MAX_ATTEMPTS = 5;

/** The first retry waits this long; each one after doubles it. */
export const OUTBOX_BASE_BACKOFF_MS = 60_000;

/** No retry waits longer than this, however many have failed. */
export const OUTBOX_MAX_BACKOFF_MS = 3_600_000;

/**
 * How long a claimed task may stay claimed before another worker may take it.
 *
 * A worker that is killed mid-task leaves the row RUNNING forever; without a
 * lease the queue quietly loses work rather than retrying it. Longer than any
 * handler should take, shorter than anyone's patience.
 */
export const OUTBOX_LEASE_MS = 300_000;

/**
 * How long to wait before attempt number `attempts + 1`.
 *
 * Exponential and capped. Deliberately not jittered here: jitter is a property
 * of the *caller* wanting two workers to diverge, and a pure function that
 * returns a different answer each call cannot be tested.
 */
export function backoffMs(attempts: number): number {
  if (attempts < 1) return OUTBOX_BASE_BACKOFF_MS;
  const grown = OUTBOX_BASE_BACKOFF_MS * 2 ** (attempts - 1);
  return Math.min(grown, OUTBOX_MAX_BACKOFF_MS);
}

/** When a task that has just failed becomes runnable again. */
export function nextAttemptAt(attempts: number, now: Date): Date {
  return new Date(now.getTime() + backoffMs(attempts));
}

/**
 * Whether a task that has just failed is out of attempts.
 *
 * Attempts are counted when a task is *claimed*, not when it succeeds, so a
 * worker killed mid-handler still spends one — otherwise a task that crashes
 * the process retries forever and takes every worker with it.
 */
export function isDeadLettered(attempts: number): boolean {
  return attempts >= OUTBOX_MAX_ATTEMPTS;
}

/** Where a failed task goes next: back into the queue, or to a person. */
export function outcomeOfFailure(
  attempts: number,
  now: Date
): { status: OutboxStatus; availableAt: Date } {
  return isDeadLettered(attempts)
    ? { status: OutboxStatus.FAILED, availableAt: now }
    : { status: OutboxStatus.PENDING, availableAt: nextAttemptAt(attempts, now) };
}

/**
 * A task is claimable when it is due and nobody holds it — or when whoever held
 * it has gone quiet for longer than the lease.
 */
export function isClaimable(
  task: { status: string; availableAt: Date; lockedAt: Date | null },
  now: Date
): boolean {
  if (task.availableAt > now) return false;
  if (task.status === OutboxStatus.PENDING) return true;
  if (task.status !== OutboxStatus.RUNNING) return false;
  return task.lockedAt !== null && now.getTime() - task.lockedAt.getTime() >= OUTBOX_LEASE_MS;
}

/**
 * What a caller hands the outbox. `payload` is an object rather than a string:
 * the column is text, and serialising at the boundary is what stops two callers
 * disagreeing about how.
 */
export const enqueueOutboxSchema = z.object({
  type: z.string().min(1).max(120),
  payload: z.record(z.string(), z.unknown()),
  organizationId: z.number().nullable().optional(),
  /**
   * Makes a retry safe. Two enqueues with the same key are one task, which is
   * what lets a caller re-run without checking whether it already did.
   */
  idempotencyKey: z.string().min(1).max(200).optional(),
  /** Deferred work — a reminder, a scheduled push. Absent means now. */
  availableAt: z.coerce.date().optional(),
});

export type EnqueueOutboxInput = z.infer<typeof enqueueOutboxSchema>;
