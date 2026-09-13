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
run("npx", ["tsx", "--conditions=react-server", "prisma/seed.ts"]);

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
