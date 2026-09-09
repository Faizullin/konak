# The external API

Letting somebody else's software talk to this one, with a key that says who they
are and what they may do.

Nothing here is built. This is the shape, the decisions that are expensive to
reverse, and what has to exist first.

## Why it is not the API we already have

tRPC is the app's own transport, and it is deliberately not a public interface.

**The decisive fact is on the wire.** `trpc.ts:20` sets `transformer: superjson`,
so a response is not plain JSON:

```json
{ "json": { "date": "2027-03-04T00:00:00.000Z", "total": 12000 },
  "meta": { "values": { "date": ["Date"] }, "v": 1 } }
```

A caller has to unwrap `.json` and understand `meta` to read a date. For a
TypeScript client that is invisible and worth it — dates arrive as `Date`. For a
PHP website, an automation platform or a channel manager it is a bespoke
encoding nobody has a library for. Removing the transformer to fix that would
cost the app the thing it is there for.

Three more, none of them fatal alone and all of them true:

- **The contract is a TypeScript type.** A caller who is not this repository has
  nothing to hold on to — no schema to publish, no version to pin.
- **There is no version.** Renaming a procedure or a field is a client-side type
  error here and a silent break for anyone outside.
- **The routes are internal by construction.** `src/server/root.ts` is
  "composition and nothing else"; exposing it would make every procedure a
  public commitment the moment it is written.

### So: REST outside, tRPC underneath

Not a choice between them. The route handler at `/api/v1/…` publishes plain,
versioned JSON — and calls the same procedures through `createCallerFactory`,
with an API-key context instead of a session. That is the same mechanism
`tests/server/harness.ts` already uses to call procedures without HTTP.

One implementation of every rule, two ways in, and the public shape free to stay
still while the internal one changes. A `trpc-to-openapi` package could generate
the REST layer instead, and is worth a look at implementation time — but it
would publish procedure shapes directly, which is the coupling this is avoiding.

## What already exists to build on

More than expected, because the schema was written with this in mind:

- **`publicId`** on `Reservation` and `RoomType` — UUIDv7, unique, and
  `inventory.prisma:15` says why: *"Named by the public availability widget,
  which has no session to check."* External callers never see an integer id.
- **`GuestAccessToken`** in `access.prisma` is the pattern, already in the
  schema: `tokenHash` unique, a `scope` column, `expiresAt`, `revokedAt`,
  `lastUsedAt`. An API key is the same shape with a different owner.
- **`server/crypto.ts`** has `secretsMatch` — a timing-safe compare — and
  `lastFour`, which is exactly how a key is shown back to the person who made
  it.
- **88 domain codes.** A public API's error body wants a stable machine-readable
  code far more than the app did, and every refusal already has one.
- **Five `createAccessControl` statement tables.** Scopes are the same idea and
  should use the same primitive rather than inventing a second one.

**Better Auth does not help here.** Version 1.7.3 ships nineteen plugins —
`bearer`, `jwt`, `one-time-token` among them — and **no API key plugin**. This
is ours to build, which is the honest reading rather than a gap to be surprised
by later.

The sibling projects were checked and do not apply: `nextcrm-app`,
`kidio-general-api` and the rest hold *outbound* keys, for calling OpenAI and
Resend. That is the opposite direction and a different problem.

## `GuestAccessToken` is a different thing, and should stay one

It is tempting, because the row looks identical: a hashed token, a scope, an
expiry, a revocation, a `lastUsedAt`. `access.prisma:83` says what it actually
is:

> The guest's way in: a link they were emailed, scoped to one thing they may
> do. **This is the whole of the second identity story** — no password, no
> account, no membership.

An API key would be the **third**. The three differ on every axis that matters:

| | `User` + session | `GuestAccessToken` | API key |
|---|---|---|---|
| Held by | a staff member | a member of the public | a machine |
| Bound to | an organization, by membership | **one reservation** | **a whole workspace** |
| Lives | until sign-out | hours or days | months |
| Issued | by signing up | automatically, when a booking is made | deliberately, by a manager |
| If it leaks | one person's access | one booking | every booking the tenant has |

Two of those are not preferences:

- **The foreign key.** `GuestAccessToken` cascades from `Reservation` — delete
  the booking and the link dies with it, which is correct. An API key must
  survive every reservation it ever touched, so it hangs off `Organization`. One
  table cannot have both parents.
- **The scope vocabulary.** `BOOKING_VIEW`, `ONLINE_CHECK_IN`, `FOLIO_VIEW` are
  three things one guest may do to one row. An API key's scopes are
  resource-and-verb across a tenant. Sharing a column would mean a `scope`
  string that means two unrelated things depending on which foreign key is set,
  which is the kind of column nobody can safely query.

**What they should share is the mechanism, not the model.** One
`hashToken` / `verifyToken` pair in `server/crypto.ts`, beside `secretsMatch`
which already does the timing-safe half. Two tables, one implementation of "a
bearer token is stored as a hash and compared without leaking its length".

## Whose permissions does a key carry?

This is the question "let an external app add automations" actually asks, and it
has a wrong answer that is easy to reach by accident.

**A key must not be able to do what the person who made it cannot.** If a MEMBER
can create a key with `reservation:cancel`, the role table stops meaning
anything — the escalation is one HTTP call away. So the scopes offered at
creation are the intersection of what is declared and what the creator's
`OrgRole` already grants.

**Then the harder half: what happens when that person leaves?** Two models, and
the choice is not obvious:

- **A personal token** acts as its creator and dies with their membership.
  Honest about accountability, and it breaks every automation the day someone
  changes job — which is the outage nobody predicts.
- **A workspace key** belongs to the organization and outlives its creator. The
  automation survives staff turnover, and the audit trail has to name the key
  rather than a person, because there may no longer be one.

**Recommended: workspace keys, and only OWNER or ADMIN may mint one.** An
automation that stops when a receptionist leaves is worse than useless, and
restricting creation to a manager is what keeps the escalation closed without
tying the key to a person who will not always be there. `AuditLog` records the
key, and the key records who created it — so "who did this" is answerable
without the key depending on them still being here.

A personal-token model is the right answer for a *different* feature — a member
of staff scripting against their own view — and it is not this one.

## The key

```
kok_live_7f4a…            shown once, at creation
```

- **Stored as a hash, never as itself.** SHA-256, unique, indexed — the lookup
  is by hash, and `secretsMatch` does the final compare. A leaked database does
  not leak working keys.
- **A prefix that says what it is**, so a key found in a log or a repository is
  recognisable as this system's and revocable. `kok_live_` and `kok_test_`.
- **`lastFour` for display.** A person with six keys has to be able to tell
  which one to revoke.
- **Owned by an `Organization`, optionally narrowed to one `Property`.** Every
  request is scoped by the key rather than by anything the caller sends, which
  is what makes a wrong `propertyId` in a request body a NOT_FOUND rather than
  another tenant's data.
- **Expiry and revocation, both.** `revokedAt` is immediate; `expiresAt` is the
  discipline that stops a key living forever because nobody remembered it.
- **`lastUsedAt`**, because the only safe way to retire a key is to see that
  nothing is using it.

## Scopes

The same primitive as everywhere else — a statement table, granted per key:

```ts
export const apiStatements = {
  availability: ["read"],
  reservation: ["read", "create", "cancel"],
  property: ["read"],
  ratePlan: ["read"],
} as const;
```

Three properties carry over from `architecture.md` § *Permissions are a table*,
and they matter more here than internally: an unlisted resource reads as no, so
a capability added to the table is denied to every existing key until granted;
verbs are AND-ed; and granting something outside the table does not compile.

**A key is not a person.** It has no `User`, so it cannot inherit `OrgRole`, and
`requireOrgMember` does not apply. The guard is its own — `requireApiKey(scope)`
— returning the organization and property the key is bound to.

## The surface

`/api/v1/...`, one version segment, no `external` in the path — everything under
`/api/v1` *is* external, and the internal transport already lives at
`/api/trpc`.

| Endpoint | Scope |
|---|---|
| `GET /api/v1/properties` | `property:read` |
| `GET /api/v1/properties/{publicId}/room-types` | `property:read` |
| `GET /api/v1/availability?from=&to=&roomTypeId=` | `availability:read` |
| `GET /api/v1/rate-plans` | `ratePlan:read` |
| `POST /api/v1/reservations` | `reservation:create` |
| `GET /api/v1/reservations/{publicId}` | `reservation:read` |
| `POST /api/v1/reservations/{publicId}/cancel` | `reservation:cancel` |

Availability and booking first, because that is what a booking engine, a channel
manager and the Phase 8 widget all need, and it is the pair that proves the
whole shape.

**Idempotency on `POST`.** A booking created twice because a caller retried is
the failure that matters most here. An `Idempotency-Key` header, stored with the
result — the same discipline `InventoryHold.holdKey` and `OutboxTask.idempotencyKey`
already use.

## Where the code goes

```
src/app/api/v1/…/route.ts   transport only — parse, authenticate, map, respond
src/features/api/
  ├── server/    the key guard, the rate limiter, the error mapping
  └── model/     the statement table, the request and response schemas
```

A feature, because it owns a domain end to end — the keys, their scopes, the
screen that manages them — and `architecture.md` says a feature owns exactly
that. The route files stay near-empty for the same reason `page.tsx` does.

**Three rules the route handlers live by:**

1. **No business rule in a route handler.** It calls a feature service, or a
   procedure through `createCallerFactory` with an API-key context. If a rule
   has to be written to make an endpoint work, it belongs in `model/` or
   `server/` first and the endpoint calls it.
2. **The response is a DTO, not a Prisma row.** A published shape that happens
   to match a table today will be changed by a migration tomorrow. Declare the
   response with Zod in `model/` and map to it explicitly — that schema is also
   what generates the OpenAPI document.
3. **The OpenAPI document is generated, not written.** A hand-kept spec drifts
   from the code within a release, and a drifted spec is worse than none because
   callers trust it. The Zod schemas in `model/` are the source; a generator
   reads them.

   Next.js has no built-in support, and the App Router's route handlers are
   plain functions, so this is a package choice rather than a framework
   feature. The field as of now: `next-openapi-gen` reads route handlers and
   JSDoc and targets OpenAPI 3.0–3.2, with docs UIs (Scalar, Redoc, Swagger)
   scaffolded for it; `next-openapi-route-handler` inverts it and wraps the
   handler so the types and the spec come from one definition. Either is
   preferable to `trpc-to-openapi`, which publishes procedure shapes and so
   re-couples the public contract to the internal one.

   Decide at implementation time and check the versions then — this note will
   be out of date. What should not change is that the document is generated
   from the same schemas that validate the request.

4. **One place turns a `DomainError` into HTTP.** `mapDomainErrors` already does
   this for tRPC; the REST equivalent is one function, and it emits the domain
   code in the body:

   ```json
   { "error": { "code": "room.taken", "message": "…" } }
   ```

   `DomainStatus` maps to a status code once, so a new refusal needs no new
   plumbing.

## What has to exist first

**Rate limiting**, and it is the one genuinely new dependency. `roadmap.md`
already lists it for Phase 8; an API key makes it non-optional, because a public
endpoint without one is a bill and an outage waiting for a bad client.

That is also where **Redis stops being premature**. In-memory counters break the
moment a second instance runs, and this is the first feature in the product that
cannot be correct without shared state. Until then the honest answer is a single
instance and a database-backed counter, and the plan should say which.

**An audit trail.** `AuditLog` exists in the schema. A key acting on a tenant's
data without a record of what it did is the kind of gap that is only noticed
during an incident.

## Deliberately not in v1

- **Webhooks.** The outbox and its worker exist, so outbound delivery is closer
  than it looks — but a webhook is a second public contract with its own
  retries, signing and replay story, and it should not ride along.
- **OAuth or per-user tokens.** A key identifies an *integration*, not a person.
  When a third party needs to act as a named user, that is a different feature
  and probably `jwt`, which Better Auth does ship.
- **Anything that writes money.** Payments and folios are Phase 6, and exposing
  them before they exist internally would fix their shape from the outside.
- **File upload.** An integration will eventually want to attach a passport scan
  or a signed contract, and the mechanism for that is the same presigned
  two-phase flow `plans/file-uploads.md` describes — `requestUpload` returns a
  URL, the caller PUTs to storage, `confirmUpload` verifies. It is left out of
  v1 because none of it exists yet internally: the `Attachment` table currently
  records files that were never stored anywhere. Publishing that would be
  publishing a bug.
