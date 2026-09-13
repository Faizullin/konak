import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

/** Every feature. Adding one here is what extends the boundaries below to it. */
const FEATURES = [
  "billing",
  "channels",
  "desk",
  "directory",
  "housekeeping",
  "identity",
  "organizations",
  "platform",
  "properties",
  "rates",
  "reservations",
];

const serverDirs = FEATURES.map((f) => `./src/features/${f}/server`);
const clientDirs = FEATURES.map((f) => `./src/features/${f}/client`);

/**
 * The boundaries from `docs/guides/architecture.md`, as rules rather than prose.
 *
 * `server-only` already stops a client importing a feature's `server/`, and it
 * was the only rule anything enforced. These cover the other directions, where
 * the failure is silent: the import compiles, the build passes, and the
 * coupling is found months later when a feature cannot be moved.
 *
 * Zones are written out rather than globbed. `import/no-restricted-paths` does
 * not expand a glob in `target` — it matches nothing and reports nothing, which
 * is worse than having no rule at all.
 */
const zones = [
  // model/ is the isomorphic core: it depends on nothing environment-specific.
  // Another feature's *root barrel* is allowed — that is model-only by
  // definition — so only the server/ and client/ doors are listed here.
  ...FEATURES.map((f) => ({
    target: `./src/features/${f}/model`,
    from: ["./src/server", "./src/app", "./src/components", ...serverDirs, ...clientDirs],
    message: "model/ is isomorphic and depends on nothing. Put this in server/ or client/.",
  })),

  // A client component reaches the server through tRPC, never by import.
  ...FEATURES.map((f) => ({
    target: `./src/features/${f}/client`,
    from: serverDirs,
    message: "A client component may not import a feature's server/. Call it through tRPC.",
  })),

  {
    target: "./src/features",
    from: "./src/app",
    message: "A feature may not import a route. Routes render features, never the reverse.",
  },
  {
    target: ["./src/lib", "./src/components/ui"],
    from: "./src/features",
    message: "Infrastructure may not depend on the domain — that is what makes it replaceable.",
  },
];

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "import/no-restricted-paths": ["error", { zones }],
    },
  },
  {
    /**
     * Playwright's fixtures take a callback named `use`, and the React plugin
     * reads that as the `use` hook being called outside a component. It is a
     * false positive on a file that never renders anything.
     */
    files: ["tests/e2e/**/*.ts", "playwright.config.ts"],
    rules: {
      "react-hooks/rules-of-hooks": "off",
    },
  },
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      "src/generated/**",
    ],
  },
];

export default eslintConfig;
