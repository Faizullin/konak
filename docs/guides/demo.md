# The demonstration

Ten minutes, eight MVP items, no empty screens. Written for whoever is driving,
not for the audience.

## Before

```bash
docker compose -f docker/compose/db.yml up -d
npm run db:seed     # users, the organization, one property
npm run demo        # the hotel worth showing
npm run dev
```

Sign in as `admin@konak.dev` / `konak-demo-pw` and open

```
http://localhost:3000/desk/acme/seaside
```

`npm run demo` is re-runnable and clears its own previous run, so a rehearsal
costs nothing — run it again between takes and the picture is identical. It is
separate from `db:seed` on purpose: the seed is the minimal chain a fresh clone
needs, this is the dressed set. What it builds:

- **Ten rooms across three types** — Double ×4, Single ×4, Family ×2.
- **Ninety nights of inventory and rates**, Friday and Saturday nights at ×1.25,
  so the calendar reads as a calendar.
- **Fifteen bookings** covering every state, including a cancellation, a
  no-show and two same-day turnovers.
- **Мария Иванова**, three stays behind her.

## The path

Each stop discharges one of the client's eight items. The numbers in brackets
are theirs, from `ui-refactor-notes/mvp-analysis.md` § 2.

### 1 — The шахматка (item 1)

Land on it. Say nothing for a moment; it is the screen that sells.

Then, in order:

- **Rooms down, dates across, and a booking is a bar, not a row of cells.** The
  bar spans its nights because a stay *is* one thing.
- **Room 203, five nights out** — one stay ends on the morning another begins.
  The two chips meet on a diagonal rather than overlapping or leaving a gap,
  which is the honest picture: the room is not free that day, and it is not
  doubly sold either. Same-day turnover is the normal case at a busy hotel and
  most grids cannot draw it.
- **Room 202 is the same thing happening today** — Олег Волков leaves this
  morning, Елена Морозова arrives this afternoon. Only the arrival is on the
  grid, because his last night was yesterday; both are in the day lists below.
- **Sold and free per night, on each room type's own header row.** Not one
  total for the hotel — the question is never "have I got a room", it is "have
  I got a Double on Friday", and that is the row it is answered on.
- **The unassigned band**, under its type's header. Игорь Лебедев arrives today
  and has no room yet. That is normal, not an error: he bought a *type*, not a
  door.
- **Collapse a room type** you are not discussing. Ten rooms fit on a screen;
  a real hotel's eighty do not.

### 2 — Navigating dates (item 8)

- **± a day, ± a week, or type a date.** Then the window length: **14 / 31 / 62
  nights.**
- Say why it is a window and not a month: *a stay crossing the 1st is drawn
  whole.* A month grid cuts it in half, and every competitor does.
- **The density toggle.** Nobody else in this market offers it. A laptop at the
  desk and a 27-inch monitor in the back office are not the same screen.

### 3 — Today (item 7)

Left nav → **Актуальные**. Arrivals, departures, in house — the same three
questions a receptionist is asked all morning, as three lists.

Дмитрий Соколов is mid-stay, Анна Кузнецова is in house, Елена Морозова arrives
this afternoon.

### 4 — Check someone in (items 3, 7)

Игорь Лебедев, arriving today, no room.

1. Assign him a free Double — **drag his bar onto the row**, or use the booking.
2. **Check in.**

Then the point worth making: **try to check in someone arriving next week.** The
button is disabled *and says why*. A refusal that does not state its reason is
the thing every one of these products gets wrong.

### 5 — The booking, as tabs (item 5)

Open any booking. **Основное** holds the dates, guests, the total, what is paid,
the balance, and the status actions — each carrying its refusal reason.
**Оплата** is the bill: what was charged, what was paid, what is left.

Two things worth saying here:

- **The tabs are URLs.** Send a colleague the bill and they open the bill, not
  the booking with instructions. Most systems make a tab a piece of component
  state, and then there is nothing to send.
- **The URL holds a `publicId`**, not the row id. A booking reference counting
  up from 1 tells a competitor how many bookings the hotel took last month.

### 6 — Take a booking (item 3)

New booking, a few nights out.

- Free rooms per type **per night**, not a single number for the range.
- The quote is the sum of its nights — the weekend ones cost more, visibly.
- The reference is allocated inside the transaction from a number series, so two
  receptionists booking at once cannot be handed the same one.

### 7 — Rooms and categories (items 2, 4)

Left nav → **Номера**. Types and rooms, as a table across the full width.

Room state is **derived, never stored** — occupancy from stays, cleanliness from
housekeeping. Say this one plainly: a stored "status" column is a field that
goes stale the moment somebody forgets to update it.

### 8 — The guest (item 6)

Left nav → **Гости** → **Мария Иванова**. Contacts, tags, documents, and three
stays behind her.

That last part is the whole argument for a directory: a returning guest is a
person, not three unrelated bookings.

### 9 — The bookings list

**Бронирования** → **Архив**. The cancellation and the no-show live here — neither
occupies a room, which is exactly why neither is on the grid.

### 10 — Both languages

Switch the language in the top bar. The client's staff work in Russian, and
every screen here is translated — including the refusal reasons.

A dark theme is **not** on this path. The tokens for one exist, on this surface
and the old one, but nothing in the product flips them yet — see `todo.md`. Do
not offer it and then go looking for the switch.

## What not to promise

- **Channel manager** — the machinery is built and tested; no vendor is
  connected. Say "ready for", not "connected to".
- **Fiscal receipts, door locks, the public booking page** — modelled, not
  built.
- **Hostel beds and hourly rentals (баня, сауна)** — open questions, in
  `todo.md`. Kontur answers the second with a separate шахматка.

## The screenshots

`npm run test:e2e && npm run report:ui` produces the PDF over these screens in
both languages — see [plans/e2e-and-reports.md](../plans/e2e-and-reports.md).
Run it before the meeting, not during.
