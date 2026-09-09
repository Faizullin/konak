# CLAUDE.md

Only what bites silently. Everything else is in the docs below.

## What to read, in order

Top to bottom on arriving; then stop as soon as you have what you need.

| Read | When |
|---|---|
| `docs/handoff.md` | first, always — where things stand and what to start the database with |
| `docs/todo.md` | next — the few things that come next, in order |
| `docs/plans/roadmap.md` | to see which phase that sits in, and its **Done when** |
| `docs/guides/architecture.md` | **before writing code** — where a file goes, what may import what |
| `docs/guides/ui-patterns.md` | **before writing UI** — forms, dialogs, tables, errors |
| `docs/guides/local-development.md` | the database and scripts |
| `docs/plans/hotel-pms.md` | only for "what is this meant to be" — domain and decisions, no sequencing |
| `docs/history.md` | only for "why is it like this" — append-only, never edited |

The guides are binding: if one disagrees with the code, the guide is wrong and
gets fixed. Files prefixed `v1_` are recovered history, not plans.

## Comments

Short. One or two lines saying *why*. Do not narrate the code or restate the
signature. Several files here over-explain; do not add to it.

## Traps

- **`toast.error(e.message)`** — never. `authClient` *returns* `{ data, error }`
  instead of throwing, so a wrong password reads as success. Use
  `handleFormError(form, e)` or `handleError(e)` from `lib/errors.ts`.
- **A schema `.default()` with `useForm` `defaultValues`** — the schema wins and
  the field silently resets. Strip the default when deriving a form schema.
- **`server/auth.ts` and anything it reaches** — relative imports only, no `@/`
  aliases. `auth:generate` loads it through jiti, which ignores tsconfig `paths`.
- **`process.env`** — only `env.mjs` reads it, plus `next.config.ts` and
  `getBaseUrl()` in `server/provider.tsx`, which both say why.
- **`form.setError("root")` with nothing rendering it** — a dialog without
  `<FormError />` fails silently.
- **`styles/globals.css` is shadcn's.** The CLI rewrites it; ours goes in
  `styles/` beside it.

## Before finishing

Everything in `package.json` passes. Two that are easy to skip: `test:server`
when a router or the schema changed, and `build` when routing or config did.

A phase also ends with a pass over what it created — `roadmap.md` § How a phase
ends. Measure, change one thing, measure again.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
