# Local development

## Running

```bash
npm run dev      # next dev --turbopack
npm run build    # next build --turbopack
npm run lint
npx tsc --noEmit # type check on its own
npm run format   # prettier --write .
npm test         # node:test through tsx over src/**/*.test.ts
```

`src/env.mjs` validates every environment variable at startup, so `next build`
fails at "Collecting page data" — *after* a successful compile — when one is
missing or empty. A build that says `✓ Compiled successfully` and then errors
is almost always an env problem, not a code problem.

Copy `.env.example` to `.env`. Only three variables are required:
`DATABASE_URL`, `BETTER_AUTH_SECRET` (generate one with `npx auth@latest
secret`) and `BETTER_AUTH_URL`. The OAuth pairs are optional.

## Authentication

Better Auth runs in-process. There is no dashboard, no tunnel and no webhook —
`src/server/auth.ts` is the entire configuration, and
`src/app/api/auth/[...all]/route.ts` serves every `/api/auth/*` route.

```bash
npm run auth:generate   # rewrite prisma/schema/identity.prisma from auth.ts
npm run db:migrate      # then migrate
```

`prisma/schema/identity.prisma` is **generated**. Change `src/server/auth.ts`
and regenerate; editing the `.prisma` file by hand means the next generate
silently reverts it.

Two constraints on `src/server/auth.ts` that are easy to trip over:

- **It uses relative imports, never `@/` and never a feature barrel.**
  `auth:generate` loads the file with jiti, which does not read tsconfig
  `paths`. The rule is transitive: anything the file reaches must obey it too,
  which is why it imports `../features/identity/model/user` directly rather
  than through `@/features/identity`.
- **`auth:generate` runs with `SKIP_ENV_VALIDATION=1`,** so it works on a clone
  with no `.env` at all.

`auth:generate` warns that the `memberships` column on `User` "rejects every
insert Better Auth makes". **It is a false positive.** `memberships` is a
Prisma relation list (`OrganizationMember[]`), not a column — `PRAGMA
table_info(users)` shows no such field, and the seed's `signUpEmail` calls
succeed. The CLI reads a required relation array as a required column. Do not
"fix" it by making the relation optional.

A social provider is registered only when **both halves of its pair** are set.
An unconfigured provider is absent from the runtime config rather than present
with a blank `clientId` — which is why there is no "missing clientId" warning
and no dead button. `configuredSocialProviders` is derived from that same
object and is what the sign-in and sign-up pages pass to `<OAuthButtons />`,
so the UI cannot advertise a provider the server did not register.

## Database

SQLite, so there is no service to run — the whole database is `dev.db`,
and deleting it is a valid reset.

```bash
npm run db:migrate   # prisma migrate dev — create and apply a migration
npm run db:push      # push the schema with no migration (prototyping only)
npm run db:generate  # regenerate the client after a schema change
npm run db:seed      # demo users + one organization
npm run db:studio    # browse the data
npx prisma migrate status
npx prisma migrate reset   # drop, re-migrate, and reseed
```

The schema is split by domain across `prisma/schema/*.prisma`; Prisma
concatenates them, so a relation may cross files freely. The split is for
readers, not the engine.

`migrate dev` regenerates the client, but not always in time for a type check
in the same breath — if `tsc` cannot find `organizationMember` on
`PrismaClient` right after a migration, run `npm run db:generate` and try again.

### The seed

`prisma/seed.ts` creates three users — `admin@konak.dev`, `mod@konak.dev`,
`user@konak.dev`, all with the password `password123` — and one organization
with two members. `prisma.config.ts` wires it into `migrations.seed`, so
`prisma migrate reset` reseeds automatically.

**It never inserts users with Prisma directly.** A row written straight into
`users` has no `accounts` row and therefore no password hash: the account
exists and can never sign in. The seed goes through `auth.api.signUpEmail`,
which writes both tables and applies Better Auth's `scrypt` hashing. `role` is
then set through Prisma, because `input: false` means it cannot arrive through
sign-up.

Re-running is a no-op: existing users are skipped and the organization is
upserted. The script refuses to run when `NODE_ENV=production` — the shared
password is a development convenience only.

### SQLite has no enums

`provider = "sqlite"` cannot express a Prisma `enum`. `User.role` and
`OrganizationMember.role` are therefore `String` columns, and the allowed
values live in the feature's `model/` as a const object plus a zod schema. The
database will accept any string; the schema is what stops one getting in.

### User ids are strings

Better Auth generates `User.id`, and it is a string — not an integer, and not a
uuid. Never validate one with `z.uuid()`. Organizations still key on
autoincrementing integers; only the user side is string-keyed, so a
`userId`/`organizationId` pair mixes the two.

### Moving to Postgres

Three edits, plus a fresh migration:

1. `prisma/schema/_base.prisma` — `provider = "postgresql"`.
2. `src/server/db.ts` — `@prisma/adapter-pg` (`PrismaPg`) instead of
   `@prisma/adapter-better-sqlite3`.
3. `src/server/auth.ts` — the `provider` passed to `prismaAdapter`. It is a
   separate string from the schema's and will not follow it.

Then the string role columns can become real enums, and `mode: "insensitive"`
becomes available on the `contains` filters in the routers (SQLite ignores it,
which is why it is absent here).

## Running scripts that import feature code

Every file under `features/*/server/` starts with `import "server-only"`. That
package resolves to a module whose only job is to throw — which is exactly what
stops server code reaching the browser, and exactly what makes a standalone
script fail on line one.

The escape is Node's `react-server` export condition, which swaps `server-only`
for an empty module:

```bash
npx tsx --conditions=react-server script.mts
```

**This works, conditionally.** The flag also swaps React for its server build,
so a script dies the moment anything reachable from `src/server/trpc.ts` calls
`React.createContext` — an auth or analytics SDK that imports `next/navigation`
is the usual way that happens. Nothing in the current graph does. If a script
starts failing with `_react.default.createContext is not a function`, a new
server-side dependency is what changed, not your script.

Write scripts as `.mts` — top-level `await` is not available in the `.ts` (CJS)
transform — and start them with `import "dotenv/config"`, because `env.mjs`
reads `process.env` and nothing has populated it in a bare `tsx` process.

`prisma/seed.ts` needs none of this. It reaches only `src/server/*` and
`features/*/model/`, neither of which carries `server-only`, so it runs under
plain `tsx`. Keep it that way: one import from `features/*/server/` would put
the condition flag back in `package.json`.

Any script that changes data should take a `--commit` flag and be a dry run
without it. Run the dry run first and read what it says it will do.

### Exercising a router without a browser

`createCallerFactory` calls procedures directly, with a context you supply — so
the real guards, the real Zod parsing and the real database run, with no
session and no HTTP:

```ts
const callerFor = createCallerFactory(organizationRouter);
const asAlice = callerFor({
  db,
  session: {
    user: { id: alice.id, email: alice.email, name: alice.name, role: alice.role },
    session: { id: "script", expiresAt: new Date(Date.now() + 60_000) },
  },
} as never);

await asAlice.create({ name: "Acme Inc.", slug: "acme" });
```

The context is Better Auth's shape — `session.user` *and* `session.session`,
not a bare `userId`. `requireUser` re-reads the row from `session.user.id`, so
a hand-built context only needs an id that actually exists.

This is the cheapest way to check an access rule. Assert on the failures as
well as the successes — that a MEMBER *cannot* add a member is the half worth
testing.

## Backups

`dev.db` is one file: copy it. Do it before any migration that drops a
column or a table.

**Write the copy outside the repo.** `.gitignore` covers `dev.db` and `prisma/*.db`, but a
dump moved somewhere else is one `git add -f` away from being committed, and it
contains every user row.
