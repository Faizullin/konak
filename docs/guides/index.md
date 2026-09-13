# Guides

How to work in this codebase. Guides describe how things **are** — if one
disagrees with the code, the guide is wrong; fix it.

Four documents sit beside these, each with one job and no overlap:
[handoff](../handoff.md) is where to pick up, [todo](../todo.md) is what is
next, [history](../history.md) is what shipped (append-only), and
[plans](../plans/index.md) describe what is not built yet. A fifth folder,
[reports](../reports/index.md), holds deliverables — documents generated for
somebody outside this repository, not guides. **A plan carries no
status**; when something ships it leaves the plan, what it taught moves into a
guide, and the fact of it is appended to history.

| Guide | Read it when |
|---|---|
| [architecture.md](architecture.md) | you are new, or unsure where a file goes |
| [ui-patterns.md](ui-patterns.md) | building a form, list, dialog or combobox |
| [local-development.md](local-development.md) | setting up, running scripts, the seed, the database |
| [demo.md](demo.md) | showing the product to someone — the data to load and the path through it |

## Tests

Three kinds, separated by **directory** rather than by filename. That is not a
style choice: `src/**/*.test.ts` also matches `foo.int.test.ts`, so a suffix
split would silently drag database tests into the suite that must run anywhere.

| Kind | Lives in | Command | Needs |
|---|---|---|---|
| Unit | `src/**/*.test.ts`, beside the code | `npm test` | nothing |
| Integration | `tests/server/**/*.test.ts` | `npm run test:server` | Postgres |
| End-to-end | `tests/e2e/**/*.e2e.ts` | `npm run test:e2e` | Postgres on 5433, and the app |

**`npm test` must stay runnable on a laptop with no Docker**, in CI with no
services, in under a second.

Unit tests stay **beside the code they test** rather than moving under `tests/`
for symmetry. The split is by what a test *needs*, not by where code lives: a
pure test needs nothing, so it belongs next to its module, where deleting the
module leaves its test visibly orphaned. Integration tests belong to no single
module — one of them touches `directory`, `organizations`, `identity` and
Prisma at once — so `tests/server/` is their honest home. Every test that needs a database goes in
`tests/server/`. Component tests, when they arrive, can colocate as
`*.test.tsx` — a different extension never matches the `.ts` glob.

`model/` is the half worth testing: those functions decide what the router
permits *and* what the UI offers, so a disagreement between them is a button
that 403s. `features/organizations/model/organization.test.ts` is the worked
example.

### The browser layer

`tests/e2e/`, driven by Playwright against a **dev server on port 3100 and a
second database**, `konak_e2e` on 5433. Both are built by `npm run e2e:db`,
which the test commands run for you; uploads land in `.storage-e2e`. A browser
test checks a guest in, and doing that to the database somebody is looking at
makes both unreliable.

**Projects are kinds, not browsers.** Chromium only — `setup` signs in once per
role and saves the cookies, `journeys` asserts, `report` photographs. Fanning
one suite across three engines buys almost nothing; add a browser when a real
bug makes the case.

**Fixtures, not page objects.** `lib/fixtures.ts` extends Playwright's `test`
with `property`, `bookings` and `grid`, so a spec asks for a booking and neither
makes nor cleans one. There is exactly one page object, `lib/grid.ts`, because
the шахматка is the one screen genuinely re-driven; it holds locators and the
smallest verbs and **never asserts** — a page object that asserts reports its
failure in a file that does not say what was being attempted.

Three rules the suite learnt the hard way, each written where it bit:

- **Arrange by writing rows, assert only what a screen shows.** Getting a
  booking into a given state through the UI makes every test depend on the
  screen it is not testing.
- **Ask for a free room, never name one.** Four specs once hard-coded
  `roomIds[1]` and all booked tonight; the exclusion constraint refused three,
  correctly. `bookings.create({ roomId: "free" })` claims one and retries
  against the constraint.
- **Nothing survives a run.** `e2e-db.mts` clears holds and housekeeping tasks
  before seeding, because a test that fails half-way never reaches its cleanup
  and what it leaves is not inert.

`lib/db.ts` talks to Postgres through `pg` rather than Prisma: the generated
client is CJS and Playwright's loader is ESM, and the interop failure surfaces
as an error about `require(esm)` that says nothing about either.

### The screenshot report

`npm run report:ui` — the same suite, in its own project, photographing every
screen in `tests/e2e/report/screens.ts` across both locales and both themes,
then `scripts/report.mts` folds the shots into `reports/latest/index.html` and
`report.pdf`. Adding a screen is a row in that file.

It is a **deliverable, not a test**, and asserts almost nothing on purpose —
with two exceptions, both of which exist because they were once needed:

- **A 5xx fails the shot.** Sixty-eight green shots once hid a 500 on every
  desk screen; a picture of an error page is worth nothing.
- **It waits for the data.** `load` fires while every query is in flight, and
  the шахматка photographed then is an empty grey box. It waits for no
  `[data-slot="skeleton"]` to remain — `networkidle` cannot be the answer here,
  because the desk polls forever.

Each shot also files the console errors, page errors and failed requests beside
it, which is what makes it a report: a screen that looks right while its console
throws is a broken screen, and the manifest says so where a picture cannot.

`/reports` is git-ignored. A committed screenshot report makes a PNG diff part
of code review; send the PDF.

### The client's report

`npm run report:mvp` is the other one, and the rule above is about the sweep
rather than about pictures in git. It photographs the **desk only**, in Russian,
in light, fifteen shots, and folds them into a document for the client:
`tests/e2e/mvp/steps.ts` says what to shoot and how to get there,
`docs/reports/src/mvp-report.ru.md` holds the prose, and
`scripts/mvp-report.mts` composes `docs/reports/mvp-report.ru.md`.

That one **is** committed, because a document whose images are not in the
repository is not a document. What keeps it from becoming the thing the rule
forbids is its budget — one locale, one colour scheme, at most sixteen shots,
under 2 MB — and that it is a deliverable somebody sends rather than a run's
output. `docs/reports/index.md` states both.

The prose and the pictures cannot drift: the composer fails on a placeholder
naming a shot nobody took, and on a shot no placeholder uses.

**`test:e2e` names its projects** — `journeys` and `report` — rather than
running everything, so a test run never rewrites a committed deliverable. The
`mvp` project belongs to `report:mvp` alone. `report` may run with the suite
because what it writes is git-ignored.

**When a rule is fused to a query, split it rather than mock the query.** The
last-admin guard needed a row count, so the decision moved to `model/user.ts`
as `couldRemoveLastAdmin` and `isLastAdmin`, and `user.updateRole` kept only
the queries and the throw.

Integration tests are for what `model/` cannot answer: that a procedure asks
the question its permission table defines, against a real database. They run
with `--conditions=react-server`, which swaps `server-only` for an empty module
— see [local-development.md](local-development.md). `tests/server/harness.ts`
builds a caller with a fabricated session and an isolated organization.

The [README](../../README.md) is the short version of all three.
