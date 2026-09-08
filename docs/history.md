# History

Append-only, newest last. What shipped, and what it cost to learn. Nothing here
is ever edited — a correction is a new entry.

## 2026-09-08 — error handling, routing, and the template split

`lib/errors.ts` normalises tRPC's throws and Better Auth's returned errors into
one `AppError` and places it: a named field, the form, or a toast. Replaced nine
copies of `toast.error(e.message)`, which was a silent-failure trap — Better
Auth *returns* errors rather than throwing, so a wrong password read as success.

Route groups `(auth)` and `(app)`; organizations keyed by slug rather than row
id. The last-admin guard split into pure predicates in `model/`.

The template was extracted to a public repo and konak became the product.

**Learned:** the seed had never worked on a fresh clone — `haveIBeenPwned()` and
a demo password of `password123` shipped in the same commit, and the seed's
"skip existing users" made every run report success against an already-seeded
database.

## 2026-09-09 — the database

45 models across 13 domain files: directory, properties, platform, inventory,
reservations, rates, billing, housekeeping, channels, compliance, access.
Eight migrations, replayed from empty and seeded.

Decisions worth keeping: a guest books a **room type**, not a room. Availability
is derived, never a stored flag. `Organization` is the tenant and `Property` is
one hotel. A guest is a `Person` with a token, never an account.

**Learned:** Prisma rejects a scalar foreign key beside a nested relation create
— use `connect`. `prisma format` writes missing back-relations except across a
named relation, where it fails with a validation error instead. SQLite has no
`Json` type, so JSON lives in `String`. Prisma 7 stores SQLite `DateTime` as ISO
text, not epoch integers.

**Corrected:** the plan's rule "a tenant column on every row, no exceptions" was
wrong, and the schema next door proved it — aggregate roots carry the tenant,
children inherit through a required parent. A duplicated scope can disagree with
its parent, which is worse than the join it saves.

## 2026-09-09 — Postgres, and the constraint that justified it

Three edits, as `local-development.md` had promised: the schema provider, the
adapter in `server/db.ts`, and the provider passed to `prismaAdapter`. Plus a
`docker/compose/db.yml` holding one Postgres service for development.

The point of the move is one line of SQL:

```sql
EXCLUDE USING gist ("roomId" WITH =, daterange("checkIn"::date, "checkOut"::date, '[)') WITH &&)
  WHERE ("roomId" IS NOT NULL AND "status" IN ('CONFIRMED','CHECKED_IN','CHECKED_OUT'))
```

Verified in both directions. Refused: a second confirmed stay overlapping the
first in room 101. Allowed: a same-day turnover, a cancelled stay over the same
nights, a stay with no room assigned yet, and the same dates in room 102.

**Learned:** the constraint forced a modelling change. A constraint cannot read
another table's column, so `status` is now on `RoomStay` as well as
`Reservation` — which turns out to be the honest model anyway, since one room of
a multi-room booking can be cancelled while the rest stands.

The SQLite migrations were deleted rather than converted; their SQL cannot run
on Postgres, and nothing was deployed.

## 2026-09-09 — tests, and a boundary that was only prose

Three kinds of test, separated by directory rather than filename — verified
against the runner, `src/**/*.test.ts` also matches `foo.int.test.ts`, so a
suffix split would have dragged database tests into the suite that must run
without Docker. Unit tests stay beside their module; `tests/server/` holds the
fifteen integration tests, which belong to no single module.

The seed had twenty empty tables. Six are now filled and thirteen are left
empty on purpose, with the reason written down: faking a hold or a fiscal
receipt makes a screen look finished while the flow that fills it does not
exist.

Boundaries became `import/no-restricted-paths` zones and `ignoreDuringBuilds`
came off, so a violation fails a build. One violation existed already —
`config/nav-items.ts` reached a feature's `model/`, a fourth door.

The client barrels came out. A `"use client"` module is a bundler entry point,
so nothing tree-shakes across it: `/sign-in` was shipping
`@tanstack/react-table` to render a heading and a form. 476 kB to 360 kB;
`/dashboard` 498 to 402.

**Learned:** a lint rule can be decorative. The first zone list used
`./src/features/*/model` as a target, passed lint, and caught nothing —
`import/no-restricted-paths` does not expand a glob in `target`. It was only
found by deliberately committing the violation it was supposed to forbid. Every
zone is now proven to fire that way.

## 2026-09-09 — Phase 1 closed

The database is done: 45 models on Postgres, the overlap invariant held by an
exclusion constraint, five more held by tested pure functions, 70 unit and 15
integration tests, and boundaries that fail a build.

Two earlier plans were recovered from `origin/master` before those commits are
discarded. The booking one was superseded in full. The CRM one had a part that
never shipped and was quietly assumed to exist: `hotel-pms.md` opened by
claiming a module contract — a module declares its own permissions, adds
nothing to the core, can be switched off — and all four claims were false.
`root.ts` composes three routers by hand, three features call
`createAccessControl` separately, and there is no enablement table. It is now
the plan's first item rather than its premise.

**Learned:** a plan can assert its own foundation. This one had done so for
weeks, and only reading a superseded predecessor surfaced it.

Recovered plans are kept with a `v1_` prefix and a header saying what survives.
They are not plans; nothing is worked from them.

## 2026-09-09 — the module contract

An organization can now switch a module off. `ORG_MODULE_REGISTRY` declares
each module once — label, icon, segment, who may see it, whether it is core —
and the nav, the route and the procedure all read that declaration.
`OrganizationModule` holds the toggles, and a row exists only to disagree with
a default, so an empty table means every module behaves as declared. Core
modules have no off switch. `DIRECTORY` is the first non-core module, off by
default, so nothing links to a route that does not exist.

Two of the four changes the old plan proposed were **not** made, and the
reasons are worth keeping. Merging every module's statements into one
`createAccessControl` would make the organizations feature import its modules —
a core feature depending on the things built on it. Composing `root.ts` from
the registry cannot work as described, because routers are `server-only` and
the registry is isomorphic; it would need a second server-side map, one line
per module, replacing one line per module.

**Learned:** the lint boundaries added hours earlier caught their first real
thing — `module` is a reserved variable name in Next, in two files. That is the
class of mistake `ignoreDuringBuilds: true` had been hiding.

`todo.md` and a new `plans/roadmap.md` now separate what the product is from
the order to build it, so the two cannot drift.
