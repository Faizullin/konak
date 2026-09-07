# Architecture

One rule generates the whole tree:

> **A feature owns one domain end to end. A layer directory owns something no
> feature could own alone.**

Two tests decide where any file goes:

1. *Would two features ever own this together?* → it is shared
   (`components/ui`, `hooks/`, `src/server/`).
2. *Could it be swapped for another vendor without changing a business rule?*
   → it is infrastructure (`src/lib`). If it knows our models or our rules, it
   is a feature.

The second test is what keeps `lib/` nearly empty here. `lib/utils.ts` (the
`cn` class merger) passes it, and so does `lib/auth-client.ts` — it is the
browser half of an auth vendor and knows none of our rules. A hypothetical
`lib/org-invite-mailer.ts` would not: it would know our roles and our wording,
so it belongs to `features/organizations`.

## The tree

```
src/
├── app/          ROUTING ONLY — page, layout, loading, error, not-found
│   └── api/      route handlers (tRPC transport, Better Auth catch-all)
├── features/     THE DOMAIN — vertical slices, each complete
│   └── <name>/
│       ├── server/   router, services, db access        ("server-only")
│       ├── client/   "use client" components and hooks
│       ├── model/    zod schemas, types, constants — isomorphic
│       └── index.ts  re-exports model/ ONLY
├── server/       FRAMEWORK — trpc, root, db, auth, provider
├── components/   SHARED UI — ui (shadcn), common (ours), data-table, layout (the shell)
├── config/       nav-items.ts — the sidebar, as data
├── hooks/        generic hooks only
├── lib/          REPLACEABLE ADAPTERS
├── store/        client providers (nice-modal)
└── utils/ generated/
```

Two features ship in the template: `identity` (who the caller is) and
`organizations` (the container the rest of the domain hangs off).
`organizations` is the worked example — it exercises every layer, and a third
feature should look like it.

## The three entry points

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
build** instead of shipping the database client to the browser. (The same guard
is what makes standalone scripts awkward — see
[local-development.md](local-development.md).)

`src/server/*` is the framework layer and deliberately takes **no**
`server-only`. That is what lets `prisma/seed.ts` import `src/server/auth.ts`
under plain `tsx`, and it weakens nothing: those modules are only ever reached
from other server code.

A feature with nothing genuinely shared has no `model/` and no root barrel. That
is deliberate: an empty barrel asserts a sharing that does not exist.

**Client components live in `client/components/` behind a `client/index.ts`.**
Both features do this, so a page imports `@/features/organizations/client` and
never a file path inside it — which is what lets a component be renamed or
split without touching the routes that render it.

### What goes in `model/`

Anything both sides need to agree on. In practice that is three things:

- **Zod input schemas.** `createOrganizationSchema` is validated by the router
  *and* drives the create form's resolver. Written twice they drift — the form
  enforces the slug format while the router accepts any non-empty string, and
  a caller reaching tRPC directly creates a slug the UI would never produce.
  `signInSchema` and `signUpSchema` are the same relationship with Better Auth
  instead of a router: the server re-validates, and the schema exists so the
  form cannot accept a password the server will reject.
- **Enums.** SQLite has no enum type, so `UserRole` and `OrgRole` are string
  columns and the values live in `model/`. One definition the server validates
  against and the client renders from.
- **Permission predicates.** `canManageMembers(role)` is called by the router
  to decide and by the UI to hide a button. Same rule, one function.

## `app/` holds routing and nothing else

A file under `app/` is one of five Next.js primitives: `page`, `layout`,
`loading`, `error`, `not-found`. A `page.tsx` reads params, fetches what
routing needs, and renders feature components. If it has state, effects or
queries, it is a feature component with the wrong filename.

That is why the organization pages are three-line files that render
`OrganizationOverview`, `OrganizationMembersPanel` and
`OrganizationSettingsPanel` from
`features/organizations/client/components/organization-panels.tsx`. The panels
hold the queries; the routes hold the params.

`sign-in/page.tsx` and `sign-up/page.tsx` are the same shape. They resolve two
things routing owns — is there already a session, and which OAuth providers are
configured — and hand off to `<SignInForm />` / `<SignUpForm />`. Neither page
has `"use client"`, `useState` or `useForm`; all of that is in the feature.

There are no `_components/` directories. Feature UI lives in the feature.

## Access control

Access is checked **at the resource**, never by path matching.

There is no `src/middleware.ts`, and its absence is the design. A middleware
matcher has its own idea of the URL space, that idea drifts from Next.js's, and
the gap is a reachable protected resource. A layout cannot drift: it runs on
the server for every route beneath it, because it *is* beneath-ness.

- `app/dashboard/layout.tsx` calls `auth.api.getSession` and redirects an
  anonymous visitor. Every page beneath it inherits that guard by being beneath
  it. It is also the app's single session read — the result goes to
  `<AppSidebar />` as props, so nothing below refetches the current user.
- `protectedProcedure` and `adminProcedure` in `src/server/trpc.ts` guard the
  API. A procedure picks its guard explicitly; there is no ambient default.

Inside a feature, the guards compose. `@/server/auth` exports `requireUser`,
`requireOrgMember`, `requireOrgManager` and `requireOrgOwner` so a procedure
**states what it needs** instead of re-querying the same two rows with slightly
different error strings:

```ts
const { user, role } = await requireOrgManager(ctx, input.organizationId);
```

A non-member gets `FORBIDDEN` rather than `NOT_FOUND` on purpose: the two are
indistinguishable to someone probing ids, and FORBIDDEN is the honest answer to
the case that actually matters — you are signed in, and this is not yours.

The UI hides controls using the `model/` predicates. That is a courtesy, never
the enforcement. The server re-checks every one.

## Identity is owned, not mirrored

Better Auth writes our own `users` table through the Prisma adapter. There is
no mirror, no external subject id, and no sync step — `User.id` *is* the
identity, and every other table foreign-keys straight to it.

That removes a class of bug rather than solving it: there is no window in which
a credential exists and its row does not, because sign-up writes `users` and
`accounts` in one transaction. `user.getCurrent` cannot answer `NOT_FOUND` for
a freshly signed-up person.

`User.id` is a Better Auth string, not an integer and not a uuid. Never
validate one with `z.uuid()`. Organizations still key on integers; only the
user side is string-keyed.

Two fields are ours rather than Better Auth's, declared in
`user.additionalFields` in `src/server/auth.ts`:

- **`role`** carries `input: false`. That is the whole defence against a caller
  POSTing themselves to `ADMIN` at sign-up — the field is refused on the way
  in, and only `adminProcedure` (and the seed) write it through Prisma.

Because the schema is generated from that config, `prisma/schema/identity.prisma`
is **not hand-edited**. Change `src/server/auth.ts`, run `npm run auth:generate`,
then migrate. Editing the `.prisma` file directly means the next generate
silently reverts it.
