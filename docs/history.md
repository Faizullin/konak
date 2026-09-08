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
