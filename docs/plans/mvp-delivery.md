# MVP delivery

The order to close the distance [mvp-updates.md](mvp-updates.md) measures.
What the product is when it is finished lives in
[product-shape.md](product-shape.md); what is missing lives in `mvp-updates.md`;
this file is only the sequence and the method, so the three cannot disagree.

**These are not roadmap phases.** The block sits between Phase 4, which is
closed, and Phase 5. It opens no module Phase 5 owns and it is not the visual
work Phase 12 owns — except on the one screen where the defaults are wrong
rather than plain, which is the screen the demonstration is about.

Three rules hold over every phase. Two are [roadmap.md](roadmap.md)'s:

- **The rule before the router.** Anything provable without a database goes in
  `model/` with tests, first.
- **No screen before its procedure.** A screen built on a procedure that does
  not exist is a screen built on a guess.

The third belongs to this block, because it is measured against a demonstration:

- **Nothing the screen says may be untrue.** A wrong sentence costs more in the
  room than a missing feature does — the feature is a roadmap, the sentence is a
  defect the audience can read.

---

## M1 — What the screen already knows

First because it is hours, and because everything in it is visible.

- **The sold row.** Every `NightAvailability` already carries `sold` beside
  `available` (`reservations/server/service.ts:34`), and the grid draws only
  `available` (`reservation-grid.tsx:767-787`). Draw `sold` above it — the
  reference's `Занято` over `Свободно`. Occupancy is the number a hotelier
  actually watches, and this costs no server change and no extra query.
- **The hint under the grid is false.** It ends *"Moving the dates needs a
  procedure that does not exist yet"* (`reservation-grid.tsx:861-866`).
  `reservation.moveStay` exists (`reservations/server/router.ts:564`) and is
  what both the sideways drag and the edge drag call. Rewrite it, and put it
  through `messages/en/reservations.json` — a paragraph outside the message
  files is one the orphan-key test cannot see.
- **Two strings in the action bar.** `room {number}` and `no room yet`, at
  `reservation-grid.tsx:443`, sitting beside correctly translated labels. They
  must be keys before M6, not during it.
- **The per-render rescans.** `data.rooms.filter` runs per type and
  `data.availability.find` per type per night, inside render
  (`reservation-grid.tsx:754,769`). One pass into a `Map` keyed by type and by
  `type:night`. This is a grouping change rather than an optimisation, and it
  belongs here because M3 multiplies the columns it runs over.

**Done when** the grid shows sold and free per type per night, and no string it
draws is untranslated or untrue.

## M2 — The booking card

The one item on the brief with no screen, and the only construction in this
file. Taken before the adjustments, because the rest of the block hangs off it:
M4's lists need something to open.

The server half first.

- **`reservation.byPublicId`** — one reservation with its stays, their rooms and
  types, the booker, the guests, the rate plans and the money. Nothing new is
  stored: `Reservation` carries `reference`, `currencyCode`, `totalMinor`,
  `paidMinor`, `notes`, `booker`, `company` and `guests`, and each `RoomStay`
  carries its own `ratePlanId` and `totalMinor`
  (`prisma/schema/reservations.prisma`). `requirePropertyMember` decides the two
  refusals the way every procedure in this router does — an unknown id is
  NOT_FOUND, another tenant's is FORBIDDEN.
- **The refusal answers for the reservation, not the chip.** `StayActions`
  computes its preview from the selected stay alone
  (`reservation-grid.tsx:409`), and the code already says the server answers for
  all of them. On a card that shows every stay, that shortcut becomes visible:
  one refusal per stay, each carrying its own reason.

Then the screen.

- **A route**, `front-desk/[propertySlug]/bookings/[publicId]`, built like the
  person route (`directory/[personId]/page.tsx`): organization by slug, module
  toggle, then the lookup with the tenant inside the `where` rather than checked
  after it, so another tenant's booking is absent and not forbidden.
- **Keyed on `publicId`, not `id`.** The column exists for exactly this —
  *"quoted outside the building… sequential ids would leak how many bookings the
  hotel takes"* (`prisma/schema/reservations.prisma:22`). A URL that can be sent
  to a colleague today is the URL a guest link uses in Phase 8.
- **The grid and the day lists open it.** `StayActions` keeps its buttons and
  gains a link; selection stays component state, because selecting a chip is not
  navigating to it.

**Done when** a booking opens from the grid, survives a refresh, and shows the
reservation — every stay, every guest, the plan and the total — rather than the
chip that was clicked.

## M3 — The window

The grid moves a calendar month at a time and always starts on the 1st
(`reservation-grid.tsx:501`, `reservations/model/grid.ts:44`). Two costs: no
date is reachable directly, and a stay crossing a month boundary is cut by the
view rather than drawn whole — which is what a desk needs most in the last week
of a month.

- **`windowFrom(anchor, nights)` in `model/`, with tests**, beside
  `monthWindowOf` rather than replacing it: the window becomes an anchor and a
  length. `GRID_MAX_NIGHTS` stays 62 (`model/grid.ts:17`) — it is what bounds
  the query, and it already allows two months.
- **A date picker in the toolbar**, replacing month-at-a-time stepping
  (`reservation-grid.tsx:671-691`). Step by day and by week; keep today.
- **The header shows the boundary.** One month label is correct only while the
  window is one month (`reservation-grid.tsx:690`).
- **The length is the desk's choice**, not the calendar's.

**Done when** any date is reached in one act, and a stay crossing a month
boundary is drawn whole.

## M4 — Finding a booking

- **`list` is not yet a list procedure.** `status` is an untyped `z.string()`,
  there is no search, no cursor, and a flat `take: 200`
  (`reservations/server/router.ts:67-92`). Give it the typed status, a cursor,
  and one term matched against guest name, room number and reference — the three
  things a desk knows when the phone rings.
- **Search in the grid toolbar.** After the date, this is the most-used control
  on the screen.
- **Filter to one type**, which M1's grouping map already keys by.
- **Three list views** — new, current, archive — each a `DataTable` over `list`,
  each row opening M2's route.

**Done when** a booking is found by guest, room or reference without knowing its
dates, and every row opens the card.

## M5 — Booking for a date that is not tonight

What exists is a walk-in that books, assigns and checks in in one transaction
(`reservations/server/router.ts:394`) — genuinely useful, and a different act.
It cannot sell next month. The reference's primary action is *check availability
and book*, and it is the only path to a future booking.

- **`availability` has no screen** (`reservations/server/router.ts:43`). Dates,
  type and occupancy in; free per night out, per type.
- **The hold is taken when the search becomes a booking**, not when it is run.
  `reservation.hold` and `releaseHold` exist and nothing calls them
  (`router.ts:217,276`). This is `product-shape.md` §6's *"available to you, for
  the next few minutes"*, and it is the difference between a search and a
  promise.
- **The price comes from the plan.** `quoteStay` walks the nights, so the total
  shown is the total written.
- **The room stays optional.** A booking made for March has a type and no door.
  That is what the unassigned band is for, and assigning it later is M2's card
  or a drag.

**Done when** a booking for a date that is not tonight is made from the grid,
against derived availability, at the plan's price.

## M6 — Russian

The brief, the reference product and the intended users are Russian; the product
is English. The machinery is finished — every feature string comes from
`messages/en/`, keys are typed, and the tests fail in both directions — so this
is a translation job with three code exceptions.

`todo.md` defers a second locale until there is a reader. There is one now: the
audience this is demonstrated to. The condition is met; the position has not
changed.

- **`LOCALES` is a one-element tuple** (`config/locales.ts:9`). Add `ru` and
  `messages/ru/`; the existing tests then hold the two directories to the same
  keys in both directions.
- **The grid's date formatters are fixed `"en"`** — weekday, day, month and
  range (`reservation-grid.tsx:130-141`). They sit outside the message files and
  will not follow the switch. Take the locale from the request.
- **M1's strings must already be keys.** A string that is still hardcoded
  translates to nothing and no test says so.

**Done when** the whole desk — grid, day lists, booking card, refusals and dates
— runs in Russian, and switching back changes every one of them.

## M7 — The grid read for a shift

The product wears shadcn's defaults until Phase 12, and this does not reopen
that. The grid is the exception the roadmap already names: the one screen where
the defaults are wrong rather than merely plain.

- **Density.** A 10rem label column, 2.5rem per night, 1.75rem per lane
  (`reservation-grid.tsx:56-58`) — about 88rem for 31 nights, which scrolls
  horizontally on most laptops. The reference trades days for no scroll. Neither
  is right; what is missing is the choice. Compact and comfortable, remembered
  per desk.
- **Type groups collapse.** Three types do not need it. Twenty is the difference
  between a screen and a scroll.
- **A keyboard path to all three gestures.** Assign, move and resize are drag
  only. Select a chip, move it with arrows, commit with Enter — the same three
  procedures, a second input, because a desk that works fast works on a
  keyboard.
- **One toolbar** carrying date, step, today, density, search and filter, rather
  than three buttons in a row.

Colour stays the placeholder it is. The accessibility floor is met — every
status carries a text mark and the legend decodes both — and turning six
independent choices into a scale is Phase 12's, across the product rather than
on one screen.

**Done when** a forty-room property is read for a shift without a mouse and
without horizontal scrolling at the density that desk chose.

---

## Decisions taken

Recorded so they are not re-argued. Each is reversible at a named cost.

1. **The booking card is a route, not a dialog.** A dialog keeps the desk on the
   grid, which is where it wants to be, and matches every other detail view
   here. A route is addressable, survives a refresh and can be sent to someone —
   and M4's lists must open *something*, which a grid-cell dialog cannot be.
   Reversing this means the lists lose their destination.
2. **It is keyed on `publicId`.** Changing to `id` later means every link
   already sent stops working, and leaks the hotel's booking count.
3. **Free / booked / occupied is a legend, not a schema change.** The six
   reservation states stay. The client's three words are a projection over a
   room *and a night*, and collapsing the six would take a room off sale that an
   enquiry never sold. Only the labelling is in scope.
4. **The month stops being the window's unit.** `monthWindowOf` stays for the
   default; the state becomes an anchor and a length. `GRID_MAX_NIGHTS` is
   unchanged, so nothing about the query's bound moves.
5. **`ru` lands inside this block**, not after it. It is the demonstration's
   language, which is the reader `todo.md` was waiting for.

## One correction to `mvp-updates.md`

**Weekends are already marked.** `isWeekend` is defined at
`reservation-grid.tsx:143` and applied at `:394` to every night column of every
`NightArea` — the date header included, since the header uses the same
component. §2 lists it as missing. There is nothing to build.

## Not in this block

- **Hourly and day-use.** A second interval model, a second availability
  calculation and a second grid — `product-shape.md` §20. A decision, not a
  feature request.
- **Folio, channels, direct sales, compliance.** Roadmap Phases 6 to 9.
- **The housekeeping board and the guest screens.** Roadmap Phase 5, which this
  block sits in front of.
- **Colour as a scale, and motion.** Phase 12, across the product.
- **An overbooking policy.** Phase 7, and it is a written policy before it is
  code.

## How each phase ends

The gate in `roadmap.md` § How a phase ends, over what that phase created. Two
this block will actually trip:

- **M1 and M3 both change what runs per column per type.** Measure the grid
  render before M1 and again after M3 — once at the end measures nothing, since
  M1 removes work and M3 adds columns.
- **M4's `list` gains a search across three tables' columns.** A new query shape
  wants an index, tenant column first.
