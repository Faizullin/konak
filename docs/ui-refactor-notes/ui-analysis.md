# UI/UX analysis — current state, and how the field does it

Working notes. Companion to `mvp-analysis.md` (functional coverage); this file
is about the *interface*. Date: 2026-09-13. Code read only, no builds run.
Screenshots inspected from `docs/screenshots-report/` — note they are stale
(the grid shot still says "Moving the dates needs a procedure that does not
exist yet", which shipped since).

- Part A — is the current UI good, or is it "just shadcn"?
- Part B — how Kontur and the rest of the field build theirs, and which is best
- Part C — what to change here
- Part D — architecture for the themeable widget playground

---

# Part A — The current UI

## Verdict in one line

It is stock shadcn, deliberately and per `roadmap.md` Phase 12 — **but the
problem is not the styling, it is the layout.** Three structural decisions hurt
the product today, and none of them is a Phase 12 concern.

## What is genuinely good, and should survive any redesign

These are not accidents; they are written down and defended in
`docs/guides/ui-patterns.md`, which is binding.

1. **Colour is never the only cue.** `STATUS_CLASS` carries hue, `STATUS_MARK`
   carries a shape (`?` `○` `●` `✓`), and enquiry/checked-out also differ by
   border style. The mark is `aria-hidden` because the chip's `title` already
   says the status in words. **No competitor surveyed does this.** Kontur,
   Bnovo, meHotel and TravelLine all encode status in hue alone.
2. **A legend rendered where the marks are used**, not in a help page.
3. **User-controlled density.** `comfortable` / `compact`, persisted per user.
   Rare in this market — TravelLine and Bnovo offer only Day/Month mode
   switches, not density.
4. **Both themes, everywhere.** Dark mode is class-based and every grid colour
   is paired with a `dark:` variant. Front desks run dim at night.
5. **Skeletons over spinners**, `placeholderData` so tables keep the previous
   page, URL-as-state for every table filter (`nuqs`). All correct for
   operational software.
6. **Refusals carry their reason.** A greyed-out "Check in" says why, and the
   disabled button and the server refusal are computed from the same
   `model/` function. This is a rarer quality than it sounds — the Cloudbeds
   research (below) names error recovery as a top staff frustration.
7. **Housekeeping is cards, not a table**, with an explicit written rationale:
   read standing up, one hand free, one decision per card. Correct.

## What is actually wrong — ranked

### 1. The shell caps the app at 1024px. This is the big one.

`src/app/(app)/dashboard/layout.tsx`:

```tsx
<div className="mx-auto w-full max-w-5xl flex-1 p-6">{children}</div>
```

`max-w-5xl` = 64rem = **1024px**, centred, with 24px padding each side → **976px
of usable content width on any monitor.**

The reservation grid is a two-axis data surface up to 62 columns wide. Do the
arithmetic against the grid's own density tokens:

| Density | Label col | Night col | Nights that fit in 976px |
|---|---|---|---|
| comfortable | 10rem (160px) | 2.5rem (40px) | **20** |
| compact | 7rem (112px) | 1.75rem (28px) | **30** |

The **default window is 31 nights at comfortable density**. So out of the box a
receptionist sees ~20 of 31 nights and horizontally scrolls for the rest — on a
1280px laptop and on a 2560px desk monitor alike, because the constraint is the
layout, not the screen. On that 2560px monitor roughly **1500px is empty
margin**. The screenshot shows exactly this: a small grid marooned in white.

`max-w-5xl` is a reading measure. It is right for settings, a booking card, a
form. It is wrong for the one screen the product exists for.

### 2. Today's work and the month are stacked, not side by side

`front-desk/[propertySlug]/page.tsx` renders `<FrontDeskDay>` then
`<ReservationGrid>` in a single `space-y-6` column. Arrivals, departures and
in-house sit *above* the grid, so a receptionist scrolls vertically between the
two things they alternate between all day — inside a 1024px column that has
room for neither. These are the two halves of one job and they never share a
screen.

### 3. Red means "sold out"

```tsx
counts.available === 0 ? "text-destructive font-medium" : "text-muted-foreground"
```

A sold-out night is the *best* commercial outcome a hotel has. Painting it in
the destructive token trains staff to read full occupancy as an error. Across
every system surveyed, red is reserved for **overbooking** or **overdue
payment** — genuine problems. This is a one-line fix and a real semantic bug.

### 4. Grid colours are hard-coded palette classes, not tokens

`STATUS_CLASS` is literal Tailwind: `bg-sky-100`, `bg-emerald-100`,
`dark:bg-sky-950`. They do not reference `--primary`, `--chart-*` or any
semantic token, so **they will not move when a theme changes.** For the stated
goal of "widgets that fit different themes" this is the single most important
thing to fix, and it is more urgent than picking a nicer palette.

The stock `--chart-1..5` tokens exist in `globals.css` and are unused.

### 5. Page chrome is sized like a marketing site

`PageHeader` renders `h1.text-2xl` plus a description, then `space-y-6` below.
On the front desk that is ~120px of vertical space spent restating the property
name and check-in times — on a screen read for eight hours where vertical space
is rows of rooms. Operational screens want a compact title bar that merges with
the toolbar, not a hero.

### 6. The theme is untouched stock

`globals.css` is shadcn's default zinc/neutral oklch set, `--radius: 0.625rem`.
No brand colour, no density scale, no elevation scale. That is *fine and
intended* until Phase 12 — worth stating plainly in any client-facing report so
"it looks like a template" is answered before it is asked.

## Screen-by-screen, against the eight MVP items

| Screen | UI verdict |
|---|---|
| Шахматка | Excellent mechanics (spans, lanes, drag, resize, keyboard, legend), crippled by the 1024px cap. Missing: today line, half-cell arrivals/departures, overbooking state |
| Номера (setup) | Plain forms + panels. Adequate. Manager-only gating is visible and correct |
| Бронирование | Dialog with live availability per type per night and a rate quote. Good — better than a blank form |
| Статус номера | Two-axis model is right; the room's housekeeping status is a small grey caption in the row label and reads as an afterthought |
| Карточка брони | Clean sectioned layout — stays table, guests, money, notes, actions with reasons. Solid |
| Карточка гостя | Contacts as a bare `<dl>`, then three attachment panels and stay history. Functional but the thinnest screen in the product; no tags, no VIP marker, no avatar |
| Заезд/выезд | Present as a separate day panel, absent from the grid itself |
| Навигация по датам | Rich (±day, ±week, date jump, window length, density) — but the toolbar is one long unstructured `flex-wrap` row mixing navigation, view options, actions and the legend |

---

# Part B — How the field does it

## The research that matters: Cloudbeds' PMS User Experience Report

A survey of **500 hotel employees across five countries**. The numbers are the
most useful thing found on the whole web for this project:

- **52.2% of managers** say front-desk staff need **four months to three years**
  to feel confident in their PMS.
- **38% of employees** cited PMS frustration as a factor in **leaving the job**.
- 73% of training is in-person, pulling managers off the floor.
- Named frustrations, in order: interface complexity (needing several windows
  open for one task), data-entry errors that are expensive to correct,
  not knowing the right path through a task, and **being unable to recover from
  an error without a supervisor**.

Read that last one against our refusal design: a disabled button that states its
own reason is a direct answer to the most-cited complaint in the industry's own
research. That is a defensible selling point, not a detail.

Cloudbeds' stated design principles: minimise clicks for check-in, drag-and-drop
for modifying reservations, real-time inventory, mobile-first housekeeping with
task prioritisation and checklists, centralised guest profiles with history,
pre-configured reports rather than a query builder. **We already have four of
those seven.**

## The three philosophies in the Western market

| | Approach | Cost |
|---|---|---|
| **Mews** | Clean, modern, low density, opinionated defaults. Optimises for training time | Trades depth; power users hit walls |
| **Cloudbeds** | Modular and rich — many panels, many tabs, several routes to one task. Scales to large operations | Their own research names this shape as the top complaint |
| **Apaleo** | API-first; the UI is explicitly not the differentiator | Not a UI model to copy |

## The Russian market (what the client actually knows)

Detail is in `mvp-analysis.md` §6. The short form:

- **Half-cell arrival/departure is universal.** TravelLine: a booking fills a
  whole cell or part of one, and a partial cell *means* the guest arrives or
  departs that day. The day splits three ways — departures, a middle band for
  late checkout / early check-in, arrivals.
- **Bnovo** additionally draws early check-in / late checkout as a red stripe
  with a timestamp, and those reduce availability on the *neighbouring* day.
- **Unassigned** = striped fill (Bnovo) or a separate tab (Kontur).
- **Overbooking** = red, everywhere.
- **Colour often encodes payment, not stay state** (meHotel: yellow = unpaid
  within deadline, green = paid, red = overdue). We cannot do this until
  Phase 6.
- **Kontur lets users recolour the grid themselves** and move the toolbar to the
  bottom to reclaim vertical space — an admission that the vendor's defaults do
  not fit every desk.
- **Kontur's own users complain it is cluttered**: too many unnecessary rows,
  constant scrolling while a guest is on the phone
  ([kontur.ru/qa/11853](https://kontur.ru/qa/11853)). They ask for compact,
  dates across, rooms down, empty cell = free, colour-coded statuses.

## The density literature

The consensus of the enterprise-UX writing, and it lines up with the above:

- Density should track **user expertise and task frequency**. Experts on a
  screen used all day want high density; onboarding wants low. The correct
  answer is **not a fixed choice but a user-adjustable one** — which we have and
  most competitors do not.
- Practical floors: **12px minimum for interface text**; 32–36px control
  heights for compact buttons; 48px effective touch targets on mobile even when
  the visual element is smaller.
- Progressive disclosure is the density tool: collapse rarely used controls
  behind "more", keep levels of abstraction (summary → detail) rather than
  showing everything at once.
- The recurring warning is specifically about our failure mode: layouts tuned
  for a reading measure or a phone go **vacant on desktop**.

Our compact lane height is 1.25rem = **20px**, and the night column 28px. That
is genuinely dense — denser than most — and it is the right instinct. It is
simply trapped in a 976px box.

## So which is best?

No single product is. The synthesis that beats all of them for this market:

1. **Grid conventions from TravelLine/Bnovo** — half-cells, striped unassigned,
   red for overbooking only, a today line, collapse-a-category-to-availability.
   These are the conventions the client's staff already have in their hands, and
   they are more mature than Kontur's.
2. **Visual calm from Mews** — one route to a task, few panels, strong defaults.
   Explicitly *not* Cloudbeds' many-tabs model, which their own research
   indicts.
3. **Density control from us** — keep it; nobody else in this market offers it,
   and the literature says it is the correct answer to a question that has no
   fixed answer.
4. **Accessibility from us** — shape + hue, and refusals that state their
   reason. Nobody surveyed does either. This is a genuine differentiator against
   a Russian-market incumbent, not a nice-to-have.
5. **Kontur's configurability, scoped.** Let the grid palette be a theme, not a
   per-user colour picker — that way it serves the same need without becoming a
   settings screen nobody maintains.

---

# Part C — What to change here, in order

**Before any restyling. None of this is Phase 12 work.**

1. **Let the front desk out of the 1024px box.** Not by removing `max-w-5xl`
   globally — settings and forms want it. Make the width a per-route decision:
   the layout renders a plain full-width `flex-1` container, and the *reading*
   measure becomes a wrapper that content pages opt into. One prop or one
   wrapper component, not a rewrite.
2. **Put the day lists beside the grid**, not above — a sidebar column on wide
   screens, stacked below a breakpoint.
3. **Stop painting sold-out red.** Use a neutral-emphatic token; reserve
   destructive for overbooking when it exists.
4. **Move `STATUS_CLASS` onto semantic tokens** (see Part D). This is the
   prerequisite for everything thematic.
5. **A compact page chrome for operational routes** — title merged into the
   toolbar row, not a 120px hero.
6. **Structure the grid toolbar**: navigation | window | view | actions | legend,
   as groups with separators, rather than one `flex-wrap` run.
7. Then the cheap parity items: today line, Shift+wheel, copy-link on a chip.
8. Half-cell arrivals/departures — the one genuinely new piece of geometry.
   Belongs in `model/grid.ts` as a pure function so it is testable without a
   browser, exactly like `spanInWindow`.

---

# Part D — Architecture for the themeable widget playground

The stated goal: implement the core functions once, then define our own pages
and widgets that can wear different themes. That is a three-layer problem and
the current code only has one layer.

## 1. The token layer — three tiers, not one

Today `globals.css` has semantic tokens (`--primary`, `--muted`) and the grid
ignores them, using literal `sky-100`. The standard structure:

```
primitive   --blue-500, --space-2, --text-xs      (raw values, never used in components)
semantic    --surface, --surface-raised, --text-muted, --edge
domain      --status-confirmed, --status-in-house, --night-width, --lane-height
```

The domain tier is the one this product is missing and needs most. A theme then
swaps the semantic and domain tiers; components never change. Concretely:

```css
:root {
  --status-enquiry-bg: var(--muted);
  --status-confirmed-bg: oklch(...);
  --grid-night: 2.5rem;
  --grid-lane: 1.75rem;
}
[data-density="compact"] { --grid-night: 1.75rem; --grid-lane: 1.25rem; }
```

The grid already does this for its three measurements — `--grid-label`,
`--grid-night`, `--grid-lane` are set as CSS custom properties from the density
preference. **That pattern is correct; extend it to colour.** The work is
mechanical and the file that proves it already exists.

## 2. The logic/presentation split

Core functions stay where they are — `model/` for pure rules, tRPC for data.
What is missing is the middle: a headless hook per widget that owns state and
returns data + handlers, with a presentational component that renders it.

`reservation-grid.tsx` is 1270 lines doing all three jobs at once: query,
optimistic-update arithmetic, drag/resize state machine, and markup. To have
two themed variants of the grid you would today copy 1270 lines.

The split for this codebase:

```
model/grid.ts              pure geometry            (exists, tested)
client/hooks/use-grid.ts   query + drag/resize + optimistic state  (extract)
client/components/…        markup only, reads the hook              (thin)
```

`use-desk-preferences.ts` already shows the shape. The grid is the file that
most needs it and is also the hardest — do one smaller widget first (the day
lists, or the housekeeping board) to prove the pattern before touching 1270
lines.

## 3. What the playground should actually contain

Not a component gallery — those rot. A **route that renders each real widget
against fixture data**, with theme, density, locale and viewport as controls.
Concretely valuable because it makes four things checkable in one place that are
currently only checkable by driving the whole app with a seeded database:

- a Russian string overflowing a column (the reason `locale.e2e.ts` exists),
- a grid row with six overlapping unassigned stays,
- every status chip in both themes at both densities,
- an empty state, a loading skeleton, and a refusal message.

The fixtures should be the same ones `tests/e2e/fixtures` uses, so the playground
and the browser suite cannot disagree about what the data looks like.

**Caution.** `docs/guides/architecture.md` is binding and the memory note says
shared UI goes in `components/common` and no new component directories get
invented. A playground is a *route*, not a new top-level directory — it belongs
under `app/` (probably its own route group, and it must not ship in the
production bundle), with widgets staying in their features.

---

# Open questions

1. Is the front desk allowed its own layout width, or is `max-w-5xl` a
   deliberate global decision someone will defend? (It reads accidental — the
   comment says nothing about it.)
2. Do we build half-cell rendering before the client demo, or present the
   exclusive-checkout convention and let them react?
3. Is the playground a Phase 12 deliverable, or does it come earlier because it
   is a *testing* tool as much as a design one? Argument for earlier: it pays
   for itself the first time a Russian string overflows.
4. Phase 12's "colour as data: a scale" is still unwritten. The domain token
   tier above is what that phase actually needs to produce — worth recording in
   the roadmap now so it is not rediscovered.

---

# Sources

**PMS UX research**
- https://www.cloudbeds.com/hotel-pms-ux/findings/ — 500-employee survey, the numbers
- https://www.cloudbeds.com/articles/pms-user-experience/ — their design principles
- https://www.hospitalitynet.org/opinion/4127256.html

**Market/UI comparison**
- https://hoteltechinsight.com/pms-vs/cloudbeds-vs-mews/
- https://www.mews.com/en/compare/mews-vs-cloudbeds
- https://hoteltechinsight.com/pms-vs/mews-vs-apaleo/

**Russian PMS grid conventions**
- https://help.bnovo.ru/knowledgebase/planing/
- https://www.travelline.ru/support/knowledge-base/chto-takoe-shakhmatka-i-kak-ona-pomogaet-v-rabote/
- http://help.mehotel.ru/setka-bronirovaniya
- https://kontur.ru/qa/11853 — Kontur users on Kontur's grid

**Density and dense UI**
- https://blog.logrocket.com/balancing-information-density-in-web-development/ — 12px floor, 48px targets
- https://design.basis.com/foundations/density — high/low density by user expertise
- https://uxdesign.cc/how-white-space-killed-an-enterprise-app-and-why-data-density-matters-b3afad6a5f2a (403 to fetch; title states the thesis)

**Tokens and headless architecture**
- https://ui.shadcn.com/docs/theming
- https://blog.logrocket.com/the-complete-guide-to-building-headless-interface-components-in-react/
- https://www.greatfrontend.com/blog/top-headless-ui-libraries-for-react-in-2026
