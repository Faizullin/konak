import { chromium } from "@playwright/test";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * The screenshot report: rows in, a page and a PDF out.
 *
 * Run after the capture pass (`playwright test --project=report`), which writes
 * one JSON row per shot. Two audiences read the result and want different
 * things from it — the team, whether a screen started erroring; a client, what
 * the product looks like — so it carries both the pictures and what the browser
 * said while it drew them.
 */

const dir = process.env.REPORT_DIR ?? join("reports", "latest");

type Row = {
  shot: string;
  title: string;
  description: string;
  path: string;
  locale: string;
  theme: string;
  file: string;
  status: number | null;
  ms: number;
  redirectedToSignIn: boolean;
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: string[];
};

/**
 * The development overlay talks in the console, loudly, and none of it is the
 * application. Left in, it buries the one line that matters under three hundred.
 */
const NOISE = /^%c%s%c|React DevTools|Next\.js Dev Tools|\[Fast Refresh\]/;

const rows: Row[] = readdirSync(join(dir, "rows"))
  .filter((file) => file.endsWith(".json"))
  .map((file) => JSON.parse(readFileSync(join(dir, "rows", file), "utf8")) as Row)
  .map((row) => ({ ...row, consoleErrors: row.consoleErrors.filter((e) => !NOISE.test(e)) }));

const findings = (row: Row) => [
  ...row.consoleErrors.map((e) => ["console", e] as const),
  ...row.pageErrors.map((e) => ["page error", e] as const),
  ...row.failedRequests.map((e) => ["request", e] as const),
];

/** One section per screen, with its axes side by side. */
const byShot = new Map<string, Row[]>();
for (const row of rows) {
  const list = byShot.get(row.shot) ?? [];
  list.push(row);
  byShot.set(row.shot, list);
}

const escape = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const total = rows.length;
const flagged = rows.filter((row) => findings(row).length > 0 || row.redirectedToSignIn);
const generatedAt = new Date().toISOString();

const sections = [...byShot.entries()]
  .map(([shot, shots]) => {
    const first = shots[0]!;
    const images = shots
      .toSorted((a, b) => `${a.locale}${a.theme}`.localeCompare(`${b.locale}${b.theme}`))
      .map(
        (row) => `
        <figure>
          <img src="${row.file}" alt="${escape(row.title)} — ${row.locale}, ${row.theme}" />
          <figcaption>${row.locale} · ${row.theme} · ${row.status ?? "?"} · ${row.ms} ms</figcaption>
        </figure>`
      )
      .join("");

    const problems = shots.flatMap((row) =>
      findings(row).map(
        ([kind, text]) =>
          `<li><b>${kind}</b> (${row.locale}/${row.theme}): ${escape(text.slice(0, 400))}</li>`
      )
    );

    return `
    <section id="${shot}">
      <h2>${escape(first.title)}</h2>
      <p class="path"><code>${escape(first.path)}</code></p>
      <p>${escape(first.description)}</p>
      ${problems.length > 0 ? `<div class="problems"><b>${problems.length} finding(s)</b><ul>${problems.join("")}</ul></div>` : ""}
      <div class="shots">${images}</div>
    </section>`;
  })
  .join("");

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<title>Konak — screens</title>
<style>
  :root { color-scheme: light; }
  body { font: 14px/1.6 -apple-system, Segoe UI, Roboto, sans-serif; margin: 0 auto; padding: 2rem; max-width: 62rem; color: #18181b; }
  h1 { margin-bottom: .25rem; }
  .meta { color: #71717a; margin-top: 0; }
  nav ul { columns: 3; list-style: none; padding: 0; }
  section { page-break-before: always; border-top: 1px solid #e4e4e7; padding-top: 1.5rem; margin-top: 2rem; }
  section:first-of-type { page-break-before: avoid; }
  h2 { margin-bottom: .25rem; }
  .path { margin: 0 0 .5rem; color: #71717a; font-size: 12px; }
  .shots { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-top: 1rem; }
  figure { margin: 0; }
  img { width: 100%; border: 1px solid #e4e4e7; border-radius: 6px; }
  figcaption { color: #71717a; font-size: 12px; margin-top: .25rem; }
  .problems { background: #fef2f2; border: 1px solid #fecaca; border-radius: 6px; padding: .75rem 1rem; }
  .problems ul { margin: .5rem 0 0; padding-left: 1.1rem; font-size: 12px; }
  .summary b { font-size: 1.5rem; }
</style></head>
<body>
  <h1>Konak — every screen</h1>
  <p class="meta">${generatedAt} · ${total} shots across ${byShot.size} screens, two languages, two themes</p>
  <p class="summary"><b>${flagged.length}</b> shot(s) with something the browser complained about.</p>
  <nav><ul>${[...byShot.values()].map((s) => `<li><a href="#${s[0]!.shot}">${escape(s[0]!.title)}</a></li>`).join("")}</ul></nav>
  ${sections}
</body></html>`;

writeFileSync(join(dir, "index.html"), html);

// Chromium only, which `page.pdf()` requires and the capture used anyway.
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`file://${resolve(dir, "index.html")}`, { waitUntil: "load" });
await page.pdf({
  path: join(dir, "report.pdf"),
  format: "A4",
  printBackground: true,
  margin: { top: "14mm", bottom: "16mm", left: "12mm", right: "12mm" },
  displayHeaderFooter: true,
  headerTemplate: "<div></div>",
  footerTemplate:
    '<div style="width:100%;font-size:9px;color:#71717a;padding:0 12mm;display:flex;justify-content:space-between"><span>Konak — screens</span><span class="pageNumber"></span>/<span class="totalPages"></span></div>',
});
await browser.close();

console.log(`${dir}/index.html and report.pdf — ${total} shots, ${flagged.length} flagged`);
