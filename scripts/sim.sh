#!/usr/bin/env bash
# Uso: scripts/sim.sh up|down|logs|validate
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] || cp .env.example .env
case "${1:-up}" in
  up)       docker compose --profile sim up -d ;;
  down)     docker compose --profile sim down ;;
  logs)     docker compose --profile sim logs -f --tail=50 "${@:2}" ;;
  validate) scripts/validate.sh ;;
  *) echo "Uso: $0 up|down|logs|validate" >&2; exit 64 ;;
esac
