# Handoff

**Where it is.** Phases 1 and 2 are done — the database and the domain. 46
models on Postgres; seven features, all with routers. Phase 4 is open and most
of the way there: the front desk has its data (`property.*`,
`reservation.grid`), the month grid, drag to assign, and check-in / check-out /
cancel / no-show from the grid itself. Its **Done when** is a receptionist
running a whole day, and three pieces of that day are still missing —
**arrivals and departures for a date**, a **walk-in** (nothing in the UI creates
a booking at all), and **moving a stay's dates**. Two decisions the phase owes
are also open: real-time, and the server half of the end-of-phase pass.
`docs/todo.md` names them in order.

**The desk refuses more than the status machine does.** A booking cannot check
in without an assigned room, and cannot check in or be marked a no-show before
the day it arrives — `refuseStatusChange` in `reservations/model/status.ts`,
which every caller of `setStatus` goes through, not just the grid. A greyed-out
"Check in" is that rule, and the button carries the reason. "Today" is the
property's own day, so a seeded booking in another timezone can be a day out
from the browser's.

**Start the database first.** `docker compose -f docker/compose/db.yml up -d`,
then `npm run db:migrate` and `npm run db:seed` on a fresh volume.

**The front desk is an off-by-default module.** `FRONT_DESK` in
`ORG_MODULE_REGISTRY`, like `DIRECTORY`: an organization that runs no hotel
never sees it, and its route 404s until it is switched on. The seed switches it
on for the demo organization, so `/dashboard/orgs/acme/front-desk` works out of
the box. On any other organization, turn it on in Settings first — a 404 there
is the module being off, not the screen being broken.

**Where to start.** `docs/todo.md`, top entry.

**Before you finish.** `npm run lint && npm test && npx tsc --noEmit && npm run format:check`,
and `npm run test:server` when a router or the schema changed,
plus `npm run build` if routing or config moved.

**What is binding.** `docs/guides/` describes how things are. `CLAUDE.md` lists
the traps that fail silently.
