# Hotel PMS

An all-in-one property management system: reservations, distribution, rates,
guests, housekeeping, billing, compliance, locks and analytics, run from one
dashboard.

This is what the product is: the domain, the decisions that are expensive to
reverse, and what each module contains. **The order to build it in is
[roadmap.md](roadmap.md)** — this file carries no sequencing, so the two cannot
drift apart.

## Prerequisites no module can be finished without

| Needed | By | Why it cannot be deferred |
|---|---|---|
| A job queue draining `OutboxTask` | channels, locks, fiscal, registration | Every external system is slow and fails. Retries, idempotency and dead letters are not optional. |
| Real-time push | grid, housekeeping | A receptionist and a housekeeper must not see stale state; there is no subscription transport. |
| Field-level encryption | passports, payment references | `IdentityDocument.numberEncrypted` is named for an obligation the code does not meet. |

## The modelling decisions that are expensive to reverse

### 1. A guest books a *room type*, not a room

This is the decision the whole system turns on. Availability is counted against
a **RoomType** (inventory of N rooms of that category); a **physical Room** is
assigned at or before check-in. Rates, restrictions and OTA mappings all hang
off RoomType, never off a Room.

Model it the other way and every rate plan, every channel push and every
overbooking rule has to be rewritten.

### 2. `Organization` is the tenant; a hotel is a `Property`

Same trap as `Account` in the CRM plan. `Organization` here already means the
account that pays for the software. A management company with four hotels is
one Organization and four Properties. Every table below carries `propertyId`,
and `propertyId` resolves to an Organization for the existing guards.

### 3. Availability is derived, never stored as a boolean

"Free" is `inventory − confirmed reservations − blocks` for a date range, per
RoomType. A stored `isAvailable` flag will drift the first time a booking is
cancelled by a channel and nobody notices. Storing a **daily inventory row**
per RoomType/date is the usual compromise, and it is also what a channel
manager needs to push.

### 4. Reservation state is a machine, not a status string

`enquiry → confirmed → checked-in → checked-out`, with `cancelled` and
`no-show` as terminal branches. Transitions carry side effects — inventory,
folio, keycard, housekeeping status — so the legal transitions belong in
`model/` as a pure function and are tested there. A free-form status column
lets a room be checked out twice.

### 5. Double-booking is now distributed

The booking plan called this its last-admin guard. Here it is worse: a room can
be sold at the front desk and on Booking.com in the same second. Two defences,
both required:

- **Inside**: a Postgres exclusion constraint over the stay range. The database
  refuses, not the application.
- **Outside**: the channel manager is eventually consistent by nature, so the
  system needs an explicit **overbooking policy** and a conflict resolution
  path. Pretending sync is instant is how a guest arrives to no room.

## The ten modules, grouped by what they actually are

**Core domain — build these, they are yours.**

1. **Reservation grid (chessboard)** — rooms × dates, drag-to-move, resize to
   extend, split stays, colour by state. This is *not* the DataTable stack: it
   is a virtualised two-axis timeline with its own range-query shape. Treat it
   as its own component with its own data contract, and expect it to be the
   single largest piece of UI in the product.
2. **Booking engine + embeddable widget** — public, unauthenticated, and
   therefore a **second identity story**: a guest is not an `OrganizationMember`.
   Needs its own rate limiting, its own CSP story for embedding, and its own
   session model.
4. **Rates and restrictions** — seasonal calendars, weekend rules, MinLOS,
   early-bird and non-refundable plans, occupancy and child pricing. A rate
   engine is a subsystem: one function that answers "price for this room type,
   these dates, this occupancy, this plan" and is tested exhaustively in
   `model/`.
5. **Guest CRM** — profiles, stay history, preferences, corporate accounts,
   blacklist. Note the blacklist is a *legal* artefact, not a tag; it needs a
   reason, an author and a review date.
6. **Housekeeping** — mobile-first, room state machine (clean / dirty /
   in-progress / out-of-order), driven automatically by check-out. The one
   module that is genuinely small.
10. **Analytics** — occupancy, ADR, RevPAR, debt, audit log. These are defined
    metrics with standard formulas; pin them in `model/` with tests, because
    every hotelier will check your RevPAR against their own arithmetic.

**Integration surfaces — these are not features, they are projects.**

3. **Channel manager (Booking.com, Airbnb, Ostrovok…)** — each channel is its
   own API, its own certification, its own mapping table and its own failure
   modes. Budget one plan and one release *per channel*. Shared core: mapping,
   an outbound availability/rate push queue, an inbound reservation poller or
   webhook, and idempotency keys everywhere.
9. **Smart locks** — vendor SDKs, key encoding, time-bounded PINs tied to the
   reservation state machine. One plan per vendor.

**Compliance — jurisdictional, and the highest-risk code here.**

7. **Billing and fiscal registers** — online fiscal cash registers are
   country-specific and legally binding. This needs a **country adapter**
   interface, not a generic implementation.
8. **Immigration / police registration** — converts passport data into official
   filings. Same shape: an adapter per jurisdiction.

Both of these store or transmit identity documents. That means field-level
encryption, a retention policy, an access audit trail, and a deliberate answer
to "who on staff may read a passport number". None of that exists today, and it
is not something to retrofit after launch.

## Done when

- A room cannot be sold twice, refused by a database constraint rather than by
  application code.
- The grid renders a month for a 60-room property, and a drag that would overlap
  is refused with the reason shown.
- No query reaches the database without a property scope in its `where`.

## Decisions taken

Recorded so they are not re-argued. Each is reversible only at a cost, and the
cost is named.

1. **Multi-property from the start.** `Property` belongs to `Organization`;
   domain tables carry `propertyId`. Adding it later is a migration through
   every table.
2. **A guest is not a user** — a `Person` reached by a time-limited token, never
   an `OrganizationMember`. The same mechanism issues door PINs.
3. **Multi-currency**, `Currency` and `ExchangeRate` as tables, money as integer
   minor units.
4. **Postgres, not SQLite.** The overlap invariant is an exclusion constraint
   SQLite cannot express, and this is concurrent and handles money.
5. **Buy channel management, do not build it.** One wholesale API reaches 60+
   OTAs behind a single integration and a single certification; direct
   connections mean repeating certification per channel forever.
6. **One jurisdiction first, behind an adapter.** Fiscal and registration
   modules are country-locked. Design for one country; generalise when a second
   is paid for, never before.
7. **The booking widget comes late.** It is a second identity story and a
   public attack surface, so everything before it stays behind existing auth.

## Smaller, once the above exists

- **CSV export of a guest's data.** Inherited from the CRM plan for a different
  reason: not a sales report, a person asking what is held about them. It pairs
  with `IdentityDocument.purgeAfter`, which is the deletion half of the same
  obligation.

## Open questions

- Which jurisdiction is first? It decides the fiscal and registration adapters,
  and some of what `IdentityDocument` must hold.
- Which OTA is connected first?
- Is the product the PMS alone, or PMS plus channel management? It changes
  whether distribution is core or an upsell.
