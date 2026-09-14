# The dashboard header

What is left of it. The theming half of this plan **shipped** on 2026-09-13,
and the header itself — componentised, the language switcher moved in, the
bell as demo data — shipped after that; both are in `docs/history.md`. The
rules live in [ui-patterns.md](../guides/ui-patterns.md) § Surfaces and themes,
the registry is `config/surfaces.ts`, and what a surface on another CSS base
would cost is [second-surface.md](second-surface.md).

What is left is two ideas the header work did not touch, because neither had
enough design to build:

- **A breadcrumb on the left.** `app-header.tsx` is otherwise empty on that
  side and the shell is being opened exactly once. Out of scope as written,
  and the cheapest time to add it is while the header is already being
  touched — which it no longer is.
- **A property switcher, in the dashboard's own header** — not the one
  `features/properties/client/components/property-switcher.tsx` now gives the
  desk sidebar. That one answers "which property" inside `/desk`; a
  organisation with several hotels still has no fast way to jump between them
  from the dashboard's own front-desk pages. More design than a line here
  covers: whether it belongs in the header at all, or whether
  `dashboard/orgs/[orgSlug]/front-desk` growing its own switcher (the way
  `AppSidebar` already reads `orgSlug` from the route) is the cheaper answer.

Neither is scheduled. This file stays until one of them is designed enough to
build, at which point it either grows a real plan section or the idea moves to
`todo.md` and this file goes.
