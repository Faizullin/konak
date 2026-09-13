# Todo

The next few things, in order. A title and one line of why — no status, no
boxes. A finished item leaves here; the fact of it goes to `history.md`.

Where this sits in the whole build: `plans/roadmap.md`.

## The overselling races
Availability is read before the transaction that writes the stay, and the
exclusion constraint only protects an *assigned* room — while unassigned is the
normal case for every advance and every channel booking. Same shape for folios:
two "open the bill" presses make two folios. `plans/server-hardening.md` § 2.
`lockOrganization` in `platform/server/attachments.ts` is the worked example of
doing this right.

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

## A failed e2e run leaves a dev server behind
When `test:e2e` cannot finish cleanly, the `next dev` it started survives —
wedged, serving nothing, and still holding `.next/dev/lock`. Next 16 refuses a
second dev server **in the same directory**, so every later run fails to start
with a message naming a PID. `lsof -nP -iTCP:3100 -sTCP:LISTEN` will not always
find it, because a wedged one has already released the port; `cat .next/dev/lock`
names it. Worth a `pretest:e2e` that clears a lock whose PID is dead, or at
least a line in `guides/local-development.md`.

## Three claims in the docs that are not reachable
- `uploadAttachment()` has no production caller, while `architecture.md` and
  `handoff.md` both say it opens the panel "from anywhere".
- `docs/screenshots-report/` is 3 MB of light-only PNGs from a tool that no
  longer exists, still tracked — while `.gitignore` now ignores `/reports` on
  the argument that a committed report makes PNG diffs part of review.
- The landing page says "Prisma on SQLite". It is Postgres.

## A channel-manager vendor
Phase 7's server half is finished and the adapter registry is empty on purpose.
`ChannelAdapter` is two methods; choosing the vendor is a commercial decision,
and the market decides it — the same question as which jurisdiction is first.
`guides/index.md` § The browser layer for the suite that will prove it.
