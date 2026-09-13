# Roadmap

The order to build the PMS in. What each phase *is* lives in
[hotel-pms.md](hotel-pms.md); this file is only the sequence, so the two cannot
disagree.

Phases already finished are not listed — they are in [history](../history.md).
A phase is done when its **Done when** is true, not when its work feels
complete.

**A gap in the numbering is not always a finished phase.** *Phase 3 — Design
direction* was folded into **Phase 12**, which now carries its `Done when`
unchanged: the product wears shadcn's defaults until the end, where they cost
least to replace. The reasoning is in history under "where styles live".

Two rules hold across every phase:

- **The rule before the router.** Anything provable without a database goes in
  `model/` with tests, first. Logic that lands inside a tRPC procedure cannot be
  tested without a service, which is the property that makes `model/` worth
  having.
- **No screen before its procedure.** A screen built on a procedure that does
  not exist yet is a screen built on a guess.

---

## Phase 7 — Distribution *(machinery done, `Done when` not met)*

Everything but the vendor. The outbox worker drains with retries, backoff and
dead letters; room types and rate plans map; availability and rates push as a
diff against `ChannelSyncState`; reservations pull idempotently; the overbooking
policy is written down and tested. Every change to what is for sale announces
itself in the transaction that makes it, and a test loops over the ways the
market moves so the next omission fails rather than oversells.

**What is left is one integration.** `ChannelAdapter` is two methods and
`ADAPTERS` is deliberately empty — choosing the vendor is a commercial decision,
not an engineering one, and it is the same question as which jurisdiction Phase 9
serves first. Until then the honest phrase is *ready for*, not *connected to*.

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

- The document writer, using `encryptField` from `server/crypto.ts` — the
  primitive, its key and its tests already exist; what does not is anything that
  calls it. The retention job is half-built: `sweepExpiredRetention` already
  purges attachments past `expiresAt` in the outbox worker, and `purgeAfter`
  needs the same pass with a second predicate.
- A fiscal adapter for one jurisdiction; a registration adapter for the same one.
- Access to a passport is audited, and refusable, separately from reading a name.
  `writeAudit` and the `VIEW` action exist already; what does not is a reader to
  put them on, since `IdentityDocument` has no writer yet. Audit the document
  screen specifically — a generic read log is the thing HHS proposed under HIPAA
  and withdrew as unworkable, and why CloudTrail data events are opt-in.
  Retention belongs here too: CNIL says six months to a year for access logs,
  which the same `purgeAfter` pass can serve.

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

## Phase 12 — Visual design and motion

Last on purpose. Until here the product wears shadcn's defaults, which are
good enough to run a hotel and cheap to replace.

- A density scale for screens read all day — a forty-room grid is not a
  marketing page.
- Colour as data: a **scale**, replacing the grid's placeholder palette. The
  accessibility floor is already met and is not this phase's to redo — the rule
  and its worked example are in `ui-patterns.md` § Colour as data, because a
  grid that reads only in colour could not wait for the last phase.
- Keyboard rules for the repetitive work: check-in, assignment, search.
- Motion, last of all, and only where it explains something — a row moving, a
  panel opening. Animation that decorates is animation that delays.

**Done when** the rules are in `ui-patterns.md` and one shipped screen has been
rebuilt against them — a reference, not a mockup.

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

**Client.** Did any route's first-load bundle grow — `npm run bundle` — and is
the growth something that route actually renders? Does anything the shell draws on every navigation
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

- **`RoomTypeInventory` has no computed availability.** Sold is derived on every
  read by design — correct, and the first thing to measure when a channel push
  is doing it for ninety days at once in **Phase 7**.
- **Bundle floor.** `npm run bundle`, after a build: **819,257 bytes shared by
  every route**. Re-recorded at the end of Phase 5, and it went *down* by 5.9 kB
  — `NiceModal.Provider` moved out of the root `Providers` and into the
  dashboard layout, so the auth routes and the landing page stopped carrying a
  modal registry they never open. The move was made to fix every dialog in the
  product; this was the second, unlooked-for half of it. Anything that moves those
  without adding a screen is a regression. Re-record them when a phase ends: a
  floor left behind by two phases reads as a regression that never happened.

  These are raw chunk bytes and are **not** comparable to the 245 kB Next 15
  used to print — Next 16 removed `size` and `First Load JS` from the build
  output, so the unit changed once, deliberately. See `scripts/bundle.mts`.

## Not phases

These have no natural slot and land when the phase that needs them arrives:

- **Real-time push.** Decided in Phase 4: the desk polls every 30 seconds
  rather than holding a socket a route handler cannot hold. Revisit when a
  channel manager starts writing bookings nobody at the desk made — that is
  **Phase 7**, and it is when 30 seconds stops being fast enough.
- **JSON columns.** Postgres has a real `Json` type; `customFields`, `options`
  and `diffJson` are `String` from the SQLite era. A migration that earns itself
  the first time one needs filtering.
- **CSV export of a guest's record.** Pairs with `purgeAfter` — the same
  obligation, read and delete.
- **Smart locks.** One plan per vendor, once Phase 9's credential lifecycle is
  real.
- **[Notifications](notifications.md).** An in-app feed and the bell the
  dashboard header already has a hole for. It has no phase because it is owed to
  several: Phase 7's dead letters, housekeeping's assignments and billing's
  payments all want to tell somebody. Whichever of those is next carries it.
- **[Desk generation](desk-generation.md).** The machinery that makes a second
  desk a registry entry rather than a copied layout — and, on the way, the
  sidebar the one desk is missing (no sign-out, no property switcher, no way to
  reach Setup). Those defects are worth fixing on their own; the generation is
  what makes them worth fixing *once*. Pairs with
  [second-surface.md](second-surface.md), which prices the other axis.
- **[The data table](data-table.md).** URL state is mandatory today, so a table
  cannot live in a dialog. A port of a fix already shipped upstream, which is
  why it is a note here rather than a phase.
