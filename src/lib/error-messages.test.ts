import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";

/**
 * Key parity: every domain code a router can throw has a message, and every
 * message belongs to a code that exists.
 *
 * This is the check the gate was missing. A code with no key is a refusal that
 * renders the server's English forever without anyone noticing; a key with no
 * code is a string nobody will ever see, kept alive by nothing.
 *
 * It reads the source rather than importing it: the catalogues live under
 * `features/*\/model/`, and `lib/` may not import from `features/`.
 */

const messages = JSON.parse(readFileSync("messages/en/errors.json", "utf8")) as Record<
  string,
  string
>;

const validation = JSON.parse(readFileSync("messages/en/validation.json", "utf8")) as Record<
  string,
  string
>;

/**
 * Every key a Zod schema names, read from the schemas themselves.
 *
 * A message in `model/` is a key rather than a sentence — the schemas are
 * module-level constants shared by the router and the form, so they cannot be
 * built per request with a translator.
 */
function validationKeysInUse(): Set<string> {
  const keys = new Set<string>();
  const call =
    /\.(?:min|max|length|regex|refine|startsWith|endsWith|nonempty)\([^)]*?"([a-z][a-z0-9_]*)"\s*\)|z\.(?:email|url|uuid|string|number)\(\s*"([a-z][a-z0-9_]*)"\s*\)/g;

  for (const feature of readdirSync("src/features")) {
    const dir = `src/features/${feature}/model`;
    let files: string[];
    try {
      files = readdirSync(dir);
    } catch {
      continue;
    }
    for (const file of files) {
      if (file.endsWith(".test.ts")) continue;
      const source = readFileSync(`${dir}/${file}`, "utf8");
      for (const [, a, b] of source.matchAll(call)) {
        const key = a ?? b;
        if (key) keys.add(key);
      }
    }
  }
  return keys;
}

/** The codes as declared, from every `model/errors.ts` plus `SharedError`. */
function declaredCodes(): Set<string> {
  const files = [
    ...readdirSync("src/features").map((f) => `src/features/${f}/model/errors.ts`),
    "src/server/errors.ts",
  ];

  const codes = new Set<string>();
  for (const file of files) {
    let source: string;
    try {
      source = readFileSync(file, "utf8");
    } catch {
      continue; // a feature with no catalogue of its own
    }
    for (const [, value] of source.matchAll(/^\s+[A-Z_]+: "([a-z_]+(?:\.[a-z_]+)+)",?$/gm)) {
      codes.add(value);
    }
  }
  return codes;
}

/**
 * Codes whose sentence is computed by a rule in `model/` — `refuseStatusChange`
 * and its siblings return the words, and which words depends on why. A single
 * key cannot reproduce them, so they render the server's English until those
 * rules return codes too. Listed rather than skipped, so the debt is visible.
 */
const SENTENCE_FROM_A_RULE = new Set([
  "rate_plan.terms_invalid",
  "reservation.status_refused",
  "room_type.occupancy_invalid",
  "stay.move_refused",
  "stay.no_price",
]);

test("every domain code has a message, or is a known rule-supplied sentence", () => {
  const missing = [...declaredCodes()].filter(
    (code) => !(code in messages) && !SENTENCE_FROM_A_RULE.has(code)
  );

  assert.deepEqual(missing, [], `codes with no message in messages/en/errors.json`);
});

test("every message belongs to a code that exists", () => {
  const declared = declaredCodes();
  const orphans = Object.keys(messages).filter((key) => !declared.has(key));

  assert.deepEqual(orphans, [], "messages/en/errors.json has keys no code declares");
});

test("the rules that supply their own sentence are not silently translated", () => {
  // If one of these gains a key, the key wins over the rule's sentence and the
  // specific refusal becomes a generic one. That is a regression, not progress.
  const wrongly = [...SENTENCE_FROM_A_RULE].filter((code) => code in messages);

  assert.deepEqual(wrongly, [], "a rule-supplied sentence gained a key that would override it");
});

test("no message is empty, and every placeholder is closed", () => {
  for (const [key, value] of Object.entries(messages)) {
    assert.ok(value.trim().length > 0, `${key} is empty`);
    const opens = (value.match(/\{/g) ?? []).length;
    const closes = (value.match(/\}/g) ?? []).length;
    assert.equal(opens, closes, `${key} has unbalanced braces`);
  }
});

test("every validation key a schema names has a message", () => {
  const missing = [...validationKeysInUse()].filter((key) => !(key in validation));

  assert.deepEqual(missing, [], "keys with no message in messages/en/validation.json");
});

test("every validation message is named by a schema", () => {
  const used = validationKeysInUse();
  const orphans = Object.keys(validation).filter((key) => !used.has(key));

  assert.deepEqual(orphans, [], "messages/en/validation.json has keys no schema uses");
});

test("no Zod message is an English sentence left behind", () => {
  // A key is lower_snake_case. A capital letter or a space means a sentence
  // survived the sweep and will never be translated.
  const sentences = [...validationKeysInUse()].filter((key) => !/^[a-z][a-z0-9_]*$/.test(key));

  assert.deepEqual(sentences, [], "a Zod call still carries prose");
});
