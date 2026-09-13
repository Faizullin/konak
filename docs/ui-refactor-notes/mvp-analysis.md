# MVP analysis — working notes

Working material for the MVP report — analysis, not a deliverable.
Date: 2026-09-13. No builds or scripts were run for any of this — code read only.

Contents:
1. The client's request
2. Point-by-point coverage against the codebase
3. The two points that need a client conversation
4. Gaps, and the two expensive modelling questions
5. Assessment of docs/kontur-notes/ (3 files)
6. Web research: what is findable, what is blocked, what it settles
7. Open decisions before the report is written

---

## 1. The client's request

Source: message from client, in Russian. MVP of a hotel management system,
"ориентируясь на функциональность программы «Контур Hotel»". Eight items:

1. шахматка (календарь занятости номеров)
2. создание и отображение номеров
3. бронирование номера
4. отображение статуса номера (свободен, забронирован, занят)
5. возможность открыть карточку бронирования
6. базовую карточку гостя
7. отображение заезда и выезда в шахматке
8. базовую навигацию по датам

Explicitly: only core functionality, no extras. Everything else staged after
MVP approval.

---

## 2. Point-by-point coverage

**Verdict: all eight are implemented. Six are past MVP quality.**

| # | Требование | Status | Where |
|---|---|---|---|
| 1 | Шахматка | Beyond MVP | `src/features/reservations/client/components/reservation-grid.tsx` (1270 lines). Rooms down, dates across, stays as spans not cells, lanes for overlap, room types as collapsible groups, per-night sold/free counts, unassigned band, drag-to-assign, drag-to-move, edge-resize, keyboard moves, density toggle, 30s polling. Geometry is pure + tested in `model/grid.ts` |
| 2 | Создание и отображение номеров | Done | `/front-desk/<slug>/setup`. `property.createRoom / updateRoom / archiveRoom`, same for room types. `compareRoomNumbers` sorts like a corridor, not lexically. Manager-only: OWNER/ADMIN write, MEMBER reads |
| 3 | Бронирование номера | Beyond MVP | `reservation.create` (any dates, against a real `InventoryHold`), `reservation.walkIn` (book + assign + check-in in one transaction), booking dialog shows free rooms per type per night and quotes a rate plan. `reference` comes from `NumberSeries` inside the transaction (router.ts:237), not `count()+1` |
| 4 | Статус номера | Modelled differently — see §3 | |
| 5 | Карточка бронирования | Done | `/front-desk/<slug>/bookings/<publicId>`, `booking-card.tsx`. Stays, guests, notes, total/paid/balance, status actions carrying their refusal reason. Keyed on `publicId` so the URL does not leak booking volume |
| 6 | Базовая карточка гостя | Done, with known holes | `/directory/<personId>`. Contacts, stay history, attachment panels (identity docs / consents / files). Guest names on a booking link straight to it |
| 7 | Заезд и выезд в шахматке | Different convention — see §3 | Arrivals/departures/in-house also have their own day panel: `front-desk-day.tsx` |
| 8 | Навигация по датам | Beyond MVP | +/-1 day, +/-1 week, date jump input, window length 14/31/62 nights, persisted per user. Window is anchor + length, deliberately not a calendar month, so a stay crossing the 1st is drawn whole |

Supporting facts worth carrying into the report:

- 46 Prisma models across 14 schema files; 8 feature slices; ~28k lines of
  hand-written TS (excluding generated Prisma client).
- Test suite: 220 unit (run clean, 0.6s), 136 integration, 20 e2e journeys,
  36 screenshots. `tsc --noEmit` clean.
- Double-booking is refused by a Postgres exclusion constraint, not by
  application code.
- Front desk is an off-by-default org module (`FRONT_DESK`).
- i18n: en + ru, both live.

---

## 3. The two points that need a client conversation

### «Отображение статуса номера (свободен, забронирован, занят)»

There is no single tri-state field, and that is correct. Two orthogonal axes:

- **Booking status** — `ENQUIRY / CONFIRMED / CHECKED_IN / CHECKED_OUT` plus
  `CANCELLED / NO_SHOW`. Drawn on the chip by colour AND by shape
  (`STATUS_MARK`: ? o * v), so it survives colour-blindness and a dim night desk.
- **Room housekeeping status** — `CLEAN / DIRTY / IN_PROGRESS / INSPECTED /
  OUT_OF_ORDER`, shown in the row label.

"Свободен" = no chip + the per-type free count row. Maps onto the client's three
words exactly: забронирован = CONFIRMED, занят = CHECKED_IN, свободен = empty.
If they want a literal per-room badge, that is an afternoon, not a redesign.

### «Отображение заезда и выезда в шахматке»

`checkOut` is exclusive, so the departure day is not drawn — the departing chip
ends where the arriving one begins and they share a lane. Every major Russian
PMS instead splits the cell (see §6). **This is the one real parity gap.**

---

## 4. Gaps and the expensive questions

Cheap:

- No VIP / problem-guest tags in the UI. `Tag` / `EntityTag` tables exist, unused.
- No passport fields on the guest card. `IdentityDocument.numberEncrypted` and
  `encryptField` both exist; nothing writes them. Phase 9 by design.
- No "copy link" on a chip. We already have stable `publicId` URLs — nearly free.
- No Shift+wheel horizontal scroll (Kontur has it; staff have it in their fingers).
- No vertical "today" line on the grid.
- No overbooking state. We refuse it at the DB level; every competitor draws it red.

Expensive — **must be answered before MVP sign-off, not after**, because both
break assumptions the whole schema turns on:

1. **Койко-места (beds in a hostel room).** Kontur sells a bed inside a room and
   even names bunks upper/lower. Nothing in our 46 models has a bed level.
   Retrofitting touches availability, the exclusion constraint, the grid's
   vertical axis and every rate plan.
2. **Почасовые объекты (бани, сауны, беседки).** Every date column here is
   date-only property-local midnight, deliberately. Good news from research:
   Kontur, Bnovo and TravelLine all solve this with a **separate grid / mode**,
   not by folding hours into the nightly one. So it is a second screen and a
   second rate shape, not a rewrite of the first.

Question to put to the client in writing: *do the target properties include a
hostel or an hourly object?*

---

## 5. docs/kontur-notes/ — usefulness assessment

Three files, all AI-generated by Kontur's own tooling, all carrying its
"может ошибаться" disclaimer. The Пересказ and Протокол are both derived FROM
the Транскрипция — citing all three is citing one source three times.

| File | Lines | Value |
|---|---|---|
| Транскрипция | 376 | **High — the only one worth citing.** Timestamped verbatim. The only source with UI-level detail |
| Пересказ | 172 | **Medium.** Structured sweep of the whole product (settings -> tariffs -> bookings -> tasks -> reports -> channels -> mini-site). Almost nothing on the шахматка itself. Use for the "what comes after MVP" section |
| Протокол | 61 | **Low.** Agenda, attendees, next-steps checklist. One line at most: dates the session (30 March 2026), ~22 hotel operators being trained |

### Eight facts the transcript gives that the code cannot

1. **Kontur colour semantics** (01:39:14, 00:44:39). Default: orange = created,
   green after check-in. The trainer's customised instance: green = not yet
   arrived, pink = arrival day reached but not checked in, light blue = in house,
   dark blue = unassigned, red = овербукинг. Palette is user-configurable — which
   makes our Phase 12 placeholder palette a smaller problem than it looks.
2. **Овербукинг is a drawn state.** Users expect to see it and resolve it.
3. **Unassigned bookings live on a separate tab** «не выбран номер», not an
   inline band per room type the way ours does.
4. **Date navigation**: calendar picker, arrows, and Shift+wheel for horizontal
   scroll (01:48:51).
5. **Kontur's grid has no zoom modes yet.** Verbatim, 01:37:29: «Пока это
   финальные возможные версии Шахматки. Сейчас мы для вас разработаем
   возможность переключаться между режимами». Our density toggle + 14/31/62-night
   window already ships what Kontur was still promising in March. Strongest
   single line available for the report.
6. **Check-in is refused before the arrival date** (01:54:53). Kontur does
   exactly what our `refuseStatusChange` does. Direct validation.
7. **Chip interactions are a right-click context menu**: open in new tab, copy
   link, edit, cancel, attach/detach from group. We chose left-click-select plus
   an action panel, deliberately.
8. **Deleted bookings go to «Архив» and can be restored** when a guest turns up
   later. Our model treats cancelled as terminal, on purpose. Defensible, but
   must be said out loud rather than discovered.

### Caution

ASR damage is heavy. «электронные звонки» is **электронные замки** (smart locks,
our `LockDevice`). Also «хостный номер» = хостельный, «коейко место» =
койко-место, «Бронрование», «блередного» = бледного. Read it, never quote it
verbatim.

These are notes on how to USE Kontur, not a requirements document. The client's
brief lists eight items and only those are in scope. Everything else in the
files — тарифы, услуги, турналог, касса, ФМС, отчёты, каналы, мини-сайт — is
context for what comes next.

---

## 6. Web research

### What is blocked

Kontur's real product documentation is at `support.kontur.ru/hotel`. Article
URLs are findable via search (`40968-s_chego_nachat`,
`40976-nastrojki_bronirovaniya`) but **every fetch returns 403** — index and
articles alike. Bot-protected. No YouTube tutorials surfaced.

`kontur.ru/hotel/*` renders but is marketing. Its `/spravka` section is an SEO
blog about apartment tax law and conflict resolution, not product docs.

**Consequence: the meeting transcript is the best Kontur-specific source we
have.** If support.kontur.ru is wanted, a human must open it in a browser and
paste the relevant pages into `docs/kontur-notes/`.

### What competitors document properly — and what it settles

**The half-cell convention is an industry standard, not a Kontur quirk.**

TravelLine, verbatim: a booking occupies either a whole cell or part of one, and
"when a booking doesn't fill a complete cell, the guest is checking in or
checking out that day." The day is split three ways: departures first, a middle
band for late checkout / early check-in, arrivals last.

Bnovo does the same, drawing early check-ins and late checkouts with a red
stripe and a timestamp — and those affect availability counts on the NEIGHBOURING
day (early arrival reduces the previous day; late departure the following one).

This is the convention every Russian front-desk operator has in their hands.
It is the one visual thing our grid does differently, and it moves item 7 from
"a difference worth mentioning" to THE parity gap.

**Kontur's own users complain about Kontur's шахматка.** kontur.ru/qa/11853:
too many unnecessary rows, constant scrolling while a guest is on the phone,
cluttered. The request: compact, dates across the top, room numbers down the
side, empty cell = free, colour-coded statuses. That describes our grid almost
exactly, including collapsible categories and the density toggle. Strongest
third-party material for the report.

**Colour conventions: there is no single expectation to meet.**

| | Kontur (default) | Bnovo | meHotel |
|---|---|---|---|
| Created | orange | green (new) | yellow — unpaid, deadline live |
| Verified/confirmed | — | yellow | green — fully paid |
| Checked in | green | blue | purple |
| Unassigned | separate tab | striped | — |
| Overbooking | red | red | — |
| Overdue payment | — | — | red |

Two consequences. Our sky/emerald/slate is not wrong — and Kontur lets users
recolour anyway. But **meHotel and Bnovo tie chip colour to PAYMENT state, not
just stay state.** We cannot until Phase 6 (folios). Say so before the client
notices.

Near-universal and missing from ours: overbooking drawn red, and a vertical line
marking today with a "Today" button.

**Recurring features for the "after MVP" section**: cleaning status per room row
(we have it), collapsing a category to a bare availability row (we have it —
TravelLine describes exactly our sold/free counts), icons on the chip for
pets/children/cot/early arrival, guest search from the grid, Day/hour mode
toggle for hourly objects.

### Sources

- https://kontur.ru/qa/11853 — user feedback on Kontur's шахматка
- https://kontur.ru/hotel/spravka/279-shahmatka_dlya_gostinicy
- https://help.bnovo.ru/knowledgebase/planing/
- https://www.travelline.ru/support/knowledge-base/chto-takoe-shakhmatka-i-kak-ona-pomogaet-v-rabote/
- http://help.mehotel.ru/setka-bronirovaniya
- https://blog.hotelpms.ru/instrumenty/shahmatka-dlya-gostinicy/
- https://support.kontur.ru/hotel/40968-s_chego_nachat — 403 to automated fetch

---

## 7. Open decisions before writing the report

1. **Language.** Russian for the client, or English for internal use, or both?
2. **Half-cell rendering** — build it before the demo, or present the exclusive
   convention and let the client react?
3. **Overbooking** — say "refused by design, Phase 7 adds the policy", or add a
   drawn state now?
4. **Hostel / hourly** — put the question to the client in writing before
   MVP sign-off.
5. **Scope framing.** The honest recommendation is: do not build toward this
   list, demo against it. Everything is already reachable in the running app;
   what remains is presentational plus a scripted demo path.
6. **Stale docs.** `docs/todo.md` still lists the screenshot report and the
   three journeys as next; both shipped. Phase 5 work is staged uncommitted.
   Worth fixing before anything is shown, in a repo this disciplined about docs
   describing reality.
