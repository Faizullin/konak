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

## 2026-09-09 — the day the desk runs, and the two things Phase 4 owed

Phase 4's **Done when** was a receptionist running a whole day. The grid drew
the month and the status machine moved a booking, but the day itself did not
exist: no list of who arrives, and nothing in the UI that creates a booking at
all — a walk-in meant SQL.

**Three lists, one query.** A stay touching a date is an arrival, a departure or
a night in between, and `dayRoleOf` in `model/` decides which from two dates. So
`reservation.day` reads the stays that touch the day once and sorts them in
memory rather than asking three times. The bounds are the only place `checkOut`
is inclusive: a departure is not a night, but it is the morning's work.

**Unassigned sorts first.** A stay with no room is the work; buried under fifty
assigned rows it is what gets missed. The rest run in corridor order, which is
`compareRoomNumbers` again rather than a second opinion about how to read "10".

**A walk-in is one transaction, not three writes.** `create` then `assignRoom`
then `setStatus` is three round trips where the second can fail after the first
succeeded, leaving a booking nobody decided to make. `reservation.walkIn` does
all of it or none of it, and the guest record is written inside the same
transaction — an integration test asserts that a refused walk-in leaves no
orphan person behind.

Its status rules are satisfied **by construction rather than re-checked**: the
schema requires a room, and the arrival is `todayAt(property.timezone)`. Those
are exactly the two things `refuseStatusChange` asks of a check-in, so the
walk-in cannot create a state the desk could not have reached by hand.

**The dates are not fields.** A walk-in arrives on the property's own day, which
the server knows and the browser does not, so the form asks how many nights.

**`createGuestPerson` is directory's, not reservations'.** A booking's guest is
a booking artifact, so it is deliberately not `directory.createPerson` — that is
a management action gated on the DIRECTORY module and on `canManagePeople`, and
a hotel running no directory still takes walk-ins. Directory gained the
`server/service.ts` the architecture threshold asked for, and reservations
imports it through the feature's server door.

### The server half of the optimisation gate

The client and data halves had been made; this was the half that had not, and it
had something to find. **The grid was reading the same rows twice** — room types
once to name them and again inside `availability` to count them, and every stay
in the window once to draw and again to count. Same property, same window, two
scans with different projections.

`availability` now takes what the caller already read. The grid is **seven
queries to five**, in the same two waves. Passing a superset is safe and the
type says so: only `occupiesInventory` statuses are counted, and types outside
`roomTypeIds` are never emitted — which is why excluding cancelled stays from
the grid's read cannot change a count.

Indexes were checked and needed nothing: tenant column first on every shape the
phase added.

### Real-time, decided

**Polling, not a subscription.** Two receptionists on one desk go stale in
seconds, and a 30-second `refetchInterval` on the grid and the day lists closes
that without a transport we would have to own — a Next route handler does not
hold a socket, and both surfaces are one bounded query each. A mutation on
either invalidates both, so the two views of the same booking cannot disagree.

Revisit when a channel manager starts writing bookings nobody at the desk made:
that is when 30 seconds stops being fast enough, and it is Phase 7.

**Measured.** `/dashboard/orgs/[orgSlug]/front-desk/[propertySlug]` 410 → 425 kB
for the lists and the dialog it renders. Shared JS unchanged at 244 kB, and no
other route moved — the growth is on the route that draws it.

105 unit tests, 80 integration.

## 2026-09-09 — moving a stay, and Phase 4 closed

A drag moved a booking between rooms and nothing moved it between nights.
`assignRoom` answered "which room"; there was no procedure for "which nights",
so a guest staying an extra night meant SQL.

**One procedure for both, because one drag changes both.** `reservation.moveStay`
takes the new nights and, optionally, a new room. Two calls would let the room
land while the dates were refused, which is a booking in a room nobody chose.

**`refuseStayMove` is the same shape as `refuseStatusChange`** — a sentence, not
a boolean, so a disabled edge and the server's refusal cannot disagree. What it
holds is what the exclusion constraint cannot know:

- **An arrived guest arrived when they arrived.** A checked-in stay moves its
  departure and not its arrival; correcting an arrival is a different decision
  with its own record, the same way an undone status is.
- **A booking is not moved into nights that have gone.** Onto today is fine —
  that is a guest arriving now.
- **Leaving today is not the past.** `checkOut` is exclusive, so departing on
  today's date means last night was the final one: an ordinary early checkout,
  and the rule says so rather than refusing it.

The overlap itself is deliberately *not* checked in `model/`. The exclusion
constraint is the only answer that stays true when two clerks drag at once, and
it surfaces as a sentence on the field rather than a 500.

**Only the added nights are asked about.** Availability counts a stay against
itself, so asking about the whole new range would find the booking already there
and refuse its own move. `addedNights` is the set difference, and it is a pure
function with its own tests.

**A moved stay is re-quoted.** The nights changed, so the price did; the
reservation's total is recomputed from its stays in the same transaction, or the
header would disagree with the folio.

### The drag

**The grabbed night goes under the cursor.** Picking a five-night chip up by its
middle and dropping it must not shift it four days, so `dragstart` records which
night was grabbed and the drop moves by the difference.

**A drop is one of two decisions, and which one is arithmetic.** Landing on the
night the chip already occupied is a room change — `assignRoom`, cheaper. Landing
anywhere else is a date move, room included.

**The column is read from the pointer, not from a per-cell handler.** A chip sits
above the night cells, and dropping onto one still has to say which night it was.

**A clipped edge is not a resize handle.** `model/grid.ts` already distinguished
a drawn edge from a real one for the rounded caps; the handles reuse it. Dragging
an edge the grid cannot see would move a date nobody could read.

The optimistic update recomputes the span with **`spanInWindow`** — the same
function the server laid the grid out with — so an optimistic chip cannot land a
column away from where the refetch puts it. A stay dragged clean out of the month
returns the grid untouched and lets the refetch remove it.

**Measured.** The front desk route 425 → 426 kB. Shared JS unchanged at 244 kB.

Phase 4's **Done when** was already met; this finishes the grid section that sat
beside it. 111 unit tests, 88 integration.

## 2026-09-09 — the second cue, and where Phase 3 went

**There is no Phase 3, and the gap was reading as a finished phase.**
*Phase 3 — Design direction* was folded into Phase 12 in "where styles live";
what was never written down is that `roadmap.md`'s own rule — "phases already
finished are not listed" — made its absence say the opposite. Two readers lost
the same ten minutes to it, so the roadmap now says so in a sentence.

**The deferral's premise had been spent.** Phase 3's whole argument was its
position: *before* the grid, because the grid is the largest piece of UI and the
hardest to rework, and decisions not made in advance get made by accident inside
it. The grid is now built, so that bet was called — and one of the things Phase 3
existed to prevent had happened. `STATUS_CLASS` separated confirmed, checked-in
and checked-out by **hue alone**; only enquiry carried a second cue.

That is an accessibility floor rather than visual polish, so it did not wait for
Phase 12. What waits is the palette; what did not is that there is a second cue
at all.

**Shapes, not letters.** A one-night chip is 2.5rem wide, and `C` against `O` at
that size is a guess. Hollow is a room still waiting, filled is a guest in it, a
tick is a stay that is over — and enquiry and checked-out also differ by border
style. The test is pairwise, not per-state: four states that each look distinct
in a legend can still contain two that differ only by hue.

The mark is `aria-hidden`. The chip's `title` already says the status in words,
and a second announcement of the same fact is noise.

**Dark variants, because front desks run dim.** The palette was fixed light
values while `next-themes` had been installed since the template.

**A legend, because a cue nobody can decode is not a cue.**

The rule is now in `ui-patterns.md` § Colour as data rather than only in the one
file that follows it — a convention enforced in a single screen is broken by the
next one. Phase 12 keeps the palette and loses the floor.

**Measured, because the printed number moved.** `First Load JS shared by all`
read 244 kB and now reads 245. Building with the marks and legend stripped
printed 245 as well, so this change did not cause it: the exact shared bytes are
902,063 against 902,177, and the cues cost **114 bytes**. The kilobyte was
rounding crossing a boundary. Floor re-recorded at 245 kB — which is what the
"re-record when a phase ends" line exists to prevent, one phase late.

## 2026-09-09 — setting a property up without SQL

Room types, rooms and rate plans were seeded and readable and had no screens, so
a new property could only be built with `psql`. It now has one, at
`/front-desk/<propertySlug>/setup`, behind the same module toggle as the desk.

**The rules went in `model/` first, and they are sentences.** `refuseOccupancy`
names the pair that clashes — a base above the maximum would quote a room it
cannot sleep — and `refuseCancellationTerms` refuses a non-refundable plan that
also advertises a free window, which is the kind of contradiction a guest finds
at the worst possible moment. Both are pure and tested without a database, and
both are the same sentence on the field and at the router.

**Two permission tables, and one decision that had been left open.**
`propertyStatements` and `rateStatements` follow `orgStatements`: declared once,
granted per role, asked by name. A MEMBER is a receptionist — they read both
axes all day because the grid is drawn from them, and they add no room type
mid-shift.

The rates router carried a comment saying that whether setting a season's prices
should require a manager was "a decision about roles, not a rename". It is now
decided: `setRates` and `setRestrictions` require `canSetRates`, which withholds
MEMBER. A wrong nightly rate is money, and it reaches every channel the moment
it is written.

**Nothing is archived out from under a booking.** A room type with live rooms is
not withdrawn, it is hidden, so it is refused until the rooms go first. A room
that still owes someone a night is neither archived nor retyped — retyping would
break the pairing `assignRoom` enforces, after the fact rather than at the
assignment. A departed stay blocks nothing.

**Archiving is a value, not a procedure.** `{ archived: boolean }` rather than
`archive` and `unarchive`, because withdrawing something from sale is reversible
and two procedures would drift.

**A code is unique inside its property, not across the install.** Two hotels in
one organization may both sell a "DBL", and a test says so.

### Two things found on the way

**`FieldError` children silently replace `errors`.** A hint written as children
would have swallowed every validation message on that field — exactly the class
of failure `CLAUDE.md` lists. The hint is a `FieldDescription` and the rest of
the tree was checked for the same shape; there was none.

**The integration tests were racing, and adding a sixth file exposed it.**
`identity.test.ts` reads every ADMIN in the database, parks them, and asserts
that the fixture's admin is the last one. Node runs test *files* in parallel, so
a fixture created by another file mid-assertion made that false — it passed
alone and failed in the suite. Integration tests share one database and one of
them edits global state, so `test:server` now runs with `--test-concurrency=1`.
Serial is the honest answer: the alternative is every future fixture having to
know what every other test counts.

**Measured.** The new route is 424 kB; the desk went 426 → 427 kB for the link
to it. Shared JS unchanged at 245 kB.

119 unit tests, 101 integration.

## 2026-09-09 — a worker for the outbox

`OutboxTask` had been the intent since the schema landed and nothing drained it.
It does now — the mechanism only. The first integration is Phase 7's own bullet
and deliberately not here.

**Every *when* decision is in `model/` and proved without waiting.** The backoff
curve doubles from a minute and caps at an hour; five attempts spans about half
an hour, which outlasts a deploy without hiding a real breakage for a day. A
test asserts the curve rather than observing it.

**Attempts are spent on the claim, not on the failure.** A worker killed
mid-handler still costs one — otherwise a task that crashes the process retries
forever and takes every worker with it.

**A lease, because a dead worker holds its row forever.** A RUNNING task whose
`lockedAt` is older than five minutes is claimable again. Without it the queue
loses work quietly rather than retrying it.

**A type with no handler dead-letters immediately.** Retrying cannot make a
handler appear, and waiting an hour to fail the same way is delay, not
resilience. It also means the empty registry is honest: a commit run today
fails loudly instead of looking idle.

**`drainOutbox` runs one pass, not a loop.** How often to call it is the
caller's decision — a script's `--interval`, a cron, a test calling it once. A
drain that owned its loop could not be tested without waiting.

**Raw SQL, once, and it earns it.** `FOR UPDATE SKIP LOCKED` is what lets two
workers drain one queue without either waiting on the other or both taking the
same row, and Prisma's query API cannot express it. Read-then-update would hand
the same task to both.

### The bug that took the longest to see

The drain tests passed alone and failed in the suite — a different test each
run, which is the signature of a race rather than an ordering problem. Pairing
the file against each other file in turn reproduced it twice and then stopped
reproducing at all, which ruled out interference and pointed at timing.

**It was two clocks.** `availableAt` is written with `new Date()` and every
model function reasons in those terms, but the claim compared it against
Postgres's `now()` — which is *transaction start* time, not statement time. A
task enqueued a moment earlier could read as not yet due and silently not be
claimed. The claim now takes the application's clock, like everything else that
touches that column. Four consecutive suite runs, clean.

Worth keeping: a flaky test that moves between assertions is describing a shared
clock or a shared row, not a bad assertion.

### The script

`scripts/outbox-worker.mts`, run with `--conditions=react-server` exactly as
`local-development.md` specifies, and a dry run without `--commit` as that guide
requires of anything that changes data. `scripts/` sits beside `src/` rather
than inside it, so a file that is not part of the app's module graph is not in
`tsc`'s or Next's either; `architecture.md` says so now.

126 unit tests, 114 integration.

## 2026-09-09 — field encryption, and a key that must exist

`IdentityDocument.numberEncrypted` was named for an obligation nothing in the
code met. `server/crypto.ts` meets it.

**`src/server/`, not `src/lib/`.** The architecture test is "would two features
ever own this together" — compliance will encrypt passport numbers and billing
will encrypt payment references, so it is shared rather than a feature's. It
also reads `node:crypto`, and `lib/` carries no `server-only`: a client
component importing it would be a build break rather than a compile error.

**AES-256-GCM, because the failure that matters is silent corruption.** A
modified ciphertext refuses to decrypt instead of decrypting to a different
number. Two tests flip a bit — one in the body, one in the tag — and assert the
refusal.

**Not deterministic, deliberately.** The same number encrypts differently every
time, so `WHERE numberEncrypted = ?` cannot work and is not meant to. Finding a
document is `numberLast4`'s job; equality on a ciphertext would leak which
guests share a document.

**A versioned envelope.** `v1.<iv>.<tag>.<ciphertext>` in one column — the parts
are useless apart, and a schema able to hold an IV without its ciphertext will
eventually hold one. The prefix is what lets a later algorithm know what old
rows are rather than guessing.

**`decryptField` throws rather than returning `null`.** A caller that forgot to
check a nullable return would write the absence of a passport number into an
official filing.

**The key is required, not optional.** A column named `numberEncrypted` that
falls back to plaintext when a variable is absent is the exact failure the name
promises it is not. `env.mjs` checks the length too, so a truncated paste fails
at startup rather than at the first write. `.env.example` gained the variable —
and lost a comment that still described the database as SQLite.

**What this does not do.** Nothing writes `IdentityDocument` yet, so no value is
encrypted in anger. The writer, the retention job and the "who may read a
passport number" audit are Phase 9, and the roadmap now says the primitive is
already there so it is not built twice.

136 unit tests, 114 integration.

## 2026-09-09 — a refusal is a code, not only a sentence

Every refusal in the tree was an English sentence and nothing else. A router
test had to assert on prose, and a translation would have had nothing to key on
— which is the entry that follows this one in `todo.md`, and the reason this one
came first.

**Five classes, one boundary.** `DomainError` with `NotFoundError`,
`ForbiddenError`, `ConflictError`, `InvalidError` and `PreconditionError` over
it. `mapDomainErrors` in `trpc.ts` turns one into a `TRPCError` exactly once,
keeping the original as `cause` so `errorFormatter` can read the code and the
field off it.

**A middleware rather than `errorFormatter`.** By the time the formatter runs
the status is already decided, and the status is the half `lib/errors.ts` routes
on. Every procedure is built from a base that applies the middleware, so a new
route cannot forget it.

**Codes live in `model/`, per feature.** Not in `server/errors.ts`: that file is
reached by `auth.ts`, which `auth:generate` loads through jiti, so it may not
import from `features/`. `model/` is also what lets the client compare against
the same constant the server threw.

**Two codes, and they answer different questions.** `AppError.code` is the
transport's — `CONFLICT`, `NOT_FOUND` — and decides where the error renders.
`AppError.domainCode` is the rule's — `room.taken` — and is what a screen or a
translation keys on. A test pins that a `null` domain code reads as absent, so a
caller comparing against a constant cannot match on nothing.

**The proof it works is the tests that did not change.** 114 integration tests
assert on tRPC codes, and all of them still pass through the new mapping. Four
of them now assert on the domain code as well — the point of the exercise, and
the first assertions in the tree that survive a rewording.

**`reservations` is converted and the rest are not**, deliberately: sixteen
codes covering thirty-odd sites, which is a worked example rather than a
mechanical sweep of a hundred. The remaining six features are named in
`todo.md`. `fieldError` stays for now — it routes to a field correctly and
carries no code, so converting it is the same sweep.

Also: `todo.md` said forty-four `TRPCError` sites. There were sixty-two.

140 unit tests, 114 integration.

## 2026-09-09 — every refusal has a code now

The sweep the previous entry left for later. All six remaining features are
converted, and two things happened on the way that were not planned.

**Seventy-seven codes across eight catalogues** — one per feature in `model/`,
plus `SharedError` in `server/errors.ts` for the refusals `auth.ts` throws,
which cannot live in a feature because jiti loads that file without tsconfig
`paths`.

**There is now exactly one `new TRPCError` in the tree**, in `mapDomainErrors`.
That was not the goal and is the better outcome: the framework guards in
`auth.ts` and `trpc.ts` were the last transport errors thrown by hand, and they
are user-visible English like everything else.

**`fieldError` and `FieldErrorCause` are gone.** Once every caller threw a
`DomainError` carrying its own field, they were a second channel for a job with
one occupant. Two client components still carried comments naming
`fieldError("slug", …)`; a comment describing a function that no longer exists
is worse than no comment.

### What the failing tests were actually telling us

Two directory tests broke, and they were right to. They call `requireOrgModule`
**directly** — no procedure, so no boundary — and asserted it threw a
`TRPCError`. It now throws a `ForbiddenError`, because the domain does not know
about tRPC and should not.

That is a real behaviour change, not a test detail: any service called from a
Server Component now throws the domain's class. Nothing in `app/` depended on
the old shape — pages use `organizationBySlug`, which returns `null` — but it
had to be checked rather than assumed.

`domainCodeOf` in the harness now reads the code from either shape, so a test
asserts on the rule rather than on which side of the boundary it caught it.

**The proof is still the tests that did not change.** 114 integration tests
assert on tRPC codes through the new mapping and pass unchanged; the two that
failed were asserting on the *pre*-boundary shape, which is the one thing the
change was always going to move.

140 unit tests, 114 integration.

## 2026-09-09 — Next 16, and the instrument it took away

Upgraded 15.5.9 → 16.3.4. Almost none of the breaking changes touched this
codebase — no `next/image`, no `revalidateTag`, no parallel routes, no
`serverRuntimeConfig`, no PPR, no custom webpack, `params` already awaited, and
`next lint` already avoided. The `middleware` → `proxy` rename cost nothing
because there is no middleware, which is the design.

**The upgrade removes `size` and `First Load JS` from the build output**, and
that was the whole reason to read the guide before doing anything else.
`roadmap.md` recorded a floor of 245 kB shared and asked at every phase end
whether a route's first-load bundle grew. The upgrade would have deleted the
instrument and left the obligation.

So `scripts/bundle.mts` landed **first, on Next 15**, and recorded a baseline in
its own units before anything moved — 767,307 bytes shared. One change at a
time, which is the rule the file itself exists to serve.

**Then it broke, which was the useful part.** `.next/app-build-manifest.json`
does not exist in Next 16; `build-manifest.json` survives but covers only the
Pages Router. The per-route client chunks are in
`server/app/**/page_client-reference-manifest.js`, as a `globalThis.__RSC_MANIFEST`
assignment whose `clientModules[*].chunks` is the list. The script reads that
now, and **fails loudly with the path it looked for** rather than reporting a
confident zero — it reads build internals, and Next will move them again.

**The floor is re-recorded once, in a unit that is not comparable.** 783,927
bytes shared, `/dashboard` at 1388.8 kB. Both the version and the measurement
source changed together, so the difference from 767,307 is not attributable to
either — which is exactly why the number resets rather than being carried over.

**The boundary lint was verified, not assumed.** `eslint.config.mjs` reaches
`next/core-web-vitals` through `FlatCompat`, and Next 16 makes the plugin
default to flat config — the one place an upgrade could have silently stopped
enforcing `import/no-restricted-paths`. A deliberate violation (a `model/` file
importing a feature's `server/`) was added, seen reported, and reverted. The
config's own comment warns that a broken rule of this kind reports nothing,
which is worse than having no rule.

**Two things the upgrade changed on its own.** Next rewrote `tsconfig.json`:
`jsx` from `preserve` to `react-jsx`, and `.next/dev/types` added to `include`.
`next dev` and `next build` now use separate output directories, so they can run
at once.

The app was checked running, not only building: `/` and `/sign-in` answer 200,
`/dashboard` redirects at 307, and tRPC answers 401 with "You must be signed in"
— the `UnauthorizedError` from the previous entry, arriving through the boundary
it now goes through.

Also corrected while nearby: `local-development.md` still documented
`--turbopack` flags that are now the default, and `architecture.md` said six
features when there are seven.

140 unit tests, 114 integration.

## 2026-09-10 — next-intl, wired and proved on two screens

The plan's configuration step. Nothing on screen changed, which was the point:
the two auth pages now read their English from `messages/en/auth.json` and
render byte-identical output.

**No locale in the URL.** The language comes from a cookie, resolved in
`lib/i18n.ts`. Locale-prefixed routing is every library's default and every
library implements it with a proxy — adopting one would have reversed the
decision at `architecture.md` that there is no middleware, for a reason
unrelated to access control, and changed every slug-keyed link in the product.

**The provider goes where the client tree is.** `(auth)/layout.tsx` mounts
`NextIntlClientProvider` with `{ auth: messages.auth }` and nothing else, rather
than the root layout mounting everything. **That decision is measurable**: the
two auth routes grew 39 kB each and the shared chunk did not move at all —
783,927 bytes before and after. A root provider would have put every string in
every bundle, including the dashboard's.

**`lib/`, not next-intl's default `i18n/`.** The architecture's own test —
"could it be swapped for another vendor without changing a business rule" —
puts a translation adapter in `lib/`, and the plugin takes a path. The locale
*list* is `config/locales.ts` instead, beside `nav-items.ts`, because a client
component needs it and `lib/i18n.ts` reads `next/headers`.

**Typed keys, verified rather than assumed.** `declare module "next-intl"`
augments `AppConfig` with the shape of the JSON, so keys autocomplete and a typo
fails `tsc`. The first attempt used the older `interface IntlMessages extends
Messages {}` and tripped `no-empty-object-type`; the v4 augmentation is not a
workaround for the lint rule, it is the current API. Proved by mistyping a key
and watching the compile fail.

**What is still English**, and named so it is not mistaken for done: the 77
domain codes' messages, the 171 Zod messages, and every dashboard string. The
plan has them in order, and the first two are where the work is.

140 unit tests, 114 integration.

## 2026-09-10 — refusals worded by their code

The larger half of the translation surface. 70 of the 75 domain codes now have a
message in `messages/en/errors.json`, and the client words a refusal from the
code rather than from the sentence the server sent.

**The open question is decided: the client resolves, the server stays
locale-free.** Nothing was added to `createTRPCContext`, because nothing would
have used it — every refusal today is rendered in a browser. That changes the
moment something a person reads leaves the browser: an email, a fiscal filing, a
channel-manager error. Phases 7 and 9 both have that shape, and both will want
the *recipient's* locale rather than the caller's, which is a different question
than the one this answers.

**Six refusals interpolate a runtime value** — how many rooms are free, which
night, which module. A code alone cannot reproduce those, so `DomainError.with({…})`
attaches them and the translation formats them with ICU. A method rather than a
fifth constructor argument: `field` is already positional in three subclasses,
and a fifth slot would be unreadable at the nine sites that need it.

**Two codes were carrying two different sentences.** `stay.sold_out` was thrown
both for "no rooms free" and for a hold asking for more than are available; the
second is now `hold.short`, which is what it always was. `room.taken` and
`person.email_taken` each had two wordings that meant the same thing, and one
wins — a code is an identity, so two sentences behind it was the drift the codes
exist to prevent.

### The surface this did not cover, and the test that says so

**Five refusals get their sentence from a rule in `model/`.**
`refuseStatusChange`, `refuseStayMove`, `refuseOccupancy`,
`refuseCancellationTerms` and the rate `refusalMessage` all return the words,
and *which* words depends on why — "a confirmed reservation cannot become
checked out" and "assign a room first" are the same code. One key cannot
reproduce that.

They keep the server's English, which still renders. `error-messages.test.ts`
pins the list both ways: a code missing a message fails, **and a code on that
list gaining a message fails too** — because a key would win over the rule's
specific sentence and quietly replace it with a generic one.

That test is also the key-parity check the plan wanted in the gate: every code
has a message, every message has a code, no empty strings, no unbalanced ICU
braces.

### The provider, and what it cost

`(app)/dashboard/layout.tsx` had no provider at all; it has one now, carrying
`errors` and nothing else. That is what makes `useErrorHandlers` work anywhere
under `/dashboard`.

**Shared JS went 765.6 → 804.9 kB, and the attribution is exact:** sign-in's own
chunk dropped 39.0 kB in the same build while its first load did not move at
all. The same bytes were reclassified — next-intl's runtime was on two auth
routes, and now that the dashboard needs it too it is shared by everything. The
floor is re-recorded at 824,258 bytes. `/dashboard` grew by exactly that amount.

**`useErrorHandlers` replaced 27 bare calls across 16 files.** `handleError` and
`handleFormError` stay exported and pure — their tests pass a translator
directly and need no provider — and the hook is what binds them to the language.
React's `rules-of-hooks` was the safety net for the mechanical edit: the first
pass inserted the hook inside a props type in four files, and the second pass
put it after the component's body-opening brace. One file has two components and
needed the hook twice, which `tsc` caught.

149 unit tests, 114 integration.

## 2026-09-10 — Zod messages are keys now

The third surface. A message in a `model/` schema is a key —
`z.email("email_invalid")` — resolved from `messages/en/validation.json`.

**The count in the plan was wrong, and the correction matters.** It said 171
English strings in Zod schemas. That number came from a regex that matched every
capitalised string in `model/`, labels and enum values included. The real
surface is **21 distinct messages across 33 calls**. A measurement worth
re-taking before acting on it, which is the second time that has been true here.

**Why keys rather than a translated schema.** The usual answer is a factory —
`createSchema(t)`, built per request. It cannot work: `createOrganizationSchema`
is a module-level const used both at `.input()` in the router and as the form's
resolver, and `.input()` is evaluated when the router is *defined*, with no
request and no locale. A factory serves only the form, leaving the router on a
second schema — the drift `architecture.md` says `model/` exists to prevent.

### Two paths, and only one of them goes through `lib/errors.ts`

Client-side validation never reaches `normalizeError`: react-hook-form hands the
schema's message straight to the field. So a key becomes a sentence in two
places, and they had to be found separately —

- **`useZodResolver`** wraps `zodResolver` and rewrites the messages it produces.
- **`useErrorHandlers`** gained `translateField`, for the same failure arriving
  over the wire after the server re-validated.

Both land on the same words, because both read the same JSON.

The alternative was translating in `FieldError`, which is one place instead of
two — but it is a `components/ui/` file that the shadcn CLI rewrites, and 34
call sites against the resolver's 9.

### The resolver has its own file, and the bundle says why

`useZodResolver` started in `lib/errors.ts` and moved to `lib/form.ts`. The
first arrangement put `@hookform/resolvers` in the shared chunk, because
`errors.ts` is reached by every route through `handleError` — **shared JS went
824,258 → 881,764 bytes**, and a screen with no form was carrying a resolver.

Split out, it is **824,461 bytes**: 203 more than before this change, for three
namespaces and two resolution paths. Sign-up is *smaller* than it was —
1301.2 → 1292.7 kB — because the English left the schemas that every route
imports and went into a namespace loaded per provider. A key is shorter than a
sentence.

**Parity is in the gate.** `error-messages.test.ts` now checks the validation
side both ways as well: every key a schema names has a message, every message is
named by a schema, and no Zod call still carries prose — a key is
`lower_snake_case`, so a capital letter fails the test.

152 unit tests, 114 integration.

## 2026-09-10 — the page shells, and organizations

The client half, started. No second locale — every screen reads the same English
it did, from `messages/en/` instead of from a literal.

**Page shells first.** Seven `page.tsx` files under `app/` now read their title
and description from `messages/en/pages.json` through `getTranslations`. Two of
them interpolate — a property's check-in hours, a property's name — so those are
ICU rather than template literals. Server Components, so no provider is
involved: `getTranslations` reads the request config directly.

**Then organizations, whole.** Six components, and every string a person reads:
form labels and placeholders, toasts, table headers, the confirm dialogs in the
danger zone including their descriptions and button labels. `organization-panels.tsx`
has four components in one file and each got its own translator.

The namespace is mounted on `(app)/dashboard/layout.tsx` beside `errors` and
`validation`. Shared JS did not move — 824,461 bytes before and after — because
the JSON is small next to the runtime that was already there.

### What is deliberately not done

**The eight `_LABELS` tables.** `ORG_ROLE_LABELS`, `ROOM_STATUS_LABELS`,
`RESERVATION_STATUS_LABELS` and the rest are the vocabulary a person reads most
— badges, selects, status chips — and they are still English in `model/`.

They are left as a set on purpose. Seven are client-only and would move cleanly,
but `ROOM_STATUS_LABELS` is read by a *router*, at
`reservations/server/router.ts`, to build the sentence behind
`room.not_sellable`. Moving it means deciding what a domain error's interpolated
value is: English, or an enum the client resolves. That is one decision for all
eight, and taking it one table at a time would answer it by accident.

**The remaining features' prose** — directory, identity, properties, rates,
reservations — is roughly 51 strings across 16 components. Mechanical, and the
pattern is now demonstrated twice over.

152 unit tests, 114 integration.

## 2026-09-10 — the rest of the client strings

Six features after `organizations`: identity, directory, properties, rates,
reservations, and the last of the page shells. Every screen now reads its words
from `messages/en/`. Still one locale, still the same English on screen.

**Three module-level label arrays had to become keys.** `NUMBERS` in the room
type form, the extra-person fields in the rate plan form, and `STATUS_ACTION` in
both the grid and the day lists were `Record`s of English defined outside any
component, where `t` does not exist. They are lists of *names* now, and the
label is `t(\`namespace.${name}\`)` at the point of render.

`STATUS_ACTION` needed more than that: the grid and the day lists disagree about
one word — cancelling reads "Cancel booking" on the grid, where the chip does
not say which booking, and "Cancel" in a day row that already does. So each file
has a `useActionLabel` hook, and the grid's overrides that one status. A status
arrives from the server as a string, so the key is checked with `t.has` before
it is read: an unrecognised one renders as itself rather than throwing.

**The confirm dialogs carry keys, not sentences.** `ASKS_FIRST` maps a status to
`{ titleKey, descriptionKey }` and the component resolves them, because the
record is module-level for the same reason.

**Measured: shared JS 824,461 → 824,413 bytes**, forty-eight bytes *below* the
floor. Nine namespaces of JSON, and the total did not move — the strings left
the component bundles and arrived in the provider payload, which is roughly a
wash. The floor is re-recorded rather than celebrated.

### What is still English, and why it is not an oversight

**The eight `_LABELS` tables.** `ORG_ROLE_LABELS`, `ROOM_STATUS_LABELS`,
`RESERVATION_STATUS_LABELS`, `MEAL_PLAN_LABELS`, `USER_ROLE_LABELS`,
`DAY_ROLE_LABELS`, `OUTBOX_STATUS_LABELS`. They are the vocabulary a person
reads most — badges, selects, status chips — and they are held back as a set.

Seven are client-only and would move today. `ROOM_STATUS_LABELS` is read by a
router, to build the sentence behind `room.not_sellable`, so moving it decides
what a domain error's interpolated value is: English, or an enum the client
resolves. That is one decision for all eight, and answering it one table at a
time would answer it by accident.

152 unit tests, 114 integration.

## 2026-09-10 — the label tables, and a check that finds what nothing reads

The last of the extraction, plus the tooling to keep it honest.

### The knot, untied by splitting a code

Six of the seven label tables were client-only and would have moved on any day.
`ROOM_STATUS_LABELS` was read by a **router**, to build
`That room is ${label} and cannot be sold`, which is why they were held back as
a set: moving it decides whether a domain error's interpolated value is English
or an enum the client resolves.

Neither, in the end. `isRoomSellable` is false for exactly two reasons — the
room is out of order, or the status is one this build does not recognise — so
**the message never needed the status at all**. Two codes, `room.out_of_order`
and `room.not_sellable`, no interpolation, and the router stopped importing
labels. Saying "out of order" about an unrecognised status would have been a
guess; now neither message guesses.

An integration test caught the split by asserting on the domain code rather than
the sentence, which is the first time that has paid for itself.

### One table stays, and a test keeps it honest

`RESERVATION_STATUS_LABELS` cannot move. `refuseStatusChange` and
`refuseStayMove` build their refusal sentences from it, and those are pure
functions in `model/` with no translator to reach — the same five sentences
`error-messages.test.ts` already lists as untranslatable.

So the words live twice: in `model/` for the rules, and in `enums.json` for the
badges. A test fails if the two copies disagree, which was proved by making them
disagree. They collapse into one when those rules return codes.

### `useEnumLabels` returns a record, not a lookup

Call sites pass these to `items={…}` on a `Select`, index them by value, and
iterate them with `Object.entries`. A record keeps all three working, so moving
a table cost one import and one hook line per component rather than a rewrite.

### The tooling

**`npm test` now finds messages nothing reads.** The opposite direction was
already a compile error — `AppConfig` types the keys from the JSON, so a typo
fails `tsc` — but a message left behind after the screen that read it changed
was invisible, and those are what a translator eventually gets paid to
translate. `message-keys.test.ts` walks the source, resolves each namespace's
keys, and reports orphans. It found five on its first run, all false positives
from keys built into a variable before being passed, which is now handled.

Three namespaces are exempt because they are keyed dynamically — `errors` by a
domain code, `validation` by a Zod message, `enums` by an enum value — and each
is checked against its *source* in `error-messages.test.ts` instead. Between
them, every message in the tree is now accounted for in both directions.

**`.vscode/settings.json` configures i18n Ally.** Inline previews and a tree of
what is missing. Worth knowing: next-intl ships no extension of its own, this is
a community one, and it does not resolve namespaces from `getTranslations` —
lokalise/i18n-ally#1170 — so Server Components show as unresolved in the editor.
The settings file says so, because the tests are what actually check.

155 unit tests, 114 integration.

## 2026-09-10 — the rules stopped writing sentences

The last untranslatable surface. `refuseStatusChange`, `refuseStayMove`,
`refuseOccupancy`, `refuseCancellationTerms` and the rate `refusalMessage`
returned the words a person read, and being pure functions in `model/` they had
no translator to reach.

They return a `Refusal` now — `{ code, values, message }` — and the wording
lives in `messages/en/errors.json` with the rest.

**The point of the exercise is that both sides still agree.** `architecture.md`
made a lot of the rule returning one string so that a disabled button and the
server's refusal could not say different things. They still cannot: they resolve
the same code from the same file. What changed is that the string is no longer
English by construction.

**Thirteen codes replaced four.** `reservation.status_refused` stood for four
different refusals — an illegal transition, a missing room, a booking that has
not arrived, a last night that has gone — and `stay.move_refused` for five.
Collapsing them had been fine while the sentence carried the detail; a code that
means five things carries none.

**`message` stays, and is deliberately plainer than what a person sees.**
`architecture.md` requires every throw to carry one, and it is the last resort
when a key is missing — which `error-messages.test.ts` now makes impossible. The
precise wording is the translation's job.

**`RESERVATION_STATUS_LABELS` is gone.** It existed only for `spoken()`, which
existed only to build those sentences. The status words are ICU `select` in the
messages now, so the enum travels as a value and each language chooses its own
words. That also removes the copy that yesterday's drift test was guarding, and
the guard with it.

### Two checks the change earned

**Every message is valid ICU.** The new messages carry `select` blocks over
statuses and refusal reasons, and a malformed one only shows when a person hits
that exact refusal. The test formats every message in every namespace against a
bag of plausible values and fails on anything that will not format — proved by
breaking one.

**The exemption list is gone.** `error-messages.test.ts` no longer carries five
codes that "supply their own sentence", because none do.

### What the tests had to become

Twelve assertions moved from prose to codes — `assert.match(refusal, /assign a
room/i)` became `assert.equal(refusal?.code, "reservation.room_required")`. One
integration test asserted `/arrives on/` against a server message that is now
the plain fallback, and it was right to fail.

That is the whole argument for codes, arriving on schedule: a rewording used to
break tests, and now it cannot.

154 unit tests, 114 integration.

## 2026-09-13 — the MVP block, M1 to M7

Seven phases between Phase 4 and Phase 5, measured against a brief benchmarked
on a Russian PMS. Their plan has left `plans/` because the work shipped; this
is what it taught.

### The grid was telling users a working feature did not work

The paragraph under it ended *"Moving the dates needs a procedure that does not
exist yet."* `reservation.moveStay` had existed for a phase, and both drags
called it. A sentence printed on a screen is a defect the audience can read,
and it cost less to fix than the feature it denied. Two more strings beside it
were hardcoded English — `room {number}` and `no room yet` — invisible to the
orphan test because a template literal is not a `t()` call. That is the class
of gap that test cannot see, and the second time it has cost something.

**The sold row was already on the wire.** `NightAvailability` carried `sold`
beside `available` and the screen drew only `available`. The cheapest item in
the block was a row that needed no server change at all.

### A booking had no address

`StayActions` was the only place a booking could be looked at, and it lived in
component state: nothing could be linked to, refreshed or sent to a colleague,
and a reservation holding two rooms had no screen. Every other first-class
object had a route.

**Keyed on `publicId`, not `id`.** The column exists so a booking can be named
outside the building; a sequential id in a URL leaks how many bookings the
hotel has taken, and the same key is what a Phase 8 guest link will carry.

**The refusal had been answering for the chip.** `refuseStatusChange` ran over
one stay where the server runs it over all of them, so a two-room booking could
be offered a check-in the server then refused. The card reads every stay.

### The month was never the window's unit

A calendar month always begins on the 1st, so a stay crossing a boundary was
cut by the view — in the last week of a month, which is when a desk needs the
days after it most. `windowFrom(anchor, nights)` replaced `monthWindowOf`, and
the month helpers went with it rather than staying as tested exports nothing
called.

**A measurement changed the implementation.** The date picker put the desk's
route at 1566 kB, +87 kB, all `react-day-picker`, for a popover that starts
closed. Lazy-loading recovered 68 kB. It was later removed entirely for
`<input type="date">`: no bundle, the reader's own first-day-of-week, keyboard
reachable without work, and the platform's picker on a phone.

### A hold made booking harder than not holding

`availability` subtracts live holds, including the caller's own — so a desk
that held a room and then booked it was refused by its own claim. Taking a hold
was strictly worse than taking none, which makes the mechanism pointless.
`exceptHoldKey` discounts it, and the hold is deleted **inside** the booking
transaction: releasing before opens a window where someone else takes the room,
releasing after leaves a claim on a booking that rolled back.

### Russian, and the formatters that did not follow it

The extraction had been finished for a phase; what was missing was a reader,
and the demo audience is one. 477 strings across twelve namespaces, and two
guards that did not exist because both only ever looked at English: every
locale must declare exactly English's keys, in both directions, and every
message must be valid ICU **in its own locale** — Russian needs `few` and
`many` where English needs neither, and a malformed branch throws at render in
the language nobody on the team reads.

Six date formatters were pinned to `"en"` at module scope. A screen whose words
move while its dates stay put reads as half-translated. `todayAt` keeps its
pin, and now says why: it reads numeric fields out of `formatToParts`, so the
language it would be *said* in never appears.

### What the keyboard had to be

Assignment, moving and resizing were drag only. Arrows build a *pending* change
rather than sending one per keypress — a drag is one mutation for a whole
gesture and this had to be too. The preview goes through `rescheduleStay`, the
same re-laning an optimistic drag uses, so a previewed move lands in the right
room at the right lane.

**The three measurements became CSS custom properties.** A row, a label and a
night are read by four components at three depths; threading a density through
all of them is prop drilling for a number CSS already inherits.

### The seed had three days of inventory, on fixed dates

`Date.UTC(2026, 8, 14)` for three nights. A night with no `RoomTypeInventory`
row is nought rooms — deliberately, so an undeclared day is not on sale — which
meant five phases of work were invisible the moment that week passed. Now
relative to today, ninety nights out.

### `product-shape.md` § 19 rule 1 was wrong, and the database was not

*"Two bookings may not share a night in one room"* omits what the constraint
has always said: `WHERE ("roomId" IS NOT NULL AND "status" IN ('CONFIRMED',
'CHECKED_IN', 'CHECKED_OUT'))`. Cancelled and no-show released what they held,
and an enquiry never held it. The prose contradicted § 6 of its own file; the
code never did.

212 unit tests, 134 integration.

## 2026-09-13 — a third layer: a browser

`model/` proves a rule without a database and `tests/server/` proves a
procedure asks the right question of one. Neither can see a dialog whose
`setError("root")` renders nowhere, a translated string overflowing its column,
or a button disabled for the wrong reason.

**No Prisma in the test process.** The generated client is ESM-only
(`import.meta`), `src/` is CommonJS, and Playwright's loader bridges neither —
`type: module`, a directly constructed client and CJS interop each ended in a
`require(esm)` cycle. The fixtures use `pg`. The trade is honest: this process
drives a browser, it does not model a domain, and what it must never become is
a second place the domain is expressed.

**Three failures on the first run, all real.**

`BETTER_AUTH_URL` is checked against the request's origin, so a server on
another port refuses every sign-in with *"Invalid origin"* and the form
silently does nothing — the exact failure class this layer exists to catch,
caught by its own setup.

A chip's accessible name is its **guest name**; the reference is in a `title`,
which is not the accessible name when there is text content. And the suite is
`fullyParallel` against one seeded property, so `Test Guest 1` matched another
test's booking — every fixture tags its guests now.

**One app fix.** `StayActions` had no accessible name, so nothing could tell
its *Check in* from the day list's. It has `role="group"` and a label now: an
accessibility improvement first, a test handle second, which is the right way
round.

12 end-to-end tests.
