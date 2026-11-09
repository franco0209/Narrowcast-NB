#!/usr/bin/env bash
# Uso: scripts/rf-run.sh [--resultado "texto"] -- <comando que emite RF>
# Comprueba el plan, limita la duración (timeout) y registra la sesión en data/logs/rf-sessions.csv.
set -uo pipefail
cd "$(dirname "$0")/.."
result=""
[ "${1:-}" = "--resultado" ] && { result="$2"; shift 2; }
[ "${1:-}" = "--" ] && shift
[ "$#" -gt 0 ] || { echo "Uso: $0 [--resultado texto] -- comando" >&2; exit 64; }

scripts/rf-check.sh || exit 1
plan="${RF_PLAN:-data/rf-plan.yaml}"
get() { sed -n "s/^$1:[[:space:]]*\([^#]*\).*/\1/p" "$plan" | sed 's/[[:space:]]*$//' | head -1; }
dur=$(get duracion_max_s)

mkdir -p data/logs
[ -f data/logs/rf-sessions.csv ] || echo "inicio_utc,banda,earfcn,modo,tx_gain,duracion_max_s,duracion_real_s,codigo,resultado" > data/logs/rf-sessions.csv
t0=$(date +%s); start=$(date -u +%Y-%m-%dT%H:%M:%SZ)
timeout --signal=INT "$dur" "$@"; code=$?
real=$(( $(date +%s) - t0 ))
[ "$code" -eq 124 ] && echo "Sesión cortada por límite de ${dur} s"
echo "$start,$(get band),$(get earfcn),$(get modo),$(get tx_gain),$dur,$real,$code,\"$result\"" >> data/logs/rf-sessions.csv
exit $code
