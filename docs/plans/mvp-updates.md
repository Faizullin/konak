# MVP updates

Notes on the distance between what exists and what an MVP demonstration of the
шахматка needs. Two subjects only: **the grid's behaviour** and **the way it
looks**. Everything here was read off the code as it stands, not inferred from
intent.

The brief this measures against asks for eight things: the шахматка, creating
and displaying rooms, booking a room, room status (free / booked / occupied),
opening a booking card, a basic guest card, arrivals and departures shown on the
grid, and basic date navigation. It is benchmarked against a commercial Russian
PMS, and a screenshot of that product's daily timeline came with it.

---

## Where each item stands

| Asked for | State |
|---|---|
| Шахматка | Built, past the required depth — spans, lanes, drag to assign, drag to move, edge drag to resize |
| Creating and displaying rooms | Built — room types and rooms, create / edit / archive, behind a manager-only setup screen |
| Booking a room | Built — a full create path, plus a walk-in that books, assigns and checks in in one transaction |
| Room status (free / booked / occupied) | Present as a different vocabulary. See §3 |
| Arrivals and departures on the grid | Built — chips carry their own edges, and separate arriving / departing / in-house lists exist beside the grid |
| Basic date navigation | Built, but coarser than the reference. See §2 |
| Basic guest card | Built, past the required depth — a person route with documents and attachments |
| **Opening a booking card** | **Missing.** See §1 |

Seven of eight are done. The list below is therefore not a build-out; it is a
short set of corrections, one genuine gap, and the visual work that was
deliberately deferred.

---

## 1. The booking card — the only missing item

What exists today is `StayActions`: a single-line bar that appears **above** the
grid when a chip is selected. It carries the guest name or the booking
reference, the reference, the status, the date range, the room number, one
button per legal next status, and the reason any disabled button is disabled.

That is the *action surface* for a booking. It is not a card. What it cannot do:

- **It is not addressable.** There is no route for one booking. A booking cannot
  be linked to, opened in a tab, refreshed, or sent to a colleague. Every other
  first-class object in the product has a route — an organization, a property, a
  person — and a reservation does not.
- **It shows one stay, not the reservation.** A booking holding two rooms has two
  chips, and selecting either shows that chip's dates and that chip's room. The
  reservation behind them — its total, its guests, its rate plan, its other
  rooms — has nowhere to be shown. The code is aware of this: the refusal
  preview in the bar is computed from the selected stay alone, with the comment
  that the server answers for all of them.
- **It shows no money and no guest detail.** No rate plan, no nightly
  breakdown, no total, no contact details, no notes. All of that is on the
  reservation already and none of it reaches a screen.
- **It disappears.** Selection is component state. Navigating the month away and
  back loses it.

The data is all there and the permissions are all there. What is absent is a
place to present one booking on its own.

Two shapes are possible and they are not equivalent. A **dialog** opened from
the chip keeps the desk on the grid, which is where the desk wants to be, and
matches how every other detail view in the product is opened. A **route** is
addressable and survives a refresh, which is what makes a booking shareable and
is what the reference product does — its bookings live under their own URL. The
reference also carries list views (new / current / archive) that must open
something, and a dialog opened from a grid cell has nowhere to be opened from on
a list. That argues for a route, with the grid opening it.

This is the decision to take first, because everything else in this file is
adjustment and this is construction.

---

## 2. The шахматка against the reference

### What already matches

- **Grouped by room type**, with the physical rooms beneath each type. The
  reference is organised the same way, and this is the structurally important
  agreement — the whole screen is built on selling a type and assigning a room.
- **A free-count row per type per night**, turning red at zero. This is the
  reference's `Свободно` row.
- **An unassigned band per type** — bookings that have a type and no room yet,
  drawn above the rooms and usable as a drop target. This is the reference's
  `Не выбран номер` lane, and it is the piece most naive grids omit.
- **Room rows labelled by number**, with the housekeeping state shown when it is
  not clean, and out-of-order rooms tinted.
- **A sticky label column**, so room numbers stay visible while the dates scroll.
- **A status legend** carrying both a colour and a text mark, so the encoding is
  not colour alone.

### What is missing or coarser

**The sold row.** The reference shows `Занято` above `Свободно` — how many of
the type are taken each night, beside how many are free. The grid shows only
free. The number is already computed and already sent to the browser; the row is
simply not drawn. This is the cheapest item on the list and the one a hotelier
will ask for first, because occupancy is the number they actually watch.

**Date navigation is a whole calendar month at a time.** The controls are
previous month, next month, today. The reference anchors on **an arbitrary
date** — its picker reads `18.03.2026` and the columns run forward from there,
crossing into April in the same view. Two differences follow:

- There is no way to jump to a specific date. Reaching next March is eleven
  clicks.
- The window always starts on the 1st, so a booking spanning a month boundary is
  cut by the view rather than shown whole. A desk looking at the end of the
  month cannot see the arrivals three days later, which is precisely when it
  wants to.

The underlying machinery does not impose this — the grid query takes an
arbitrary `from` and `to` and allows up to 62 nights. The calendar-month
restriction is entirely in the screen's own state.

**Weekends are not marked.** The reference tints Saturday and Sunday columns.
On a screen read for eight hours, the weekend stripe is how a person finds their
place without reading the header. The weekday is already computed per column.

**Type groups do not collapse.** The reference gives each category a collapse
control. With three types this does not matter; with twenty it is the difference
between a usable screen and a scroll.

**No search.** The reference searches by guest, room number or booking id from
the toolbar. There is none. For a desk, this is the second most-used control
after the date.

**No category filter.** The reference filters the grid to one room category.
Absent.

**No availability-first booking flow.** The reference's primary action is
*check availability and book* — pick dates and a category, see what is free,
then create. What exists here is a walk-in dialog, which books **tonight**,
assigns a room and checks the guest in as a single act. That is a genuinely
useful thing the reference makes harder, but it is not the same flow, and it
cannot make a booking for next month. The `availability` procedure it would need
already exists and has no screen.

**No booking list views.** The reference has new / current / archive tabs beside
the grid. A `list` procedure exists; no screen reads it.

---

## 3. Free / booked / occupied

The brief names three room states. The system has six reservation states —
enquiry, confirmed, checked in, checked out, cancelled, no-show — and a separate
housekeeping state on the room itself.

These are not in conflict, and the six should not be collapsed to three: the
distinctions carry real consequences, and an enquiry that reads as "booked"
would take a room off sale that is not sold. What the brief describes is a
**display projection**, evaluated per room *per night*:

- free — no occupying stay that night
- booked — a confirmed stay
- occupied — a checked-in stay

The important correctness point: **this is a property of a room-and-a-date, not
of a room.** A room is not "booked"; it is booked on these nights and free on
others. The system already models it correctly — status lives on the stay, and
occupancy is derived — but the brief's phrasing invites the wrong reading, and
that reading is the kind of thing discovered at a demo. Worth settling in words
before it is settled in a screen.

What may need to change is only the **labelling**: whether the three words the
client named appear on the legend, and what the other three states are called
where they are shown.

---

## 4. Language

The product is English. The brief, the reference product and the intended users
are Russian.

The extraction work is finished. Every string in the feature components comes
from a message file, the keys are typed so a typo fails compilation, and there
are tests in both directions — a message nothing reads fails, and a key nothing
declares fails. The locale list, the default, the cookie and the fallback for an
unrecognised value all exist.

What does not exist is a second locale. Adding `ru` is a translation job against
machinery that is complete, not a code change — with three exceptions found
while reading, listed in §6.

One thing to verify rather than assume: the grid formats dates with fixed
`"en"` formatters for the weekday, the day number, the month and the range. Those
are separate from the message files and will not follow a locale switch on
their own.

---

## 5. Design and view

The product wears shadcn's defaults on purpose, on the reasoning that they are
good enough to run a hotel and cheap to replace, and that visual design is worth
doing once the screens have stopped moving. That decision is sound and this file
does not reopen it. What follows is what the grid specifically will need when
that time comes, because it is the one screen where defaults are actually wrong
rather than merely plain.

**Density.** The grid is sized in fixed units: a 10rem label column, 2.5rem per
night, 1.75rem per lane. A 31-night month is therefore about 88rem wide and
scrolls horizontally on most laptops. The reference fits roughly seventeen days
in the same space, which is a deliberate trade — fewer days, no scroll. Neither
is obviously right; what is missing is the ability to choose. A screen read all
day wants a density control, and a forty-room property wants a tighter row than
a four-room one.

**Colour is a placeholder.** Status colours are a hand-picked map. The
accessibility floor is met — every status carries a text mark as well as a
colour, and the legend decodes both — so what is left is not a correctness
problem but a coherence one: the colours are six independent choices rather than
a scale, and they do not say which states are close to each other.

**Nothing is keyboard-reachable.** Assignment, moving and resizing are all drag.
A desk that works fast works on a keyboard, and there is currently no path to
any of the three without a mouse.

**No overview control.** The reference carries a floating toolbar — jump to a
date, step in four directions, return to today, help, settings. Here there are
three buttons in a row above the grid. Fine at this size; thin once the screen
is used for a shift.

**The header shows one month.** With the calendar-month window this is
consistent, but if the window becomes arbitrary (§2) the header has to show the
boundary, as the reference does by spilling `Март` into `Апрель`.

---

## 6. Hygiene found while reading

Small, and each is a few characters, but each is visible to a user.

**A stale hint, and it is false.** The paragraph beneath the grid ends: *"Moving
the dates needs a procedure that does not exist yet."* The procedure exists, is
wired, and is what the sideways drag and the edge drag both call. The sentence
describes a state the code left some time ago, and it is printed on the screen
telling users a working feature does not work.

**That same paragraph is hardcoded English.** It does not go through the message
files, so it will not translate with everything else, and — because it is not a
declared key — the test that catches orphaned messages cannot see it either.

**Two hardcoded strings in the action bar.** The room is rendered as
`room {number}`, and an unassigned booking as `no room yet`. Both sit beside
correctly translated labels, which is how they escaped notice.

**Minor, non-urgent:** the grid re-scans the full room list and the full
availability array for every type and every night during render. At MVP sizes
this is invisible. At a hundred rooms across 62 nights it is not, and it is a
grouping change rather than an optimisation.

---

## What this list deliberately excludes

Hourly and day-use objects — a peer tab in the reference product — are not an
extra field. The stay is a night-based interval and refuses a zero-night
booking by design. Hourly rental is a second interval model, a second
availability calculation and a second grid, and it belongs in a decision of its
own rather than in an MVP correction list.

Prices, channels, reports, tasks, guest campaigns and the public site are all
visible in the reference product's navigation and none are in the MVP. They are
not gaps; they are the rest of the product.
