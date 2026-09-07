# konak

A Next.js starter with **Clerk** for authentication, **Prisma on SQLite** for
data, and **tRPC** for the typed API — carrying the feature-per-domain layout
from `web_backend` without any of its domain code.

## Getting started

```bash
npm install
cp .env.example .env       # fill in the Clerk keys
npx prisma migrate dev     # creates dev.db
npm run dev
```

`src/env.mjs` validates every variable at startup, so a missing one fails the
build rather than surfacing as `undefined` at runtime.

### Clerk

1. Create an application at [dashboard.clerk.com](https://dashboard.clerk.com)
   and copy the publishable and secret keys into `.env`.
2. Start a tunnel, because Clerk cannot reach `localhost`:

   ```bash
   npm run tunnel
   ```

3. Add a webhook endpoint pointing at
   `https://konak-tunnel-web.loca.lt/api/webhooks/clerk`,
   subscribed to `user.created`, `user.updated`, `user.deleted` and
   `session.created`. Copy its signing secret into
   `CLERK_WEBHOOK_SIGNING_SECRET`.

Until the webhook fires there is no `UserAccount` row, and
`user.getCurrent` answers `NOT_FOUND`. `session.created` is the safety net: it
recreates a row for anyone who signed up while the endpoint was unreachable.

### Database

SQLite, so there is no service to run — the whole database is `dev.db`.

```bash
npm run db:migrate   # create + apply a migration
npm run db:push      # push the schema without a migration (prototyping)
npm run db:studio    # browse the data
```

Swapping to Postgres later is two edits: `provider` in
`prisma/schema/_base.prisma`, and the adapter in `src/server/db.ts`
(`@prisma/adapter-pg` instead of `@prisma/adapter-better-sqlite3`).

## Documentation

- **[docs/guides/architecture.md](docs/guides/architecture.md)** — the one rule
  the tree follows, the three entry points, and where access control lives.
  Read it first.
- **[docs/guides/ui-patterns.md](docs/guides/ui-patterns.md)** — forms, lists,
  the three kinds of dialog, comboboxes, the sidebar.
- **[docs/guides/local-development.md](docs/guides/local-development.md)** —
  running it, the database, webhooks, and how to run a script that imports
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
prisma/         schema split by domain, migrations
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
component with the wrong filename.

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
├── model/    UserRole, zod schemas — isomorphic
├── server/   router.ts (tRPC procedures), service.ts (the Clerk → db upsert)
├── client/   current-user-card.tsx, user-menu.tsx
└── index.ts  re-exports model/ ONLY
```

Clerk owns the credential; `UserAccount` mirrors just enough of the user
(`uid` is the Clerk subject) for our own tables to join against. The webhook
route is the only writer.

SQLite has no enum type, so `role` is a string column and `UserRole` lives in
`model/` instead — one definition the server validates against and the client
renders from.

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

## Auth

Access is checked **at the resource**, not by path:

- `src/middleware.ts` runs `clerkMiddleware()` only — it hydrates the session
  so `auth()` works, and decides nothing. (Clerk deprecated
  `createRouteMatcher` because a matcher's idea of the URL space drifts from
  Next.js's, and the gap is a reachable protected resource.)
- `app/dashboard/layout.tsx` redirects an anonymous visitor to `/sign-in`.
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
