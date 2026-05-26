# syntax=docker/dockerfile:1.6
#
# Multi-stage Dockerfile for the Vetoed MCP server.
# - Builder stage compiles TypeScript -> build/.
# - Runtime stage carries the compiled JS plus runtime assets
#   (resources, schema.sql, public/, scripts/) and uses
#   `npm ci --omit=dev` to slim node_modules.
#
# `scripts/` is REQUIRED in the runtime image (per PLAN.md C3) so that
#   flyctl ssh console -a vetoed-mcp
#   cd /app && npm run admin -- <subcommand>
# works end-to-end against the production DB on the mounted volume.
#
# tsx is a runtime dependency (NOT a devDependency) so `npm run admin`
# can execute `scripts/admin.ts` directly inside the slimmed runtime.

# ---------- Builder ----------
FROM node:22-bookworm-slim AS builder
WORKDIR /app

# Install dependencies first for better layer caching.
COPY package.json package-lock.json ./
RUN npm ci

# Copy build inputs. Keep scripts/ in a separate layer so that
# changes to scripts/ don't invalidate the slow TypeScript compile.
COPY tsconfig.json ./
COPY src ./src

# Compile TypeScript to build/ and stage build/db/schema.sql.
RUN npm run build

# scripts/ + public/ are not needed for `npm run build` but the runtime
# image ships them; copy them here so the runtime stage can pull
# everything from the builder.
COPY scripts ./scripts
COPY public ./public

# ---------- Runtime ----------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    MCP_TRANSPORT=http \
    PORT=3000

# Manifests + lockfile are needed for `npm ci --omit=dev`.
COPY --from=builder /app/package.json /app/package-lock.json ./

# Compiled JS for the server entry point.
COPY --from=builder /app/build ./build

# Full src/ tree ships so the admin CLI (run via tsx) can resolve its
# imports. The MCP server itself runs from build/ — src/ is only loaded
# at runtime by `tsx scripts/admin.ts`. Tests + vitest configs are
# excluded by the .dockerignore for the initial context, and tsc
# strips them out by virtue of the type-stripping; the .ts files
# stay (~30KB) because tsx needs them.
COPY --from=builder /app/src ./src
COPY --from=builder /app/public ./public
COPY --from=builder /app/scripts ./scripts

# Slim install: dev deps stripped, tsx kept (it lives in `dependencies`).
RUN npm ci --omit=dev && npm cache clean --force

EXPOSE 3000

CMD ["node", "build/index.js"]
