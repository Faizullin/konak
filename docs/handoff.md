# Handoff

**Where it is.** Phases 1, 2 and 4 are done — the database, the domain, and the
front desk. 46 models on Postgres; seven features, all with routers. Phase 4's
**Done when** is met: a receptionist can run a day without SQL — arrivals, departures and who is
in house (`reservation.day`), a walk-in that books, assigns and checks in in one
transaction (`reservation.walkIn`), drag to assign, and check-in / check-out /
cancel / no-show from either surface. A drag that would overlap is refused with
the reason in place. Both owed decisions are made: **real-time is polling**, and
the **server half of the end-of-phase pass** has been done — the grid was
reading room types and stays twice and is now five queries, not seven.

Dates move too: a chip dragged sideways moves the booking, an edge dragged on
its own resizes it, and both land on `reservation.moveStay` with the room in the
same call. **Phase 4 is closed.**

**The desk refuses more than the status machine does.** A booking cannot check
in without an assigned room, and cannot check in or be marked a no-show before
the day it arrives — `refuseStatusChange` in `reservations/model/status.ts`,
which every caller of `setStatus` goes through, not just the grid. A greyed-out
"Check in" is that rule, and the button carries the reason. "Today" is the
property's own day, so a seeded booking in another timezone can be a day out
from the browser's.

**A property is set up in the app now.** `/front-desk/<propertySlug>/setup` —
room types, rooms and rate plans, behind the same module toggle as the desk. It
is the first screen that is manager-only: OWNER and ADMIN write, MEMBER reads.

**The outbox has a worker now, and no handlers.** `npm run outbox` is a dry run;
`-- --commit` drains. Nothing registers a handler until the first external
system in Phase 7, so a commit run today dead-letters whatever it finds — which
is the intended answer, not a bug.

**Start the database first.** `docker compose -f docker/compose/db.yml up -d`,
then `npm run db:migrate` and `npm run db:seed` on a fresh volume.

**The front desk is an off-by-default module.** `FRONT_DESK` in
`ORG_MODULE_REGISTRY`, like `DIRECTORY`: an organization that runs no hotel
never sees it, and its route 404s until it is switched on. The seed switches it
on for the demo organization, so `/dashboard/orgs/acme/front-desk` works out of
the box. On any other organization, turn it on in Settings first — a 404 there
is the module being off, not the screen being broken.

**The desk refreshes itself every 30 seconds.** Polling, decided in Phase 4
rather than a subscription — a Next route handler holds no socket, and the grid
and the day lists are one bounded query each. A mutation on either invalidates
both, so two views of one booking cannot disagree. If a change seems not to
appear, it is a stale 30 seconds, not a lost write.

**Files upload, and storage cannot be filled.** Two phases:
`platform.requestUpload` reserves a row, a key and quota; the bytes go to the
provider or to `POST /api/uploads/<key>`; `platform.confirmUpload` asks storage
what it actually holds and writes **that**. A file whose bytes are not what was
claimed loses the file, not just the claim.

Four bounds, because each leaks alone: per-kind caps and type allowlists,
a per-organization quota (`Organization.storageQuotaBytes`, 5 GiB by default)
checked **when the ticket is issued**, unconfirmed reservations counted against
it, and sweeps that release abandoned uploads and purge expired retention.
`npm run outbox` runs both sweeps beside the drain, and is still a dry run
without `--commit`.

`STORAGE_PROVIDER` defaults to `filesystem`, which is implemented and needs no
configuration; S3, Cloudinary and Vercel Blob declare real capabilities and
throw `StorageNotImplementedError`. **No screen collects a file yet** — the
procedures are what one would call. See
[guides/architecture.md](guides/architecture.md#file-storage).

**Where to start.** `docs/todo.md`, top entry.

**Before you finish.** `npm run lint && npm test && npx tsc --noEmit && npm run format:check`,
and `npm run test:server` when a router or the schema changed,
plus `npm run build` if routing or config moved.

**What is binding.** `docs/guides/` describes how things are. `CLAUDE.md` lists
the traps that fail silently.
