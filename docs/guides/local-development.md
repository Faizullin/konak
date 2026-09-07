# Local development

## Running

```bash
npm run dev      # next dev --turbopack
npm run tunnel   # public URL for Clerk webhooks — see below
npm run build    # next build --turbopack
npm run lint
npx tsc --noEmit # type check on its own
npm run format   # prettier --write .
```

`src/env.mjs` validates every environment variable at startup, so `next build`
fails at "Collecting page data" — *after* a successful compile — when one is
missing or empty. A build that says `✓ Compiled successfully` and then errors
is almost always an env problem, not a code problem.

Copy `.env.example` to `.env` and fill in the Clerk keys. There are no other
required variables.

## Database

SQLite, so there is no service to run — the whole database is `dev.db`,
and deleting it is a valid reset.

```bash
npm run db:migrate   # prisma migrate dev — create and apply a migration
npm run db:push      # push the schema with no migration (prototyping only)
npm run db:generate  # regenerate the client after a schema change
npm run db:studio    # browse the data
npx prisma migrate status
```

The schema is split by domain across `prisma/schema/*.prisma`; Prisma
concatenates them, so a relation may cross files freely. The split is for
readers, not the engine.

`migrate dev` regenerates the client, but not always in time for a type check
in the same breath — if `tsc` cannot find `organizationMember` on
`PrismaClient` right after a migration, run `npm run db:generate` and try again.

### SQLite has no enums

`provider = "sqlite"` cannot express a Prisma `enum`. `UserAccount.role` and
`OrganizationMember.role` are therefore `String` columns, and the allowed
values live in the feature's `model/` as a const object plus a zod schema. The
database will accept any string; the schema is what stops one getting in.

### Moving to Postgres

Two edits, plus a fresh migration:

1. `prisma/schema/_base.prisma` — `provider = "postgresql"`.
2. `src/server/db.ts` — `@prisma/adapter-pg` (`PrismaPg`) instead of
   `@prisma/adapter-better-sqlite3`.

Then the string role columns can become real enums, and `mode: "insensitive"`
becomes available on the `contains` filters in the routers (SQLite ignores it,
which is why it is absent here).

## Receiving webhooks locally

Clerk needs a public URL to reach `/api/webhooks/clerk` — it cannot reach
`localhost`. This project uses [localtunnel](https://theboroer.github.io/localtunnel-www/)
with a fixed subdomain:

```bash
npm run tunnel
# which is: npx localtunnel --subdomain konak-tunnel-web --port 3000
# installed globally (npm i -g localtunnel), the same thing is:
lt --subdomain konak-tunnel-web --port 3000
```

Then point the Clerk webhook endpoint at:

```
https://konak-tunnel-web.loca.lt/api/webhooks/clerk
```

The fixed `--subdomain` is the point: the URL survives a restart, so the Clerk
endpoint is configured once instead of re-pasted every session. It is
first-come-first-served across all localtunnel users, so if the name is taken
`lt` silently hands you a random subdomain — read the URL it prints and check
it is the one above before assuming webhooks are arriving.

Keep `CLERK_WEBHOOK_SIGNING_SECRET` in sync with that endpoint. The route
verifies the signature, so a stale secret fails closed rather than silently
accepting.

Two localtunnel quirks worth knowing:

- The **first request from a browser** shows an interstitial page asking for
  your public IP as a password. Clerk's POSTs are not browsers and go straight
  through, so this only affects opening the URL by hand.
- The tunnel drops on network changes without exiting. If webhooks stop
  arriving, restart `lt` before suspecting the code — Clerk's dashboard shows
  the failed attempts under the endpoint.

Subscribe to `user.created`, `user.updated`, `user.deleted` and
`session.created`. Until one fires there is no `UserAccount` row and
`user.getCurrent` answers `NOT_FOUND`; the dashboard card says so rather than
rendering blank. `session.created` is the safety net that recreates a row for
anyone who signed up while the tunnel was down.

## Running scripts that import feature code

Every file under `features/*/server/` starts with `import "server-only"`. That
package resolves to a module whose only job is to throw — which is exactly what
stops server code reaching the browser, and exactly what makes a standalone
script fail on line one.

The documented escape is Node's `react-server` export condition, which swaps
`server-only` for an empty module:

```bash
npx tsx --conditions=react-server script.mts
```

**That does not work here.** The condition also swaps React for its server
build, and `@clerk/nextjs/server` — reached through `src/server/trpc.ts` —
pulls in `next/navigation`, which calls `React.createContext`. The server build
does not have it, so the script dies a step later with
`_react.default.createContext is not a function`.

Neutralise the one module instead:

```js
// stub-server-only.cjs
const Module = require("node:module");
const load = Module._load;
Module._load = function (request, ...rest) {
  if (request === "server-only") return {};
  return load.call(this, request, ...rest);
};
```

```bash
npx tsx --require ./stub-server-only.cjs script.mts
```

Write scripts as `.mts` — top-level `await` is not available in the `.ts` (CJS)
transform.

Any script that changes data should take a `--commit` flag and be a dry run
without it. Run the dry run first and read what it says it will do.

### Exercising a router without a browser

`createCallerFactory` calls procedures directly, with a context you supply — so
the real guards, the real Zod parsing and the real database run, with no Clerk
session and no HTTP:

```ts
const callerFor = createCallerFactory(organizationRouter);
const asAlice = callerFor({ db, session: { userId: alice.uid } } as never);

await asAlice.create({ name: "Acme Inc.", slug: "acme" });
```

This is the cheapest way to check an access rule. Assert on the failures as
well as the successes — that a MEMBER *cannot* add a member is the half worth
testing.

## Backups

`dev.db` is one file: copy it. Do it before any migration that drops a
column or a table.

**Write the copy outside the repo.** `.gitignore` covers `dev.db` and `prisma/*.db`, but a
dump moved somewhere else is one `git add -f` away from being committed, and it
contains every user row.
