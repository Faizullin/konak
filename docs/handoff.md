# Handoff

**Where it is.** Phases 1 and 2 are done — the database and the domain. 46
models on Postgres; six features, all with routers. Availability, booking,
quoting, holds, activities, tags and attachments all work through the API.
There are no screens for them yet.

**Start the database first.** `docker compose -f docker/compose/db.yml up -d`

**Where to start.** `docs/todo.md`, top entry.

**Before you finish.** `npm run lint && npm test && npx tsc --noEmit && npm run format:check`,
and `npm run test:server` when a router or the schema changed,
plus `npm run build` if routing or config moved.

**What is binding.** `docs/guides/` describes how things are. `CLAUDE.md` lists
the traps that fail silently.
