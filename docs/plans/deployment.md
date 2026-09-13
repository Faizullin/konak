# Deploying konak to konaq.kz

The production deployment: what runs, why it is shaped this way, how to operate
it, and what is deliberately missing.

The reference point throughout is ArqaMed, which is the other production system
on this team. Where this deployment differs from it, the difference is argued
rather than assumed — ArqaMed's choices are good ones for ArqaMed's box, and
several of them are wrong for this one.

## The host

| | |
|---|---|
| Address | `89.207.249.64` — `new-vps` / `newvps` in `~/.ssh/config` |
| OS | Ubuntu 22.04.5 LTS |
| CPU / RAM | **1 vCPU, 1.9 GB** |
| Disk | 49 GB (`/dev/vda1`), ~42 GB free |
| Swap | 4 GB, added for this deployment (there was none) |
| Preinstalled | Docker 29.8.0, Compose v5.5.1 |
| Not installed | node, npm, pm2, nginx — and none is needed |
| Repo | `/opt/projects/konak`, tracking `NABIPRO-Labs/konak` |

`konaq.kz` and `www.konaq.kz` both already resolve to `89.207.249.64`. Nothing
was listening on 80 or 443.

**One vCPU and 1.9 GB is the fact that shapes every decision below.** It is not
a detail to note and move past: it decides how the app is built, how many
processes serve it, how Postgres is tuned, and whether Redis runs at all.

## The shape

```
            konaq.kz / www.konaq.kz  (DNS -> 89.207.249.64)
                          │
                     :80  :443
                          │
                  ┌───────────────┐
                  │     caddy     │   TLS termination, automatic Let's Encrypt
                  └───────┬───────┘   the ONLY container publishing a port
                          │
              ─────── network: edge ───────
                          │
                  ┌───────────────┐
                  │      app      │   Next.js 16 standalone, node server.js
                  └───────┬───────┘   no published port
                          │
            ─────── network: internal ───────   (internal: true — no gateway)
                    │            │
            ┌───────────┐  ┌───────────┐
            │ postgres  │  │  redis    │   (profile-gated: defined, not running)
            └───────────┘  └───────────┘   no published ports
```

Files:

| Path | Purpose |
|---|---|
| `Dockerfile` | 3-stage build: `deps` → `builder` → `runner` |
| `.dockerignore` | keeps 1.4 GB of `node_modules`/`.next` out of the build context |
| `docker/compose/prod.yml` | the stack: networks, volumes, 5 services |
| `docker/Caddyfile` | TLS, the www→apex redirect, the reverse proxy |
| `docker/deploy.sh` | preflight → build → migrate → start → verify |
| `.env.production.example` | every variable, documented |
| `.env` | the real secrets — gitignored, `chmod 600`, on the server only |

## Why containers here, when ArqaMed uses pm2 on the host

ArqaMed runs the Node process directly on the host under pm2 (cluster mode, one
worker per core), with nginx on the host, release directories swapped by a
`current` symlink, and Docker used *only* for Postgres and Redis.

That is a good design, and this deployment does not copy it:

- **The host has no Node and does not want one.** Docker was already installed
  and nothing else was. Building in a container means the Node version is a line
  in the `Dockerfile` rather than a thing installed on a box that must then be
  kept in sync with CI.
- **pm2 cluster mode buys nothing on one core.** ArqaMed's `instances: 'max'` is
  what makes its box use all its CPUs. Here `max` is 1, so the entire cluster
  apparatus — the master process, the rolling reload, the `EADDRINUSE`
  bind-change hazard documented at length in ArqaMed's `ecosystem.config.js` —
  would be complexity paid for with no throughput gained.
- **Caddy replaces nginx + certbot.** Automatic certificate issuance and
  renewal, no cron, no `certbot --nginx`, no separate renewal failure mode. On a
  box with no ops tooling and one service, that is the right trade.
- **Rollback is an image tag, not a release directory.** `deploy.sh` tags every
  build `konak-app:<sha>`, which is the same guarantee ArqaMed gets from keeping
  three release directories, without the disk cost of three unpacked builds.

What *is* borrowed from ArqaMed, deliberately:

- **Migrations run once, before the app starts** — never from an app entrypoint.
- **Persistent data lives outside the deployable artifact.** ArqaMed learned this
  the expensive way: on 2026-08-22 an unset `MEDIA_DIR` meant patient media had
  been written inside release directories and deleted three deploys later, and
  `deploy.sh` now hard-fails rather than allow it. The same failure is available
  here through `STORAGE_FS_ROOT`, so `deploy.sh` refuses to run unless it is
  `/data/storage`, the mount point of the `storage` volume.
- **Secrets are supplied at runtime, never baked into the artifact.**

## Networks — the security model

Two networks, and the split is the boundary:

- **`edge`** — Caddy and the app. An ordinary bridge, so containers on it have
  outbound internet, which Caddy needs to reach Let's Encrypt.
- **`internal`** — the app, Postgres and Redis, declared `internal: true`. Docker
  attaches no gateway to it: there is no NAT and no route off the host in either
  direction.

Only Caddy publishes ports. Postgres and Redis publish **nothing** — the app
reaches them as `db:5432` and `redis:6379` through Docker's embedded DNS.

This is stricter than ArqaMed, which publishes its database on
`127.0.0.1:5432`. ArqaMed's own `docs/setup.md` explains why it must: ufw does
**not** filter Docker's published ports, because they bypass it through the
`DOCKER-USER` chain, so binding to loopback is the only thing actually keeping
its Postgres off the internet. Not publishing the port at all removes the
question, and removes the chance of a later edit flipping `127.0.0.1:5432` to
`5432` and exposing the database without anyone noticing.

Consequence worth knowing: `psql` from the host does not work by address. Use
`docker compose ... exec db psql -U konak konak`.

## Database

Postgres 17 Alpine, matching `docker/compose/db.yml`'s development version, on
a named `db-data` volume that `docker compose down` does not touch.

Tuned down from the defaults, which assume the box exists to serve the database:

```
shared_buffers=128MB          # not the default 25% of RAM
effective_cache_size=384MB
maintenance_work_mem=64MB
work_mem=4MB
max_connections=50
```

`max_connections=50` against one app container is generous; it is the memory
ceiling that matters, since each connection costs backend memory the app needs.

Migrations run as a **profile-gated one-shot service** built from the `builder`
stage, because the Prisma CLI is a `devDependency` and does not exist in the
runner image. `deploy.sh` runs `prisma migrate deploy` — the only `migrate` verb
that applies committed migrations without generating, resetting or prompting —
and aborts the deploy if it fails, leaving the previous app running.

The reservation-overlap exclusion constraint is why this is Postgres and not
SQLite; that is unchanged in production.

## Redis — defined, not running

The compose file declares a Redis service behind a `redis` profile, so
`docker compose up` does not start it.

This is the honest state of things: **nothing in konak uses Redis today.**
`package.json` has no client dependency and `src/` contains no reference to one.
Running it would be a service with no caller holding memory on a box with
1.9 GB, and an unauthenticated one at that.

Everything needed for the day it *is* used is already in place — the service
definition, the volume, the network attachment, an LRU eviction policy and a
96 MB cap. Turning it on is:

1. add `REDIS_URL=redis://redis:6379` to `.env`
2. declare it in `src/env.mjs` (it validates every variable; an undeclared one
   is simply not readable)
3. `bash docker/deploy.sh --with-redis`

No change to `prod.yml` is required. Add `requirepass` at that point if anything
other than the app ever joins `internal`.

## Environment and secrets

`src/env.mjs` validates everything at startup through `@t3-oss/env-nextjs`, so a
missing variable fails immediately and by name rather than surfacing as
`undefined` in a request. Four are genuinely required:

| Variable | Notes |
|---|---|
| `DATABASE_URL` | host is **`db`**, not `localhost` — inside the app container `localhost` is the app |
| `BETTER_AUTH_SECRET` | rotating it logs everyone out |
| `BETTER_AUTH_URL` | `https://konaq.kz` — the apex, and the origin OAuth callbacks are built from |
| `FIELD_ENCRYPTION_KEY` | exactly 32 bytes of base64; `env.mjs` refuses anything else |

All three secrets were generated on the server with `openssl rand` and exist
only in `/opt/projects/konak/.env` (`chmod 600`, gitignored).

The build runs with `SKIP_ENV_VALIDATION=1`. That is not a shortcut around the
validation — it is what keeps runtime secrets out of image layers. The values
are supplied by compose when the container starts, and validated then.

`deploy.sh` re-checks the same constraints before building, so a bad `.env`
fails in one second rather than after 20 minutes of a single core.

> ⚠️ **`FIELD_ENCRYPTION_KEY` is not backed up anywhere off this server.** It is
> not derivable. If the box is lost, every encrypted identity-document value is
> permanently unreadable even from a database dump. Copy it somewhere else.

### `.gitignore`

`.gitignore` line 34 is `.env*`, with a single negation for `.env.example`. That
also hid `.env.production.example`, so a second negation was added — otherwise
the production template could never be committed.

## Domain and TLS

`konaq.kz` and `www.konaq.kz` both resolve to the host already, which is the
only precondition for Caddy's automatic HTTPS. Caddy provisions certificates on
first start via the HTTP-01 challenge and renews them on its own.

**`www` redirects to the apex; it does not serve the app.** This is not
cosmetic. `BETTER_AUTH_URL` is one origin, and Better Auth sets session cookies
and builds OAuth callback URLs against it. Serving both origins means a session
started on `www` is not sent to the apex, and an OAuth callback registered for
one origin is rejected from the other.

`caddy-data` is a named volume because it holds the issued certificates and the
ACME account key. Losing it re-issues on every restart, and Let's Encrypt rate
limits that to 5 per domain per week — a restart loop with an ephemeral cert
volume takes konaq.kz off TLS for days.

HSTS is intentionally **not** enabled yet. It commits every browser that has
visited to HTTPS-only for the `max_age`, and that is not revocable. Turn it on
after the certificate has renewed cleanly at least once.

## Load balancing

The honest answer: **there is nothing to balance, and adding a balancer would
make things worse.**

A load balancer distributes load across units that can serve in parallel. This
host has one vCPU. Two app replicas on one core do not serve two requests at
once — they interleave on the same core while each holds its own ~250 MB Node
heap, against 1.9 GB shared with Postgres and Caddy. That is strictly worse than
one replica: same throughput, double the memory, and a new class of bug from
two processes assuming they are alone.

So the stack runs **one app container**, and Caddy is a reverse proxy and TLS
terminator rather than a balancer.

What *is* in place is the ability to change that without redesigning anything.
Caddy proxies to `app:3000` — a Docker DNS name, not an address. Scale the
service and Docker's embedded DNS returns one A-record per replica, which Caddy
load-balances across with **no change to the Caddyfile**:

```bash
docker compose --project-directory . -f docker/compose/prod.yml --env-file .env \
  up -d --scale app=3
```

That becomes worth doing on a box with more than one core. Before then, the real
scaling steps in order are:

1. **Move storage off the box** — `STORAGE_PROVIDER=s3` (MinIO, R2 or B2). It is
   already implemented and keeps objects private with signed reads, which is the
   requirement for identity documents. This is also what makes multiple replicas
   possible at all, since a local volume is not shared.
2. **Move Postgres to its own host**, so the database stops competing with the
   app for 1.9 GB.
3. *Then* add app replicas, or more hosts behind a real balancer.

## Deploying

```bash
ssh new-vps
cd /opt/projects/konak
git pull
bash docker/deploy.sh
```

`deploy.sh` does, in order:

1. **Preflight** — `.env` present, required variables non-empty, `DATABASE_URL`
   points at `db`, `FIELD_ENCRYPTION_KEY` decodes to 32 bytes,
   `STORAGE_FS_ROOT` is `/data/storage`.
2. **Build** the image and tag it `konak-app:<sha>`. The running app is
   untouched throughout — this is the 10–25 minute step.
3. **Start Postgres** and wait for its healthcheck. The app's Prisma client would
   otherwise race first-boot `initdb` and crash-loop.
4. **Migrate**, once, to completion. A failure aborts the deploy with the old app
   still serving.
5. **Start** app and Caddy.
6. **Verify** by requesting the app from inside the `edge` network — testing the
   app itself rather than DNS, TLS and the public route at once. On failure it
   prints the last 40 log lines and tells you how to roll back.

Flags: `--with-redis` adds the Redis profile, `--no-build` restarts from the
current image.

### Rollback

```bash
docker images konak-app                              # find the previous sha
docker tag konak-app:<previous-sha> konak-app:latest
bash docker/deploy.sh --no-build
```

Note what this does **not** roll back: migrations. A deploy that added a
destructive migration is not undone by reverting the image. That is a general
property of `migrate deploy`, not of this setup — the mitigation is that
migrations must be backward-compatible with the previous release, which is
required anyway for any deploy without a maintenance window.

### Build memory

`next build` on this box is the tightest moment in the whole system. Mitigations,
both already applied:

- **4 GB swap**, with `vm.swappiness=10` so it is a backstop rather than a
  routine destination. There was none before; a build would have met the OOM
  killer.
- **`NODE_OPTIONS=--max-old-space-size=1536`** in the builder stage. Node sizes
  its default heap from total RAM and would happily grow into swap until the box
  thrashes. Capping it makes V8 collect garbage instead.

If a build still fails on memory, build the image elsewhere and ship it —
`docker save` / `docker load`, or a registry — rather than raising the cap.

## Gaps — what is deliberately not done

These are real and worth deciding on, not oversights.

1. **There are no backups. This is the largest gap by a wide margin.**
   ArqaMed has nightly AES-256-encrypted dumps, retention of 30 daily / 8 weekly
   / 6 monthly, a weekly automated restore *verification*, and `/api/health`
   reporting stale backups. konak has none of it. A `db-data` volume on a single
   VPS with no dump is one bad disk from total data loss. ArqaMed's
   `scripts/backup-db.sh`, `restore-db.sh` and `verify-backup.sh` are directly
   adaptable — the container name and env differ, the logic does not.

2. **No `/api/health` endpoint.** konak has no health route, so the Docker
   healthcheck requests `/`, which proves the Node process accepts HTTP and
   nothing more — it does not prove the database is reachable. ArqaMed's pings
   the DB and is what its deploy gates on. A small route that runs
   `SELECT 1` would make both the healthcheck and any uptime monitoring
   meaningful.

3. **No CI/CD.** ArqaMed deploys from a GitHub Actions self-hosted runner on
   push to `main`. Here deployment is a manual `deploy.sh`. A self-hosted runner
   on this box is possible but would contend for the one core; building in
   GitHub-hosted CI and pushing an image to GHCR is the better fit, and would
   remove the 10–25 minute on-box build entirely.

4. **No firewall.** `ufw` is inactive, so the host's own ports are unfiltered.
   Only 22, 80 and 443 are listening, so the exposure is small — but it should be
   enabled, with `DEFAULT_FORWARD_POLICY=ACCEPT` (ufw defaults it to `DROP`,
   which breaks Docker bridge networking).

5. **No monitoring or alerting.** Nothing reports that the site is down.

6. **The outbox worker is not deployed.** `scripts/outbox-worker.mts` drains
   `OutboxTask` and runs the storage sweeps, and nothing currently runs it — so
   queued tasks accumulate unprocessed. It is the direct analogue of ArqaMed's
   `arqamed-notify` pm2 app. It needs a `tsx` runtime, so it does not fit the
   standalone runner image; the natural home is a sixth compose service built
   from the `builder` stage with a restart loop, or `--interval`.

Recommended order: **backups first**, then the health endpoint, then the outbox
worker, then the firewall.
