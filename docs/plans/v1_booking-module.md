> **Extracted from git history — not a live plan.**
>
> Written before the product was decided, recovered from `origin/master` for
> the one part of it that has not shipped. Kept at `v1_` so it is never mistaken
> for something to work from. What survives is marked below; the rest is either
> built or was superseded when the product became a hotel PMS.

> **Superseded in full.** Its resource/availability/reservation model is the
> reservation grid, which shipped: `RoomType`, `Room`, `RoomTypeInventory`,
> `Reservation`, `RoomStay`. Slot maths is `features/reservations/model/stay.ts`.
> The timezone decision became `Property.timezone`. Double-booking is a Postgres
> exclusion constraint. The open question — is booking customer-facing — was
> answered: a guest is a `Person` with a token, never an account.
>
> Nothing here is outstanding.

# Booking, as the second module

Resources, availability and reservations, scoped to an organization. Depends on
the module contract in [crm-module.md](crm-module.md) — this plan adds a
domain, not a mechanism. **If Booking needs a change to core that CRM did not
already need, the contract is wrong and that is the finding**, not the schema
below.

## The evidence

- `features/organizations/model/registry.ts:22` — a segment added here appears
  in the org sidebar with no nav code. Booking is one entry.
- `server/auth.ts:114,126` — `requireOrgMember` and `requireOrgManager` already
  answer "may this person touch this organization". Booking procedures compose
  them; there is no new auth layer.
- `features/organizations/model/organization.ts:190` —
  `listOrganizationsSchema` fixes the list contract
  (`{ filter, orderBy, pagination }` → `{ items, total, meta }`). A booking list
  that copies it gets the DataTable stack for free.
- `docs/guides/local-development.md:125` — moving to Postgres is documented as
  three edits. Read that section before Phase 5; the reason is below.

## The domain

| Table | Is | Key fields |
|---|---|---|
| `Resource` | the bookable thing — a room, a table, a person's time | name, slug, capacity, durationMinutes, organizationId |
| `Availability` | when a resource is open | resourceId, weekday, startMinute, endMinute |
| `AvailabilityException` | a closure or a one-off opening | resourceId, date, closed, startMinute?, endMinute? |
| `Booking` | a reservation | resourceId, userId, startsAt, endsAt, status, organizationId |

`status` is a string column with the values in `model/`, like every other enum
here — SQLite has no enum type.

## The four decisions

### 1. Double-booking is this module's last-admin guard

It is the one invariant whose failure is unrecoverable and visible to a
customer, so it gets the same treatment: the rule in `model/`, tested; the
query and the throw in the router.

**SQLite cannot enforce it.** Postgres can, with `EXCLUDE USING gist` over a
`tstzrange` — one constraint, no race. On SQLite the best available is a
transaction that re-checks overlap before insert, which leaves a window between
check and write. That window is real and must be **written down in the code**,
not discovered in production.

This is the strongest argument the codebase has yet produced for the Postgres
switch. Phase 5 decides it; Phases 1–4 do not depend on the answer.

### 2. Slot maths lives in `model/`

"Do these two ranges overlap", "what slots does this availability generate for
this date", "is this booking inside opening hours", "does it respect the
resource's duration" — pure functions over pure data, no database, no React.

Same reasoning that moved the last-admin rule out of the router: this decides
both what the router permits *and* what the UI offers, so a disagreement is a
slot the calendar offers and the server refuses. Expect this to become the
largest test file in the repo, and write it **before** the router.

### 3. Timezones, decided once

Store UTC in every column. Put an IANA zone on `Organization` — the resource's
opening hours mean nothing without one — and render in the viewer's zone.
Availability is stored as minutes-from-midnight **in the organization's zone**,
resolved to an instant per date, because that is what survives daylight saving.

Getting this wrong is the defining bug of booking software, and it is cheap now
and a data migration later.

### 4. Who may book

`bookingStatements` in the module manifest, merged into the org table by the
contract: `resource: ["create","update","delete","list"]` and
`booking: ["create","cancel","list","manage"]`. A MEMBER books and cancels
their own; an ADMIN manages anyone's. "Own" is a filter, not a permission —
`cancel` on someone else's booking is `manage`.

## Phases

| # | Scope |
|---|---|
| 1 | `booking.prisma`, `model/` types, status enum, manifest with statements and grants |
| 2 | Slot maths in `model/` **and its tests** — overlap, generation, DST boundary, zero-length, exception days |
| 3 | `server/` — resources and availability CRUD, tenant-scoped through `requireOrgManager` |
| 4 | `server/` — booking create/cancel/list, overlap guarded inside a transaction |
| 5 | The Postgres decision, driven by whether concurrent booking is real |
| 6 | `client/` — resource table on the DataTable stack, a slot picker, booking form on `FormDialog` |

Phase 2 before Phase 3: the rules are provable with no database, and the router
should be assembled around something already proven.

## Done when

- Booking adds **one line** to the module registry and nothing else to core.
- An organization with Booking disabled 404s on `/dashboard/orgs/<slug>/bookings`
  and its procedures refuse — not just the nav.
- Two overlapping bookings cannot both be accepted; the test names the SQLite
  race explicitly rather than pretending it is closed.
- No booking query reaches the database without `organizationId` in its `where`.
- A booking crossing a daylight-saving boundary lands on the intended wall time.
- `npm run lint`, `npm test`, `npx tsc --noEmit` and `npm run build` pass.

## Open question

**Is booking customer-facing?** Everything above assumes staff-only: a booker
is an `OrganizationMember`, and `requireOrgMember` is the gate. If someone
without a membership can book, that is a second identity story — public links,
tokens, or customer accounts distinct from `User` — and it does not fit the
org-scoped contract at all. Decide before Phase 3; it changes the schema, not
just the routes.
