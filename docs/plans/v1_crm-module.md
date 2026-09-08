> **Extracted from git history — not a live plan.**
>
> Written before the product was decided, recovered from `origin/master` for
> the one part of it that has not shipped. Kept at `v1_` so it is never mistaken
> for something to work from. What survives is marked below; the rest is either
> built or was superseded when the product became a hotel PMS.

> **Part 1 (the module contract) has not shipped and still matters.** It has
> been lifted into `hotel-pms.md`, which is where to work from.
>
> **Part 2 (the CRM domain) is superseded.** `Account`/`Contact` shipped as
> `Company`/`Person`; activities, tags, attachments, custom fields, audit,
> archive and dedupe all shipped. `Lead`, `Deal` and `Pipeline` did not, and
> should not — a guest directory is not a sales pipeline, and this product is a
> PMS. Lead conversion goes with them.
>
> One item outlived both: **CSV export**, which a PMS needs for a different
> reason than a CRM does — a guest asking for their data.

# A CRM module, and the plugin contract it forces

Two things at once, because the first is only provable by the second: a
**module contract** that lets a domain be added without editing the core, and
**CRM** as the module that proves it. Booking is the second consumer and adds
nothing new to the contract — if it needs a sixth change to core, the contract
is wrong.

## The evidence

A plugin system is already half-built, and stopped at cosmetics.

- `features/organizations/model/registry.ts:22` — `ORG_FEATURE_REGISTRY`
  declares `label`, `icon` and `segment` per feature, and
  `config/nav-items.ts:80` turns it into sidebar entries with no per-feature
  code. That is the shape a manifest wants. It carries **nothing but
  presentation**: no router, no permissions, no way to be off.
- `server/root.ts:7` composes routers **by hand**. A module cannot add a
  procedure without editing the core file.
- `features/organizations/model/organization.ts` — `orgStatements` and
  `ORG_ROLE_AC` are one closed table. A module cannot add a permission without
  editing another feature's model.
- `prisma/schema/_base.prisma:2` — *"Every other file in this folder is one
  domain. Prisma concatenates them."* Schema is **already** modular. Nothing
  else is.
- `app/(app)/dashboard/orgs/[orgSlug]/` — one directory per segment. A module
  ships its own route folder; nothing central needs to know.

So four of the five joints are hard-wired, and the fifth is already right.

## Part 1 — The module contract

A module is a directory under `features/` with the usual three doors, plus a
manifest its `model/` exports:

```ts
export const crmModule = {
  id: "crm",
  label: "CRM",
  icon: "Contact",
  segment: "crm",
  statements: crmStatements,   // merged into the org AC table
  grants: CRM_ROLE_GRANTS,     // what each OrgRole may do
} satisfies OrgModule;
```

Five changes to core, once, for every module that follows:

1. **`OrgModule` type** in `organizations/model/` — the manifest shape, widening
   today's `OrgFeatureDefinition`. Built-ins (overview, members, settings)
   become manifests too, so there is one kind of thing, not two.
2. **`root.ts` composes from a list**, not by hand. A module exports its router;
   the root maps over the registry. This is the only file where "modules exist"
   is visible.
3. **The AC table merges statements.** `createAccessControl` takes one
   statements object, so the module's are spread into it before `newRole` is
   called. Grants stay per-`OrgRole`. A module granting a verb it never declared
   must stay a compile error — that property is load-bearing today and cannot be
   lost in the merge.
4. **`OrganizationModule` table** — `(organizationId, moduleId, enabled)`. An org
   turns CRM on without turning Booking on. Nav, routes and procedures all read
   it, and **the procedure is the enforcement** — a hidden nav item is a
   courtesy, exactly as with roles today.
5. **A route guard** — `[orgSlug]/[segment]` 404s when the module is off, so a
   deep link cannot reach a disabled module.

Everything else a module needs — schema file, router, model, client components,
route folder — it already owns.

## Part 2 — CRM, basic but complete

### Naming, decided before any code

`Organization` in this codebase is **the tenant**. A CRM's "company" record is
a different thing entirely and must not reuse the word. It is **`Account`**.
Every CRM table carries `organizationId` — the tenant — and `Account` is a row
inside it. Getting this wrong is unrecoverable once data exists.

### Entities

| Table | Is | Key fields |
|---|---|---|
| `Account` | a customer company | name, domain, ownerId, tenant |
| `Contact` | a person, optionally at an Account | name, email, phone, accountId?, ownerId |
| `Lead` | an unqualified prospect | name, email, source, status, ownerId |
| `Pipeline` / `PipelineStage` | configurable deal stages | name, order, probability |
| `Deal` | an opportunity | title, value, currency, stageId, accountId?, contactId?, closeDate |
| `Activity` | note, call, meeting, task | type, subject, body, dueAt, doneAt, ownerId |
| `Tag` / `EntityTag` | free labelling | name, colour |

**Lead conversion** is the one workflow a CRM is judged on: a Lead becomes an
Account + Contact + optionally a Deal, in **one transaction**, and the Lead is
marked converted rather than deleted. It belongs in `server/service.ts`, beside
`createOrganizationWithOwner`, which is the same shape of operation.

### Activity linkage — the modelling decision

Prisma has no polymorphic relations. Two options, and the plan picks one:

- **Nullable FK per subject** (`accountId?`, `contactId?`, `dealId?`) — keeps
  referential integrity and cascade deletes; costs a column per new subject.
- `subjectType` + `subjectId` strings — extensible, but throws away foreign
  keys and lets an Activity outlive its subject.

**Take the nullable FKs.** A CRM gains subject types rarely, and the database
enforcing the link is worth more than the column. A `CHECK` that exactly one is
set is Postgres-only; on SQLite it is a `model/` invariant with a test.

### The cross-cutting things a CRM is expected to have

- **Tenant scoping on every query.** Every table has `organizationId`; every
  procedure resolves it through `requireOrgMember` first. A missing filter is a
  cross-tenant leak, which makes this the module's most dangerous class of bug.
- **Ownership and visibility.** Each record has an `ownerId`. "My records" vs
  "everyone's" is a filter, not a permission — but *reassigning* an owner is a
  permission, and belongs in the statements table.
- **Audit fields.** `createdById`, `updatedById`, alongside the existing
  `createdAt` / `updatedAt`. Prisma middleware is the wrong place — pass them
  explicitly from `ctx.session.user.id`, the way `ownerId` already is.
- **Archive, not delete.** `archivedAt` nullable. A deleted deal is a deleted
  conversation; every list filters it out by default.
- **Dedupe.** `@@unique([organizationId, email])` on Contact and Lead. It
  surfaces as `fieldError("email", …)` — the channel exists.
- **Lists** follow the `{ filter, orderBy, pagination } → { items, total, meta }`
  contract that `listOrganizationsSchema` already defines, so the DataTable
  stack works with no new wiring.
- **Timeline.** Activities for a subject, newest first — the read that makes a
  CRM feel like one.
- **CSV import/export.** Expected of every CRM. Export first (it is a query and
  a stream); import needs column mapping and a dry run, and is its own plan.
- **Custom fields.** Also expected, also its own plan — a JSON column plus a
  per-tenant field definition table. Do not start it here.

## Phases

| # | Scope | Proves |
|---|---|---|
| 1 | `OrgModule` type, built-ins converted, `root.ts` composes from the registry | the contract, with zero new domain |
| 2 | Statements merge + `OrganizationModule` table + route guard | a module can be off |
| 3 | `crm.prisma`, `model/` types, permissions, pure invariants **and their tests** | the domain, testable with no database |
| 4 | `server/` — Accounts, Contacts, Leads, tenant scoping everywhere | |
| 5 | Deals, pipeline, lead conversion in one transaction | the workflow |
| 6 | Activities and the timeline | |
| 7 | `client/` — table views on the DataTable stack, forms on `FormDialog` | no new UI primitives needed |
| 8 | Booking — see [booking-module.md](booking-module.md) | **the contract, or the contract is wrong** |

Phase 3 before Phase 4, and Phase 8 last, for the same reason: the rules are
testable without a database, and the router should be assembled around
something already proven.

## Done when

- `features/crm/` and `features/booking/` each add a domain with **no edits to
  core** beyond one registry line each.
- An organization with CRM enabled and Booking disabled shows one in the nav,
  and 404s on the other's URL — and its procedures refuse, not just the nav.
- No CRM query reaches the database without `organizationId` in its `where`.
- Lead conversion is one transaction, with a test for the partial-failure case.
- `npm run lint`, `npm test`, `npx tsc --noEmit` and `npm run build` pass.

## Open questions

1. **Are CRM records visible to all org members, or only their owner?** Changes
   the statements table and every list query. Assume all-members until told.
2. **Do Deals need currency conversion?** A `currency` column is cheap; rates
   are a service. Assume single currency per organization.
3. **Is Booking customer-facing?** If someone with no membership can book, that
   is a second identity story — public tokens or customer accounts — and it does
   not fit the org-scoped contract above. Assume staff-only.
