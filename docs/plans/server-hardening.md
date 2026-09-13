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

## 2. Read-then-write, five times — **blocking**

### 2.1 The last room oversells

`reservations/server/router.ts:192` reads `availability()`. The transaction that
writes the stay opens at `:238`. Between them, another request reads the same
count. `walkIn` (`:648` → `:687`) and `moveStay` (`:823` → `:868`) have the same
shape.

The comment at `:189` says the database refuses an overlapping room — and it
does, but the exclusion constraint is
`EXCLUDE … WHERE ("roomId" IS NOT NULL AND …)`. **An unassigned stay has no
protection at all**, and unassigned is the normal case: every advance booking,
and every channel booking (`channels/server/inbound.ts:138` — *"No room. The
channel sold a type"*). `InventoryHold` bounds it only when the caller passes a
`holdKey`, which the desk's own booking path leaves optional.

Two clerks sell the last Double for the same night. Both succeed. The grid shows
eleven stays against ten rooms.

**The fix has a worked example in this repo.** `lockOrganization`
(`platform/server/attachments.ts:95`) is exactly this pattern done right for the
storage quota: take the lock, then decide, then write, all inside one
transaction. Availability wants the same — lock the `RoomTypeInventory` rows for
the range, or the room type, and move the check inside.

### 2.2 A reservation can end up with two folios

`billing.folioForReservation` (`billing/server/router.ts:63`) and `openFolioFor`
(`billing/server/service.ts:37`) both read *"is there a non-VOID folio"* then
create one. `billing.prisma` has `@@unique([propertyId, number])` and **nothing
stopping two open folios on one reservation**. A clerk pressing *Open the bill*
while the check-out transaction is running gets two folios, two burnt numbers,
and the room charges on only one of them.

A partial unique index — one non-VOID folio per reservation — turns this from a
race into an error the second caller can recover from.

### 2.3 Three more in billing

- **`takePayment`** (`router.ts:236`) reads by `idempotencyKey`, then creates.
  The comment says *"the second attempt reads the first rather than racing
  it"*; under concurrency it races it, and the unique index turns a
  double-click into an unmapped P2002 **500** instead of returning the payment
  that already exists.
- **`close`** (`router.ts:300`) reads lines and payments, computes
  `closedTotalMinor`, and updates — **not in a transaction**. A line posted
  between the two freezes a total that excludes it, permanently: `folio.ts:88`
  explains why that number can never be re-derived.
- **`postLine`** (`router.ts:164`) reads `folio.status`, then creates. A folio
  closed concurrently accepts the line anyway.

### 2.4 `enqueueOutbox` turns a duplicate key into a failed booking

`platform/server/outbox.ts:83` is `findUnique`-then-`create` against a `@unique`
column. `pushKey` is minute-grained, so two writers in the same minute compute
the same key, both miss on the read, and the second `INSERT` raises P2002 —
**aborting the transaction it was enqueued in**.

On `create` and on check-out this is accidentally masked, because
`nextSeriesNumber`'s increment takes the series row lock earlier in the same
transaction and serialises the two. It is **not** masked on `setStatus` to
`CANCELLED` or `NO_SHOW`, nor on `rate.setRates`, `rate.setRestrictions`,
`channel.map` or `channel.unmap`. Two cancellations in the same minute: one
fails with a raw duplicate-key 500 and the cancellation rolls back.

`createMany({ skipDuplicates: true })`, or catching P2002 and treating it as
*already enqueued* — which is what the key means.

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
2. **§ 2.1 and § 2.2**, the two overselling races, using `lockOrganization` as
   the worked example. **This is the top of the list now.**
3. **§ 2.4**, because it turns an ordinary cancellation into a 500.
4. **§ 4**, the guard chain — one change, every procedure faster.
5. **§ 8**, then the rest by appetite.

Each of § 1, § 2.1 and § 2.2 wants an **integration test that runs two callers
at once**, the way `reservations.test.ts` now does for the series number. The
audit's sharpest lesson is that the existing test for that bug booked twice *in
a row* and passed against broken code for its whole life.
