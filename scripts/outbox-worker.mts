import "dotenv/config";
import {
  countDueOutbox,
  drainOutbox,
  outboxSummary,
  OUTBOX_HANDLERS,
} from "../src/features/platform/server/outbox";

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
 * Nothing registers a handler yet — the first external system is Phase 7 — so a
 * commit run today dead-letters whatever it finds, on purpose and loudly.
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
    console.log(
      due === 0
        ? "Dry run: nothing to do."
        : `Dry run: would claim up to ${Math.min(due, limit)} task(s). Re-run with --commit.`
    );
    return;
  }

  const result = await drainOutbox({ limit });
  console.log(
    `claimed ${result.claimed} · done ${result.done} · retried ${result.retried} · dead-lettered ${result.deadLettered}`
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
