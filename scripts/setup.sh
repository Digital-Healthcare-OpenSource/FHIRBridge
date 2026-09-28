#!/usr/bin/env bash
# FHIRBridge Setup Script
# Installs dependencies, starts Docker services, and initializes the database.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env"
COMPOSE_FILE="${ROOT_DIR}/docker/docker-compose.yml"

# ── Colors ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
log_info()  { echo -e "${GREEN}[setup]${NC} $*"; }
log_warn()  { echo -e "${YELLOW}[warn]${NC}  $*"; }
log_error() { echo -e "${RED}[error]${NC} $*" >&2; }

# ── Check prerequisites ───────────────────────────────────────────────────────
check_command() {
  if ! command -v "$1" &>/dev/null; then
    log_error "Required command '$1' not found. Please install it first."
    exit 1
  fi
}

log_info "Checking prerequisites..."
check_command node
check_command pnpm
check_command docker

# Verify Node.js version >= 22
NODE_VERSION=$(node --version | sed 's/v//' | cut -d. -f1)
if [[ "${NODE_VERSION}" -lt 22 ]]; then
  log_error "Node.js >= 22 required. Found: $(node --version)"
  exit 1
fi

# Verify pnpm version >= 9
PNPM_VERSION=$(pnpm --version | cut -d. -f1)
if [[ "${PNPM_VERSION}" -lt 9 ]]; then
  log_error "pnpm >= 9 required. Found: $(pnpm --version)"
  exit 1
fi

# ── Environment setup ─────────────────────────────────────────────────────────
if [[ ! -f "${ENV_FILE}" ]]; then
  log_warn ".env not found. Copying from .env.example..."
  cp "${ROOT_DIR}/.env.example" "${ENV_FILE}"
  log_warn "Please edit .env with your actual values before running services."
fi

# Load env vars for Docker
set -a
# shellcheck source=/dev/null
source "${ENV_FILE}" 2>/dev/null || true
set +a

# ── Install dependencies ──────────────────────────────────────────────────────
log_info "Installing pnpm dependencies..."
cd "${ROOT_DIR}"
pnpm install --frozen-lockfile 2>/dev/null || pnpm install

# ── Docker services ───────────────────────────────────────────────────────────
log_info "Starting Docker services (Postgres + Redis)..."
docker compose -f "${COMPOSE_FILE}" up -d

# ── Wait for Postgres ─────────────────────────────────────────────────────────
log_info "Waiting for Postgres to be ready..."
MAX_RETRIES=30
RETRY_COUNT=0

until docker compose -f "${COMPOSE_FILE}" exec -T postgres \
  pg_isready -U "${POSTGRES_USER:-fhirbridge}" -d "${POSTGRES_DB:-fhirbridge_audit}" \
  &>/dev/null; do
  RETRY_COUNT=$((RETRY_COUNT + 1))
  if [[ "${RETRY_COUNT}" -ge "${MAX_RETRIES}" ]]; then
    log_error "Postgres not ready after ${MAX_RETRIES} attempts. Check Docker logs."
    docker compose -f "${COMPOSE_FILE}" logs postgres
    exit 1
  fi
  sleep 2
done

log_info "Postgres is ready."

# ── Wait for Redis ────────────────────────────────────────────────────────────
log_info "Waiting for Redis to be ready..."
RETRY_COUNT=0

until docker compose -f "${COMPOSE_FILE}" exec -T redis \
  redis-cli ping &>/dev/null; do
  RETRY_COUNT=$((RETRY_COUNT + 1))
  if [[ "${RETRY_COUNT}" -ge "${MAX_RETRIES}" ]]; then
    log_error "Redis not ready after ${MAX_RETRIES} attempts. Check Docker logs."
    docker compose -f "${COMPOSE_FILE}" logs redis
    exit 1
  fi
  sleep 2
done

log_info "Redis is ready."

# ── Setup complete ────────────────────────────────────────────────────────────
echo ""
log_info "Setup complete!"
echo ""
echo "  Postgres: postgresql://${POSTGRES_USER:-fhirbridge}@localhost:${POSTGRES_PORT:-5432}/${POSTGRES_DB:-fhirbridge_audit}"
echo "  Redis:    redis://localhost:${REDIS_PORT:-6379}"
echo ""
echo "  Run 'pnpm dev' to start all packages in development mode."
echo "  Run 'pnpm build' to build all packages."
echo ""
