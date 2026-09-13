# MVP roadmap — a second surface, built beside the first

A new set of screens with **their own layout**, built for the client's eight
MVP items and for a demonstration. They import the existing services and touch
none of the existing UI.

[roadmap.md](roadmap.md) is the full-fledged product. This is the other thing,
and the two do not overlap: **nothing here adds a hotel capability.** Every
procedure these screens call already exists and is tested.

## The rule that makes this safe

> **New routes, new components, imported services. Nothing existing is edited.**

The current dashboard keeps working exactly as it does. If this surface is
abandoned, deleting its route group and its components leaves the product
untouched — no procedure changed, no model changed, no shared component changed.

That is what "do not garbage the original design" means in practice, and it is
also why this can move fast: there is nothing to regress.

**What may be imported:** every tRPC router (`reservation`, `housekeeping`,
`billing`, `property`, `directory`, `platform`, `channel`), everything in any
feature's `model/`, `components/ui/*`, `lib/*`. **What may not be changed:**
anything under `app/(app)/dashboard/`, any existing feature component, any
shared component's behaviour.

## Scope of the word "theme"

This plan is the **system design**: layout, structure, density, the shape of a
screen. Colour is the same topic and comes **last** — P6, once the structure
has stopped moving. Building a palette against a layout that is still changing
is work done twice, and a theme switch shipped early would have to be re-fitted
to every screen that arrived after it.

---

## What Kontur actually does

Read from `docs/kontur-notes/` — the client's own training transcripts, which
are first-hand and better than anything findable on the web.

- **Sections down the left**, one of which is the шахматка. Others: Актуальные
  (today's arrivals and departures), Бронирования, Задачи, Смены, Отчёты,
  Профили гостей, Контрагенты, Каналы, Сайт.
- **A booking is a tabbed workspace, not a page of stacked sections.** Основное,
  Оплата, Услуги, Задачи, комментарий администратора, История бронирования — and
  a separate "окно расчёта" that prints расчёт, счёт, акт, квитанция, договор.
- **A chip has a context menu**: открыть · скопировать ссылку · редактировать ·
  отменить.
- **Booking has three modes**: the guest books for themself, a contact books for
  someone else, or an organization books a group — with «Добавить другую
  категорию» and «Добавить другую дату» for a group across types or dates.
- **A checked-in chip turns blue.**
- **Hourly objects get their own шахматка**, not hours folded into this one.

Three of these are shape, not features, and are what this plan adopts: sections
down the left, the booking as tabs, the chip's context menu.

---

## P1 — The shell

A route group of its own — `app/(desk)/` — with a layout that owes nothing to
the dashboard's.

- **No reading measure.** The dashboard caps content because it holds forms and
  prose. This surface is operational: full width, always.
- **A dense chrome.** No hero heading. A single top bar: property name, the
  section, and the actions for that section.
- **Sections down the left**, Kontur's shape, and the shape the client's staff
  already have: Шахматка · Актуальные · Бронирования · Номера · Гости.
- Its own `layout.tsx`, its own nav component, its own spacing scale as CSS
  custom properties on the shell — the pattern `reservation-grid.tsx` already
  proves with `--grid-night`.

**Imports:** the session and organization resolution the dashboard layout
already does, `property.getBySlug`.

**Done when** the shell renders at full width with the five sections, and the
existing dashboard is byte-identical.

## P2 — The grid screen

The one screen the product is about, laid out for it.

- **Two columns.** The grid takes the width it needs; a narrow column beside it
  holds today's arrivals, departures and in-house. Below ~1280px they stack.
  Today these are in one vertical column and a receptionist scrolls between the
  two halves of one job.
- **Toolbar in four groups** with separators — where you are · how much you see ·
  how it looks · what you can do — rather than one run of eight controls.
- **A today line** down the grid.
- **A chip context menu**: open · copy link · cancel. The booking already has a
  stable `publicId` URL, so copy-link is nearly free and is how one receptionist
  sends a booking to another.
- **The half-cell.** A departure and an arrival on one day become one cell split
  on the diagonal. The model is already right — `checkOut` is exclusive — so
  this is drawing only, and the geometry goes in `model/grid.ts` beside
  `spanInWindow` where it is testable without a browser.

**Imports:** `reservation.grid`, `reservation.day`, `reservation.setStatus`,
`reservation.assignRoom`, `reservation.moveStay`, and `model/grid.ts`.

**Done when** a 31-night window and today's lists are on one 1440px screen, and
a same-day turnover reads as one split cell.

## P3 — The booking as a tabbed workspace

Shipped. `/desk/<org>/<property>/bookings/<publicId>` and its `/bill`.

**Tabs are routes**, so one receptionist can send another the exact half they
mean. **Услуги** folded into Оплата — a service is a folio line of type
`SERVICE` and the panel already posts one. **История was dropped**, and that
one was not a choice: the plan claimed `AuditLog` served it, and `AuditLog` has
no writer and no reader. A history tab needs both, which is a capability and
belongs in [roadmap.md](roadmap.md).

The logic is `useBooking` — what the booking is, which transitions are offered,
which are refused and why. The desk's components hold no decision the hook
could hold, which is what makes a third presentation cheap.

## P4 — Rooms and the guest

The two remaining MVP items, in this shell.

- **Номера** — the category and room lists, laid out as a table that fills the
  width rather than a stack of panels.
- **Гости** — the guest card: contacts, tags, stay history, documents. Kontur
  marks a guest VIP or problematic from here; tags already exist and are wired.

**Imports:** `property.listRoomTypes`, `property.listRooms`,
`directory.getPerson`, `directory.stayHistory`, `platform.listSubjectTags`.

**Done when** all eight MVP items are reachable inside the new shell without
returning to the dashboard.

## P5 — The demonstration

Shipped. `npm run demo` builds the hotel, [guides/demo.md](../guides/demo.md)
is the path through it, and `npm run report:ui` photographs all fifteen screens
in both languages and both themes.

**Done when** someone who has never seen the product can be walked through all
eight items in ten minutes without meeting an empty screen.

## P6 — The theme, and each surface choosing its own

Shipped. `next-themes` is mounted at the root, both surfaces stamp
`data-surface`, both carry an `AppearanceToggle`, and no component in the grid
or the housekeeping board names a colour any more — the booking and room states
are tokens in `styles/status.css`, overridden per surface.

What the MVP did **not** take from [dashboard-header.md](dashboard-header.md):
the dashboard header becoming a component, the language switch moving into it,
and the notification bell. Those are that plan's Phases 2, 3 and 6, are
dashboard polish, and can follow at any time. Its Phase 7 — a *second* palette
for one surface — is now an afternoon's work and should not be built
speculatively. Its Phase 8 — a surface on a different CSS base — is designed
there with its price visible.

## Gates — once, at the end

The long checks run **at the end of a phase, in one pass**, not after every
step. `lint`, `test:server`, `build` and `test:e2e` are minutes each on this
machine, and running them after every edit is most of the day.

**While working:** `npx tsc --noEmit`. It is the one that catches the mistakes
that matter mid-edit, and it is seconds.

**At the end of the phase**, in this order — each is cheaper than the next, so a
failure is found by the cheapest thing that can find it:

```bash
npx tsc --noEmit
npm run lint
npm run format:check
npm test
npm run test:server        # a router or the schema changed
npm run build              # routing or config moved
npm run test:e2e           # the browser, and the screenshot report
npm run report:ui          # the PDF, when it is being shown to anybody
```

A phase is not finished until that block is green. Nothing between the start and
the end of a phase is a gate.

---

## Decisions taken

1. **A second surface, not a refactor.** The alternative was changing the
   existing screens in place, which risks a working product for a
   demonstration. New routes cost a little duplication and cannot regress
   anything.
2. **Colour is deferred to the last phase**, P6 — not dropped, and not a
   `todo.md` item any more. This plan is structure; the palette is fitted to a
   layout that has stopped moving.
3. **No env-selected edition.** A second *surface* is what was actually wanted;
   an environment variable choosing between two component trees is machinery
   for a customer who does not exist, and it costs the bundle floor
   `roadmap.md` defends.
4. **No Redis.** Nothing here needs it, and the outbox forbids it: an intent
   must commit in the same transaction as the change it announces.

## What this deliberately does not do

- **Hostel beds and hourly objects.** Questions for the client, not work —
  `todo.md` carries the wording. Kontur answers the second with a separate
  шахматка, which is the same conclusion Bnovo and TravelLine reached.
- **Anything in `roadmap.md`.** A channel vendor, fiscal receipts, the public
  booking flow.
- **Touching the existing dashboard.** If a step here would require it, the step
  is wrong.

## What must survive

`ui-patterns.md` is binding and these beat the Russian incumbents. No new
surface gets to lose them:

- **Colour is never the only cue** — shape and hue. Kontur, Bnovo, meHotel and
  TravelLine all use hue alone.
- **Refusals state their reason** — a greyed-out "Check in" says why.
- **Density as a user choice** — nobody else in this market offers it.
- **Both themes everywhere** — front desks run dim.
