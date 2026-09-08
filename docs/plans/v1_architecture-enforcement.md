> **Extracted history — not a live plan. Fully shipped.**
>
> Every item landed in `7d631b7`: boundaries are `import/no-restricted-paths`
> zones that gate the build, the client barrels are gone, and the threshold for
> `server/service.ts` is written into `architecture.md`. Its one open finding —
> `config/nav-items.ts` reaching a feature's `model/` — was closed in the same
> pass.
>
> Kept rather than deleted only because its measurements are the evidence behind
> a reversal in `architecture.md`. Nothing here is outstanding; work from
> `hotel-pms.md`.

# Architecture enforcement

The tree in [architecture.md](../guides/architecture.md) is the right shape and
is not what this plan changes. What is missing is that almost nothing holds it
in place: of the rules that guide states, one is enforced by the compiler and
the rest are honour-system prose. This plan makes the boundary real, and
removes the one piece of the shape that charges for a job the boundary does
better.

## What is not in scope

These are settled and this plan does not touch them:

- `model/` as a pure isomorphic core — no Prisma, no `@/server`, no `node:` in
  any of the six features. It is the property everything below exists to
  protect.
- Three doors per feature, root barrel re-exporting `model/` only.
- `import "server-only"` on every file under `features/*/server/`.
- `app/` as routing only; permissions as statement tables; slug-keyed routes.

## The gap

`architecture.md:55-59` states three doors and what each may import.
`architecture.md:61` calls this "enforced, not just documented" — which is true
of exactly one direction. `server-only` stops a client importing `server/`.
Nothing stops the other five rules being broken:

| Rule | Stated at | Enforced by |
|---|---|---|
| client must not import `server/` | `architecture.md:58` | `server-only` — real |
| root barrel is `model/` only | `architecture.md:59` | nothing |
| no cross-feature deep imports | `architecture.md:55` | nothing |
| `features/` must not import `app/` | implied by the tree | nothing |
| shared must not import features | implied by the tree | nothing |
| three doors, no fourth | `architecture.md:55-59` | nothing |

The last one has already been broken. `src/config/nav-items.ts:10` imports
`@/features/organizations/model` — a fourth door, past the root barrel, into a
directory the table does not list as an entry point. It went unnoticed through
the growth from two features to six.

`next.config.ts:7-8` sets `eslint.ignoreDuringBuilds: true`, so even the rules
that could be linted do not gate a build. `eslint.config.mjs:13` extends
`next/core-web-vitals` and `next/typescript` and adds no boundary rules of its
own.

Documentation-only rules survive three features. They do not survive six, and
the failure is silent: the import compiles, the build passes, and the coupling
is found months later when a feature cannot be moved.

## 1. Boundaries as lint

`import/no-restricted-paths`, one zone per feature plus the layer zones, and
`ignoreDuringBuilds` off so a violation fails the build the way `server-only`
already does.

This is the reference implementation's answer too: bulletproof-react enforces
the same slice boundary with `import/no-restricted-paths` zones rather than
with barrel files, having reversed its earlier barrel recommendation on
tree-shaking grounds.

It goes first because it is the only item here that cannot break anything —
it adds no runtime code — and because it is what keeps items 2 and 3 from
drifting back.

## 2. The client barrels come out

`architecture.md:75-78` requires a page to import `@/features/organizations/client`
and "never a file path inside it", so that a component can be renamed without
touching its routes. The encapsulation is worth having. The barrel is the wrong
mechanism for it, and item 1 provides a better one.

A `"use client"` module is a bundler entry point, not an ordinary module, so
Turbopack does not tree-shake across it: every consumer of the barrel gets all
of its exports. Two production builds, the second with every route importing
its component directly:

| Route | via barrel | direct | delta |
|---|---|---|---|
| `/sign-in`, `/sign-up` | 476 kB | 360 kB | −116 kB |
| `/dashboard` | 498 kB | 402 kB | −96 kB |
| `/dashboard/orgs/[orgSlug]` (+ members, settings) | 495 kB | 443 kB | −52 kB |
| `/dashboard/users` | 498 kB | 492 kB | −6 kB |
| `/dashboard/orgs` | 495 kB | 493 kB | −2 kB |

The last two barely move because those routes genuinely use the data-table
stack. The rest were paying for it unused — `/sign-in` renders a heading and a
form and ships `@tanstack/react-table`.

`/dashboard` pays twice, because `src/components/layout/dashboard/sidebar/app-sidebar.tsx:8`
pulls the organizations barrel into the layout, so every dashboard route
inherits all nine organization components before its own page loads.

**This is cheapest now and never again.** Only `identity` and `organizations`
have a `client/` — `src/features/identity/client/index.ts` (5 exports) and
`src/features/organizations/client/index.ts` (9). The other four features are
`model/`-only. Nine import sites move. After the reservation grid — the largest
piece of client UI in the product — the same change is a much wider edit, and
the grid would be built on the pattern being removed.

Server and model barrels stay. Server code never reaches a bundle, and `model/`
is small.

## 3. A stated threshold for `server/service.ts`

`architecture.md:43-46` offers `organizations` as the worked example a third
feature should follow, but never says when the service layer it demonstrates is
required. The result is that the precedent was not followed:

| Feature | Router | Service |
|---|---|---|
| `organizations` | `server/router.ts`, 353 lines | `server/service.ts`, 94 lines |
| `directory` | `server/router.ts`, 335 lines | none |
| `identity` | `server/router.ts`, 105 lines | none |

`directory` is within twenty lines of the feature held up as the example and
extracted nothing.

The rule to write down is not a line count. **A router gets a `service.ts` when
it owns a multi-step transaction or enforces an invariant** — otherwise the
router is the right place and a service is ceremony.

This is ordered last but is the one with a deadline. `reservations`, `rates` and
`platform` have tested `model/` layers and no `server/` yet, and their routers
carry the invariants the product turns on — overlap, pricing, inventory. Logic
that lands inside a tRPC procedure cannot be tested without a database, which
is precisely the property that makes the current `model/` layer worth having.
Settle the threshold before those routers are written, not after.

## Smaller, and only worth doing alongside the above

- `model/index.ts` uses `export *` in all six features. Every export added to a
  model file silently widens the feature's public API; named re-exports make
  widening a decision. Low value on its own.
- `src/config/nav-items.ts:10` closes itself once item 1 lands.
- `src/server/trpc.ts:5` imports `userCan` from `@/features/identity`, so the
  framework layer depends on a feature. The direction is defensible — framework
  may depend on domain, and `model/` depends on nothing — but item 1 forces the
  zone list to state whether it is allowed, which is the point.
- `architecture.md:43` says two features ship; the tree at `:29` names four; six
  exist. Guides describe reality, so this is a guide edit, not a plan item.
