import "dotenv/config";
import {
  countDueOutbox,
  drainOutbox,
  outboxSummary,
  OUTBOX_HANDLERS,
} from "../src/features/platform/server/outbox";
import { countSweepable, sweepStorage } from "../src/features/platform/server/storage-sweep";
import { countExpiredHolds, sweepExpiredHolds } from "../src/features/reservations/server/service";

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

const registered = Object.keys(OUTBOX_HANDLERS);

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

  const result = await drainOutbox({ limit });
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
