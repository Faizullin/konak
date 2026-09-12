import { Client } from "pg";

/**
 * The end-to-end database, over `pg` rather than Prisma.
 *
 * **Deliberate, and worth the explanation.** Prisma's generated client is
 * ESM-only (`import.meta`), `src/` is CommonJS, and Playwright's loader is
 * neither consistently — importing the app's client here fails with a
 * `require(esm)` cycle no arrangement of `type: module` resolves. Making three
 * module systems agree is a toolchain fight with no product value.
 *
 * The trade is honest: this process drives a **browser**, it does not model a
 * domain. It arranges a few rows and removes them again, and `pg` is already
 * here because the Prisma adapter uses it.
 *
 * What it must not become is a second place the domain is expressed. Anything
 * that decides a *rule* belongs in `model/`, is tested there, and is asserted
 * through the screen — never re-implemented in SQL.
 */

const connectionString =
  process.env.E2E_DATABASE_URL ?? "postgresql://konak:konak@localhost:5433/konak_e2e?schema=public";

/** One connection per call: fixtures are short and a pool would outlive them. */
export async function query<T = Record<string, unknown>>(
  sql: string,
  values: unknown[] = []
): Promise<T[]> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const { rows } = await client.query(sql, values);
    return rows as T[];
  } finally {
    await client.end();
  }
}

export async function one<T = Record<string, unknown>>(
  sql: string,
  values: unknown[] = []
): Promise<T> {
  const rows = await query<T>(sql, values);
  const row = rows[0];
  if (!row) throw new Error(`expected a row from: ${sql}`);
  return row;
}
