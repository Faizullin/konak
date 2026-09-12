# End-to-end tests, and the report they produce

Two things that share one machine: a browser driving the real app, and the
screenshot report that falls out of it.

Nothing here is built. What exists is the *output* of a tool that was never
committed — `docs/screenshots-report/` holds twelve PNGs, an `index.html`, a
`report.pdf` and a `manifest.json`, and nothing in the repository can produce
them again. The manifest's shape is worth keeping; the way it was made is lost.

---

## What end-to-end means, and what it does not

The project has two test layers and no third.

| Layer | Where | What it proves | Count today |
|---|---|---|---|
| Pure | `src/**/model/*.test.ts` | A rule is right, without a database | 212 |
| Integration | `tests/server/*.test.ts` | A procedure asks the right question of a real database | 134 |
| **End-to-end** | — | **A person can do the thing, in a browser** | **0** |

An end-to-end test starts the real server against a real database, opens a real
browser, and works the screen the way a receptionist would: click, type, read.
It asserts on what a person sees.

**It is the only layer that can catch:**

- a route that 404s because a module toggle is off,
- a dialog whose `form.setError("root")` has nothing rendering it — the trap
  `CLAUDE.md` names, and one no server test can see,
- `toast.error(e.message)` reading a failure as success,
- a translated string that overflows the column it sits in,
- a button that is disabled for the wrong reason, or not disabled at all,
- a screen that renders nothing because a client component imported
  `@/lib/storage`.

**It is not a replacement for the other two, and it must stay small.** Each test
is seconds rather than milliseconds, each can fail for reasons that are not the
code's, and a suite of two hundred of them becomes something people re-run
rather than read. The rule stays what it already is: anything provable without a
browser is proved without one. What reaches here is what only a browser knows.

---

# Section 1 — the tests

## What real repositories of this stack actually do

Read rather than taken on trust — three open-source products on Next.js +
Prisma, each large enough to have been forced into a shape.

| | Tests live in | Grouping | Page objects |
|---|---|---|---|
| **cal.com** (48k★) | `apps/web/playwright/` | flat `*.e2e.ts`, subdirs only where an area grew (`auth/`, `eventType/`, `settings/`) | **no `pages/` directory** — `lib/pageObject.ts` and page-shaped *fixtures* |
| **documenso** (15k★) | `packages/app-tests/` — **its own package**, with its own `package.json`, `tsconfig.json` and config | `e2e/<domain>/` — documents, organisations, folders, recipient | none |
| **formbricks** (13k★) | `apps/web/playwright/` | flat `*.spec.ts` plus `api/`, `fixtures/`, `lib/` | none |

**The consensus contradicts the tutorials on one point, and it is the important
one.** Every guide proposes a `pages/` directory of page-object classes. None of
these three has one. What they have instead is `fixtures/` — factory functions
that set *state* up and tear it down — composed once:

```ts
// cal.com — apps/web/playwright/lib/fixtures.ts
export const test = base.extend<Fixtures>({
  users: async ({ page }, use) => { … },
  bookings: async ({ page }, use) => { … },
  …
});
```

Each fixture keeps a `store` of what it made and exposes `deleteAll()`, so a
spec reads `const user = await users.create()` and the cleanup is not the spec's
problem. Where a page object *is* useful they fold it into the same mechanism —
`bookingPage`, `eventTypePage` — rather than giving it a parallel directory.

The lesson for a codebase this size: **fixtures first, page objects only where a
screen is genuinely re-driven.** The grid is that screen. Nothing else here is,
yet.

## Where the files go

Those three put the suite beside the app it tests, or in a package of its own.
This repository has no packages, and `tests/server/` already established that
non-unit tests live under `tests/` while `src/` stays the application's module
graph (`architecture.md` § The tree). So: beside it.

```
playwright.config.ts          root, because the CLI looks for it there
tests/e2e/
├── fixtures/                 state, not screens — cal.com's shape
│   ├── auth.ts               a signed-in context per role, from storage state
│   ├── property.ts           a hotel, its types and rooms, and `deleteAll()`
│   └── booking.ts            a reservation in a given state, and `deleteAll()`
├── lib/
│   ├── fixtures.ts           the composed `test`, exported instead of `@playwright/test`
│   ├── grid.ts               the one page object worth having
│   └── teardown.ts
├── *.e2e.ts                  flat, one per journey — `front-desk.e2e.ts`
└── report/
    └── capture.e2e.ts        § Section 2
```

Specs import `test` from `./lib/fixtures`, never from `@playwright/test`. That
is the whole trick: a spec that needs a booking asks for one, and the fixture
decides how it is made and that it is removed.

## The five decisions worth taking before any file exists

**1. Locators are roles and labels, not test ids.** Playwright's own guidance is
to prefer user-facing attributes, and this codebase is unusually ready for it:
every icon button already carries an `aria-label` from the message files
(`grid.previousWeek`, `grid.close`, `grid.jumpToDate`), the status legend is a
list, and a chip is a `<button>` with a `title`. `getByTestId` is the exception,
not the rule, and each use of it should say why in a comment.

The one place that will need help is the grid's cells: a night in a room is a
`<div>` with no accessible name, and a drop target has to be addressable. That
is the argued case for a `data-testid` on the night area.

**2. Signing in happens once, in a setup project, not in every test.** A
`storageState` per role — owner, admin, member — written by a setup project and
reused. The seed already creates three demo users, and the roles matter here
because the split the product cares about is *uploading versus deleting*
(`product-shape.md` § 2): a MEMBER seeing a delete button is a real bug and only
a browser sees it.

**3. Its own database, not the dev one.** `tests/server` shares the dev database
and survives by tagging every fixture uniquely. A browser cannot do that — it
reads the same seeded demo the developer is looking at, and a test that checks
somebody in changes what they see. A `konak_e2e` database, migrated and seeded
before the run, keeps both honest.

**4. The server is started by the config, not by hand.** Playwright's
`webServer` builds once, starts, waits for the port, and stops after. A suite
that requires a person to have run `npm run dev` first is a suite CI cannot run.
Both cal.com and documenso do this, and cal.com builds the array dynamically so
an embed suite can add a second server.

**5. Drag is not the first thing tested, and possibly not tested at all.** The
grid's three gestures are custom HTML5 drag events carrying `dataTransfer`
(`reservation-grid.tsx` § `StayChip`), which is the least deterministic thing in
any browser automation. **M7 gave all three a keyboard path** — select, arrow,
`Enter` — and that path is ordinary keyboard input. Test the keyboard, which is
deterministic and is the accessibility guarantee anyway; leave drag to a manual
pass. This is a real saving: it removes the flakiest tests before they are
written.

## What to test first, in order

Ranked by what breaks silently and costs most when it does.

**1. A desk runs a day.** Sign in → the property → the grid draws → open a
booking → check it in → it moves to *in house*. This is Phase 4's **Done when**
asserted end to end, and it crosses six procedures.

**2. A refusal reaches the screen with its reason.** Select a booking that has
not arrived; *Check in* is disabled and carries the sentence. Then the same rule
from the day list, and confirm the two surfaces say the same words. Nothing
below this layer can prove that a disabled button has a `title`.

**3. Booking a date that is not tonight.** M5: open the dialog, pick nights, see
what is free, choose a type, book — and confirm the chip appears on the grid in
the unassigned band. This is the only path that exercises `hold` → `create`
together, and the hold seam is where the subtle bug was.

**4. The language switch moves everything.** M6 has no server test and cannot
have one. Switch to Russian in the user menu; assert the grid's counts row reads
`Занято`/`Свободно`, that the column headers are Russian weekday names, and that
switching back moves all of it. This is the phase most likely to regress
silently, because an untranslated string still renders.

**5. Finding a booking.** M4: search by guest, by room number, by reference;
each finds the same booking; the row opens the card.

**6. Uploads.** Two phases and the only path touching storage. It is last
because it is the slowest and the most environment-dependent.

## What the configs of those three settle, so this one does not re-argue it

Copied from what they run, not from what is recommended.

- **Projects split by *kind*, not by browser.** Documenso has `api` (10 workers),
  `ui` (cores ÷ 2) and `license` (1 worker, because those tests share a file).
  Cal.com's are named per package. Neither fans a suite across browsers by
  default — documenso's Firefox project is commented out, and cal.com runs
  Firefox only for embeds.
- **Chromium is the honest default.** "Test across all browsers" is the official
  advice and neither of these large products follows it for their main suite.
  Multiply the browsers when a real bug makes the case.
- **`trace: "retain-on-failure"`, `video: "retain-on-failure"`.** Both. The
  artefacts exist only for the runs that need them.
- **Retries on CI only** — cal.com 2, documenso 4, both 0–1 locally. A retry
  locally hides a flake from the person who introduced it.
- **Suppress animation, explicitly.** Documenso sets `reducedMotion: "reduce"`
  *and* ships a `__disable_animations` cookie in the default `storageState`.
  This project has motion coming in Phase 12 — the seam should exist before it
  does.
- **Explicit `actionTimeout` and `navigationTimeout`** rather than the global
  one: 15s and 30s in documenso. A default timeout makes every failure look the
  same.

## Done when

A clean checkout runs `npm run test:e2e` with nothing started by hand, the six
journeys above pass in Chromium, and a failure names the journey rather than a
selector.

---

# Section 2 — the report

## The goal

**One command produces a dated folder holding a screenshot of every screen, an
`index.html` that reads as a report, and a PDF of the same.** Two audiences want
it for different reasons: the team, to see whether a screen started erroring or
drifted; the client, to see what the product looks like — now in Russian.

## What already exists, and what does not

`docs/screenshots-report/manifest.json` is a good schema and it was designed by
someone who had done this before. Per screenshot it records the route, a shot
name, a human title and description, the steps taken to reach it, the theme, the
viewport, the file, the HTTP status, the milliseconds, any error, **whether it
was redirected to sign-in**, and three arrays: `consoleErrors`, `pageErrors`,
`failedRequests`.

Those last four are the reason this is a *report* and not a slideshow: a
screenshot that looks fine while the console throws is a screen that is broken,
and the manifest already says so. Keep the schema; add a `locale` axis beside
`theme` and `viewport`, because there are two languages now.

## The tools are already on this machine

Verified rather than assumed:

- `playwright` on the PATH,
- `chromium-1243`, `chromium_headless_shell-1243` and **`ffmpeg-1011`** in the
  Playwright browser cache — the last means video recording works without
  another download,
- Google Chrome, if a real-Chrome run is ever wanted.

Nothing needs installing but the `@playwright/test` dev dependency. There is no
second framework to choose and no headless-browser question to answer.

## The pipeline

Three steps, each one a thing that already works rather than a thing to invent.

1. **Capture** — `tests/e2e/report/capture.spec.ts`, a spec rather than a
   standalone script, so it inherits the auth fixture, the seeded property, the
   `webServer`, retries and traces. It walks a declared list of screens, and for
   each one takes the shot at every point on the axes (theme × viewport ×
   locale), recording the manifest row as it goes. A screen is declared once and
   yields eight images.

2. **Assemble** — `scripts/report.mts`, which reads the manifest and writes
   `index.html`: a contents list, a section per screen with its title,
   description and steps, the images side by side across the axes, and a red
   band on any screen whose `consoleErrors` or `failedRequests` are not empty.

3. **Print** — the same Playwright, opening that `index.html` from disk and
   calling `page.pdf()`. Chromium only, which is not a constraint since the
   capture is Chromium anyway. `format: "A4"`, `printBackground: true`, and a
   footer with the date and page numbers.

A **custom reporter** is the other way to build the manifest — it sees every
test and step as they happen. It is the better answer once the report should
cover the *journeys* rather than a list of routes, and it is worth doing then
rather than now: a reporter that assembles a manifest from six specs is more
machinery than a spec that walks a list.

## Scripts

```
test:e2e        playwright test
test:e2e:ui     playwright test --ui
report:ui       playwright test report/ && tsx scripts/report.mts
```

`report:ui` writes to a dated folder, so a report is a record rather than a file
that keeps being overwritten. Whether those folders belong in git is the open
question below.

## Done when

`npm run report:ui` on a clean checkout produces a folder holding one PNG per
screen per axis, an `index.html` that reads top to bottom without the manifest
beside it, and a PDF of the same — and a screen that throws in the console is
visible as a failure in all three.

---

## Open questions

- **Does the report belong in git?** The existing one is committed, which makes
  a diff of a PNG part of code review and the repository heavier every run. The
  alternative is a build artefact and a link. This decides whether `report:ui`
  writes into `docs/` or into an ignored directory.
- **How many axes?** Theme × viewport × locale is eight images per screen and
  eight times the reading. Light+dark desktop in both languages, with mobile
  only where mobile is the point (housekeeping, once it exists), may be the
  honest set.
- **Does CI run the browser suite on every push, or on merge?** It needs a
  database and a build, which is minutes rather than seconds.
- **Is drag tested at all?** The argument above is to leave it to a manual pass.
  If it must be automated, it is its own plan and its own flake budget.
- **Visual baselines, or only a report?** Documenso commits PNG baselines under
  `visual-regression/` and diffs against them, which catches a layout that moved
  and costs a re-baseline every time a design changes on purpose. Cal.com keeps
  `*-snapshots` folders for the same thing but only for icons. The report in
  § Section 2 is the softer version: it shows the screens and lets a person
  look. Doing both is reasonable; doing neither is where this is today.
