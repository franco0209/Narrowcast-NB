#!/usr/bin/env bash
# Aplica a oai-dev: (1) simulación de RACH controlada por entorno, (2) inyector UDP, (3) enganches que imprimen los NAS de bajada.
set -euo pipefail
cd "$(dirname "$0")"
docker cp inject.c oai-dev:/tmp/inject.c
docker exec oai-dev sh -c '
set -e
# (0) simulación de acceso aleatorio de OAI (hoy desactivada con un 0): se activa con OAI_SIM_RACH=1
M=/opt/oai/openair2/PHY_INTERFACE/IF_Module_L2_primitives_NB_IoT.c
grep -q OAI_SIM_RACH $M || sed -i "s/enable_preamble_simulation(UL_INFO,0);/enable_preamble_simulation(UL_INFO, getenv(\"OAI_SIM_RACH\") ? 1 : 0);/; s/enable_msg3_simulation(UL_INFO,0);/enable_msg3_simulation(UL_INFO, getenv(\"OAI_SIM_RACH\") ? 1 : 0);/; 1i #include <stdlib.h>" $M
# (4) CORRECCION: el decodificador S1AP de OAI descarta el Initial Context Setup Request si trae un IE que no conoce
#     (Open5GS manda Masked-IMEISV, id 192, criticidad ignore). Se omite el IE en vez de devolver -1.
D=/opt/oai/cmake_targets/lte_build_oai/build/CMakeFiles/R10.5/s1ap_decoder.c
python3 - <<PY
p="$D"; s=open(p).read()
k="Unknown protocol IE id (%d) for message s1ap_initialcontextsetuprequesties\\\\n\", (int)ie_p->id);\n                return -1;"
if k in s: open(p,"w").write(s.replace(k,k.replace("return -1;","break; /* IE desconocido: se omite */"),1)); print("decodificador S1AP corregido")
PY
U=/opt/oai/openair2/LAYER2/MAC/eNB_scheduler_ulsch_NB_IoT.c
grep -q "OAI_INJECT" $U || { echo "#include <stdlib.h>" | cat - $U > /tmp/u.c && cp /tmp/u.c $U && cat /tmp/inject.c >> $U; }
S=/opt/oai/openair2/RRC/LITE/rrc_eNB_S1AP.c
if ! grep -q "NAS-DL" $S; then
  # NAS de bajada (Authentication Request, Security Mode Command...): justo antes de crear el DLInformationTransfer
  python3 - <<PY
p="$S"; s=open(p).read()
k="    length = do_DLInformationTransfer_NB_IoT ("
hook="""    { printf("[NAS-DL] rnti=0x%x ", ue_context_p->ue_context.rnti); for (int q = 0; q < (int)S1AP_DOWNLINK_NAS (msg_p).nas_pdu.length; q++) printf("%02x", S1AP_DOWNLINK_NAS (msg_p).nas_pdu.buffer[q]); printf("\\\\n"); }
"""
assert k in s; s=s.replace(k,hook+k,1)
k2="int rrc_eNB_process_S1AP_INITIAL_CONTEXT_SETUP_REQ(MessageDef *msg_p, const char *msg_name, instance_t instance)\n{"
hook2="""
  { s1ap_initial_context_setup_req_t *q_ = &S1AP_INITIAL_CONTEXT_SETUP_REQ(msg_p); printf("[ICS-REQ] eNB_ue_s1ap_id=%u rabs=%d\\\\n", (unsigned)q_->eNB_ue_s1ap_id, q_->nb_of_e_rabs);
    for (int r_ = 0; r_ < q_->nb_of_e_rabs; r_++) { printf("[ICS-NAS] rab=%d len=%d ", q_->e_rab_param[r_].e_rab_id, (int)q_->e_rab_param[r_].nas_pdu.length);
      for (int b_ = 0; b_ < (int)q_->e_rab_param[r_].nas_pdu.length; b_++) printf("%02x", q_->e_rab_param[r_].nas_pdu.buffer[b_]); printf("\\\\n"); } }
"""
assert k2 in s; s=s.replace(k2,k2+hook2,1)
open(p,"w").write(s)
PY
fi
cd /opt/oai/cmake_targets/lte_build_oai/build && make -j2 lte-softmodem 2>&1 | grep -E "error|Error|warning: implicit|Built target lte-softmodem" | head -12'
