# CLAUDE.md

`docs/guides/` is binding — read the relevant guide before writing code.
[architecture](docs/guides/architecture.md) for where a file goes,
[ui-patterns](docs/guides/ui-patterns.md) for forms, dialogs, tables and
errors, [local-development](docs/guides/local-development.md) for scripts and
the database.

Below is only what bites silently. Everything else is in the guides.

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
  aliases. `npm run auth:generate` loads it through jiti, which ignores
  tsconfig `paths`.
- **`process.env`** — only `env.mjs` reads it, plus `next.config.ts` and
  `getBaseUrl()` in `server/provider.tsx`, which both say why.
- **`form.setError("root")` with nothing rendering it** — a dialog without
  `<FormError />` fails silently.

## Before finishing

`npm run lint && npm test && npx tsc --noEmit && npm run format:check`,
and `npm run test:server` when a router or the schema changed, plus
`npm run build` when routing or config changed.
