# Todo

The next few things, in order. A title and one line of why — no status, no
boxes. A finished item leaves here; the fact of it goes to `history.md`.

Where this sits in the whole build: `plans/roadmap.md`.

## Two questions for the client, in writing, before MVP sign-off
Both break assumptions the schema turns on, and both are cheap to ask and
expensive to retrofit.

**Койко-места** — a hostel sells a bed inside a room, and Kontur even names the
bunk. Nothing in the 46 models has a bed level, and adding one touches
availability, the exclusion constraint, the grid's vertical axis and every rate
plan.

**Почасовые объекты** — бани, сауны, беседки. Every date here is a
property-local midnight, deliberately. The research half of this is settled:
Kontur, Bnovo and TravelLine all answer it with a *second grid*, not by folding
hours into the nightly one — so it is another screen, not a rewrite of this one.

## Two components still name their own colours
`platform/client/components/attachment-status-badge.tsx` and the `destructive`
pair in the housekeeping board's `OUT_OF_ORDER` — the first is upload state
rather than a hotel state, which is why it was left when the grid and the room
tones became tokens; the second is deliberate, because a room out of order
genuinely is a problem and `--destructive` already means that everywhere. The
first should follow the others into `styles/status.css` the next time anyone is
in that file. `guides/ui-patterns.md` § Surfaces and themes is the rule.

## A channel-manager vendor
Phase 7's server half is finished and the adapter registry is empty on purpose.
`ChannelAdapter` is two methods; choosing the vendor is a commercial decision,
and the market decides it — the same question as which jurisdiction is first.
`plans/e2e-and-reports.md` for the browser suite that will prove it.
