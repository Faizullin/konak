# The server, hardened

Found by an audit on 2026-09-13 that read every `features/*/server/*.ts`, all of
`src/server/` and all fourteen `.prisma` files. Everything here was verified
against the code, not inferred.

The domain layering is not the problem and is largely right: the rules really
are pure functions in `model/`, tested without a database. The problems are in
three places — **a write path that does not exist**, **read-then-write races**,
and **the guard chain every procedure starts with**.

One of these was already found and fixed the hard way: `nextSeriesNumber` read a
counter, added one and wrote it back, with a comment claiming that was what kept
two clerks apart. It was not. **Everything in § 2 is that same bug in a
different table**, and the lesson is worth stating once: *a check and the write
it authorises must be one act, or two requests will both pass the check.*

---

## 1. ~~Inventory had no write path~~ — shipped

`RoomTypeInventory` no longer stores `totalRooms`. How many rooms of a type
exist is **counted from the `Room` rows**, so a night nobody declared is every
room, and a property set up through the app sells on the day it is created.

The table now holds only what staff deliberately withheld, written by
`property.setBlock`. See `guides/architecture.md` § What is counted, never
stored.

## 2. ~~Read-then-write~~ — mostly shipped

**Availability is decided under a lock now**, inside the transaction that
writes it: `lockRoomType` in `reservations/server/service.ts`, taken by
`create`, `walkIn`, `moveStay` and `hold`. `availability()` takes the client to
ask, so the decision and the write are one act. An integration test sends three
bookings at once for two rooms and asserts that exactly one is refused — and it
fails if the lock is removed.

**The folio race is closed by `lockReservation`**, not by an index. A unique
index was written first and an integration test refused it within the minute:
`billing.split` puts a company on the room and the guest on the bar, so **two**
live folios against one reservation is correct. What was wrong was two callers
both believing they were the first. `billing.folioForReservation` calls the
service now instead of being a second implementation of it.

**`enqueueOutbox` recovers from its own key being taken.** The read and the
create were two statements, `pushKey` is minute-grained, and the loser's P2002
used to abort the transaction it was enqueued in — so two cancellations in the
same minute rolled one of them back. `isUniqueViolation` in `server/errors.ts`
is the shared shape-match.

**And § 2.3 with them.** `lockFolio` covers `postLine`, `close` and
`takePayment` — three procedures that read a bill's state and then wrote
against it. `takePayment` also catches P2002, because its key is unique across
*all* folios and the folio lock only serialises two hands on one of them.

---

## 3. ~~Three changes the channels were never told about~~ — shipped

`walkIn`, `moveStay` and `applyInboundReservation` all change what is for sale
and announced nothing. They do now, each in the transaction that makes the
change — and a cancellation arriving from a channel does too, because a room
coming back is news for the channels that could sell it.

`moveStay` pushes from the **earlier** of the two dates: a stay that shifts
frees the nights it left as well as taking the ones it arrived on, and
announcing only the new dates would leave a channel refusing to sell a night
nobody occupies.

The invariant is asserted now rather than assumed —
`channels.test.ts` § "every change to what is for sale enqueues a push" loops
over the ways the market moves, so the next one that forgets fails a test
instead of producing an overbooking.

---

## 4. ~~The guard chain~~ — shipped

`requireOrgMember` no longer calls `requireUser`. It needed an id, and an id is
what `ctx.session.user` carries — which `requireUser`'s own docstring told
callers to prefer. Every property-scoped procedure paid for that round trip
sequentially before doing any work; the grid and the day lists paid it twice
every thirty seconds per open desk.

Safe because nothing read anything else: `user.id` is the **only** field any
caller of these guards touches, 53 times across the features. `requireUser`
keeps its six direct callers, where the live row is the point.

`requirePropertyMember` also selects the whole small property row, so the five
procedures that re-read it for a `timezone` or a `currencyCode` stopped —
`reservation.create`, `reservation.walkIn`, `housekeeping.board`,
`housekeeping.createTask` and `properties.hasLiveStays`, the last of which takes
the timezone as an argument now rather than fetching one.

## 5. ~~Indexes~~ — measured, and the answer was not an index

Benchmarked on 300,000 stays across five years, asking for a one-month window —
the shape a real property reaches:

| | grid query |
|---|---|
| as shipped | **195 ms** |
| `+ (checkIn, checkOut)` on `room_stays` | 193 ms |
| `+ (checkOut, checkIn)` | 193 ms |
| `+ (checkOut, checkIn, status)` | 199 ms |
| **`propertyId` on the stay + `(propertyId, checkOut, checkIn)`** | **0.02 ms** |

**No index on `room_stays` was ever chosen by the planner**, and that is the
finding. The property filter lives on `reservations`, so Postgres drives from
there — an index scan over every booking the property has ever taken, then a
nested-loop probe into `room_stays` 300,000 times. An index on the stay's dates
cannot help a plan that never reaches the stay first.

So the answer was the option the plan had listed second and the table
conventions argue against: **the stay carries its own `propertyId`**. Convention
1's objection is that a copied scope can disagree with its parent — and this one
cannot, because `room_stays_property_matches_reservation` is a composite foreign
key onto `reservations (id, propertyId)`. The reason behind the rule is
satisfied rather than waived, and an integration test asserts the database
refuses a mismatch.

Cheaper items in the same pass, still open:

- **Redundant:** `organizations_slug_idx` duplicates the `@unique`;
  `organization_members_organizationId_idx` is the leading column of the
  `@@unique([organizationId, userId])`.
- **Nothing reads them:** `RateCalendar`/`RateRestriction @@index([roomTypeId, date])`
  (every reader supplies `ratePlanId` too), `Folio` and `Payment`
  `@@index([propertyId, status])`, and `HousekeepingTask @@index([assignedMemberId, status])`
  — that last one implies a *my tasks* screen that was planned and never built.
- **Missing:** `EntityTag` has `[personId]` and `[companyId]` but not
  `[propertyId]`, which `listSubjectTags` filters on.

---

## 6. ~~Unbounded input~~ — shipped

`MAX_RANGE_NIGHTS` (400, a little over a year so "this date next year" is one
request) and `boundedRange`, applied to `reservation.availability`,
`rate.calendar`, `rate.setRates` and `rate.setRestrictions`. Refused **on `to`**,
which is the field somebody mistyped, and by the schema the router and the form
already share.

The reads were a memory problem — `availability()` builds a row per room type
per night, so a decade was thirty-six thousand of them for free. The writes were
sharper: a range becomes a `deleteMany`, one insert per night and a channel
push **in one transaction**.

Two more that had no `take`:

- **`platform.listAttachments`** now takes 200. A panel shows one kind for one
  subject, which is small in practice — and "in practice" is not a bound.
- **`billing.get`'s lines and payments** deliberately stay unbounded, and the
  reasoning is worth keeping: `refuseClose` sums the lines and `close` freezes
  that sum into `closedTotalMinor`, which is never re-derived. A `take` there
  would not make a screen slow; it would close a bill at a total missing the
  lines past the limit, silently and for ever. It was added and then removed for
  that reason.

`error-messages.test.ts` had to learn about `superRefine` on the way: a rule
about two fields at once cannot be written as `.min()` on one of them, and its
key was just as real.

---

## 7. Sequential work — the two hot ones done, the rest open

**`organization.moduleAccess` is one query now**, which is what its own comment
had claimed while being three: the organization by slug, then the membership,
then the toggles, strictly sequential, on a query the shell runs on **every
navigation**. They are one row and its two relations.

It is also the only place outside `requireOrgMember` that decides whether
somebody is a member, so the refusal moved to `noOrgAccess()` in
`server/errors.ts` — one place for the words and the code, beside
`userNotFound()` and `memberNotFound()`.

**`frontDeskGrid` stopped counting rooms it had already read.** It draws one row
per room, so it reads them all first; `availability` then ran a `groupBy` for
the same answer with the same filter. The scope carries them now.

### And the measurement said: do not claim a number

Timed on the demo property, thirty runs, before and after — **10.1 / 9.5 /
2.5 ms** against **12.1 / 7.4 / 18.1 ms**. They overlap completely. An earlier
single reading of 26 ms against 12 ms looked like a win and was noise, which is
§ 5's lesson arriving a second time.

That does not make the change wrong; it makes the *claim* wrong. What it removes
is a **round trip**, and a round trip to a Postgres on the same machine is worth
nothing. On a managed database at 10–20 ms it is the whole cost. The honest
statement is the count — the grid is six queries in two waves rather than seven,
and `moduleAccess` is one rather than three — not a millisecond figure measured
where latency is zero.

**`organization.delete` is batched and paged.** It filed one storage removal per
attachment — two statements each — in a loop, inside the transaction that also
holds the cascade: twenty thousand sequential statements at ten thousand
attachments, with `organizations` locked throughout. `enqueueOutboxMany` files a
page in one `createMany({ skipDuplicates: true })`, which is the same promise the
single version makes — a key already filed is already said — made by the unique
index instead. The read is paged too, so a tenant's whole upload history is
never in memory at once.

Still open, and none of it urgent:

- **`quoteStay`** does two `Promise.all`s where the second depends on nothing
  from the first. On the `create`, `walkIn` and `moveStay` paths.
- **`applyInboundReservation`** re-reads the channel mapping once per arrival,
  inside the pull loop. A 200-booking pull is 200 identical lookups.
- **`drainOutbox`** runs handlers strictly sequentially, each a network call,
  while `claimOutboxBatch`'s `SKIP LOCKED` was built to allow concurrency.
- **`assignRoom`** and **`updateRoom`** chain reads that do not depend on each
  other.

---

## 8. ~~One security hole~~ — shipped

`billing.postLine` accepted any `roomStayId` with no check that the stay belongs
to the folio's reservation — so a line could be bound to another tenant's stay,
which also poisoned `postRoomCharges`'s idempotency ("does this stay already
have a line"). It is checked now, and refused as **invalid** rather than *not
found*: the row may well exist, and saying so would confirm another tenant's id
to somebody guessing.

## 9. Duplication — the booking transaction collapsed

**`bookStay` in `service.ts`**, called by `create` and `walkIn`. The two were
the same transaction typed twice — take the type's lock, ask whether there is a
room, take a reference, write the guest, write the reservation and its stay,
tell the channels — about eighty lines each, and the router is 120 lines shorter
for it.

The duplication was never theoretical. The room-type lock that closed the
overselling race had to be written into both; the channel push that closed the
silent-availability gap had to be written into both. The next rule about booking
would have been the third.

What genuinely differs stayed an argument rather than a branch: a walk-in is
`CHECKED_IN` in a room already chosen, a booking is `CONFIRMED` and usually has
no door yet, and only a booking consumes a hold or names a guest the directory
already has. Even `soldOutField` is a real difference — a booking's dates are
`checkIn`, a walk-in's are a count of `nights`, and the field is what a form
highlights.

**The caller keeps everything before the transaction**: the range, the occupancy
rule, the quote. Those refusals are worded for the screen that asked — a
walk-in's "too many people" is about a room, a booking's is about a type.

**And `reservationDates` in `model/stay.ts`** — the second collapse, and it
closed a latent bug rather than only saving lines. Three places asked what a
reservation's dates are: `refuseStatusChange` took the true minimum, while the
bookings list and the guest's stay history each took `stays.at(0).checkIn` and
were correct **only because both queries happened to order by `checkIn`**.
Nothing in a type said they must, and removing that `orderBy` for any reason
would have started reporting the wrong arrival on two screens, silently. The
unit test hands the stays over out of order.

Still open, and cosmetic: `properties/server/router.ts` holds four query helpers
with near-twins in `rates/server/router.ts`, and `archiveFilter` is defined
identically in two routers.

---

## 10. Smaller, verified

- ~~**Case-sensitive search on Postgres.**~~ **Shipped**, and it was worse than
  "smaller": on Postgres a bare `contains` compiles to `LIKE`, so
  `directory.listPeople`, `listCompanies` and `identity.adminList` returned
  **nothing at all** unless the term was capitalised exactly as stored. Measured
  against a 500k-row copy of this schema: `иванов` → 0 rows, `Иванов` → 418.
  Nobody types a surname capitalised, so those three searches were dead, not
  slow. The stale comment that said "On Postgres, add it" is deleted, and every
  search now goes through `server/search.ts` — one place, so the next router
  inherits the decision instead of re-making it.
- ~~**`AuditLog` is declared, indexed three ways, and written by nothing.**~~
  **Shipped**; see § 11.
- **Over-fetching without a `select`**, in roughly a dozen places; the ones that
  matter are `assertSubjectInOrg` (fetches a whole row to test existence — a
  `count` would do) and `directory`'s `include` pulling whole `Company` rows for
  a table that shows a name.

---

## 11. The audit trail — shipped, with its limits written down

`writeAudit` takes the caller's transaction client, exactly as `enqueueOutbox`
does, so the record and the act commit together or not at all. `audit.test.ts`
asserts the rollback directly, because the claim is about the database rather
than about the function.

Three decisions worth keeping, each of which cost a migration or a bug:

- **No foreign key to `Organization`.** It cascaded, so the record of who
  deleted a tenant was the deletion's first casualty — the one row somebody
  would actually come looking for. `organizationId` is also nullable now, since
  granting install-wide `ADMIN` belongs to no tenant.
- **An allowlist per entity, never `JSON.stringify(row)`.** A diff built from
  whatever the row holds writes a passport number in clear into an unencrypted
  column, in the table nothing is supposed to delete from.
- **A partial row is not a cleared field.** `identity.updateRole` passed the
  whole user as `before` and `{ role }` as `after`, and the trail reported that
  the admin had cleared the user's email. A missing *side* means created or
  removed; a field missing from a *present* side means the caller passed half a
  row, and the log stays silent about it. A log that invents acts is worse than
  no log.

**Not every mutation, and no generic read auditing.** The list is the management
plane — privilege changes, membership, tenant deletion — which is what OWASP's
logging guidance names and how CloudTrail splits management from data events.
Auditing reads generically is the thing large systems have tried and backed out
of: HHS proposed a per-read access report under HIPAA and withdrew it as
unworkable, and both CloudTrail data events and GCP data-access logs are opt-in
and separately priced because the volume is otherwise ruinous. Reading a
passport stays in **Phase 9**, where it belongs to `IdentityDocument` — which
currently has no writer, so there is nothing to read yet.

**Retention is deliberately unresolved, and "append-only forever" is the wrong
default.** CNIL recommends six months to a year for access logs; keeping
identity data past its purpose is itself the violation the table was meant to
protect against. Whoever adds retention should add it as a pruning job with a
configured window, not as a schema change — and should note that the diff
allowlist is what keeps the pruning question small.

---

## Order

1. ~~**§ 1**, the inventory write path.~~ Shipped.
2. ~~**§ 2.1, § 2.2 and § 2.4**~~ — shipped. `lockRoomType` and
   `lockReservation` are the worked examples now, beside `lockOrganization`.
3. ~~**§ 2.3**~~ and ~~**§ 8**~~ — shipped.
4. ~~**§ 4**, the guard chain.~~ Shipped.
5. ~~**§ 3**~~ — shipped.
6. ~~**§ 5**~~ — measured and shipped. The leftover index tidying in it is
   cosmetic.
7. ~~**§ 6**~~ — shipped.
8. **§ 7**'s two hot paths are done. What is left of it is cold — a pull loop,
   the outbox worker's concurrency, an unbounded delete — and none of it is
   reachable by a user waiting for a screen.
9. ~~**§ 10**'s search bug~~ and ~~**§ 11**, the audit trail~~ — shipped. The
   search one was not cosmetic: it changed three screens from returning nothing
   to returning answers.
10. **§ 9** (duplication) and what is left of **§ 10** by appetite. Neither
    changes behaviour. `create` and `walkIn` being 80% the same code is the one
    worth doing, because the next rule about booking will have to be written
    twice.

Each of § 1, § 2.1 and § 2.2 wants an **integration test that runs two callers
at once**, the way `reservations.test.ts` now does for the series number. The
audit's sharpest lesson is that the existing test for that bug booked twice *in
a row* and passed against broken code for its whole life.
