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

### Still open — § 2.3, the rest of billing

- **`takePayment`** reads by `idempotencyKey`, then creates. A double-click is a
  P2002 **500** rather than the payment that already exists.
- **`close`** reads lines and payments, computes `closedTotalMinor`, and
  updates — **not in a transaction**. A line posted between the two is frozen
  out of a total that can never be re-derived.
- **`postLine`** reads `folio.status`, then creates. A folio closed
  concurrently accepts the line.

All three want the same treatment: `lockReservation` or a transaction around the
decision, and `isUniqueViolation` where a unique index already exists.

---

## 3. Three changes the channels are never told about — **worth fixing**

The stated invariant is that an intent is written in the same transaction as the
change it announces. These change what is for sale and announce nothing:

- **`reservation.walkIn`** — takes a room off *tonight's* market, which is the
  most overbooking-prone moment there is.
- **`reservation.moveStay`** — changes which nights are sold.
- **`applyInboundReservation`** — a booking from Booking.com reduces
  availability for Expedia and Airbnb, and no push is enqueued for any
  connection.

`create` and `setStatus` do it correctly, which is what makes these read as
omissions rather than a decision.

---

## 4. The guard chain costs three round trips before any work — **worth fixing**

`requirePropertyMember` → `requireOrgMember` → `requireUser` is three strictly
sequential queries on **49** property-scoped procedures and **41** org-scoped
ones.

**The user lookup is redundant.** `requireOrgMember` uses only `user.id`, which
*is* `ctx.session.user.id` — and `requireUser`'s own docstring says callers
needing only that should read the session. The membership row cascades from
`User`, so a deleted user already yields no member. Dropping it takes the hot
path from three auth round trips to two.

**The guard also selects too little**, so five call sites immediately re-read
the same property row for `timezone` or `currencyCode`:
`reservations/server/router.ts:210` and `:596`,
`housekeeping/server/router.ts:43` and `:123`,
`properties/server/router.ts:101`. `roadmap.md` states the end-of-phase gate as
*"Does any request do the same lookup twice?"* — this is five instances of it.
The row is tiny; widen the `select`.

This matters because the grid and the day lists **poll every thirty seconds**,
per open desk.

---

## 5. Indexes — **worth fixing**

**`RoomStay` has no index the hot queries can use.** The grid
(`service.ts:338`) and the day list (`:479`) filter
`reservation: { propertyId }` + `checkIn < to` + `checkOut > from` + a status
list. The three available indexes lead with `roomTypeId`, `roomId` and
`reservationId` — and neither query supplies a room or a type. The *window* is
bounded; the *history* is not, so the work grows with every stay the hotel has
ever taken.

Either `@@index([checkIn, checkOut])` on `RoomStay`, or `propertyId`
denormalised onto the stay — which the table conventions argue against, and
which is the reason this needs a decision rather than a patch. **Measure first**
with `EXPLAIN ANALYZE` on a property with real history; the audit found the
absence, not the plan's choice.

Cheaper items in the same pass:

- **Redundant:** `organizations_slug_idx` duplicates the `@unique`;
  `organization_members_organizationId_idx` is the leading column of the
  `@@unique([organizationId, userId])`.
- **Nothing reads them:** `RoomTypeInventory @@index([date])`,
  `RateCalendar`/`RateRestriction @@index([roomTypeId, date])` (every reader
  supplies `ratePlanId` too, so the unique serves them), `Folio` and `Payment`
  `@@index([propertyId, status])`, and
  `HousekeepingTask @@index([assignedMemberId, status])` — that last one implies
  a *my tasks* screen that was planned and never built.
- **Missing:** `EntityTag` has `[personId]` and `[companyId]` but not
  `[propertyId]`, which `listSubjectTags` filters on.

---

## 6. Unbounded input — **worth fixing**

`model/grid.ts` states the principle: *"The cap exists because the window is what
bounds the query — without it one request asks for a year of every room."* It is
applied to the grid and to nothing else. Any signed-in member can send
`from: 2020, to: 2120` to:

- `reservation.availability` — builds 36,500 × N rows in memory and returns them
- `rate.calendar` — the same shape
- `rate.setRates` / `setRestrictions` — a ten-year range becomes a `deleteMany`
  of 3,653 dates plus 3,653 inserts plus a channel push, in one transaction

The cap already exists as a named constant for the grid. Give these one too.

Two more without a `take` that actually grow: `platform.listAttachments`, and
`billing.get`'s `lines`.

---

## 7. Sequential work that should be one batch — **worth fixing**

- **`organization.moduleAccess`** says *"One query rather than two, because the
  shell asks on every navigation."* It is **four**, sequential. The comment is
  wrong about its own code, and this runs on every navigation.
- **`frontDeskGrid`** runs three queries in parallel, then `availability()`
  issues two more. Five queries in two waves where one wave would do — scope the
  inventory and hold queries by `roomType: { propertyId }` rather than by a list
  of ids.
- **`quoteStay`** does two `Promise.all`s where the second depends on nothing
  from the first. It is on the `create`, `walkIn` and `moveStay` paths.
- **`applyInboundReservation`** re-reads the channel mapping once per arrival,
  inside the pull loop. A 200-booking pull is 200 identical lookups.
- **`drainOutbox`** runs handlers strictly sequentially, each a network call to a
  channel manager — while `claimOutboxBatch`'s `SKIP LOCKED` was built to allow
  concurrency. A bounded `Promise.all` uses the design that is already there.
- **`organization.delete`** reads every attachment with no `take`, then loops
  `await enqueueOutbox` per row — two statements each — inside one transaction
  holding the cascade. Ten thousand attachments is twenty thousand sequential
  statements and a lock on `organizations` while it runs.

---

## 8. One security hole — **worth fixing**

`billing.postLine` writes `roomStayId` with **no check that the stay belongs to
this folio's reservation, or even to this property**. `postLineSchema` types it
as a bare optional number. A line can be bound to another tenant's stay, which
also poisons `postRoomCharges`'s idempotency check.

---

## 9. Duplication worth collapsing — **worth fixing**

- **`create` and `walkIn` are ~80% the same code, written twice** —
  the occupancy check, the availability check and its throw, the quote and its
  refusal, then `nextSeriesNumber` + person + reservation in a transaction.
  `reservations/server/router.ts` is 920 lines and holds three multi-step
  transactions inline, while the feature *has* a `service.ts` whose docstring
  names "owns a multi-step transaction" as the threshold. One `bookStay()` would
  also mean § 2.1's lock is written once instead of three times.
- **The arrival/departure/nights reduction is written three times** —
  `reservations/server/service.ts:646`, `directory/server/router.ts:171`, and a
  third reading inside `refuseStatusChange`. That is a rule about what a
  reservation's dates *are*; it belongs in `model/`, once.
- **`billing.folioForReservation` and `openFolioFor`** are two implementations of
  one sentence, including the same reasoning in both docstrings. The router
  should call the service.
- **`archiveFilter`** is defined identically in two routers; the conventions set
  the threshold at the third caller, so this is a note, not yet a change.

---

## 10. Smaller, verified

- **Case-sensitive search on Postgres.** `directory.listPeople`,
  `listCompanies` and `identity.adminList` use `contains` with no
  `mode: "insensitive"`. The comment in `organizations/server/router.ts:86`
  explains it as a SQLite carry-over and says *"On Postgres, add it"*. The
  database changed and three call sites did not.
- **`AuditLog` is declared, indexed three ways, and written by nothing.** The
  table conventions require it ("who read this passport"). It is also what a
  booking's **История** tab would read — the reason that tab was dropped from
  the desk.
- **Over-fetching without a `select`**, in roughly a dozen places; the ones that
  matter are `assertSubjectInOrg` (fetches a whole row to test existence — a
  `count` would do) and `directory`'s `include` pulling whole `Company` rows for
  a table that shows a name.

---

## Order

1. ~~**§ 1**, the inventory write path.~~ Shipped.
2. ~~**§ 2.1, § 2.2 and § 2.4**~~ — shipped. `lockRoomType` and
   `lockReservation` are the worked examples now, beside `lockOrganization`.
3. **§ 2.3**, the last three in billing. **Top of the list.**
4. **§ 4**, the guard chain — one change, every procedure faster.
5. **§ 8**, then the rest by appetite.

Each of § 1, § 2.1 and § 2.2 wants an **integration test that runs two callers
at once**, the way `reservations.test.ts` now does for the series number. The
audit's sharpest lesson is that the existing test for that bug booked twice *in
a row* and passed against broken code for its whole life.
