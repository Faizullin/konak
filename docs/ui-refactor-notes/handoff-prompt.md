# Handoff prompt — konak MVP report, UI work, and the edition system

Paste the block below into a fresh session. It is self-contained: every repo
path in it is stable, and the findings are carried inline rather than by
reference to the other notes in this folder.

---

I'm working on **konak** (`/Users/osman/Desktop/OSMAN_PROJECTS/konak`), a
multi-tenant hotel PMS: Next.js 16, React 19, tRPC 11, Prisma 7 on Postgres,
Better Auth, shadcn + Tailwind 4, next-intl (en/ru). Read `CLAUDE.md`, then
`docs/handoff.md` and `docs/todo.md` before anything else — the guides in
`docs/guides/` are binding.

A previous session did three analyses. Here is what it found and what is left
to do. **Don't re-derive this; verify only where you're about to act.**

## Background: the client request

A client asked for an MVP "ориентируясь на функциональность программы Контур
Hotel" with eight items: шахматка, создание/отображение номеров, бронирование,
статус номера (свободен/забронирован/занят), карточка бронирования, карточка
гостя, отображение заезда/выезда в шахматке, навигация по датам.

**All eight are already implemented; six are past MVP quality.** The relevant
code:

- Grid: `src/features/reservations/client/components/reservation-grid.tsx`
  (1270 lines), geometry in `src/features/reservations/model/grid.ts` (pure,
  tested)
- Day lists: `src/features/reservations/client/components/front-desk-day.tsx`
- Booking card: `src/features/reservations/client/components/booking-card.tsx`
- Guest card: `src/app/(app)/dashboard/orgs/[orgSlug]/directory/[personId]/page.tsx`
- Rooms/setup: `src/features/properties/`, route `/front-desk/<slug>/setup`
- Status rules: `src/features/reservations/model/status.ts` (`refuseStatusChange`)

Health at last check: 220 unit tests pass, `tsc --noEmit` clean. Not run:
`test:server` (needs Postgres) and `build`.

## Finding 1 — the layout bug (highest priority, fix first)

`src/app/(app)/dashboard/layout.tsx:76`:

```tsx
<div className="mx-auto w-full max-w-5xl flex-1 p-6">{children}</div>
```

1024px minus 48px padding = **976px usable on every dashboard route**,
including the reservation grid. Against the grid's own density tokens
(`--grid-label`, `--grid-night` in `reservation-grid.tsx`):

- comfortable: 160px label + 40px/night → **20 nights fit**
- compact: 112px label + 28px/night → 30 nights fit

The default window is **31 nights at comfortable density**, so out of the box a
receptionist sees two-thirds of the window and scrolls — on a 1280px laptop and
a 2560px monitor alike, because the cap is the layout, not the screen.

**Fix:** content width becomes a per-route decision. The layout renders a
full-width `flex-1` region; pages declare `full` (front desk, housekeeping,
wide tables) or `reading` (settings, forms, booking card, person page). Verify
before/after with the `report` Playwright project and `npm run bundle`.

Two smaller layout problems in the same area:
- `front-desk/[propertySlug]/page.tsx` stacks `<FrontDeskDay>` *above*
  `<ReservationGrid>` in one column — the two halves of one job never share a
  screen. Should be side by side on wide viewports.
- The grid toolbar is one unstructured `flex-wrap` row mixing navigation,
  view options, actions and the legend.

## Finding 2 — the sidebar is not translated (independent bug)

`src/features/organizations/model/registry.ts` carries `label: "Overview"`,
`"Front desk"`, `"Directory"` as English literals; `src/config/nav-items.ts`
does the same for `accountNavItems`; `nav-main.tsx` renders `item.title` raw.
Only `nav-user.tsx` calls `useTranslations`. **With the Russian locale active
the entire sidebar stays English** — visible in
`docs/screenshots-report/*.png`. This contradicts `docs/guides/ui-patterns.md`
§ Strings, and `tests/e2e/locale.e2e.ts` evidently does not assert on the nav.

Fix: the registry carries a message key; the renderer resolves it. Add the
assertion to `locale.e2e.ts` so it can't regress.

## Finding 3 — colours are not tokens

`STATUS_CLASS` in `reservation-grid.tsx` uses literal Tailwind
(`bg-sky-100`, `dark:bg-sky-950`), not semantic tokens, so **grid colours will
not move when a theme changes.** The stock `--chart-1..5` in
`src/styles/globals.css` are unused. The grid already does the right thing for
its *measurements* (CSS custom properties driven by the density preference) —
copy that pattern for colour. This is the precondition for any theming work.

Also: `counts.available === 0` paints sold-out nights with `text-destructive`.
A full house is the best commercial outcome there is; every PMS surveyed
reserves red for overbooking or overdue payment. One-line semantic fix.

## Finding 4 — what the market does (for the client report)

Research is done; don't redo it.

- **Half-cell arrival/departure is an industry standard**, not a Kontur quirk.
  TravelLine and Bnovo both document it: a partial cell *means* the guest
  arrives or departs that day; the day splits into departures / middle band /
  arrivals. Our `checkOut` is exclusive so we draw nothing on the departure
  day. **This is the one real parity gap** on the client's seventh item.
- Universal and missing here: **overbooking drawn red** (we refuse it at the DB
  level via a Postgres exclusion constraint) and a **vertical "today" line**.
- Colour conventions **disagree across vendors**, and several encode *payment*
  state rather than stay state — which we can't do until Phase 6. So there is
  no single expected palette to match.
- **Kontur's own users complain their grid is cluttered**
  (kontur.ru/qa/11853): too many rows, constant scrolling. They ask for
  compact, dates across, rooms down, empty = free. That describes our grid.
- Cloudbeds' 500-employee survey: **52% of managers** say staff need 4 months
  to 3 years to feel confident; **38% of employees** cited PMS frustration in
  leaving a job; the top complaint is **being unable to recover from an error
  without a supervisor**. Our disabled-button-states-its-reason design
  (`refuseStatusChange`) answers that directly — a real selling point.
- Two things we do that **nobody surveyed does**: colour is never the only cue
  (`STATUS_MARK` shapes + border styles), and user-controlled density.

`docs/kontur-notes/` holds three files from a Kontur training session. Only the
**Транскрипция** (376 lines, timestamped) is worth citing — the other two are
derived from it. Heavy ASR damage: «электронные звонки» means электронные
замки. Kontur's real docs at `support.kontur.ru/hotel` return 403 to automated
fetching; a human must copy pages in if they're wanted.

## Finding 5 — two modelling questions to put to the client in writing

Both break assumptions the whole schema turns on, and both must be answered
**before MVP sign-off**:

1. **Койко-места** — Kontur sells a bed inside a hostel room. Nothing in our 46
   models has a bed level. Retrofitting touches availability, the exclusion
   constraint, the grid's vertical axis and every rate plan.
2. **Почасовые объекты** (бани/сауны) — every date column here is date-only
   property-local midnight, deliberately. Good news: Kontur, Bnovo and
   TravelLine all solve this with a **separate grid/mode**, so it's a second
   screen, not a rewrite of the first.

Ask: *do the target properties include a hostel or an hourly object?*

## Finding 6 — the "edition" system (planned, not built)

The ask was: an env variable selects a preset — `basic` (today, unchanged) and
a second one that turns on more features by default and wears its own shell.

**Half already exists.** `src/features/organizations/model/registry.ts` is the
right shape: `isOrgModuleEnabled(id, toggles)` falls back to `enabledByDefault`
when no stored row disagrees. Adding an edition is one signature change:
`isOrgModuleEnabled(id, toggles, edition)`, stored toggle still winning.

Constraints verified in `node_modules/next/dist/docs/`:
- **Route trees cannot be duplicated per preset** — route groups "should not
  resolve to the same URL path… and cause an error". One route tree,
  edition-swapped components.
- **`template.tsx` is reserved** by Next (a layout that resets client state)
  and **`theme`** belongs to next-themes. Call it an **edition**:
  `APP_EDITION=basic`.
- **Only `env.mjs` reads `process.env`**, and its `client: {}` is empty by
  design. So resolve the edition server-side in the dashboard layout and pass
  it down via context — the same path `locale`, `messages` and `user` already
  take. That also keeps a future *per-organization* edition possible for free.
- **`docs/plans/roadmap.md` records a bundle floor** (819,257 shared bytes) and
  treats movement without a new screen as a regression. Two statically-imported
  shells would breach it; a runtime conditional does not tree-shake. **Measure
  with `npm run bundle` before building a second shell.**

**The rule that makes it safe: an edition changes defaults, never permissions.**
If an endpoint were reachable because of which UI rendered, flipping an env var
would silently change authorization, the Phase 7 REST API would bypass the
gate, and `tests/server/` would be testing a different model than production.
Guards stay in `requirePropertyMember` / `isOrgModuleEnabled` / `model/permissions.ts`.

The registry belongs in `src/config/editions.ts` — `architecture.md` defines
`config/` as "data, not behaviour".

## What to do, in order

1. **Fix the width** (Finding 1). Needs no edition system. Biggest UX payoff
   available. Re-screenshot and re-run `npm run bundle`.
2. **Fix the untranslated sidebar** (Finding 2), with a `locale.e2e.ts`
   assertion so it can't regress.
3. **Fix sold-out-is-red, and move `STATUS_CLASS` onto semantic tokens**
   (Finding 3).
4. **Then decide**: is a second edition actually wanted, or was the real goal
   "make the front desk wide and dense"? If the latter, step 1 delivered it and
   steps 5–7 don't exist. **Ask me before starting step 5.**
5. Edition scaffolding with exactly one edition (`basic`) — zero visual change,
   proven by the existing 20 e2e journeys and 36 screenshots.
6. Module defaults: `isOrgModuleEnabled(id, toggles, edition)` + cases in
   `registry.test.ts` (stored toggle beats edition; edition beats
   `enabledByDefault`; `core` beats everything). Pure `model/` work, no DB.
7. A second shell — only after the bundle question has a measured answer.

## Housekeeping notes

- `docs/todo.md` is **stale**: its top two entries (the screenshot report, the
  three journeys) both shipped. Phase 5 (housekeeping) work is **staged but
  uncommitted**. Worth fixing before anything is shown, in a repo this
  disciplined about docs describing reality.
- **Never commit, push, or stash.** Report and suggest; I land it.
- Before finishing anything: `npm run lint && npm test && npx tsc --noEmit &&
  npm run format:check`, plus `npm run test:server` if a router or the schema
  changed and `npm run build` if routing or config moved.
- A client-facing **MVP report** still has to be written. Decide the language
  (Russian for the client vs English internal) before drafting.
