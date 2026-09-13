#!/usr/bin/env bash
# konak — production deploy on the konaq.kz host.
#
#   bash docker/deploy.sh                 build, migrate, restart, verify
#   bash docker/deploy.sh --with-redis    same, plus the redis profile
#   bash docker/deploy.sh --no-build      restart from the current image only
#
# Run it from the repo root. It exists mainly so nobody has to remember the
# compose invocation: `--project-directory .` is what makes the relative paths
# in docker/compose/prod.yml resolve from the repo root, and `--env-file .env`
# is what fills the ${...} interpolations. Plain `docker compose -f ...` breaks
# both, silently, in ways that look like a broken compose file.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$PWD"

log()  { echo "[deploy] $*"; }
fail() { echo "[deploy] ERROR: $*" >&2; exit 1; }

WITH_REDIS=0
DO_BUILD=1
for arg in "$@"; do
  case "$arg" in
    --with-redis) WITH_REDIS=1 ;;
    --no-build)   DO_BUILD=0 ;;
    *) fail "unknown argument: $arg" ;;
  esac
done

[ -f "$ROOT/package.json" ]   || fail "run from the repo root"
[ -f "$ROOT/.env" ]           || fail ".env not found — cp .env.production.example .env, then fill it in"

COMPOSE=(docker compose --project-directory . -f docker/compose/prod.yml --env-file .env)
[ "$WITH_REDIS" -eq 1 ] && COMPOSE+=(--profile redis)

# ── preflight ────────────────────────────────────────────────────────────
# Check the values the app cannot start without BEFORE spending 15 minutes of
# a single core on a build that ends in a crash-looping container.
log "checking .env"
set -a; . "$ROOT/.env"; set +a

for var in POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB DATABASE_URL \
           BETTER_AUTH_SECRET BETTER_AUTH_URL FIELD_ENCRYPTION_KEY; do
  [ -n "${!var:-}" ] || fail "$var is empty in .env"
done

case "${DATABASE_URL}" in
  *CHANGE_ME*) fail "DATABASE_URL still contains the CHANGE_ME placeholder" ;;
  *@db:*)      ;;
  *) fail "DATABASE_URL must point at host 'db' (the compose service), not localhost — from inside the app container localhost is the app itself" ;;
esac

# 32 bytes of base64, checked here as well as in env.mjs so the failure arrives
# in one second rather than after the build.
klen=$(printf %s "$FIELD_ENCRYPTION_KEY" | base64 -d 2>/dev/null | wc -c || echo 0)
[ "$klen" -eq 32 ] || fail "FIELD_ENCRYPTION_KEY must be 32 bytes of base64 (got $klen) — openssl rand -base64 32"

# Uploads written anywhere else are deleted by the next release.
[ "${STORAGE_FS_ROOT:-}" = "/data/storage" ] || \
  fail "STORAGE_FS_ROOT must be /data/storage — it is the mount point of the 'storage' volume"

SHA="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"

# ── build ────────────────────────────────────────────────────────────────
# The slow step: one core, a Next.js 16 build. Expect 10-25 minutes and heavy
# swap use. It happens while the OLD container keeps serving — the running app
# is not touched until `up -d` below.
if [ "$DO_BUILD" -eq 1 ]; then
  log "building image for $SHA (slow on 1 vCPU — 10-25 min is normal)"
  "${COMPOSE[@]}" build app
  # Tag the built image with the commit so there is something to roll back TO.
  docker tag konak-app:latest "konak-app:$SHA"
  log "tagged konak-app:$SHA"
fi

# ── database ─────────────────────────────────────────────────────────────
log "starting postgres"
"${COMPOSE[@]}" up -d db

log "waiting for postgres to report healthy"
for i in $(seq 1 60); do
  state="$(docker inspect -f '{{.State.Health.Status}}' konak-db 2>/dev/null || echo starting)"
  [ "$state" = "healthy" ] && break
  sleep 2
done
[ "${state:-}" = "healthy" ] || fail "postgres did not become healthy — docker logs konak-db"

# ── migrations ───────────────────────────────────────────────────────────
# Once, to completion, before the new code serves traffic. `migrate deploy`
# applies committed migrations only; it never generates, resets or prompts.
log "applying migrations"
"${COMPOSE[@]}" run --rm --no-deps migrate || fail "migrations failed — the old app is still running and was not replaced"

# ── start ────────────────────────────────────────────────────────────────
log "starting app and caddy"
"${COMPOSE[@]}" up -d

# ── verify ───────────────────────────────────────────────────────────────
# Checked from inside the edge network, so this tests the app itself rather
# than DNS, TLS and the public route at the same time.
log "waiting for the app to answer"
ok=0
for i in $(seq 1 45); do
  if docker run --rm --network konak-edge curlimages/curl:latest \
       -fsS -o /dev/null --max-time 5 http://app:3000/ 2>/dev/null; then
    ok=1; break
  fi
  sleep 2
done

if [ "$ok" -ne 1 ]; then
  echo "[deploy] app did not answer. Last 40 lines:" >&2
  # By service, not by container name: `app` has no fixed container_name (so it
  # can be scaled), and this also prints every replica when there is more than one.
  "${COMPOSE[@]}" logs --tail 40 --no-color app >&2 || true
  fail "deploy finished but the app is not serving — roll back with: docker tag konak-app:<previous-sha> konak-app:latest && bash docker/deploy.sh --no-build"
fi

log "app is serving"
"${COMPOSE[@]}" ps
log "deployed $SHA — https://konaq.kz"
