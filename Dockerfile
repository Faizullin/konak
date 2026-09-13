# syntax=docker/dockerfile:1.7
#
# konak — production image.
#
# Three stages, and the split is load-bearing on a 1 vCPU / 1.9 GB box:
#   deps     npm ci, cached on package-lock.json alone so a source-only change
#            never reinstalls ~980 MB of packages.
#   builder  prisma generate + next build. Keeps full node_modules, so it is
#            ALSO the image that runs migrations (see the `migrate` service in
#            docker/compose/prod.yml) — the prisma CLI is a devDependency and
#            does not exist in the runner.
#   runner   the standalone output only. No source, no devDependencies, no
#            package manager.

# ─────────────────────────── deps ───────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app

# Prisma's engines and sharp are glibc-linked; alpine needs the shim.
RUN apk add --no-cache libc6-compat

COPY package.json package-lock.json ./
RUN npm ci

# ────────────────────────── builder ─────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# `next.config.ts` reads BUILD_STANDALONE from the raw process.env and only
# then sets output:'standalone'. Without it the build produces a .next that
# `next start` can serve but the runner stage cannot — there is no server.js.
ENV BUILD_STANDALONE=true
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# src/env.mjs validates every variable at import time, and the build imports it.
# Skipping is correct here rather than a shortcut: the values that matter at
# RUNTIME (BETTER_AUTH_SECRET, FIELD_ENCRYPTION_KEY, DATABASE_URL) must come
# from compose at start, not be frozen into a layer that ends up in a registry.
ENV SKIP_ENV_VALIDATION=1

# prisma.config.ts calls env("DATABASE_URL") when the CLI loads it. Generation
# never opens a connection, but the config must parse — so this placeholder is
# present only for that, and is never what the running app uses.
ENV DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build"

# 1 core, 1.9 GB RAM, 4 GB swap. Node's default heap is sized from total RAM
# and would let the build grow into swap until the box thrashes or the OOM
# killer takes it. Cap it below (RAM + a little swap) so V8 runs GC instead.
ENV NODE_OPTIONS="--max-old-space-size=1536"

# The client is generated into src/generated (gitignored), so it MUST be built
# here — a checkout alone does not contain it and the build would fail on the
# first import.
RUN npx prisma generate

RUN npm run build

# Fail here, loudly, rather than produce a runner image whose CMD is missing.
RUN test -f .next/standalone/server.js || \
      (echo "ERROR: .next/standalone/server.js missing — BUILD_STANDALONE did not take effect" && exit 1)

# konak has no public/ directory — it ships no static files outside .next.
# public/ is optional to Next, but the runner's COPY needs the path to exist or
# the build fails at the very last step. Creating it here keeps that COPY
# unconditional, so adding public/ later needs no Dockerfile change.
RUN mkdir -p public

# ────────────────────────── runner ──────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
# Bind all interfaces INSIDE the container. This is not the public internet:
# the app publishes no ports and is reachable only across the compose `edge`
# network, from Caddy. Binding loopback here would make it unreachable.
ENV HOSTNAME=0.0.0.0

# Run as a non-root user. node:alpine ships uid 1000 `node`; the storage volume
# is chowned to it in the compose file's init, so uploads are writable.
RUN mkdir -p /data/storage && chown -R node:node /data/storage

# The standalone output is self-contained: it bundles the traced subset of
# node_modules and its own server.js.
COPY --from=builder --chown=node:node /app/.next/standalone ./
# Static assets and public/ are NOT traced into standalone — Next expects to
# find them on disk next to server.js. Omitting either yields a running app
# with no CSS and no images.
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public

USER node
EXPOSE 3000

# konak has no /api/health endpoint yet (see docs/plans/deployment.md, "Gaps").
# Until it does, this proves the Node process is accepting HTTP — it does not
# prove the database is reachable.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:3000/ || exit 1

CMD ["node", "server.js"]
