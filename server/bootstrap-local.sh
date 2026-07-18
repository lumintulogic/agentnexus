#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIRECTUS_DIR="$ROOT_DIR/server/directus"
KEYCLOAK_DIR="$ROOT_DIR/server/keycloak"

require_env() {
  local service_dir="$1"
  if [[ ! -f "$service_dir/.env" ]]; then
    printf 'Missing %s/.env. Copy .env.example to .env and fill the local secrets first.\n' "$service_dir" >&2
    exit 1
  fi
}

compose_up() {
  local service_dir="$1"
  (cd "$service_dir" && docker compose --env-file .env up -d)
}

require_env "$DIRECTUS_DIR"
require_env "$KEYCLOAK_DIR"

compose_up "$DIRECTUS_DIR"
compose_up "$KEYCLOAK_DIR"

(cd "$KEYCLOAK_DIR" && python3 setup-agentnexus.py)
(cd "$DIRECTUS_DIR" && node setup-agentnexus-schema.mjs)
