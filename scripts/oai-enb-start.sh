#!/usr/bin/env bash
# Arranque del eNB NB-IoT dentro del contenedor: genera la config desde el plan RF y lanza lte-softmodem.
# El plan lo valida el panel/rf-check.sh ANTES de encender el contenedor; aqui solo se traduce.
set -euo pipefail
PLAN="${RF_PLAN:-/data/rf-plan.yaml}"
TMPL=/config/enb.nbiot.conf.tmpl
OUT=/tmp/enb.nbiot.conf
get() { sed -n "s/^$1:[[:space:]]*\"\{0,1\}\([^\"#]*\)\"\{0,1\}[[:space:]]*\$/\1/p" "$PLAN" 2>/dev/null | head -n1; }

if [ "${S1_ONLY:-0}" = 1 ]; then          # prueba de S1 sin plan RF ni radio (no emite)
  BAND=${BAND:-3}; DL_HZ=${DL_HZ:-1840000000}; TXG=0
else
  [ -f "$PLAN" ] || { echo "ERROR: no hay plan RF ($PLAN)"; exit 1; }
  BAND=$(get band); DL_HZ=$(get dl_freq_hz); TXG=$(get tx_gain)
  [ -n "$BAND" ] && [ -n "$DL_HZ" ] && [ -n "$TXG" ] || { echo "ERROR: plan RF incompleto (band, dl_freq_hz, tx_gain)"; exit 1; }
fi
case "$BAND" in   # offset UL-DL (Hz) de las bandas permitidas
  3) UL_OFFSET=-95000000;; 8) UL_OFFSET=-45000000;; 20) UL_OFFSET=41000000;; 28) UL_OFFSET=-55000000;;
  *) echo "ERROR: banda $BAND no permitida"; exit 1;;
esac
# En OAI "tx_gain" de la config es ATENUACION respecto al maximo del USRP (90 ~ ganancia 0 en B210).
# Suposicion a verificar con el modelo real: atenuacion = 90 - ganancia del plan.
TX_ATT=$(( 90 - TXG )); [ "$TX_ATT" -ge 0 ] || TX_ATT=0
sed -e "s/@BAND@/$BAND/" -e "s/@DL_HZ@/$DL_HZ/" -e "s/@UL_OFFSET@/$UL_OFFSET/" -e "s/@TX_ATT@/$TX_ATT/" \
    -e "s/@MME_IP@/${MME_IP:-10.44.0.10}/" -e "s#@ENB_IP@#${ENB_IP:-10.44.0.40}#g" "$TMPL" > "$OUT"
echo "eNB NB-IoT: banda $BAND, DL $DL_HZ Hz, UL offset $UL_OFFSET, atenuacion TX $TX_ATT, MME ${MME_IP:-10.44.0.10}"
exec /opt/oai/cmake_targets/lte_build_oai/build/lte-softmodem -O "$OUT" -S "$@"
