# Todo

The next few things, in order. **A title and a line or two of why — nothing
more.** No status, no boxes, no solution: an item that needs a design needs a
plan, and the line here links to it. A finished item leaves; the fact of it goes
to `history.md`.

Where this sits in the whole build: `plans/roadmap.md`.

## Two questions for the client, before MVP sign-off

**Койко-места** — a hostel sells a bed, not a room, and nothing in the 46 models
has a bed level. **Почасовые объекты** — бани and беседки are sold by the hour,
and every date here is a property-local midnight on purpose. Both are cheap to
ask and expensive to retrofit.

## `useDataTable` calls nuqs unconditionally

So a table in a dialog, or a second table on one route, cannot use the stack —
six places hand-roll `<Table>` instead, and four features repeat the same param
parsing. Fixed upstream in `next-better-auth-template` (`f298695`) by moving the
parser out of the hook behind an optional strategy.
→ [plans/data-table.md](plans/data-table.md)

## Guest names need one normalised column to search

`ё`/`е` are two letters to Postgres and one name to a hotel, and the directory
never splits a search on whitespace. `directory.test.ts` § search already
asserts the `ё` case as failing.
→ [architecture.md](guides/architecture.md) § Searching a text column

## Sixteen `<SelectValue />` render the stored value, not its label

Base UI shows the *value* unless given a function, so a select of codes shows
codes. `reservation-grid.tsx` has the shape to copy; `grep -rn "<SelectValue"
src/` is the list. Invisible until somebody switches language.

## Two claims in the docs that are not reachable

`uploadAttachment()` has no production caller, and the landing page still says
"Prisma on SQLite".

## One component still names its own colour

`attachment-status-badge.tsx` — upload state rather than a hotel state, which is
why it was left behind when the rest became tokens. The housekeeping board's
`destructive` is deliberate and stays.

## The dashboard has one palette, and no reason for a second

The registry says so rather than a condition in the control, which is the right
answer until somebody asks. Do not build it speculatively.

## A channel-manager vendor

Phase 7's server half is done and `ChannelAdapter` is two methods. Which vendor
is a commercial decision, not an engineering one.
