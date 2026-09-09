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

The second test keeps `lib/` nearly empty: `utils.ts`, `auth-client.ts` and
`errors.ts` know no business rules. Anything that knows our roles or our
wording belongs to a feature.

## The tree

```
src/
├── app/          ROUTING ONLY — page, layout, error, not-found
│   ├── (auth)/   /sign-in, /sign-up — the not-signed-in guard + card
│   ├── (app)/    /dashboard/* — the session guard + sidebar shell
│   └── api/      route handlers (tRPC transport, Better Auth catch-all)
├── features/     THE DOMAIN — vertical slices, each complete
│   └── <name>/       identity · organizations · directory
│                      platform · rates · reservations
│       ├── server/   router, services, db access        ("server-only")
│       ├── client/   "use client" components and hooks
│       ├── model/    zod schemas, types, constants — isomorphic
│       └── index.ts  re-exports model/ ONLY
├── server/       FRAMEWORK — trpc, root, db, auth, errors, provider
├── components/   SHARED UI — ui (shadcn), common (ours), data-table, layout (the shell)
├── config/       nav-items.ts — the sidebar, as data
├── hooks/        generic hooks only
├── lib/          REPLACEABLE ADAPTERS
├── styles/       every stylesheet — shadcn's `globals.css`, and ours after it
├── store/        client providers (nice-modal)
└── utils/ generated/
```

`scripts/` sits beside `src/`, not inside it: a `.mts` file run by `tsx` is not
part of the app's module graph, and putting one under `src/` would put it in
`tsc`'s and Next's. `outbox-worker.mts` is the only one today — see
[local-development.md](local-development.md#running-scripts-that-import-feature-code)
for why it needs `--conditions=react-server`.

Six features exist. `identity` (who the caller is) and `organizations` (the
container the rest hangs off) exercise every layer, and `organizations` is the
worked example. `directory` (people and companies) has a `model/` and a
`server/`; `platform`, `rates` and `reservations` are `model/`-only so far —
the rules the database cannot hold, tested without one.

### When a router needs a `service.ts`

**When it owns a multi-step transaction or enforces an invariant** — not at a
line count. `organizations/server/service.ts` exists because creating an
organization writes two tables as one unit and because slug uniqueness is an
invariant. `directory/server/router.ts` is nearly the same size with no
service, and that is correct: it validates, scopes and writes single rows.

The distinction matters most for the routers not yet written. Logic that lands
inside a tRPC procedure cannot be tested without a database, which is exactly
the property that makes `model/` worth having.

## The three entry points

A feature exposes three doors, each single-environment. This is a
**compile-time correctness rule**, not a style preference — Next.js splits the
module graph into server and client, and a barrel that mixes them drags Prisma
and `node:crypto` into the browser.

| Entry | May import | Must never import |
|---|---|---|
| `<feature>/server` | other features' `server/`, `@/server/*`, `node:*`, Prisma, React's `cache()` | any `client/`, React components or hooks |
| `<feature>/client` | other features' `client/`, `model/`, `@/utils/trpc`, `components/*` | any `server/`, Prisma, `node:*` |
| `<feature>` (root) | `model/` only | anything environment-specific |

Enforced, not just documented, in two ways. Every file under
`features/*/server/` starts with `import "server-only"`, so a client component
importing one **fails the build** instead of shipping the database client to the
browser. (The same guard is what makes standalone scripts awkward — see
[local-development.md](local-development.md).)

The other directions are `import/no-restricted-paths` zones in
`eslint.config.mjs`, and `next.config.ts` no longer ignores lint during builds,
so they fail a build too: `model/` may not reach `@/server`, `app/` or any
feature's `server/`/`client/`; a `client/` may not import a `server/`; a feature
may not import a route; and `lib/` and `components/ui` may not import a feature.

Zones are written out per feature rather than globbed — the rule does not
expand a glob in `target`, and a zone that matches nothing reports nothing,
which is worse than no rule at all. **Adding a feature means adding its name to
`FEATURES` in that file**, or it is unguarded.

**`cache()` is the one React import a `server/` file may make.** The rule
exists to keep components and hooks out of server code, and `cache()` is
neither — it is per-request memoisation. `organizationBySlug` uses it because a
single navigation asks three times: `generateMetadata`, the layout and the
page. Measured, that is three queries becoming one.

`src/server/*` is the framework layer and deliberately takes **no**
`server-only`. That is what lets `prisma/seed.ts` import `src/server/auth.ts`
under plain `tsx`, and it weakens nothing: those modules are only ever reached
from other server code.

A feature with nothing genuinely shared has no `model/` and no root barrel. That
is deliberate: an empty barrel asserts a sharing that does not exist.

**Client components live in `client/components/`, imported directly.** There is
no `client/index.ts`, and that is deliberate: a `"use client"` module is a
bundler entry point, so Turbopack cannot tree-shake across it and every
consumer of a barrel receives all of its exports. Measured, removing them took
`/sign-in` from 476 kB to 360 kB and `/dashboard` from 498 kB to 402 kB —
`/sign-in` renders a heading and a form, and was shipping
`@tanstack/react-table`.

The encapsulation a barrel bought is now held by
`import/no-restricted-paths` in `eslint.config.mjs`, which is a better
mechanism for it: a rule that fails the build rather than a convention.

`server/` and `model/` keep their barrels. Server code never reaches a bundle,
and `model/` is small.

### What goes in `model/`

Anything both sides need to agree on. In practice that is three things:

- **Zod input schemas.** `createOrganizationSchema` is validated by the router
  *and* drives the create form's resolver. Written twice they drift — the form
  enforces the slug format while the router accepts any non-empty string, and
  a caller reaching tRPC directly creates a slug the UI would never produce.
  `signInSchema` and `signUpSchema` are the same relationship with Better Auth
  instead of a router: the server re-validates, and the schema exists so the
  form cannot accept a password the server will reject.
- **Enums.** `UserRole`, `OrgRole` and the status columns are `String`, with
  the values in `model/`. Postgres could hold real enums; `model/` is the
  enforcement anyway, is tested, and answers "no" to an unrecognised value
  rather than throwing — see
  [local-development.md](local-development.md).
- **Permissions.** A statement table declares which resources exist and what
  each role may do with them; `canManageMembers(role)` and its siblings are the
  named questions asked of it. The router calls them to decide and the UI calls
  them to hide a button — same rule, one place. See
  [Access control](#access-control).

## `app/` holds routing and nothing else

A file under `app/` is one of five Next.js primitives: `page`, `layout`,
`loading`, `error`, `not-found`. A `page.tsx` reads params, fetches what
routing needs, and renders feature components. If it has state, effects or
queries, it is a feature component with the wrong filename.

That is why the organization pages are near-empty files that render
`OrganizationOverview`, `OrganizationMembersPanel` and
`OrganizationSettingsPanel` from
`features/organizations/client/components/organization-panels.tsx`. The panels
hold the queries; the routes hold the params.

Those routes are keyed by **slug**, not id: `/dashboard/orgs/acme`. The slug is
the half a person can read, type and share, and `organizationSlugSchema`
already guaranteed it was unique and URL-safe.

Each page calls `organizationBySlug(slug)` once and hands the result down as
`OrganizationRouteData` — id, name, slug, description, the shape declared in
`model/` beside the Prisma `select` that produces it. The id is what every
procedure takes; the rest lets the panel draw its heading and
`generateMetadata` fill a title without waiting on a query. Only what a route
cannot know — the caller's role, the member count — is still fetched client
side. Membership stays where it was: checked by the procedures the page calls,
never a second time in the route.

`(auth)/sign-in/page.tsx` and `(auth)/sign-up/page.tsx` are the same shape:
a heading and a form. What they no longer each carry is the guard — *is there
already a session* — and the centred card around it. Both were written twice,
in files that do not import one another, and both now live in
`(auth)/layout.tsx`. Neither page has `"use client"`, `useState` or `useForm`;
all of that is in the feature.

**Route groups mark a layout, never a URL.** `(auth)` and `(app)` add no path
segment — `/sign-in` and `/dashboard` are unchanged — and each exists because
something real differs beneath it: a guard, a shell. Add one when a set of
routes needs its own layout or its own gate, not to file things tidily; a group
that wraps nothing is four invisible levels a reader has to hold. There is one
public page today, so there is no `(public)` group: an empty group asserts a
grouping that does not exist, the same way an empty barrel does.

`/dashboard` stays a real segment rather than folding into `(app)`. It is the
seam a second surface mounts beside — `/portal`, `/admin` — without every new
top-level route risking a collision with a public page.

There are no `_components/` directories. Feature UI lives in the feature.

## Table conventions

Every table obeys these. A review rejects one that does not.

1. **An aggregate root carries the tenant column** — `organizationId`, or
   `propertyId`, which resolves to one. Child rows inherit it through a
   required parent rather than duplicating it: a copied scope can disagree with
   its parent, which is worse than the join it saves.
2. **Integer autoincrement keys.** `User.id` is a Better Auth string, and that
   is the only exception.
3. **`publicId String @unique @default(uuid(7))` on rows that escape the
   building** — quoted to a guest, an OTA or the public widget. `id` joins,
   `publicId` travels. `Property` and `Organization` need none: their `slug` is
   already that. UUIDv7, not v4, so inserts keep index locality.
4. **Audit columns**: `createdAt`, `updatedAt`, `createdById`, `updatedById`,
   passed explicitly from `ctx.session.user.id` — never Prisma middleware.
5. **An append-only `AuditLog` beside them**, whose actor is the *user* id, so
   the trail survives a membership being deleted. "Who read this passport" is a
   question the columns cannot answer.
6. **Archive, never delete**: `archivedAt` nullable, filtered out of every list.
7. **Money is integer minor units** plus a currency code. `Currency.minorUnits`
   turns them back into a number — JPY has 0, and dividing by 100 everywhere is
   right only by accident.
8. **Time is UTC in the column**, with an IANA zone on the property. Dates that
   mean a *day* are stored as UTC midnight of the property-local day.
9. **Enum or lookup table, decided per field.** Code branches on it → a const in
   `model/`. The customer edits the list → a per-tenant table.
10. **Any row a client can create offline carries an idempotency key** —
    `clientEventId` or `idempotencyKey`, unique.
11. **Sequenced legal numbers come from `NumberSeries`**, consumed inside the
    transaction that uses them — never `count() + 1`.
12. **Index every foreign key and every tenant scope**, tenant first.
13. **One Prisma file per domain.** Prisma concatenates `prisma/schema/`, so the
    split is for readers.

### What the database cannot hold

Postgres holds one of these — overlapping stays, as an exclusion constraint.
The rest it cannot express, so they live in `model/` as pure functions with
tests, which is also the only way to test them without a database:

- **Exactly one subject.** Activities, tags and attachments carry one nullable
  foreign key per subject; zero is an orphan and two is ambiguous.
- **No overlapping stays in one room.** Half-open `[checkIn, checkOut)`, so a
  same-day turnover is legal and a shared night is not. The database enforces
  this one too; `model/` is what lets the UI refuse before the round trip.
- **Legal status transitions.** A reservation moves forward or ends; nothing
  returns to an earlier state, because the side effects are not reversible by
  flipping a column back.
- **One property per row.** `RoomStay` names a reservation, a room type, a room
  and a rate plan — all property-scoped, and nothing stops them disagreeing.
- **Unguessable storage keys.** A passport scan at a path built from integers is
  readable by anyone who can count.

## Styles

Two owners, and the split is what keeps `shadcn add` safe to run:

| File | Owner | Rule |
|---|---|---|
| `src/styles/globals.css` | **shadcn** | The CLI writes and rewrites it. Never edit it; `components.json` points here. |
| `src/styles/index.scss` | ours | The only stylesheet `layout.tsx` imports. Pulls in `globals.css` first, then ours. |
| `src/styles/overrides.css` | ours | Fixes to vendored styles — survives both `shadcn add` and `--overwrite`. |

Ours is imported **after** shadcn's, so it wins on equal specificity without
`!important`.

The entry is `.scss` so variables, nesting and mixins are available the day a
screen needs them, rather than being a build change at that moment. That is not
an instruction to write SCSS: plain CSS stays plain CSS, and Tailwind utilities
stay the first choice. Sass is there for the cases utilities genuinely cannot
express.

New files go in `src/styles/` and are imported from `index.scss` in order.
There are no empty placeholders — a file appears when it has something in it.

## Naming

Files are kebab-case and name their main export: `sign-in-form.tsx` exports
`SignInForm`. Rename one and rename the other, or the next person greps for the
wrong half.

A suffix says **which mechanism**, not just which noun, so the filename answers
a question you would otherwise open the file to settle:

| Suffix | Means | Example |
|---|---|---|
| `*NiceDialog` / `*-nice-dialog.tsx` | built with `NiceModal.create`, opened by `NiceModal.show` from anywhere | `confirm-nice-dialog.tsx` |
| `*Form` / `*-form.tsx` | `useForm` + `zodResolver` over a schema from `model/` | `sign-up-form.tsx` |
| `*FormDialog` / `*-form-dialog.tsx` | a form in a dialog whose parent owns `open` — `useDialogControl`, not NiceModal | `person-form-dialog.tsx` |
| `*TableView` / `*-table-view.tsx` | the `@/components/data-table` stack — sortable, filterable, paginated | `users-table-view.tsx` |
| `*Table` / `*-table.tsx` | a plain `@/components/ui/table`, few rows, no toolbar | `member-table.tsx` |

The two table suffixes are a real distinction, not a leftover: reaching for
`DataTable` brings URL state, a toolbar and pagination with it, and the name is
what warns you which one you are about to copy.

Where a component does more than one of these, the mechanism suffix goes last
and the job comes first — `OrganizationFormNiceDialog` is a form, in a
NiceModal dialog. See [ui-patterns.md](ui-patterns.md#dialogs) for the dialog
rules the suffix implies.

## Errors

`src/server/errors.ts` holds the `TRPCError`s thrown from more than one place —
`userNotFound()` and `memberNotFound()` today. Everything else spells its
`{ code, message }` out at the throw, and should: a message with a single
caller reads better next to the condition that raises it than it does behind a
name. Each helper *returns* the error rather than throwing it, so `throw` stays
visible at the call site.

The threshold is the **third caller, not the second**. Two copies are a
coincidence; three are a pattern, and only then does the wrapper pay for its
indirection. Most `TRPCError` sites in the tree have exactly one caller and are
meant to stay literal — the file to grow is the router, not `errors.ts`.

**Every throw needs a message.** Every client mutation handler is
`onError: (e) => toast.error(e.message)`, so the message *is* the UI: a throw
without one ships an empty toast. That applies to the framework guards in
`trpc.ts` as much as to feature routers.

### A refusal is a code, not only a sentence

`DomainError` and its five subclasses — `NotFoundError`, `ForbiddenError`,
`ConflictError`, `InvalidError`, `PreconditionError` — are what a router throws
for a rule the domain refused. Each carries a **code**, an optional field, and
the tRPC status the boundary maps to.

The code is the point. A message is written for a person and will be reworded,
and eventually translated; a code survives that, so a test asserts on it and a
screen branches on it without either depending on prose.

**The mapping happens once**, in `mapDomainErrors` in `trpc.ts`. Every procedure
is built from a base that applies it, so no route can skip it. `errorFormatter`
then copies the code onto `data.domainCode` and the field onto `data.field`, and
`lib/errors.ts` reads both by shape into `AppError`.

**Codes are declared per feature, in `model/`** — `reservations/model/errors.ts`
is the worked example. Not in `errors.ts`: that file is reached by `auth.ts` and
may not import from `features/`, and a code in `model/` is also readable by the
client that has to recognise it.

`fieldError(field, message, code)` marks an error as belonging to one input.
`errorFormatter` in `trpc.ts` copies the name onto `data.field`, and the client
half — `src/lib/errors.ts` — turns it into an error under that field. That is
the only way a rule needing the database ("that slug is taken") can render
where a schema failure would.

`errors.ts` must not import from `features/`. `auth.ts` reaches it, and
`npm run auth:generate` loads `auth.ts` through jiti, which does not read
tsconfig `paths` — see [local-development.md](local-development.md).

## Access control

Access is checked **at the resource**, never by path matching.

There is no `src/middleware.ts`, and its absence is the design. A middleware
matcher has its own idea of the URL space, that idea drifts from Next.js's, and
the gap is a reachable protected resource. A layout cannot drift: it runs on
the server for every route beneath it, because it *is* beneath-ness.

- `app/(app)/dashboard/layout.tsx` calls `auth.api.getSession` and redirects an
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

### Permissions are a table, not a chain of `||`

Roles are never compared directly. `organizations/model/organization.ts`
declares the space of permissions once, then grants each role a subset, using
`createAccessControl` from `better-auth/plugins/access`:

```ts
export const orgStatements = {
  organization: ["update", "delete"],
  member: ["create", "update", "delete", "list"],
} as const;
```

That dependency is taken for the primitive alone — two functions, no tables or
routes. Better Auth's `organization` plugin *does* own storage and is
deliberately unused: adopting it would mean moving onto its six tables to gain
roles we already have.

`as const` is load-bearing. `Statements` wants readonly arrays and
`createAccessControl` is a `const` generic, so widening these to `string[]`
collapses every type beneath them.

Three properties make the table safe to extend:

- **Granting a role something outside the table does not compile.** `newRole`
  intersects `Record<Exclude<keyof TRoleStatements, keyof TStatements>, never>`,
  so a mistyped resource or verb fails `tsc` instead of quietly permitting.
- **An unlisted resource reads as "no".** A role with no `organization` entry is
  denied it. So a resource added to the table is denied to everyone until the
  grants are written — a new capability cannot arrive switched on.
- **Verbs are AND-ed.** `orgCan(role, { organization: ["update", "delete"] })`
  requires both; holding one of the two is not enough.

The last two are pinned by tests; the first is the type system's job.

The `canX` predicates are the vocabulary the app speaks, each one `orgCan`
call. A new domain adds a resource and a grant per role — not a predicate per
verb.

The install-wide scope has its own table of the same shape:
`identity/model/user.ts` declares `userStatements` and grants them per
`UserRole`, with `canListUsers` and `canSetUserRole` as its vocabulary.
`adminProcedure` asks for the whole set at once, so it passes only for a role
holding all of it. A procedure wanting one capability rather than all of them
calls `userCan` directly instead of widening that guard.

Two tables, not one: `UserRole` rides on the session and is free to consult,
`OrgRole` costs a membership lookup. `userCan` takes a plain `string` because
`User.role` is a string column — an unrecognised value reads as "no" instead of
throwing.

## Identity is owned, not mirrored

Better Auth writes our own `users` table through the Prisma adapter. There is
no mirror, no external subject id, and no sync step — `User.id` *is* the
identity, and every other table foreign-keys straight to it.

There is no window in which a credential exists and its row does not — sign-up
writes `users` and `accounts` in one transaction — so `user.getCurrent` cannot
answer `NOT_FOUND` for a freshly signed-up person.

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
