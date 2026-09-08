# Roadmap

The order to build the PMS in. What each phase *is* lives in
[hotel-pms.md](hotel-pms.md); this file is only the sequence, so the two cannot
disagree.

Phases already finished are not listed — they are in [history](../history.md).
A phase is done when its **Done when** is true, not when its work feels
complete.

Two rules hold across every phase:

- **The rule before the router.** Anything provable without a database goes in
  `model/` with tests, first. Logic that lands inside a tRPC procedure cannot be
  tested without a service, which is the property that makes `model/` worth
  having.
- **No screen before its procedure.** A screen built on a procedure that does
  not exist yet is a screen built on a guess.

---

## Phase 3 — Design direction

Before the grid, not after it. The grid is the largest piece of UI in the
product and the hardest to rework, so the decisions below have to exist before
it is drawn — otherwise they are made by accident, inside it, and inherited by
everything after.

This is not a visual refresh. It is the set of answers a receptionist's
eight-hour day depends on:

- **Density.** A property manager reads a screen with forty rooms on it. The
  default component sizing is built for marketing pages, and a comfortable
  table is the wrong table here.
- **Keyboard first.** Check-in is repetitive and done under pressure. Which
  actions have keys, what focus does after a dialog closes, whether a grid cell
  is reachable without a mouse.
- **Error legibility.** `lib/errors.ts` decides *where* a failure appears; this
  decides whether it is readable at a glance while someone is waiting at the
  desk.
- **Colour as data.** The grid encodes reservation state in colour. It needs a
  scale that survives dark mode and does not rely on hue alone, because some of
  the people using it will not see the difference.
- **Dark mode and contrast.** `next-themes` is installed and nothing has been
  designed for it. Front desks run dim at night.
- **Responsive floor.** Housekeeping is a phone held one-handed; the grid is a
  desktop. Decide which screens are which, rather than making everything bend.

**Done when** `docs/guides/ui-patterns.md` states the density scale, the
keyboard rules and the state palette, and one existing screen has been rebuilt
against them as the reference — not a mockup, a shipped screen.

## Phase 4 — The front desk

The reservation grid, and the day a receptionist actually works.

- Rooms down, dates across, one month visible, drag to move and resize to
  extend. Not the `DataTable` stack — a virtualised two-axis timeline with its
  own range-query shape.
- Arrivals and departures for a date; assign a room; check in and out.
- A refused drag says why.

**Done when** a receptionist can run a day — arrivals, assignment, check-in,
check-out — without touching SQL.

## Phase 5 — Guests and housekeeping

Turn the `DIRECTORY` module on, and give the floor its screen.

- Guest and company screens, stay history, tags, notes.
- The housekeeping board: room state, today's tasks, mark clean, report a fault.
- Mobile-first for housekeeping; it is used standing up.

**Done when** a full stay cycle happens in the app: booked, arrived, occupied,
departed, cleaned.

## Phase 6 — Money

- Post charges to a folio, split a folio, close it.
- Take a payment; refund one.
- Reservation and invoice numbers from `NumberSeries`, inside the transaction
  that consumes them.

**Done when** a stay produces a bill that balances, settled and closed, with
numbers that never repeat.

## Phase 7 — Distribution

The first phase with an outside system, so it is also the first that needs the
outbox to actually run.

- A worker draining `OutboxTask`: retries, backoff, dead letters.
- One channel-manager integration; map room types and rate plans.
- Push availability and rates as a diff against `ChannelSyncState`; pull
  reservations idempotently.
- An overbooking policy, written down, because sync is not instant.

**Done when** a rate change reaches the channel and a booking made there appears
at the front desk without anyone retyping it.

## Phase 8 — Direct sales

- A public availability and booking flow, unauthenticated by design.
- Guests reach their booking by `GuestAccessToken`, never an account.
- Rate limiting, and a CSP story for embedding the widget.
- **The legal pages, which are not marketing.** Privacy notice, terms, and a
  cookie/consent surface. This is the phase where a member of the public hands
  over a name, a card and eventually a passport number, and every regime that
  governs that expects the notice to exist *before* the collection does.

**Done when** a guest books and pays without a staff member touching it.

## Phase 9 — Compliance

The highest-risk code in the product, and the reason a regional PMS can exist.

- Field-level encryption for `IdentityDocument.numberEncrypted`, plus the
  retention job that reads `purgeAfter`.
- A fiscal adapter for one jurisdiction; a registration adapter for the same one.
- Access to a passport is audited, and refusable, separately from reading a name.

**Done when** a payment produces a registered fiscal receipt and a check-in
files a guest, both replayable without duplicating.

## Phase 10 — Analytics

Occupancy, ADR, RevPAR, debt, and the audit trail as a readable report.

**Done when** the numbers match a hotelier's own arithmetic — pin the formulas
in `model/` with tests, because they will be checked.

## Phase 11 — The public site

Marketing pages: what the product is, pricing, contact. Deliberately last, and
deliberately questionable — a marketing site has no dependency on any of the
above and every reason to be a separate deployment that does not carry this
one's auth, database and bundle.

**Decide rather than default.** If it lives here, it wants its own route group
and its own layout, and it must not pull the dashboard's client bundle. If it
lives elsewhere, this phase is one line in a README and the `/` route becomes a
redirect to sign-in.

Do not confuse this with the legal pages in Phase 8. Those are a condition of
collecting guest data; this is a shop window.

---

## How a phase ends

**Optimisation is a gate at the end of each phase, not a phase of its own.**
Both alternatives are worse: tuning before the shape settles is guessing, and
one late performance phase means unpicking decisions taken across months by
someone who no longer remembers why.

A phase is not finished until this pass has been made **over what that phase
created** — nothing else. It is short by design; if it is long, the phase was.

**Server.** Does any request do the same lookup twice? Does a list do one query
per row? Does every new query shape have an index, tenant column first?

**Client.** Did any route's first-load bundle grow, and is the growth something
that route actually renders? Does anything the shell draws on every navigation
have a `staleTime`? Does a table keep the previous page while the next loads,
or collapse to a skeleton?

**Data.** Is any derived value being recomputed per row that should be one
aggregate? Is any read hot enough to want a denormalised shape — and is that a
measurement or a feeling?

The rule for all of it: **measure the thing, change one thing, measure again.**
The client barrels came out because two builds disagreed by 116 kB, not because
barrels sound heavy.

### Known, deferred, and deliberate

Carried until the phase that touches them, so they are not rediscovered as
surprises:

- **The grid will want a denormalised read model.** A month for sixty rooms is
  a range query across reservations, stays, rooms and rate calendar. Decide it
  against a real query plan in **Phase 4**, not in advance.
- **`RoomTypeInventory` has no computed availability.** Sold is derived on every
  read by design — correct, and the first thing to measure when a channel push
  is doing it for ninety days at once in **Phase 7**.
- **Bundle floor.** `First Load JS shared by all` is 242 kB, and `/dashboard` is
  402 kB. Anything that moves those without adding a screen is a regression, and
  the build prints both.

## Not phases

These have no natural slot and land when the phase that needs them arrives:

- **Real-time push.** The grid and the housekeeping board both go stale without
  it. Cheapest to add during Phase 4, when the grid exposes the need.
- **JSON columns.** Postgres has a real `Json` type; `customFields`, `options`
  and `diffJson` are `String` from the SQLite era. A migration that earns itself
  the first time one needs filtering.
- **CSV export of a guest's record.** Pairs with `purgeAfter` — the same
  obligation, read and delete.
- **Smart locks.** One plan per vendor, once Phase 9's credential lifecycle is
  real.
