import "dotenv/config";
import {
  countDueOutbox,
  drainOutbox,
  outboxSummary,
  OUTBOX_HANDLERS,
} from "../src/features/platform/server/outbox";
import { countSweepable, sweepStorage } from "../src/features/platform/server/storage-sweep";
import { countExpiredHolds, sweepExpiredHolds } from "../src/features/reservations/server/service";
// The files, not the barrel. A barrel caught in a cycle can be only partly
// initialised by the time Node links this, and the symptom is an export that
// "does not exist" — see the same reason `inbound.ts` reaches for a service
// module rather than a feature's `server/`.
import { enqueueChannelPulls } from "../src/features/channels/server/enqueue";
import { PULL_HANDLERS } from "../src/features/channels/server/pull";
import { PUSH_HANDLERS } from "../src/features/channels/server/push";

/**
 * The worker that drains `OutboxTask`.
 *
 * Run it with the `react-server` condition, which is what neutralises the
 * `server-only` guard on the feature's server code:
 *
 *   npm run outbox            # dry run: says what it would take
 *   npm run outbox -- --commit
 *   npm run outbox -- --commit --interval=15
 *
 * A dry run by default, per `local-development.md`: this changes data, so
 * seeing what it intends to do has to be possible without doing it.
 *
 * It also runs the storage sweeps, which are not tasks: an outbox task records
 * an intent that must survive a transaction, and "look for things nobody
 * confirmed" is a periodic question with no transaction behind it. This is the
 * periodic process, so this is where it belongs.
 */

const args = new Set(process.argv.slice(2));
const valueOf = (name: string, fallback: number) => {
  const found = [...args].find((arg) => arg.startsWith(`--${name}=`));
  const parsed = found ? Number(found.split("=")[1]) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const commit = args.has("--commit");
const limit = valueOf("limit", 20);
const intervalSeconds = valueOf("interval", 0);

/**
 * Everything this worker can run.
 *
 * Composed here rather than inside `outbox.ts`: a feature that enqueues its own
 * work imports `enqueueOutbox`, and a registry that imported it back would be a
 * cycle. The worker is the one place that legitimately knows about all of them.
 */
const handlers = { ...OUTBOX_HANDLERS, ...PUSH_HANDLERS, ...PULL_HANDLERS };
const registered = Object.keys(handlers);

async function report() {
  const [summary, due] = await Promise.all([outboxSummary(), countDueOutbox()]);
  console.log("outbox:", summary, `· due now: ${due}`);
  return due;
}

async function once() {
  const due = await report();

  if (!commit) {
    const [abandoned, expired, holds] = await Promise.all([
      countSweepable("uploads"),
      countSweepable("retention"),
      countExpiredHolds(),
    ]);
    console.log(
      due === 0
        ? "Dry run: no tasks due."
        : `Dry run: would claim up to ${Math.min(due, limit)} task(s).`
    );
    console.log(
      `Dry run: would sweep ${abandoned} abandoned upload(s), ${expired} past retention ` +
        `and ${holds} expired hold(s).` +
        (due + abandoned + expired + holds > 0 ? " Re-run with --commit." : "")
    );
    return;
  }

  // Asked for before the drain, so a pull queued now runs in this same pass:
  // a booking made on a channel happens where we cannot see it, and the only
  // way to learn about it is to ask.
  const pulls = await enqueueChannelPulls();
  if (pulls > 0) console.log(`queued a pull for ${pulls} connection(s)`);

  const result = await drainOutbox({ limit, handlers });
  console.log(
    `claimed ${result.claimed} · done ${result.done} · retried ${result.retried} · dead-lettered ${result.deadLettered}`
  );

  const swept = await sweepStorage();
  // Holds are rows only — no bytes, so nothing can be left for the next pass.
  const holds = await sweepExpiredHolds();
  console.log(
    `swept: ${swept.uploads.removed} abandoned upload(s), ${swept.retention.removed} past retention, ` +
      `${holds.removed} expired hold(s)` +
      (swept.uploads.failed + swept.retention.failed > 0
        ? ` · ${swept.uploads.failed + swept.retention.failed} left for the next pass`
        : "")
  );
}

console.log(
  registered.length === 0
    ? "No handlers registered — every task drained now will dead-letter."
    : `Handlers: ${registered.join(", ")}`
);

if (intervalSeconds > 0 && commit) {
  console.log(`Draining every ${intervalSeconds}s. Ctrl-C to stop.`);
  // Sequential rather than an interval timer: two overlapping drains would be
  // safe — the claim sees to that — but they would fight over the same batch.
  for (;;) {
    await once();
    await new Promise((resolve) => setTimeout(resolve, intervalSeconds * 1000));
  }
} else {
  await once();
  process.exit(0);
}
