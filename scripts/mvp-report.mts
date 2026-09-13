import "dotenv/config";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { format, resolveConfig } from "prettier";
import { DEMO_PASSWORD, DEMO_USERS } from "../prisma/accounts";

/**
 * The client's report: prose in, a document out.
 *
 * Run after the capture pass (`playwright test --project=mvp`), which writes
 * the pictures into `docs/reports/screens/` and one JSON row per shot. This
 * puts them into the Russian text and writes `docs/reports/mvp-report.ru.md`.
 *
 * **Two files, one document, and they cannot drift.** The prose is
 * `docs/reports/src/mvp-report.ru.md`, because a client-facing paragraph is
 * content; what to photograph is `tests/e2e/mvp/steps.ts`, because it is code.
 * A `{{shot:id}}` naming a picture nobody took fails the run, and so does a
 * picture no placeholder uses — which is the whole reason the split is safe.
 *
 * What the browser complained about is printed here and **kept out of the
 * document**. `report.mts` renders those beside each picture on purpose: that
 * report is for the team. This one is for the client.
 */

const SRC = join("docs", "reports", "src", "mvp-report.ru.md");
const OUT = join("docs", "reports", "mvp-report.ru.md");
const ROWS = process.env.MVP_ROWS_DIR ?? join("reports", "mvp", "rows");

type Row = {
  id: string;
  order: number;
  caption: string;
  path: string;
  file: string;
  status: number | null;
  consoleErrors: string[];
  pageErrors: string[];
};

/** The development overlay talks in the console, loudly, and none of it is us. */
const NOISE = /^%c%s%c|React DevTools|Next\.js Dev Tools|\[Fast Refresh\]/;

const rows = readdirSync(ROWS)
  .filter((file) => file.endsWith(".json"))
  .map((file) => JSON.parse(readFileSync(join(ROWS, file), "utf8")) as Row)
  .sort((a, b) => a.order - b.order);

if (rows.length === 0) {
  throw new Error(`No shots in ${ROWS}. Run the capture first: npm run report:mvp`);
}

const byId = new Map(rows.map((row) => [row.id, row]));

/* -- the document ---------------------------------------------------------- */

const template = readFileSync(SRC, "utf8");

const used = new Set<string>();
const missing: string[] = [];

let body = template.replace(/\{\{shot:([a-z0-9-]+)\}\}/g, (_, id: string) => {
  const row = byId.get(id);
  if (!row) {
    missing.push(id);
    return "";
  }
  used.add(id);

  // Alt text and a caption say the same thing on purpose: one is for a reader
  // who cannot see the picture, the other for one who can but wants the point.
  return `![${row.caption}](screens/${row.file})\n\n_${row.caption}_`;
});

if (missing.length > 0) {
  throw new Error(
    `${SRC} asks for ${missing.length} shot(s) nobody took: ${missing.join(", ")}.\n` +
      `Either add the step to tests/e2e/mvp/steps.ts or remove the placeholder.`
  );
}

const orphans = rows.filter((row) => !used.has(row.id));
if (orphans.length > 0) {
  throw new Error(
    `${orphans.length} shot(s) are taken and never shown: ${orphans.map((r) => r.id).join(", ")}.\n` +
      `Either put {{shot:…}} in ${SRC} or remove the step.`
  );
}

/* -- how to run it, from what the seed actually writes ---------------------- */

const url =
  process.env.E2E_DATABASE_URL ?? "postgresql://konak:konak@localhost:5433/konak_e2e?schema=public";

const client = new Client({ connectionString: url });
await client.connect();
const hotel = await client
  .query<{ rooms: string; types: string; bookings: string; org: string; property: string }>(
    `select
       (select count(*) from rooms r where r."propertyId" = p.id and r."archivedAt" is null) as rooms,
       (select count(*) from room_types t where t."propertyId" = p.id and t."archivedAt" is null) as types,
       (select count(*) from reservations v where v."propertyId" = p.id) as bookings,
       o.slug as org, p.slug as property
     from properties p join organizations o on o.id = p."organizationId"
     where p.slug = $1 limit 1`,
    ["seaside"]
  )
  .then(({ rows: [row] }) => row);
await client.end();

if (!hotel) throw new Error("No property `seaside` in the database the shots came from.");

const accounts = DEMO_USERS.map(
  (user) => `| \`${user.email}\` | ${user.name} | ${user.role} |`
).join("\n");

const setup = `## Как посмотреть

\`\`\`bash
docker compose -f docker/compose/db.yml up -d
npm run db:seed     # учётные записи, организация и объект
npm run demo        # гостиница с данными
npm run dev
\`\`\`

Вход: \`${DEMO_USERS[0].email}\` / \`${DEMO_PASSWORD}\`, далее
\`http://localhost:3000/desk/${hotel.org}/${hotel.property}\`.

Пароль у всех учётных записей одинаковый — это демонстрационные данные, и в
рабочей установке сид не запускается.

| Адрес | Имя | Права |
|---|---|---|
${accounts}

Демонстрационная гостиница: ${hotel.rooms} номеров в ${hotel.types} категориях, ${hotel.bookings} броней во всех состояниях — включая отмену, незаезд и две смены гостя в один день. Есть гостья с тремя прошлыми проживаниями.

\`npm run demo\` можно запускать повторно: он убирает данные прошлого запуска,
поэтому репетиция ничего не портит.

Сценарий показа по шагам — [demo.md](../guides/demo.md).`;

if (!body.includes("{{setup}}")) {
  throw new Error(`${SRC} has no {{setup}} — the accounts and commands have nowhere to go.`);
}
body = body.replace("{{setup}}", setup);

const leftover = body.match(/\{\{[^}]+\}\}/g);
if (leftover) throw new Error(`Unknown placeholder(s) in ${SRC}: ${leftover.join(", ")}`);

/* -- provenance ------------------------------------------------------------ */

const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
const today = new Date().toISOString().slice(0, 10);

// Invisible where the client reads it, unmissable where somebody is about to
// edit the wrong file.
const banner = `<!-- Собрано командой \`npm run report:mvp\`. Не редактируйте этот файл:
     текст — docs/reports/src/mvp-report.ru.md, снимки — tests/e2e/mvp/steps.ts. -->`;

const footer = `---

Снимки экрана сделаны автоматически в реальном приложении ${today} (сборка \`${commit}\`), ${rows.length} шт. Даты в демонстрационных данных отсчитываются от дня запуска, поэтому в следующем отчёте они будут другими.`;

const composed = `${banner}\n\n${body.trimEnd()}\n\n${footer}\n`;

// Formatted here rather than by hand: `npm run format:check` covers `docs/`,
// and a generated file that fails it would fail every build after this one.
const options = await resolveConfig(OUT);
writeFileSync(OUT, await format(composed, { ...options, filepath: OUT }));

/* -- what the browser said, for us and not for them ------------------------ */

const findings = rows.flatMap((row) => [
  ...row.consoleErrors.filter((error) => !NOISE.test(error)).map((e) => [row.id, "console", e]),
  ...row.pageErrors.map((e) => [row.id, "page error", e]),
]);

for (const [id, kind, text] of findings) console.warn(`  ${id} — ${kind}: ${text.slice(0, 200)}`);

console.log(
  `${OUT} — ${rows.length} shots, ${findings.length} thing(s) the browser complained about`
);
