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

## 2026-09-09 — Phase 2, the domain speaks

Routers for `reservations`, `rates` and `platform`, whose `model/` layers were
tested and uncalled. Availability is derived per night from inventory minus
blocks, confirmed stays and live holds — never a stored flag, because a cached
count drifts the first time a channel cancels quietly and a wrong count is an
overbooking.

Booking is priced by `quoteStay`, so `totalMinor` stopped being zero. A rate
that refuses — closed, minimum stay, no price for a night — refuses the booking
with the reason on the field. References come from `NumberSeries`, consumed
inside the transaction that uses them.

Holds landed with the rest: a database constraint refuses the second *writer*,
a hold stops the second guest reaching payment, and `releaseAt` gives the room
back with no job to run. Re-using a key extends the hold rather than taking a
second room.

Attachment storage keys are generated server-side and never accepted from a
caller — the only way "random, not derived from an id" can actually be
guaranteed.

**Learned:** three test failures, and only one was a bug in the code. One was a
fixture typo the foreign key caught; one was a test that could never reach the
exclusion constraint because availability refused first, on nights earlier
tests had spent; one was `onDelete: Restrict` between rooms and room types
blocking a cascade, which is the schema working. The real bug was mine: the
module guard sat *before* the membership check, so an outsider probing another
tenant learned which modules it runs.

46 integration tests, 78 unit.

## 2026-09-09 — the Phase 2 optimisation gate

The pass over what Phase 2 created, measured rather than guessed.

**`setRates` over a 90-day season was 91 queries** — one upsert per day inside
a transaction. Replacing the range in two statements makes it 3, verified on
the shipped path with 90 rows written. `setRestrictions` had the same shape and
the same fix. Deleting exactly the range being written makes it identical in
effect to the upserts it replaces.

**`organizationBySlug` ran three times per navigation** — `generateMetadata`,
the layout and the page. React's `cache()` makes it one, confirmed by counting
queries across three concurrent calls before relying on it.

That required settling a rule rather than working around it. The entry-point
table said `features/*/server` may never import React, which is broader than
its reason: the rule exists to keep components and hooks out of server code,
and `cache()` is per-request memoisation, neither of those. The table now says
"React components or hooks", and names `cache()` as the exception.

**Client:** all four `useMemo` uses are load-bearing — two are tRPC query keys,
one is react-table's column identity, one feeds the others' dependencies.
There is no `useCallback` anywhere, and adding one would be overhead with
nothing measured behind it. Bundles unchanged; the phase added no client code
beyond the directory dialog.

**Indexes** already covered every new query shape: availability reads room
types, stays and holds through composite indexes that lead with the id, and the
rate calendar through its unique key.

## 2026-09-09 — where styles live

`src/styles/` now holds everything of ours, imported after shadcn's
`app/globals.css` so it wins on equal specificity. That file is left exactly as
the CLI writes it — `shadcn add` rewrites it, so anything of ours placed there
was always going to be lost.

The entry is `.scss`, so variables, nesting and mixins are available the day a
screen needs them rather than being a build change at that moment. Sass was
tested against the Tailwind entry before being adopted, not assumed to work.

Deliberately not a design phase. The product keeps shadcn's default admin
dashboard; density, colour-as-data, keyboard rules and motion are the last
phase, where they cost least to change.

**Learned:** the first check said the vendored-style overrides had been dropped
by the sass pass. They had not — the emitted CSS is minified onto one line, so
`grep -c` counted lines rather than occurrences. Counted properly the output is
identical to the CSS entry: fourteen `data-orientation=` selectors and no stale
`[data-horizontal]`. A measurement that disagrees with expectation is worth
re-measuring before acting on.

## 2026-09-09 — the front desk, and the read model that is not needed

Phase 4 opened with three read axes no router exposed — which hotels an
organization runs, what a guest can book at one, which rooms exist — so
`properties` became a feature. No pagination anywhere in it: these are axes, not
tables, and the `{ items, total }` contract belongs to `DataTable`, which
answers a different question. Rooms come back in the corridor's order, because
room numbers are strings and Postgres puts 10 before 2; `compareRoomNumbers` is
a pure function, applied in the router and tested without a database.

`requirePropertyMember` had been written twice, in `reservations` and `rates`,
each typed by an inline `ctx` shape. A third caller is the threshold, so it
moved into `properties/server/service.ts`. The `rates` copy was called
`requirePropertyManager` and only ever checked membership: renamed to what it
does rather than changed to what it says, because whether pricing a season needs
a manager is a roles decision and a rename is not where to make it.

**The grid's geometry is pure and lives in `model/`.** A span drawn one column
off shows a sold room as free, and that should not need a browser to catch.
`spanInWindow` clips a stay and says which edge is not real, so a clipped edge
does not become a resize handle. `assignLanes` stacks what overlaps: confirmed
stays in one room cannot overlap — the exclusion constraint refuses it — but an
enquiry holds nothing and is not constrained, and the unassigned band for a type
overlaps constantly. `GRID_HIDDEN_STATUSES` is both what the screen hides and
the `where` the query filters by, so the two cannot drift.

**Measured before deciding.** 60 rooms, 4 types, 31 nights, 846 stays at 85%
occupancy: **44 ms warm, 128 ms cold, 310 kB of JSON and 23.7 kB gzipped**, in
seven queries whose count does not move with the number of rooms. So the
denormalised read model Phase 4 reserved a decision for is **not built** — it
would buy tens of milliseconds and cost a table that can drift from the stays it
summarises, which is the failure `RoomTypeInventory` already refuses to make for
`soldRooms`. Virtualisation is not built either: 1,860 cells is not a windowing
problem, and the payload is smaller than the JavaScript that draws it.

**The front desk is a module, `FRONT_DESK`, off by default.** The registry
already decides the sidebar entry, the URL segment, the roles and the off
switch from one declaration, and a hotel PMS whose main screen is irrelevant to
a tenant using only the directory is exactly the split `DIRECTORY` was built
for. The alternative — always on — is an afternoon to migrate away from later,
which is why this was worth deciding rather than defaulting.

Archived room types come back marked rather than filtered out: archiving a type
does not cancel the stays already sold on it, and a type the grid cannot name is
a booking it cannot draw. They carry `archivedAt` and have no availability row.

Bundles: the grid route is **404 kB** against 492 kB for the `DataTable` routes,
which is the cost of not using that stack. Shared JS is unchanged at 243 kB —
the +1 kB against the recorded floor is CSS for the grid's utilities, not
JavaScript.

**Learned:** the benchmark's own calendar walk used `%` on a negative day
offset, went backwards forever and took Node to a 2 GB heap — after the fixture
had already written its property, rooms and inventory. The cleanup pass that
followed found and removed them. A throwaway script writes to the same database
as the suite, and it needs the same `after` block.

94 unit tests, 65 integration.

## 2026-09-09 — checking in, and what the desk refuses

`setStatus` had been written since Phase 2 and no screen called it. Wiring it up
turned out to be less about the button than about what a check-in actually
requires, none of which the status machine knows.

**A guest checks into a room, not into a room type.** An unassigned stay is the
ordinary state of a future booking, so the machine cannot refuse it in general —
but at the moment of check-in the room is the thing being handed over, and a
booking checked in to nothing is a guest the housekeeping board cannot see.
`refuseStatusChange` refuses it, and the grid renders the sentence on the
disabled button: the screen teaching what to do next, which hiding the button
would not.

**A booking that has not arrived is wrong dates, not an early arrival.** Checking
in tomorrow's booking today means the guest sleeps tonight, and that is a date
change with a re-quote behind it. The same rule refuses a no-show before the
day, because a guest cannot fail to turn up before they were due. A no-show
recorded late is allowed and a check-in after the last night is not — one is
paperwork catching up, the other has no night left to check into.

**The rule returns the sentence, not a boolean.** One string serves the disabled
button and the server's refusal, so the two cannot say different things about
the same booking. It lives in `model/`, which is why the three rules are proved
by unit tests and not by a browser.

**Today is the property's day.** At 01:00 an arrival is still yesterday's in
Auckland and tomorrow's in Los Angeles, and "has this arrived" is unanswerable
without saying whose day. `todayAt` reads `Property.timezone`; an unrecognised
zone falls back to UTC rather than throwing, because a typo in one property's
column must not take a front desk down.

The rules apply to **every** caller of `setStatus`, not to the grid alone. That
changed an existing integration test, which had been checking a 2027 booking in
from an unassigned stay — legal before, and not something a desk can do.

**The actions are a selection bar, not a menu on the chip.** A dropdown on a
draggable element opens on every drag, and the refusals need more room than a
menu row. Clicking a booking selects it; the bar offers the legal transitions,
disables the refused ones with their reason, and puts cancel and no-show behind
`confirm()`.

**Measured: `confirm()`'s second caller costs 1 kB everywhere.** Shared JS went
243 → 244 kB and every route grew 1–2 kB, including `/sign-in`, which shares
nothing with the front desk. Removing just the `confirm()` call and rebuilding
put all three numbers back exactly, so the cause is the alert dialog being
promoted out of the organizations chunk into the common one now that two route
families import it. Kept: the alternative is a second confirmation dialog, and
that is the cost of having one.

101 unit tests, 67 integration.
