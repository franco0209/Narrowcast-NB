#!/usr/bin/env bash
# Prepara un contenedor de desarrollo de OAI con la RADIO FALSA (sin USRP). No modifica la imagen original:
# todo queda en la capa del contenedor `oai-dev`, que se puede borrar con `docker rm -f oai-dev`.
set -euo pipefail
cd "$(dirname "$0")/../.."
IMG=${OAI_IMAGE:-narrowcast-nb/oai-nbiot:local}
docker rm -f oai-dev >/dev/null 2>&1 || true
docker run -d --name oai-dev --network narrowcast-nb-core --ip 10.44.0.43 --cap-add SYS_NICE --entrypoint sleep "$IMG" infinity >/dev/null
docker cp lab/oai-fakerf/fakedev.c oai-dev:/tmp/fakedev.c
docker cp config/oai/enb.nbiot.conf.tmpl oai-dev:/tmp/tmpl
docker exec oai-dev sh -c '
  mkdir -p /opt/fake && gcc -shared -fPIC -O2 -o /opt/fake/liboai_fakedev.so /tmp/fakedev.c -I/opt/oai/targets/ARCH/COMMON -I/opt/oai/common/utils -I/opt/oai/openair1 -I/opt/oai
  ln -sf /opt/fake/liboai_fakedev.so /opt/oai/cmake_targets/lte_build_oai/build/liboai_device.so
  sed -e "s/@BAND@/3/" -e "s/@DL_HZ@/1840000000/" -e "s/@UL_OFFSET@/-95000000/" -e "s/@TX_GAIN@/0/" \
      -e "s/@MME_IP@/10.44.0.10/" -e "s#@ENB_IP@#10.44.0.43#g" /tmp/tmpl > /tmp/enb.conf'
echo "oai-dev listo (radio falsa instalada)"
