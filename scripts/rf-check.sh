#!/usr/bin/env bash
# Verifica rf-plan.yaml antes de transmitir. Sale con 0 solo si todo está en regla.
set -uo pipefail
cd "$(dirname "$0")/.."
plan="${RF_PLAN:-rf-plan.yaml}"
[ -f "$plan" ] || { echo "FAIL  no existe $plan (copiar rf-plan.example.yaml)"; exit 1; }

get() { sed -n "s/^$1:[[:space:]]*\([^#]*\).*/\1/p" "$plan" | sed 's/[[:space:]]*$//' | head -1; }
fail=0
bad() { echo "FAIL  $1"; fail=1; }
ok()  { echo "PASS  $1"; }

band=$(get band); modo=$(get modo); gain=$(get tx_gain); att=$(get atenuacion_db)
dur=$(get duracion_max_s); free=$(get portadora_libre); ant=$(get antena_autorizada)
who=$(get autorizado_por); earfcn=$(get earfcn)
band=${band#[Bb]}

case "$band" in 3|8|20|28) ok "banda B$band soportada por el módulo" ;;
  "") bad "band vacío" ;; *) bad "banda B$band fuera de la lista del módulo (B3, B8, B20, B28)" ;; esac
[ -n "$earfcn" ] && ok "earfcn $earfcn" || bad "earfcn vacío (se elige en el barrido de la Fase 3)"
[ -n "$who" ] && ok "autorizado por: $who" || bad "falta autorizado_por (nombre y fecha)"
if [[ "$gain" =~ ^[0-9]+$ ]] && [ "$gain" -le 30 ]; then ok "tx_gain $gain (bajo)"
else bad "tx_gain '$gain' vacío o > 30 dB: empezar bajo y subir de a poco"; fi
case "$modo" in
  cable) [[ "$att" =~ ^[0-9]+$ ]] && [ "$att" -ge 60 ] && ok "cable con ${att} dB de atenuación" || bad "modo cable exige atenuacion_db >= 60" ;;
  antena) [[ "$ant" =~ ^(s|S)(i|í)$ ]] && ok "antena con permiso escrito" || bad "modo antena exige antena_autorizada: sí (permiso escrito del docente)" ;;
  *) bad "modo debe ser cable o antena" ;;
esac
[[ "$dur" =~ ^[0-9]+$ ]] && [ "$dur" -gt 0 ] && [ "$dur" -le 600 ] && ok "duración máxima ${dur} s" || bad "duracion_max_s debe estar entre 1 y 600"
[[ "$free" =~ ^(s|S)(i|í)$ ]] && ok "portadora libre confirmada" || bad "portadora_libre debe ser sí (hacer el barrido)"

[ "$fail" -eq 0 ] && echo "RF OK: se puede transmitir (duración máx ${dur} s)" || echo "RF BLOQUEADA: corregir lo anterior"
exit $fail
