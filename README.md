# konak

A Next.js starter with **Better Auth** for authentication, **Prisma on SQLite**
for data, and **tRPC** for the typed API — carrying the feature-per-domain
layout from `web_backend` without any of its domain code.

## Getting started

```bash
npm install
cp .env.example .env
npx auth@latest secret       # paste into BETTER_AUTH_SECRET
npm run db:migrate           # creates dev.db
npm run db:seed              # demo users + one organization
npm run dev
```

`src/env.mjs` validates every variable at startup, so a missing one fails the
build rather than surfacing as `undefined` at runtime.

### Demo logins

`npm run db:seed` creates three accounts, all with the password
**`password123`**:

| Email | Role |
|---|---|
| `admin@konak.dev` | ADMIN |
| `mod@konak.dev` | MODERATOR |
| `user@konak.dev` | USER |

They exist to make a fresh clone usable in one command. The password is a
development convenience and the script refuses to run with
`NODE_ENV=production`.

Re-running the seed is a no-op — it skips users that already exist and upserts
the organization.

### Authentication

Better Auth runs in-process: no dashboard, no tunnel, no webhook. Every route
under `/api/auth/*` is served by `src/app/api/auth/[...all]/route.ts`, and
`src/server/auth.ts` is the whole configuration.

Email and password work with nothing but `BETTER_AUTH_SECRET` set. OAuth is
optional — a provider is registered **only when both halves of its pair are
present** in `.env`, so an unconfigured provider is absent from the runtime
rather than present and broken, and its button is not rendered:

```
GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET   callback: /api/auth/callback/github
GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET   callback: /api/auth/callback/google
```

After changing anything about the user model in `src/server/auth.ts`, run
`npm run auth:generate` to rewrite `prisma/schema/identity.prisma`, then
`npm run db:migrate`.

### Database

SQLite, so there is no service to run — the whole database is `dev.db`.

```bash
npm run db:migrate   # create + apply a migration
npm run db:push      # push the schema without a migration (prototyping)
npm run db:seed      # demo data
npm run db:studio    # browse the data
```

Swapping to Postgres later is three edits: `provider` in
`prisma/schema/_base.prisma`, the adapter in `src/server/db.ts`
(`@prisma/adapter-pg` instead of `@prisma/adapter-better-sqlite3`), and the
`provider` passed to `prismaAdapter` in `src/server/auth.ts`.

## Documentation

- **[docs/guides/architecture.md](docs/guides/architecture.md)** — the one rule
  the tree follows, the three entry points, and where access control lives.
  Read it first.
- **[docs/guides/ui-patterns.md](docs/guides/ui-patterns.md)** — forms, lists,
  the three kinds of dialog, comboboxes, the sidebar.
- **[docs/guides/local-development.md](docs/guides/local-development.md)** —
  running it, the database, the seed, and how to run a script that imports
  server code.

The rest of this file is the short version.

## Layout

```
src/app/        routing only — pages, layouts, and route handlers
src/features/   the domain, one vertical slice per feature (server / client / model)
src/server/     framework — trpc, prisma, auth, the API layer
src/components/ shared UI — ui (shadcn), common (ours), layout (the shell)
src/config/     nav-items.ts — the sidebar, as data
src/hooks/      generic hooks only
src/lib/        replaceable adapters
src/store/      client-side providers (nice-modal)
prisma/         schema split by domain, migrations, seed
```

One rule generates the tree:

> **A feature owns one domain end to end. A layer directory owns something no
> feature could own alone.**

### The three entry points

A feature exposes three doors, each single-environment. This is a
**compile-time correctness rule**, not a style preference — Next.js splits the
module graph into server and client, and a barrel that mixes them drags Prisma
and `node:crypto` into the browser.

| Entry | May import | Must never import |
|---|---|---|
| `<feature>/server` | other features' `server/`, `@/server/*`, `node:*`, Prisma | any `client/`, React |
| `<feature>/client` | other features' `client/`, `model/`, `@/utils/trpc`, `components/*` | any `server/`, Prisma, `node:*` |
| `<feature>` (root) | `model/` only | anything environment-specific |

Enforced, not just documented: every file under `features/*/server/` starts
with `import "server-only"`, so a client component importing one **fails the
build** instead of shipping the database client to the browser.

`app/` holds routing and nothing else. A `page.tsx` reads params and renders
feature components; if it has state, effects or queries, it is a feature
component with the wrong filename. `sign-in/page.tsx` is the smallest example:
it resolves the session and the configured providers, then renders
`<SignInForm />` from the `identity` feature.

## Shared dialogs

Three things every screen ends up needing, each reached as a **function** so no
component has to hold dialog state:

```ts
// "Are you sure?" — resolves false on cancel or dismiss.
if (!(await confirm({ title: "Delete organization?", destructive: true }))) return;

// "Which one?" — resolves null on dismiss.
const member = await selectOne({ title: "Transfer to", valueKey: "id", renderText, searchFn });
```

Both mount once, under `NiceModal.Provider` in
`components/layout/providers.tsx`. `confirm()` takes an optional `onConfirm`
that is awaited before the dialog closes, so the button spins while the
mutation runs and a failure leaves the dialog up with the error still on
screen — see `organization-danger-zone.tsx` for all three shapes.

| Piece | Where | For |
|---|---|---|
| `confirm()` | `components/common/confirm-dialog.tsx` | destructive actions |
| `selectOne()` | `components/common/select-dialog.tsx` | "pick one of many" |
| `ComboBox` | `components/common/combobox.tsx` | a searchable, paginated select |
| `DataTable` | `components/data-table/` | sortable, filterable, paginated lists |
| `useDialogControl()` | `hooks/use-dialog-control.ts` | a dialog a component owns outright |

`ComboBox` takes a `searchFn(query, offset, size)` rather than an options
array, because the lists worth a combobox are the ones too long to hold in a
`<Select>`. `organization.search` is a procedure written to exactly that
contract; copy its shape for any other paginated picker.

## Features

### `identity`

```
src/features/identity/
├── model/    UserRole, sign-in / sign-up schemas — isomorphic
├── server/   router.ts (tRPC procedures)
├── client/   current-user-card, sign-in-form, sign-up-form, oauth-buttons
└── index.ts  re-exports model/ ONLY
```

Better Auth owns the `User` table outright — there is no mirror table and no
sync step. It writes `users` and `accounts` in one transaction at sign-up, so
a user row and its credential can never disagree.

`role` is ours, added through `user.additionalFields` in `src/server/auth.ts`
with **`input: false`**: that is what stops a caller POSTing themselves to
`ADMIN` at sign-up. Only `adminProcedure` writes it, through Prisma.

SQLite has no enum type, so `role` is a string column and `UserRole` lives in
`model/` instead — one definition the server validates against and the client
renders from. The credential forms take their schemas from the same place, so
the form cannot accept a password the server will reject.

### `organizations`

The container the rest of the domain hangs off, and the worked example of a
full feature slice: two models, membership-scoped procedures, and five client
components.

```
src/features/organizations/
├── model/    OrgRole, permission predicates, zod schemas — isomorphic
├── server/   router.ts (13 procedures), service.ts (create + transfer)
├── client/   table view, switcher, create/edit dialog, member table, danger zone, panels
└── index.ts  re-exports model/ ONLY
```

Three roles, checked in `@/server/auth`:

| | OWNER | ADMIN | MEMBER |
|---|:--:|:--:|:--:|
| See the organization | ✓ | ✓ | ✓ |
| Edit name / slug | ✓ | ✓ | |
| Add, remove, re-role members | ✓ | ✓ | |
| Transfer ownership, delete | ✓ | | |
| Leave | | ✓ | ✓ |

Two invariants the router will not let you break, because either one leaves an
organization no one can administer:

- **The owner cannot leave.** Transfer first, or delete the whole thing.
- **The owner's role is not editable** through `updateMemberRole`.
  `transferOwnership` moves both sides in one transaction, so there is never a
  moment with two owners or none.

`requireOrgMember` / `requireOrgManager` / `requireOrgOwner` resolve *who is
asking* and *what may they do here* in one call. A procedure states what it
needs; it never re-queries membership by hand. The UI hides controls using the
`canManageMembers` / `canEditOrganization` predicates from `model/` — the same
rules, but as a courtesy only. The server re-checks every one.

## The sidebar

The nav is **data**, in `src/config/nav-items.ts`, so one renderer
(`NavMain`) draws every level and gating an item on a role is a field
(`roles`) instead of a conditional buried in markup.

Which level shows is derived from the **route**, never from state — a deep
link renders the right sidebar on first paint and there is nothing to keep in
sync:

```
/dashboard/*                account nav      accountNavItems
/dashboard/orgs/[orgId]/*   organization nav organizationNavItems(id)
```

Adding a third level (a per-feature nav inside an organization) is the same
move: read another route param in `app-sidebar.tsx`, return another
`NavGroup[]`. The frame knows how to *pick* a level; it does not know what any
feature needs.

The open/closed state is read from the `sidebar_state` cookie on the server in
`app/dashboard/layout.tsx`, so the first paint matches what the person left it
as instead of flashing open and snapping shut.

That layout is also the app's single session read: it passes the signed-in
person down to `<AppSidebar />` as props, which is why neither the sidebar
footer nor the role-gated nav items fetch the current user again.

## Auth

Access is checked **at the resource**, not by path. There is no `middleware.ts`
— a layout runs on the server for every route beneath it and cannot be skipped
the way a matcher pattern can:

- `app/dashboard/layout.tsx` calls `auth.api.getSession` and redirects an
  anonymous visitor to `/sign-in`.
- `protectedProcedure` / `adminProcedure` in `src/server/trpc.ts` guard the
  API. Add a page under `dashboard/` and it inherits the layout's guard; add a
  procedure and you pick its guard explicitly.

## Adding a feature

Use `organizations` as the reference — it exercises every layer.

1. `prisma/schema/<name>.prisma` — the models it owns.
2. `src/features/<name>/model/` — zod schemas and types, if any are shared.
3. `src/features/<name>/server/router.ts` — starts with `import "server-only"`.
4. Register it in `src/server/root.ts`. That file is composition and nothing
   else.
5. `src/features/<name>/client/` — `"use client"` components calling
   `trpc.<name>.*`.
