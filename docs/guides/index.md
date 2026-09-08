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

## Tests

`npm test` runs `node:test` through tsx over `src/**/*.test.ts`.
`features/organizations/model/organization.test.ts` is the worked example.

`model/` is the half worth testing: those functions decide what the router
permits *and* what the UI offers, so a disagreement between them is a button
that 403s.

**When a rule is fused to a query, split it rather than mock the query.** The
last-admin guard needed a row count, so the decision moved to `model/user.ts`
as `couldRemoveLastAdmin` and `isLastAdmin`, and `user.updateRole` kept only
the queries and the throw. `server/caller.ts` builds an end-to-end caller if a
procedure ever needs one — reach for that second, since it tests the wiring and
the wiring is rarely the dangerous part.

The [README](../../README.md) is the short version of all three.
