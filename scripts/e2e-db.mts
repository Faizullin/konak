import "dotenv/config";
import { execFileSync } from "node:child_process";
import { Client } from "pg";

/**
 * The end-to-end database: created if absent, migrated, seeded.
 *
 * Separate from the developer's on purpose. A browser test checks a guest in,
 * and doing that to the database somebody is looking at makes both of them
 * unreliable — `tests/server` avoids the same problem by tagging every fixture,
 * which a browser driving real screens cannot do.
 *
 * Safe to re-run: creating an existing database is skipped, `migrate deploy` is
 * idempotent, and the seed upserts.
 */

const url = new URL(
  process.env.E2E_DATABASE_URL ?? "postgresql://konak:konak@localhost:5433/konak_e2e?schema=public"
);

const database = url.pathname.replace(/^\//, "");
if (!database) throw new Error("E2E_DATABASE_URL has no database name");

// `CREATE DATABASE` cannot run inside the database it creates, so this connects
// to the server's default one first.
const admin = new URL(url.toString());
admin.pathname = "/postgres";
admin.search = "";

const client = new Client({ connectionString: admin.toString() });
await client.connect();

const { rowCount } = await client.query("select 1 from pg_database where datname = $1", [database]);
if (rowCount === 0) {
  // Identifiers cannot be parameterised; the name comes from our own URL and is
  // quoted rather than interpolated bare.
  await client.query(`create database "${database.replace(/"/g, '""')}"`);
  console.log(`created database ${database}`);
} else {
  console.log(`database ${database} already exists`);
}
await client.end();

const env = { ...process.env, DATABASE_URL: url.toString() };
const run = (command: string, args: string[]) =>
  execFileSync(command, args, { stdio: "inherit", env });

run("npx", ["prisma", "migrate", "deploy"]);

/**
 * Operational residue does not survive a run, and is cleared *before* the seed
 * so the seed's own rows come back.
 *
 * A test that fails half-way never reaches its cleanup, and what it leaves is
 * not inert: a departure clean on room 301 makes the next run's assertion find
 * two of them and fail on strict mode — a green suite turning red because of
 * the run before it. Rooms go back to clean for the same reason.
 *
 * The same lesson as the holds below, learnt twice. Nothing here is work
 * anybody is waiting on.
 */
const before = new Client({ connectionString: url.toString() });
await before.connect();
const residue = await before
  .query("delete from housekeeping_tasks")
  .then(async (tasks) => {
    await before.query("delete from maintenance_issues");
    await before.query("update rooms set status = 'CLEAN'");
    return tasks.rowCount ?? 0;
  })
  .catch(() => 0); // A database created this minute has no tables yet.
await before.end();
if (residue) console.log(`cleared ${residue} leftover task(s)`);

run("npx", ["tsx", "--conditions=react-server", "prisma/seed.ts"]);

/**
 * And the demo hotel on top of it.
 *
 * Not decoration. The suite is `fullyParallel` against one property, and
 * several specs need *a room tonight* — with the seed's two rooms the third
 * worker to ask finds none, which is `room_stays_no_overlap` being right and
 * the fixture being starved. Ten rooms is enough for any worker count this
 * machine will choose.
 *
 * It is also what makes the screenshot report worth showing: a two-room hotel
 * photographs as a product nobody would buy.
 *
 * `demo.mts` clears its own previous run, so the state is identical every time
 * rather than accumulating across runs.
 */
run("npx", ["tsx", "--conditions=react-server", "scripts/demo.mts"]);

/**
 * Holds do not survive a run.
 *
 * A claim lives fifteen minutes, so one left behind by a test that failed
 * half-way sells the rooms out for the *next* run — and a two-room demo needs
 * only two of them. Nothing here is a claim anybody is waiting on.
 */
const holds = new Client({ connectionString: url.toString() });
await holds.connect();
const { rowCount: cleared } = await holds.query("delete from inventory_holds");
await holds.end();
if (cleared) console.log(`cleared ${cleared} leftover hold(s)`);

console.log("e2e database ready");
