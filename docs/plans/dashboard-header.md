# The dashboard header

What is left of it. The theming half of this plan **shipped** on 2026-09-13 and
has moved: the rules are in [ui-patterns.md](../guides/ui-patterns.md)
§ Surfaces and themes, the registry is `config/surfaces.ts`, and what a surface
on another CSS base would cost is [second-surface.md](second-surface.md). What
remains is the header itself.

The header is three elements today — a sidebar trigger, a separator that
separates nothing from nothing, and the appearance control that arrived with the
theme. It wants the language switcher moved into it, and it wants an inbox.

---

## 1. The header becomes a component

`components/layout/dashboard/header/app-header.tsx`, rendering exactly what the
layout renders today, imported by the layout. The layout goes back to routing —
`architecture.md` § `app/` holds routing and nothing else, and a header with
three popovers in it is a component.

A directory per shell region, mirroring `sidebar/` beside it. This is the plan's
one judgement call against the standing rule that component directories are not
invented; the alternative is four flat files in `components/layout/dashboard/`.

**Done when** the screenshots are byte-identical.

## 2. Language moves into the header

`header/header-locale.tsx` — the cookie write and `router.refresh()` that
`nav-user.tsx` already does, as an icon button with the locale code beside it.
Delete `chooseLocale` from `nav-user.tsx`: two controls for one setting is how
they drift. `switchLanguage()` in `tests/e2e/locale.e2e.ts` moves onto the new
control.

The desk already has its own, `desk-locale.tsx`, and keeps it — a surface owns
its own chrome.

**Done when** `locale.e2e.ts` passes, changed only in how it clicks.

## 3. The bell

`header/header-inbox.tsx` — a bell with an unread badge, opening a popover about
380px wide: *Mark all read*, a scrollable list grouped Today / Earlier, and an
empty state that says nothing has happened rather than looking broken.

An item is `{ id, kind, title, body?, at, read, href? }` where `kind` is
`arrival | departure | channel | housekeeping | payment` and decides the icon.
Times through `useFormatter()`.

**It stays in the shell while it is fake.** A `features/notifications/` with no
router, no model two sides agree on and no rows asserts a feature that does not
exist. Read state is `useState`, because it is demo data and pretending
otherwise is worse than admitting it. One constant, `INBOX_DEMO`, with a comment
naming what replaces it — today's arrivals and departures are already one query
(`reservation.day`), channel bookings land through `channels/server/inbound.ts`,
and a dead-lettered outbox row is the third candidate. When a `notification`
router exists the component moves to `features/notifications/client/components/`
and the header's import changes.

**Decide before building it:** the demo bell is right only if the bell is being
*shown* before it is *used*. If it is going to be used, `reservation.day` is the
cheapest honest source and the fake is a detour.

## 4. The strings

One namespace, `messages/{en,ru}/shell.json` — it exists already, carrying the
appearance control's labels. Add to it; it is mounted in both surfaces' layouts.

`message-keys.test.ts` fails on the first string added and not read, which is
why this is a named step rather than an afterthought.

---

## Still open

- **A breadcrumb on the left.** The header is otherwise empty on that side and
  the shell is being opened exactly once. Out of scope as written, and the
  cheapest time to add it is while the header is already being touched.
- **A property switcher.** Same argument, more design.

## What this does not do

- Repaint the grid. That shipped — `styles/status.css`.
- Touch `app/desk/` or `features/desk/`. A surface owns its own chrome.
- Add a `Notification` model, a router, or read state that outlives a tab.
