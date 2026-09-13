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

/** `{ a: { b: "x" } }` → `a.b`. */
function flatten(value: unknown, prefix: string): string[] {
  if (typeof value === "string") return [prefix];
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([key, nested]) =>
    flatten(nested, prefix ? `${prefix}.${key}` : key)
  );
}

const messages = JSON.parse(readFileSync("messages/en/errors.json", "utf8")) as Record<
  string,
  Record<string, string>
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

/** The file is nested now, and a code is the path through it. */
const messageKeys = new Set(flatten(messages, ""));

test("every domain code has a message", () => {
  const missing = [...declaredCodes()].filter((code) => !messageKeys.has(code));

  assert.deepEqual(missing, [], `codes with no message in messages/en/errors.json`);
});

test("every message belongs to a code that exists", () => {
  const declared = declaredCodes();
  // Flattened, because the file is nested now — next-intl reads "." as nesting,
  // so a flat "reservation.not_found" key resolved to nothing at all.
  const orphans = [...messageKeys].filter((key) => !declared.has(key));

  assert.deepEqual(orphans, [], "messages/en/errors.json has keys no code declares");
});

test("no message is empty, and every placeholder is closed", () => {
  for (const [group, entries] of Object.entries(messages)) {
    for (const [leaf, value] of Object.entries(entries)) {
      const key = `${group}.${leaf}`;
      assert.ok(value.trim().length > 0, `${key} is empty`);
      const opens = (value.match(/\{/g) ?? []).length;
      const closes = (value.match(/\}/g) ?? []).length;
      assert.equal(opens, closes, `${key} has unbalanced braces`);
    }
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

/* --- Enum labels ---------------------------------------------------------- */

const enums = JSON.parse(readFileSync("messages/en/enums.json", "utf8")) as Record<
  string,
  Record<string, string>
>;

/** Which `model/` const each group of labels describes. */
const ENUM_SOURCES: Record<string, string> = {
  userRole: "src/features/identity/model/user.ts:UserRole",
  orgRole: "src/features/organizations/model/organization.ts:OrgRole",
  roomStatus: "src/features/properties/model/room.ts:RoomStatus",
  mealPlan: "src/features/rates/model/plan.ts:MealPlan",
  dayRole: "src/features/reservations/model/day.ts:DayRole",
  roomSaleState: "src/features/properties/model/room.ts:RoomSaleState",
  reservationStatus: "src/features/reservations/model/status.ts:ReservationStatus",
  bookingView: "src/features/reservations/model/list.ts:BookingView",
  taskType: "src/features/housekeeping/model/task.ts:TaskType",
  taskStatus: "src/features/housekeeping/model/task.ts:TaskStatus",
  issueSeverity: "src/features/housekeeping/model/issue.ts:IssueSeverity",
  issueStatus: "src/features/housekeeping/model/issue.ts:IssueStatus",
  lineType: "src/features/billing/model/line.ts:LineType",
  paymentMethod: "src/features/billing/model/folio.ts:PaymentMethod",
  paymentStatus: "src/features/billing/model/folio.ts:PaymentStatus",
  folioStatus: "src/features/billing/model/folio.ts:FolioStatus",
};

/** The keys of `export const X = { … } as const`, read from the source. */
function enumValues(spec: string): string[] {
  const [file, name] = spec.split(":");
  const source = readFileSync(file!, "utf8");
  const block = source.match(new RegExp(`export const ${name} = \\{([\\s\\S]*?)\\n\\} as const;`));
  if (!block) return [];
  return [...block[1]!.matchAll(/^\s+([A-Z_]+):/gm)].map(([, key]) => key!);
}

test("every enum value has a label", () => {
  const missing: string[] = [];
  for (const [group, spec] of Object.entries(ENUM_SOURCES)) {
    for (const value of enumValues(spec)) {
      if (!(value in (enums[group] ?? {}))) missing.push(`${group}.${value}`);
    }
  }

  assert.deepEqual(missing, [], "enum values with no label in messages/en/enums.json");
});

test("every label names a value the enum still has", () => {
  const orphans: string[] = [];
  for (const [group, labels] of Object.entries(enums)) {
    const values = new Set(enumValues(ENUM_SOURCES[group] ?? ""));
    for (const key of Object.keys(labels)) {
      if (!values.has(key)) orphans.push(`${group}.${key}`);
    }
  }

  assert.deepEqual(orphans, [], "labels for values no enum declares");
});

test("every group of labels is one `useEnumLabels` accepts", () => {
  // The hook's union and the JSON are two lists of the same thing; a group in
  // one and not the other is a label nothing can ask for.
  const hook = readFileSync("src/lib/labels.ts", "utf8");
  const accepted = [...hook.matchAll(/"(\w+)"(?=\s*\|)|\|\s*"(\w+)"/g)].map(([, a, b]) => a ?? b);

  assert.deepEqual(Object.keys(enums).sort(), [...new Set(accepted)].sort());
});

/**
 * Enough of a value bag that any placeholder resolves. A message naming
 * something outside this is either a typo or a value nobody passes.
 *
 * Shared by the two tests that format every message — one asking whether it
 * formats, the other whether it is reachable at all.
 */
const VALUES = {
  from: "CONFIRMED",
  to: "CHECKED_OUT",
  status: "CLEAN",
  action: "CHECKED_IN",
  reason: "MIN_STAY",
  date: "4 Mar",
  module: "Directory",
  kind: "RESERVATION",
  count: 2,
  max: 62,
  available: 3,
  needed: 4,
  hours: 48,
  name: "Acme",
  number: "101",
  property: "Hotel",
  checkIn: "14:00",
  checkOut: "11:00",
  used: 12,
  quota: 5000,
  size: 1024,
  nights: 3,
  free: 2,
  adults: 2,
  children: 1,
  reference: "R-0001",
};

/* --- resolution ---------------------------------------------------------- */

test("every domain code actually resolves to its message", async () => {
  /**
   * The check the other three did not make.
   *
   * `error-messages.test.ts` proved the keys existed, `message-keys.test.ts`
   * proved nothing was orphaned, and the ICU test proved every message
   * *formats* — and all three passed while not one of these ninety-six
   * messages ever reached a screen. next-intl reads "." as nesting, so a flat
   * `"reservation.not_found"` key made `t.has()` false and `t()` return the
   * key itself; every refusal fell back to the server's English, in both
   * languages, for as long as the file was flat.
   *
   * Formatting is not resolving. This asserts the second.
   */
  const { createTranslator } = await import("use-intl/core");

  for (const locale of ["en", "ru"] as const) {
    const errors = JSON.parse(readFileSync(`messages/${locale}/errors.json`, "utf8"));
    const t = createTranslator({ locale, messages: { errors }, namespace: "errors" });

    const unreachable = flatten(errors, "").filter((key) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (!(t as any).has(key)) return true;
      // A key that resolves to itself is next-intl's miss, not a message.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (t as any)(key, VALUES) === `errors.${key}`;
    });

    assert.deepEqual(unreachable, [], `${locale}: codes whose message never reaches a screen`);
  }
});

/* --- ICU --------------------------------------------------------------- */

test("every message is valid ICU, and names only placeholders it is given", async () => {
  const { createTranslator } = await import("use-intl/core");

  // Every locale, not only English. A translation may reach for a plural
  // category English does not have — Russian needs `few` and `many` where
  // English needs neither — and a malformed one throws at render, on the
  // screen, for the language nobody on the team reads.
  const locales = {
    en: (await import("../../messages/en/index")).default,
    ru: (await import("../../messages/ru/index")).default,
  };

  const values = VALUES;

  const broken: string[] = [];
  for (const locale of Object.keys(locales) as (keyof typeof locales)[]) {
    const messages = locales[locale];
    for (const [namespace, group] of Object.entries(messages)) {
      const t = createTranslator({ locale, messages: { [namespace]: group }, namespace });
      for (const key of flatten(group, "")) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (t as any)(key, values);
        } catch (error) {
          broken.push(`${locale}/${namespace}.${key}: ${(error as Error).message.split("\n")[0]}`);
        }
      }
    }
  }

  assert.deepEqual(broken, [], "messages that do not format");
});

/* --- navigation ----------------------------------------------------------- */

test("every sidebar entry has a word, and every word is used by one", () => {
  /**
   * The sidebar was English in both locales for as long as Russian has
   * existed, because `nav-items.ts` and `ORG_MODULE_REGISTRY` are *data*: they
   * carry a key and the rendering resolves it, so no `t("…")` call exists for
   * the orphan scan to find. This is that check, against the source.
   */
  const nav = JSON.parse(readFileSync("messages/en/nav.json", "utf8")) as Record<string, string>;

  const ids = new Set<string>();
  for (const file of ["src/config/nav-items.ts", "src/features/organizations/model/registry.ts"]) {
    const source = readFileSync(file, "utf8");
    for (const [, id] of source.matchAll(/(?:title|label):\s*"([a-z][A-Za-z]*)"/g)) {
      ids.add(id);
    }
  }

  assert.deepEqual(
    [...ids].filter((id) => !(id in nav)).sort(),
    [],
    "sidebar entries with no word in messages/en/nav.json"
  );
  assert.deepEqual(
    Object.keys(nav)
      .filter((key) => !ids.has(key))
      .sort(),
    [],
    "words in nav.json no sidebar entry names"
  );
});
