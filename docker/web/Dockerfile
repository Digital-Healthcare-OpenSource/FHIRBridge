# syntax=docker/dockerfile:1.7
# FHIRBridge web UI — static Vite build served by unprivileged nginx, with
# /api/* proxied to the API container (same origin, no CORS setup needed).
# Built from the repo root:  docker build -f docker/web/Dockerfile .

# ── Stage 1: build ────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.11.0 --activate

# Manifests first for layer caching (same layout as the API Dockerfile)
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json tsconfig.json ./
COPY packages/types/package.json packages/types/
COPY packages/core/package.json packages/core/
COPY packages/api/package.json packages/api/
COPY packages/cli/package.json packages/cli/
COPY packages/web/package.json packages/web/

RUN pnpm install --frozen-lockfile

# The web bundle needs its own sources, the shared type declarations and the
# example column mappings + sample files it embeds (Import page presets).
COPY packages/types ./packages/types
COPY packages/web ./packages/web
COPY examples/column-mappings ./examples/column-mappings
COPY examples/data ./examples/data

RUN pnpm --filter @fhirbridge/web build

# ── Stage 2: runtime ──────────────────────────────────────────────────────────
FROM nginxinc/nginx-unprivileged:1.29-alpine AS runtime

# Patch OS-level CVEs in the base image (root only for this step).
USER root
RUN apk --no-cache upgrade
USER nginx

COPY docker/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/web/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=builder /app/packages/web/dist /usr/share/nginx/html

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/ > /dev/null || exit 1
