import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

/**
 * Every message is used by something.
 *
 * The opposite direction — a `t("key")` that names nothing — is already a
 * compile error: `AppConfig` in `lib/i18n.ts` types the keys from the JSON, so
 * `tsc` refuses a typo. What nothing catches is a message left behind after the
 * screen that read it changed, and those accumulate silently until a translator
 * is paid to translate them.
 *
 * `errors`, `validation`, `enums` and `nav` are keyed dynamically — by a domain
 * code, by a Zod message, by an enum value, and by a registry id — so they are
 * checked against the *code* in `error-messages.test.ts` instead.
 */

const DYNAMIC = new Set(["enums", "errors", "nav", "validation"]);

/** `{ a: { b: "x" } }` → `a.b`, prefixed with its namespace. */
function flatten(value: unknown, prefix: string): string[] {
  if (typeof value === "string") return [prefix];
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([key, nested]) =>
    flatten(nested, prefix ? `${prefix}.${key}` : key)
  );
}

function declaredKeys(): Map<string, string[]> {
  const byNamespace = new Map<string, string[]>();
  for (const file of readdirSync("messages/en")) {
    if (!file.endsWith(".json")) continue;
    const namespace = file.replace(/\.json$/, "");
    if (DYNAMIC.has(namespace)) continue;
    const json = JSON.parse(readFileSync(join("messages/en", file), "utf8"));
    byNamespace.set(namespace, flatten(json, namespace));
  }
  return byNamespace;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry) && !entry.endsWith(".test.ts") ? [path] : [];
  });
}

/**
 * Keys a file reaches, as exact keys and as prefixes.
 *
 * A prefix covers the calls that build a key at runtime —
 * ``t(`typeForm.${name}`)`` — where the tail is a field name rather than
 * anything a scan can resolve. Everything under that prefix counts as used,
 * which is the conservative direction: this test should never report a message
 * as orphaned when it is not.
 */
function usedIn(source: string, namespaces: string[]): { exact: Set<string>; prefixes: string[] } {
  const exact = new Set<string>();
  const prefixes: string[] = [];

  // `t("…")`, `t.has("…")`, `t.rich("…")`, and the template form.
  for (const [, raw] of source.matchAll(/\bt(?:\.\w+)?\(\s*["`]([^"`]*)/g)) {
    for (const namespace of namespaces) {
      if (raw.includes("${")) prefixes.push(`${namespace}.${raw.slice(0, raw.indexOf("${"))}`);
      else exact.add(`${namespace}.${raw}`);
    }
  }

  // A key built into a variable before it is passed —
  // ``const key = `actions.${status}`;`` — is a template that never appears
  // inside `t(`. Any template in the file counts as a prefix.
  for (const [, raw] of source.matchAll(/`([^`$]*)\$\{/g)) {
    if (!raw) continue;
    for (const namespace of namespaces) prefixes.push(`${namespace}.${raw}`);
  }

  // A key held in a variable — `titleKey: "grid.cancelTitle"` — reaches `t`
  // somewhere else entirely, so any literal that looks like a key counts.
  for (const [, literal] of source.matchAll(/["']([a-zA-Z][\w.]*\.[\w.]+)["']/g)) {
    exact.add(literal);
    for (const namespace of namespaces) exact.add(`${namespace}.${literal}`);
  }

  return { exact, prefixes };
}

test("every message is read by something", () => {
  const declared = declaredKeys();
  const unused = new Set([...declared.values()].flat());

  for (const path of sourceFiles("src")) {
    const source = readFileSync(path, "utf8");
    const namespaces = [
      ...source.matchAll(/(?:useTranslations|getTranslations)\(\s*["']([\w.]+)["']/g),
    ].map(([, ns]) => ns);
    if (namespaces.length === 0) continue;

    const { exact, prefixes } = usedIn(source, namespaces);
    for (const key of [...unused]) {
      if (exact.has(key) || prefixes.some((prefix) => key.startsWith(prefix))) unused.delete(key);
    }
  }

  assert.deepEqual(
    [...unused].sort(),
    [],
    "messages nothing reads — delete them, or the screen that lost them"
  );
});

test("every locale declares exactly the keys English does", () => {
  // `Messages` is `typeof en`, so English alone decides the key *type* and a
  // second locale cannot widen it. Whether a translation is complete is a
  // runtime fact, and this is where it is held — in both directions, because a
  // key left behind after a rename is as wrong as one never written.
  const english = new Set(
    readdirSync("messages/en")
      .filter((file) => file.endsWith(".json"))
      .flatMap((file) => flatten(JSON.parse(readFileSync(join("messages/en", file), "utf8")), file))
  );

  for (const locale of readdirSync("messages")) {
    if (locale === "en" || !statSync(join("messages", locale)).isDirectory()) continue;

    const theirs = new Set(
      readdirSync(join("messages", locale))
        .filter((file) => file.endsWith(".json"))
        .flatMap((file) =>
          flatten(JSON.parse(readFileSync(join("messages", locale, file), "utf8")), file)
        )
    );

    assert.deepEqual(
      [...english].filter((key) => !theirs.has(key)).sort(),
      [],
      `untranslated in ${locale}`
    );
    assert.deepEqual(
      [...theirs].filter((key) => !english.has(key)).sort(),
      [],
      `in ${locale} but not in English — a rename left it behind`
    );
  }
});

test("every namespace in messages/ is mounted somewhere", () => {
  // A namespace no provider carries, and no Server Component reads, is a file
  // that will drift: nothing renders it, so nothing notices when it is wrong.
  const layouts = ["src/app/(app)/dashboard/layout.tsx", "src/app/(auth)/layout.tsx"]
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");
  const server = sourceFiles("src/app")
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");

  const missing = [...declaredKeys().keys()].filter(
    (namespace) =>
      !layouts.includes(`${namespace}: messages.`) && !server.includes(`("${namespace}"`)
  );

  assert.deepEqual(missing, [], "namespaces nothing mounts or reads");
});
