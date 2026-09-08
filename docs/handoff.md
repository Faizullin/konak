# Handoff

**Where it is.** Phase 1 is done — the database. 45 models across 13 domain
files on Postgres, two migrations, seeded. `identity`, `organizations` and
`directory` have routers; `platform`, `reservations` and `rates` are `model/`
only: the rules the database cannot hold, tested without one.

**Start the database first.** `docker compose -f docker/compose/db.yml up -d`

**Where to start.** `docs/todo.md`, top entry.

**Before you finish.** `npm run lint && npm test && npx tsc --noEmit && npm run format:check`,
and `npm run test:server` when a router or the schema changed,
plus `npm run build` if routing or config moved.

**What is binding.** `docs/guides/` describes how things are. `CLAUDE.md` lists
the traps that fail silently.
