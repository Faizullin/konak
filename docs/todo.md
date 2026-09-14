# Todo

The next few things, in order. **A title and a line or two of why — nothing
more.** No status, no boxes, no solution: an item that needs a design needs a
plan, and the line here links to it. A finished item leaves; the fact of it goes
to `history.md`.

Where this sits in the whole build: `plans/roadmap.md`.

## A bed is not a room

A hostel sells a bed and nothing in the 46 models has a bed level, which the
booking engine and every occupancy figure both have to read. Phase 7.5;
design in `plans/inventory-units.md`.

## Back up the key before anything writes a passport to it

`FIELD_ENCRYPTION_KEY` exists only on the server it runs on, and there are no
database dumps. Phase 9 is what starts filling the columns it protects.
`plans/deployment.md` § Gaps.

## Почасовые объекты wait for a date

Бани and беседки are sold by the hour and want their own feature, their own
`tstzrange` and their own prices. Designed, unscheduled, depends on nothing —
`plans/inventory-units.md`.

## The dashboard has one palette, and no reason for a second

The registry says so rather than a condition in the control, which is the right
answer until somebody asks. Do not build it speculatively.
