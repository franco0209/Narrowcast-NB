#!/bin/sh
# Se ejecuta DENTRO de un contenedor con la imagen de OAI. Instala los ganchos de PRUEBA (no estan en la imagen de produccion):
#   radio falsa, simulacion de RACH controlada por entorno, inyector UDP y avisos de los NAS que baja el MME. Idempotente.
# Entradas: /lab/fakedev.c, /lab/inject.c y /tmp/tmpl (plantilla del eNB). Salida: /tmp/enb.conf y el eNB recompilado.
set -e
O=/opt/oai; B=$O/cmake_targets/lte_build_oai/build
ENB_IP=${ENB_IP:-10.44.0.43}; MME_IP=${MME_IP:-10.44.0.10}
# (1) radio falsa en lugar del USRP
mkdir -p /opt/fake
gcc -shared -fPIC -O2 -o /opt/fake/liboai_fakedev.so /lab/fakedev.c -I$O/targets/ARCH/COMMON -I$O/common/utils -I$O/openair1 -I$O
ln -sf /opt/fake/liboai_fakedev.so $B/liboai_device.so
sed -e "s/@BAND@/3/" -e "s/@DL_HZ@/1840000000/" -e "s/@UL_OFFSET@/-95000000/" -e "s/@TX_GAIN@/0/" \
    -e "s/@MME_IP@/$MME_IP/" -e "s#@ENB_IP@#$ENB_IP#g" /tmp/tmpl > /tmp/enb.conf
# (2) simulacion de acceso aleatorio de OAI (desactivada con un 0): se activa con OAI_SIM_RACH=1
M=$O/openair2/PHY_INTERFACE/IF_Module_L2_primitives_NB_IoT.c
grep -q OAI_SIM_RACH $M || sed -i 's/enable_preamble_simulation(UL_INFO,0);/enable_preamble_simulation(UL_INFO, getenv("OAI_SIM_RACH") ? 1 : 0);/; s/enable_msg3_simulation(UL_INFO,0);/enable_msg3_simulation(UL_INFO, getenv("OAI_SIM_RACH") ? 1 : 0);/; 1i #include <stdlib.h>' $M
# (3) inyector UDP (se anexa al planificador MAC) y avisos de NAS de bajada / Initial Context Setup
U=$O/openair2/LAYER2/MAC/eNB_scheduler_ulsch_NB_IoT.c
# el inyector se reemplaza siempre (se corta lo anexado antes, desde su marca, y se vuelve a anexar)
grep -q "Inyector de pruebas (Narrowcast-NB)" $U && sed -i '/---- Inyector de pruebas (Narrowcast-NB)/,$d' $U
grep -q "include <stdlib.h>" $U || sed -i '1i #include <stdlib.h>' $U
cat /lab/inject.c >> $U
# (3b) bajada de datos: los paquetes IP que el SGW-U manda al eNB se reenvian por UDP (OAI_RELAY_DL=ip:puerto) en vez de ir a PDCP
G=$O/openair3/GTPV1-U/gtpv1u_eNB.c
grep -q narrowcast_dl_relay $G || python3 - "$G" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
fn = """/* Narrowcast-NB: relevo de bajada para pruebas con radio falsa (ver inject.c). Sin OAI_RELAY_DL no hace nada. */
#include <arpa/inet.h>
static int narrowcast_dl_relay(const uint8_t *b, uint32_t n) {
  static int s = -1; static struct sockaddr_in a; static int on = -1; static unsigned long cnt = 0;
  if (on < 0) { const char *e = getenv("OAI_RELAY_DL"); char ip[64]; int port;
    if (e && sscanf(e, "%63[^:]:%d", ip, &port) == 2) { s = socket(AF_INET, SOCK_DGRAM, 0); a.sin_family = AF_INET; a.sin_port = htons(port); inet_pton(AF_INET, ip, &a.sin_addr); on = 1; printf("[DATA-DL] relevo de bajada hacia %s\\n", e); } else on = 0; }
  if (!on) return 0;
  sendto(s, b, n, 0, (struct sockaddr *)&a, sizeof a);
  if (++cnt <= 3 || cnt % 50 == 0) printf("[DATA-DL] %lu paquetes IP (%u bytes el ultimo) desde el SGW-U -> dispositivo\\n", cnt, n);
  return 1;
}

"""
k = "NwGtpv1uRcT gtpv1u_eNB_process_stack_req("
assert k in s; s = s.replace(k, fn + k, 1)
k2 = "    itti_free(TASK_UDP, ((NwGtpv1uMsgT*)pUlpApi->apiInfo.recvMsgInfo.hMsg)->msgBuf);\n"
assert k2 in s; s = s.replace(k2, k2 + "    if (narrowcast_dl_relay(buffer, buffer_len)) return NW_GTPV1U_OK;\n", 1)
open(p, "w").write(s)
PY
S=$O/openair2/RRC/LITE/rrc_eNB_S1AP.c
grep -q "NAS-DL" $S || python3 - "$S" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
k = "    length = do_DLInformationTransfer_NB_IoT ("
hook = """    { printf("[NAS-DL] rnti=0x%x ", ue_context_p->ue_context.rnti); for (int q = 0; q < (int)S1AP_DOWNLINK_NAS (msg_p).nas_pdu.length; q++) printf("%02x", S1AP_DOWNLINK_NAS (msg_p).nas_pdu.buffer[q]); printf("\\n"); }
"""
assert k in s; s = s.replace(k, hook + k, 1)
k2 = "int rrc_eNB_process_S1AP_INITIAL_CONTEXT_SETUP_REQ(MessageDef *msg_p, const char *msg_name, instance_t instance)\n{"
hook2 = """
  { s1ap_initial_context_setup_req_t *q_ = &S1AP_INITIAL_CONTEXT_SETUP_REQ(msg_p); printf("[ICS-REQ] eNB_ue_s1ap_id=%u rabs=%d\\n", (unsigned)q_->eNB_ue_s1ap_id, q_->nb_of_e_rabs);
    for (int r_ = 0; r_ < q_->nb_of_e_rabs; r_++) { printf("[ICS-NAS] rab=%d len=%d ", q_->e_rab_param[r_].e_rab_id, (int)q_->e_rab_param[r_].nas_pdu.length);
      for (int b_ = 0; b_ < (int)q_->e_rab_param[r_].nas_pdu.length; b_++) printf("%02x", q_->e_rab_param[r_].nas_pdu.buffer[b_]); printf("\\n"); } }
"""
assert k2 in s; s = s.replace(k2, k2 + hook2, 1)
open(p, "w").write(s)
PY
# (4) la correccion del decodificador S1AP ya viene en la imagen; si se usa una imagen antigua se aplica aqui
[ -f /tmp/patch-s1ap.py ] && python3 /tmp/patch-s1ap.py || true
cd $B && make -j2 lte-softmodem 2>&1 | grep -E "error|Error|Built target lte-softmodem" | head -12
