# Handoff

**Where it is.** Phases 1, 2 and 4 through 7 are done — the database, the
domain, the front desk, housekeeping, the money, and the channels. 46 models on
Postgres; eleven features, ten of them with routers. Phase 4's **Done when** is
met: a receptionist can run a day without SQL — arrivals, departures and who is
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

**The outbox has a worker and handlers now.** `npm run outbox` is a dry run;
`-- --commit` drains. Phase 7 registered both channel directions — a push that
is a diff, and a pull, because a booking made on Booking.com happens where we
cannot see it. **No vendor is connected**: `ChannelAdapter` is two methods and
the registry is deliberately empty, so say "ready for", not "connected to".

**There is a second surface.** `/desk/<orgSlug>/<propertySlug>` — five sections
down the left, its own layout, its own token block under
`[data-surface="desk"]`. It imports the routers and edits nothing that already
existed; deleting it would leave the dashboard byte-identical. Built for the
MVP demonstration; `guides/ui-patterns.md` § Surfaces and themes is the rule it
was built under.

**Load the demo data before showing anyone.** `npm run demo`, after the seed:
ten rooms across three types, ninety nights priced, fifteen bookings in every
state, a guest with three stays. It clears its own previous run, so rehearse
freely. `guides/demo.md` is the path through it — ten stops, the client's eight
items, and what not to promise.

**Start the database first.** `docker compose -f docker/compose/db.yml up -d`,
then `npm run db:migrate` and `npm run db:seed` on a fresh volume — and
`npm run demo` if you are about to show it to anybody.

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
throw `StorageNotImplementedError`.

**There are two screens.** `/front-desk/<propertySlug>/setup` carries an
`AttachmentsPanel` for photographs and documents, and
`/directory/<personId>` — reached by clicking a name in the directory — carries
three, one each for identity documents, consents and other files. A panel lists
and uploads **one kind**, so mounting several on a page does not repeat itself.
`uploadAttachment()` opens the same panel as a dialog from anywhere.

Uploading is a MEMBER right and deleting is a manager's, because deleting takes
the bytes with it. Try it on the demo: sign in as `admin@konak.dev`, open
Directory, click **Ada Lovelace**.

**The MVP roadmap shipped, all six phases, and the plan is gone** — what it
taught is in `guides/ui-patterns.md` § Surfaces and themes,
`guides/architecture.md` and `guides/demo.md`, and the gate block moved to
`guides/local-development.md`. `plans/e2e-and-reports.md` and
`plans/file-uploads-ui.md` went the same way.

**An audit on 2026-09-13 read every router**, and its first finding is fixed:
inventory is not a number anybody types. How many rooms a type has is counted
from the `Room` rows, `RoomTypeInventory` holds only what staff deliberately
withheld, and `property.setBlock` is the write path. A property set up through
the app sells on the day it is created. `guides/architecture.md` § What is
counted, never stored.

**What is left is `plans/server-hardening.md` § 2** — five read-then-write races
of the shape `nextSeriesNumber` already taught, two of which oversell rooms.
`lockOrganization` in `platform/server/attachments.ts` is the worked example of
the fix.

**Dark mode works, and a person chooses it.** `next-themes` at the root,
`AppearanceToggle` in the dashboard header and in the desk's bar. Both surfaces
stamp `data-surface`, and `config/surfaces.ts` is the registry. **No component
names a colour** — booking and room states are tokens in `styles/status.css`,
overridden per surface. `guides/ui-patterns.md` § Surfaces and themes is
binding.

**A booking opens as tabs on the desk**, and the tabs are routes:
`/desk/<org>/<property>/bookings/<publicId>` and `/bill`. The decisions live in
`useBooking`; the components are presentation. The dashboard's own card is
untouched and still works.

**All eight of the client's MVP items are now reachable without leaving the
desk.** The last two to arrive were the guest card
(`/desk/<org>/<property>/guests/<personId>`) and the housekeeping board, which
is the desk's sixth section. **The MVP is closed.** `tests/e2e/desk.e2e.ts` drives the surface — a chip
opening its booking without leaving the shell, the tabs as URLs, a guest and
their history, the floor's board, and the theme following a person between
surfaces. It found that the appearance menu had never opened.

**A component never writes the surface it lives on.** `store/surface-links.tsx`
— see `guides/architecture.md`. Without it every link out of the desk landed
back in the dashboard. Three hooks, each asking for what its caller actually
has: `useSurfaceLinks` (property-scoped), `useBookingLink` (a booking at a named
property, for a history that crosses them) and `usePersonLink` — because the
directory is organisation-wide and the dashboard's table has no property at
all.

**Where to start.** `docs/todo.md`, top entry — which is the overselling
races.

**Before you finish — once, not per edit.** `lint`, `format:check`,
`test:server`, `build` and the browser suite are minutes each on this machine,
so they run at the *end* of a phase in one pass. While working, `npx tsc
--noEmit` and nothing else. `guides/local-development.md` § The other layers has
the block and its order.

**What is binding.** `docs/guides/` describes how things are. `CLAUDE.md` lists
the traps that fail silently.
