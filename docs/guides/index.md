# Guides

How to work in this codebase. **Guides describe how things are**; anything in
`docs/plans` would describe what is still planned. If the two disagree, the
guide is wrong — fix it.

A plan is deleted once it ships: the code is the record of what was built, and
a finished plan is one more file to read before finding out it no longer
decides anything. What survives a plan is whatever it taught, moved into a
guide.

| Guide | Read it when |
|---|---|
| [architecture.md](architecture.md) | you are new, or unsure where a file goes |
| [ui-patterns.md](ui-patterns.md) | building a form, list, dialog or combobox |
| [local-development.md](local-development.md) | setting up, running scripts, the seed, the database |

`npm test` runs `node:test` through tsx over `src/**/*.test.ts`.
`features/organizations/model/organization.test.ts` is the worked example, and
`model/` is the half worth testing: those functions decide what the router
permits *and* what the UI offers, so a disagreement between them is a button
that 403s.

The [README](../../README.md) is the short version of all three: what is in the
template, and how to start it.
