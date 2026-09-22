# Production image.
#
# The repo had no container and no deploy target, so "how does this run
# anywhere but a laptop" had no answer. This is that answer.
#
# Three stages, for one reason each:
#   deps    — install once, cached on the lockfile alone, so a source edit does
#             not re-download the dependency tree.
#   build   — needs the dev dependencies and the Prisma CLI; none of them belong
#             in the shipped image.
#   runtime — carries the traced server, the static assets, and the Prisma query
#             engine, and nothing else.

# ---------------------------------------------------------------------------
FROM node:20-slim AS deps
WORKDIR /app

# openssl is required by the Prisma engines on the slim image; without it the
# client fails at startup with an error that does not name openssl.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./

# package.json carries an `overrides` block (postcss, sharp). npm 10 decides such
# a lockfile is out of sync on every upstream patch release and `npm ci` then
# fails with a diff nobody introduced. Pinned here AND in CI; they must agree.
RUN npm i -g npm@11
RUN npm ci

# ---------------------------------------------------------------------------
FROM node:20-slim AS build
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# The build must not need a reachable database or an API key. `prisma generate`
# reads the schema file only, and the app is designed to boot unkeyed — a
# deployment with no AI key is navigable and says so, rather than crashing.
ENV NEXT_TELEMETRY_DISABLED=1
# `npm run build` is already `prisma generate && next build`.
RUN npm run build

# ---------------------------------------------------------------------------
FROM node:20-slim AS runtime
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Runs as a non-root user. Uploads are the only writable path the app needs, and
# it must own that rather than the whole application directory.
RUN groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public

# Prisma's query engine is a platform binary, not an import, so Next's file
# tracing cannot see it and does not copy it. Without this the image builds and
# every query fails at runtime.
COPY --from=build --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma

# Migrations and the schema, so a release can run `prisma migrate deploy`
# against the same image it is about to serve from.
COPY --from=build --chown=nextjs:nodejs /app/prisma ./prisma

# The local storage driver writes here. In production STORAGE_DRIVER should be
# s3 — a container filesystem is not durable and does not survive a redeploy —
# but the directory must exist either way, since the driver is chosen at runtime.
RUN mkdir -p /app/uploads && chown nextjs:nodejs /app/uploads
VOLUME ["/app/uploads"]

USER nextjs
EXPOSE 3000

# Which build is serving. Read back by /api/health, so a deploy can be gated on
# the new revision actually being live rather than on a container being up.
# Declared last on purpose: an ARG here invalidates only these final layers, not
# the 40 MB public/ copy above it.
ARG APP_REVISION=unknown
ENV APP_REVISION=${APP_REVISION}

# /api/health, not /login. /login renders React and the i18n dictionaries on
# every probe and never touches the database, so it reported healthy straight
# through a total database outage while costing a full page render twice a
# minute. /api/health is a `SELECT 1` behind a timeout, and it answers 200 even
# when the database is down — restarting the web tier over a database blip is
# how a five-second outage becomes a restart loop.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
