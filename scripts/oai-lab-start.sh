#!/bin/sh
# eNB de OAI con RADIO FALSA para el Laboratorio del panel (sin USRP, no emite nada). Corre el MAC/RRC/S1AP reales de OAI
# contra el MME de Open5GS. La primera vez instala los ganchos de prueba y recompila (~1-2 min, ~100 MB en este contenedor).
set -e
mkdir -p /data/oai-lab
# Se vuelve a preparar solo si cambió algún archivo de /lab (la huella queda en .ready)
SUM=$(cat /lab/prepare.sh /lab/inject.c /lab/fakedev.c | md5sum | cut -d' ' -f1)
if [ "$(cat /opt/fake/.ready 2>/dev/null)" != "$SUM" ]; then
  echo "[oai-lab] preparando radio falsa, inyector y relevo de datos..." | tee /data/oai-lab/prepare.log
  sh /lab/prepare.sh >> /data/oai-lab/prepare.log 2>&1
  echo "$SUM" > /opt/fake/.ready
fi
chmod 755 /data/oai-lab; : > /data/oai-lab/oai.log; chmod 644 /data/oai-lab/oai.log
# Radio elegida en el panel: se escribe en el .conf (OAI solo lo lee al arrancar) y queda registrada como «aplicada»
eval "$(python3 /lab/radio_cfg.py)"
chmod 666 /data/lab-radio.applied.json 2>/dev/null || true
cd /opt/oai/cmake_targets/lte_build_oai/build
echo "[oai-lab] eNB arrancando id=$(date +%s)" >> /data/oai-lab/oai.log
# OAI_RELAY_DL: dónde entrega OAI los paquetes IP de bajada (el simulador del nodo, que hace de dispositivo)
export OAI_SIM_RACH=1 OAI_INJECT=1 OAI_RELAY_DL=${LAB_NODE_IP:-10.44.0.42}:9102
exec stdbuf -o0 -e0 ./lte-softmodem -O /tmp/enb.conf -S >> /data/oai-lab/oai.log 2>&1
