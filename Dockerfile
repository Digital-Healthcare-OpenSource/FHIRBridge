# syntax=docker/dockerfile:1.7
# Multi-stage build for FHIRBridge API server.
# Final image is a slim Node 20-alpine that runs `node packages/api/dist/index.js`.

# ── Stage 1: build ────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.11.0 --activate

# Copy manifests first for better Docker layer caching
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY packages/types/package.json packages/types/
COPY packages/core/package.json packages/core/
COPY packages/api/package.json packages/api/
COPY packages/cli/package.json packages/cli/
COPY packages/web/package.json packages/web/

RUN pnpm install --frozen-lockfile

# Copy sources and build only the packages we need at runtime (api + its deps)
COPY tsconfig.json ./
COPY packages/types ./packages/types
COPY packages/core ./packages/core
COPY packages/api ./packages/api

RUN pnpm --filter @fhirbridge/types build \
 && pnpm --filter @fhirbridge/core build \
 && pnpm --filter @fhirbridge/api build

# Prune dev deps from node_modules to slim the runtime
RUN pnpm prune --prod --no-optional

# ── Stage 2: runtime ──────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3001 \
    HOST=0.0.0.0

# Non-root user
RUN addgroup -S fhirbridge && adduser -S fhirbridge -G fhirbridge

COPY --from=builder --chown=fhirbridge:fhirbridge /app/node_modules ./node_modules
COPY --from=builder --chown=fhirbridge:fhirbridge /app/packages/types/dist ./packages/types/dist
COPY --from=builder --chown=fhirbridge:fhirbridge /app/packages/types/package.json ./packages/types/package.json
COPY --from=builder --chown=fhirbridge:fhirbridge /app/packages/core/dist ./packages/core/dist
COPY --from=builder --chown=fhirbridge:fhirbridge /app/packages/core/package.json ./packages/core/package.json
COPY --from=builder --chown=fhirbridge:fhirbridge /app/packages/api/dist ./packages/api/dist
COPY --from=builder --chown=fhirbridge:fhirbridge /app/packages/api/package.json ./packages/api/package.json
COPY --from=builder --chown=fhirbridge:fhirbridge /app/package.json ./package.json

USER fhirbridge

EXPOSE 3001

# Healthcheck — the /health route returns 200 even when DB/Redis are degraded.
# Shell-form CMD so ${PORT} is expanded at runtime; falls back to 3001 to match
# the default above. Keep this in sync with the PORT the server actually binds.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-3001}/api/v1/health" > /dev/null || exit 1

CMD ["node", "packages/api/dist/index.js"]
