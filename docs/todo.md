# Todo

The next few things, in order. A title and one line of why — no status, no
boxes. A finished item leaves here; the fact of it goes to `history.md`.

Where this sits in the whole build: `plans/roadmap.md`.

## The screenshot report
The browser suite exists and the `report` project in `playwright.config.ts` is
configured and empty. A capture spec walking the screens across locale and
theme, `scripts/report.mts` assembling an `index.html` from the manifest, and
`page.pdf()` printing it. The manifest schema to reuse is the one already in
`docs/screenshots-report/`, whose generator was never committed.
`plans/e2e-and-reports.md`.

## Three more journeys
Booking a date that is not tonight, the language switch, and finding a booking.
The language one matters most: it has no server test and cannot have one, so a
browser is the only thing that can see a Russian string overflowing its column.

## Phase 5 — guests and housekeeping
The roadmap's next phase, and where a rule `product-shape.md` § 10 states but
nothing implements belongs: **check-out does not mark the room dirty.** That is
the event which creates the work, and expecting a receptionist to also remember
is how boards go stale.

## An external API, with keys
Last on purpose. Everything above is a product a hotel uses; this is a surface
other software uses, and it is worth building once the thing it exposes has
stopped moving.
Nothing outside this repository can call it. tRPC's contract is a TypeScript
type, so there is no schema to publish and no version to pin, and
`src/server/root.ts` is internal by construction. A versioned REST surface with
scoped API keys is what a booking engine, a channel manager and the Phase 8
widget all need — and Phase 8 needs the rate limiting it forces anyway.
`plans/external-api.md` has the shape, the scopes and what must exist first.
