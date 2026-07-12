# syntax=docker/dockerfile:1.7
# Multi-stage build for FHIRBridge API server.
# Final image is a slim Node 20-alpine that runs `node dist/index.js` from a pnpm-deploy prod bundle.

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

# Tạo bản deploy prod-only, self-contained cho riêng @fhirbridge/api.
# KHÔNG dùng `pnpm prune --prod`: trong workspace nó không dọn được devDeps
# khỏi .pnpm store → vite/esbuild/vitest lọt vào image và dính Trivy gate
# (CVE trong esbuild Go binary, vite server.fs.deny bypass...).
RUN pnpm --filter @fhirbridge/api --prod deploy /deploy

# ── Stage 2: runtime ──────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app

# Vá CVE mức OS của base image (Trivy gate chặn publish khi còn HIGH+, vd
# CVE-2026-45447 libcrypto3) và gỡ npm/corepack/yarn khỏi runtime — app chạy
# bằng `node` trực tiếp, còn npm mang theo bundled deps (glob/minimatch/
# cross-spawn/sigstore) dính CVE mà app không thể vá qua lockfile.
RUN apk --no-cache upgrade && rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn*

ENV NODE_ENV=production \
    PORT=3001 \
    HOST=0.0.0.0

# Non-root user
RUN addgroup -S fhirbridge && adduser -S fhirbridge -G fhirbridge

# Bản deploy self-contained: dist + package.json + node_modules prod-only
# (workspace deps @fhirbridge/types|core được pnpm deploy nhúng sẵn).
COPY --from=builder --chown=fhirbridge:fhirbridge /deploy ./

USER fhirbridge

EXPOSE 3001

# Healthcheck — the /health route returns 200 even when DB/Redis are degraded.
# Shell-form CMD so ${PORT} is expanded at runtime; falls back to 3001 to match
# the default above. Keep this in sync with the PORT the server actually binds.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-3001}/api/v1/health" > /dev/null || exit 1

CMD ["node", "dist/index.js"]
