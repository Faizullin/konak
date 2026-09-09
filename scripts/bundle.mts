import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * What each route makes a browser download, in bytes.
 *
 *   npm run build && npm run bundle
 *
 * Next 16 removed `size` and `First Load JS` from the build output, calling
 * them inaccurate for server-driven architectures — which is fair, and left the
 * client half of `roadmap.md` § How a phase ends with no instrument. This is the
 * replacement.
 *
 * **These are raw on-disk bytes, not the kilobytes Next used to print.** The two
 * are not comparable, and the floor was re-recorded once when this landed. What
 * matters is that the number is deterministic, so "change one thing, measure
 * again" answers in bytes rather than in a rounded kilobyte that moves on its
 * own — the last two phase-end passes both needed exactly that.
 *
 * It reads build internals, which Next is free to rearrange: the `app-build-
 * manifest.json` this first used disappeared in 16. So it fails loudly with
 * what it looked for rather than reporting a confident zero.
 */

const BUILD = ".next";
const APP = join(BUILD, "server", "app");

function fail(message: string): never {
  console.error(`${message}\n\nRun \`npm run build\` first. If the build is fine, Next has moved
these files again — see the paths above and adjust scripts/bundle.mts.`);
  process.exit(1);
}

if (!existsSync(APP)) fail(`No ${APP}.`);

/** Every `*_client-reference-manifest.js`, which is one per route. */
function manifests(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return manifests(path);
    return entry.name.endsWith("_client-reference-manifest.js") ? [path] : [];
  });
}

/** `globalThis.__RSC_MANIFEST["<route>"] = {…};` — the assignment, parsed. */
function chunksOf(file: string): { route: string; chunks: Set<string> } {
  const source = readFileSync(file, "utf8");
  const opens = source.indexOf("] = ");
  const closes = source.lastIndexOf(";");
  if (opens === -1 || closes === -1)
    fail(`Cannot read ${file}: not the assignment shape expected.`);

  const parsed = JSON.parse(source.slice(opens + 4, closes)) as {
    clientModules: Record<string, { chunks?: string[] }>;
  };

  const chunks = new Set<string>();
  for (const entry of Object.values(parsed.clientModules ?? {})) {
    for (const chunk of entry.chunks ?? []) chunks.add(chunk);
  }

  // The framework bundle every route loads, listed per route beside it.
  const routeDir = file.replace(/_client-reference-manifest\.js$/, "");
  const own = join(routeDir, "build-manifest.json");
  if (existsSync(own)) {
    const build = JSON.parse(readFileSync(own, "utf8")) as { rootMainFiles?: string[] };
    for (const chunk of build.rootMainFiles ?? []) chunks.add(chunk);
  }

  return { route: relative(APP, routeDir).replace(/\/$/, ""), chunks };
}

/** A chunk is named `/_next/static/…` or `static/…`; both live under `.next/`. */
function bytesOf(chunk: string): number {
  const path = join(BUILD, chunk.replace(/^\/_next\//, ""));
  return existsSync(path) ? statSync(path).size : 0;
}

const routes = manifests(APP)
  .map(chunksOf)
  // Route handlers and error pages ship nothing a person navigates to.
  .filter((route) => !route.route.startsWith("_") && route.chunks.size > 0);

if (routes.length === 0) fail(`No client-reference manifests under ${APP}.`);

const shared = [...routes[0]!.chunks].filter((chunk) =>
  routes.every((route) => route.chunks.has(chunk))
);
const sharedBytes = shared.reduce((total, chunk) => total + bytesOf(chunk), 0);

const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} kB`;

const rows = routes
  .map(({ route, chunks }) => {
    const total = [...chunks].reduce((sum, chunk) => sum + bytesOf(chunk), 0);
    return { route, total, own: Math.max(total - sharedBytes, 0) };
  })
  .sort((a, b) => b.total - a.total);

const width = Math.max(...rows.map((row) => row.route.length), 5);

console.log(
  `\nShared by every route  ${kb(sharedBytes)}  (${sharedBytes} bytes, ${shared.length} chunks)\n`
);
console.log(`${"Route".padEnd(width)}  ${"First load".padEnd(12)}  Own`);
console.log("-".repeat(width + 26));
for (const row of rows) {
  console.log(`${row.route.padEnd(width)}  ${kb(row.total).padEnd(12)}  ${kb(row.own)}`);
}
console.log("\nRaw chunk bytes. Not comparable to Next 15's printed figure.\n");
