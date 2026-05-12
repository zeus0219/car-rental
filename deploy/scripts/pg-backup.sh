#!/usr/bin/env bash
# A5 — PostgreSQL logical backup (Docker Compose). See docs/PRODUCTION.md § PostgreSQL backups.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Override for staging or a custom compose file, e.g.:
#   COMPOSE_FILE=$REPO_ROOT/deploy/docker-compose.staging.yml \
#   ENV_FILE=$REPO_ROOT/deploy/.env.staging \
#   PGDATABASE=carrental_staging \
#   ./deploy/scripts/pg-backup.sh
COMPOSE_FILE="${COMPOSE_FILE:-$REPO_ROOT/deploy/docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-$REPO_ROOT/deploy/.env}"
PGUSER="${PGUSER:-carrental}"
PGDATABASE="${PGDATABASE:-carrental}"
OUT_DIR="${OUT_DIR:-$REPO_ROOT/backups}"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$OUT_DIR"
OUT_FILE="${OUT_DIR}/carrental-${PGDATABASE}-${STAMP}.dump"

docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T postgres \
  pg_dump -U "$PGUSER" -d "$PGDATABASE" --no-owner --format=custom > "$OUT_FILE"

echo "Wrote $OUT_FILE"
echo "Next: encrypt, copy off-host, verify checksum, and test pg_restore on a non-prod instance (see PRODUCTION.md)."
