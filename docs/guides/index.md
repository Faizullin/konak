# Guides

How to work in this codebase. Guides describe how things **are** — if one
disagrees with the code, the guide is wrong; fix it.

Four documents sit beside these, each with one job and no overlap:
[handoff](../handoff.md) is where to pick up, [todo](../todo.md) is what is
next, [history](../history.md) is what shipped (append-only), and
[plans](../plans/index.md) describe what is not built yet. **A plan carries no
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
| End-to-end | `e2e/**/*.spec.ts` *(none yet)* | — | the app running |

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
