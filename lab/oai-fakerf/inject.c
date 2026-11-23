/* ---- Inyector de pruebas (Narrowcast-NB). Se anexa a eNB_scheduler_ulsch_NB_IoT.c ----
 * Escucha comandos de texto por UDP (puerto 9100) y entrega al RRC real de OAI mensajes de SUBIDA, como si vinieran del
 * RLC/PDCP, tras haber sido codificados con el ASN.1 de OAI:
 *   SC <rnti_hex> <nas_hex>   -> RRCConnectionSetupComplete-NB con ese NAS (p. ej. el Attach Request)
 *   UT <rnti_hex> <nas_hex>   -> ULInformationTransfer-NB con ese NAS (p. ej. Authentication Response)
 *   UC <rnti_hex> 00          -> UECapabilityInformation-NB mínima (banda 3): OAI responde con RRCConnectionReconfiguration
 *   RC <rnti_hex> 00          -> RRCConnectionReconfigurationComplete-NB (el UE acepta el portador de datos: OAI contesta
 *                                al MME con la Initial Context Setup Response y se completa el túnel S1-U)
 * Plano de datos (sustituye al radio bearer de datos, que con radio falsa no existe):
 *   UDP 9101 (entrada)  paquete IP del dispositivo  -> GTP-U de OAI -> SGW-U     (subida)
 *   OAI_RELAY_DL=ip:puerto: los paquetes IP que el SGW-U envía al eNB se reenvían por UDP a esa dirección (bajada)
 * Nada de esto es radio: prueba RRC, S1AP, GTP-U y el paso hacia el núcleo de Open5GS. */
#include <pthread.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <unistd.h>
#include "UL-DCCH-Message-NB.h"
#include "intertask_interface.h"
#include "gtpv1u.h"

static int inj_hex(const char *s, uint8_t *o, int max) {
  int n = 0; unsigned v;
  while (s[0] && s[1] && n < max) { if (sscanf(s, "%2x", &v) != 1) break; o[n++] = v; s += 2; }
  return n;
}
static int inj_encode(int kind, const uint8_t *nas, int nl, uint8_t *out) {
  UL_DCCH_Message_NB_t m; memset(&m, 0, sizeof m);
  m.message.present = UL_DCCH_MessageType_NB_PR_c1;
  if (kind == 0) {
    m.message.choice.c1.present = UL_DCCH_MessageType_NB__c1_PR_rrcConnectionSetupComplete_r13;
    RRCConnectionSetupComplete_NB_t *s = &m.message.choice.c1.choice.rrcConnectionSetupComplete_r13;
    s->rrc_TransactionIdentifier = 0;
    s->criticalExtensions.present = RRCConnectionSetupComplete_NB__criticalExtensions_PR_rrcConnectionSetupComplete_r13;
    RRCConnectionSetupComplete_NB_r13_IEs_t *i = &s->criticalExtensions.choice.rrcConnectionSetupComplete_r13;
    i->selectedPLMN_Identity_r13 = 1;
    OCTET_STRING_fromBuf(&i->dedicatedInfoNAS_r13, (const char *)nas, nl);
  } else if (kind == 3) {
    m.message.choice.c1.present = UL_DCCH_MessageType_NB__c1_PR_ueCapabilityInformation_r13;
    UECapabilityInformation_NB_t *s = &m.message.choice.c1.choice.ueCapabilityInformation_r13;
    s->rrc_TransactionIdentifier = 0;
    s->criticalExtensions.present = UECapabilityInformation_NB__criticalExtensions_PR_ueCapabilityInformation_r13;
    UE_Capability_NB_r13_t *c = &s->criticalExtensions.choice.ueCapabilityInformation_r13.ue_Capability_Container_r13;
    c->accessStratumRelease_r13 = 0;
    struct SupportedBand_NB_r13 *b = calloc(1, sizeof *b);
    b->band_r13 = getenv("OAI_UE_BAND") ? atoi(getenv("OAI_UE_BAND")) : 3;   /* la banda de la celda: la fija el panel */
    ASN_SEQUENCE_ADD(&c->rf_Parameters_r13.supportedBandList_r13.list, b);
  } else if (kind == 2) {
    m.message.choice.c1.present = UL_DCCH_MessageType_NB__c1_PR_rrcConnectionReconfigurationComplete_r13;
    RRCConnectionReconfigurationComplete_NB_t *s = &m.message.choice.c1.choice.rrcConnectionReconfigurationComplete_r13;
    s->rrc_TransactionIdentifier = 0;
    s->criticalExtensions.present = RRCConnectionReconfigurationComplete_NB__criticalExtensions_PR_rrcConnectionReconfigurationComplete_r13;
  } else {
    m.message.choice.c1.present = UL_DCCH_MessageType_NB__c1_PR_ulInformationTransfer_r13;
    ULInformationTransfer_NB_t *s = &m.message.choice.c1.choice.ulInformationTransfer_r13;
    s->criticalExtensions.present = ULInformationTransfer_NB__criticalExtensions_PR_ulInformationTransfer_r13;
    OCTET_STRING_fromBuf(&s->criticalExtensions.choice.ulInformationTransfer_r13.dedicatedInfoNAS_r13, (const char *)nas, nl);
  }
  asn_enc_rval_t r = uper_encode_to_buffer(&asn_DEF_UL_DCCH_Message_NB, &m, out, 400);
  return r.encoded < 0 ? -1 : (int)((r.encoded + 7) / 8);
}
static void *inj_thread(void *arg) {
  (void)arg;
  int s = socket(AF_INET, SOCK_DGRAM, 0);
  struct sockaddr_in a = { .sin_family = AF_INET, .sin_port = htons(9100), .sin_addr.s_addr = INADDR_ANY };
  if (bind(s, (struct sockaddr *)&a, sizeof a) < 0) { printf("[INJECT] no pude abrir UDP 9100\n"); return NULL; }
  printf("[INJECT] escuchando comandos en UDP 9100\n");
  char buf[2048];
  for (;;) {
    ssize_t n = recv(s, buf, sizeof buf - 1, 0);
    if (n <= 0) continue;
    buf[n] = 0;
    char cmd[4]; unsigned rnti; static char hex[1900];
    if (sscanf(buf, "%3s %x %1899s", cmd, &rnti, hex) != 3) continue;
    uint8_t nas[900], rrc[500];
    int nl = inj_hex(hex, nas, sizeof nas);
    int kind = (cmd[0] == 'S') ? 0 : (cmd[0] == 'R') ? 2 : (cmd[0] == 'U' && cmd[1] == 'C') ? 3 : 1;
    int rl = inj_encode(kind, nas, nl, rrc);
    printf("[INJECT] %s rnti=0x%x NAS %d bytes -> RRC %d bytes: ", kind == 3 ? "UECapabilityInformation" : kind == 2 ? "RRCConnectionReconfigurationComplete" : kind ? "ULInformationTransfer" : "RRCConnectionSetupComplete", rnti, nl, rl);
    for (int i = 0; i < rl; i++) printf("%02x", rrc[i]);
    printf("\n");
    if (rl <= 0) continue;
    protocol_ctxt_t ctxt;
    PROTOCOL_CTXT_SET_BY_MODULE_ID(&ctxt, 0, 1, rnti, 0, 0, 0);
    rrc_data_ind(&ctxt, kind == 0 ? 1 : 1, rl, rrc);
  }
  return NULL;
}
/* Subida de datos: cada datagrama UDP que llega al puerto 9101 es un paquete IP del dispositivo. Se entrega al GTP-U de OAI
 * exactamente como lo haría PDCP al recibir un SDU de datos (portador por defecto, rab 5), y OAI lo envía por S1-U al SGW-U. */
static void *inj_data_thread(void *arg) {
  (void)arg;
  int s = socket(AF_INET, SOCK_DGRAM, 0);
  struct sockaddr_in a = { .sin_family = AF_INET, .sin_port = htons(9101), .sin_addr.s_addr = INADDR_ANY };
  if (bind(s, (struct sockaddr *)&a, sizeof a) < 0) { printf("[INJECT] no pude abrir UDP 9101\n"); return NULL; }
  printf("[INJECT] subida de datos en UDP 9101\n");
  static uint8_t pk[2048]; unsigned long n_ul = 0;
  for (;;) {
    ssize_t n = recv(s, pk, sizeof pk, 0);
    if (n <= 0) continue;
    uint8_t *g = itti_malloc(TASK_PDCP_ENB, TASK_GTPV1_U, n + GTPU_HEADER_OVERHEAD_MAX);
    memcpy(&g[GTPU_HEADER_OVERHEAD_MAX], pk, n);
    MessageDef *m = itti_alloc_new_message(TASK_PDCP_ENB, GTPV1U_ENB_TUNNEL_DATA_REQ);
    GTPV1U_ENB_TUNNEL_DATA_REQ(m).buffer = g;
    GTPV1U_ENB_TUNNEL_DATA_REQ(m).length = n;
    GTPV1U_ENB_TUNNEL_DATA_REQ(m).offset = GTPU_HEADER_OVERHEAD_MAX;
    GTPV1U_ENB_TUNNEL_DATA_REQ(m).rnti = 0x101;
    GTPV1U_ENB_TUNNEL_DATA_REQ(m).rab_id = 5;
    itti_send_msg_to_task(TASK_GTPV1_U, INSTANCE_DEFAULT, m);
    if (++n_ul <= 3 || n_ul % 50 == 0) printf("[DATA-UL] %lu paquetes IP (%zd bytes el ultimo) -> GTP-U -> SGW-U\n", n_ul, n);
  }
  return NULL;
}
__attribute__((constructor)) static void inj_start(void) {
  if (!getenv("OAI_INJECT")) return;
  pthread_t t; pthread_create(&t, NULL, inj_thread, NULL); pthread_detach(t);
  pthread_t d; pthread_create(&d, NULL, inj_data_thread, NULL); pthread_detach(d);
}
