# Cómo se integran Narrowcast-NB, OAI y Open5GS

Narrowcast-NB no reimplementa una red celular: integra dos proyectos de código abierto y añade lo que ninguno trae. Este documento explica qué es propio y qué es de terceros, en qué puntos se tocan los tres y cómo viaja un registro y un dato de punta a punta, con las funciones que intervienen. El detalle de cada proyecto está en [`open5gs.md`](open5gs.md) y [`oai.md`](oai.md); lo que se cambió, en [`modificaciones-oai-open5gs.md`](modificaciones-oai-open5gs.md); el código propio, en [`codigo-propio.md`](codigo-propio.md).

## La idea central: qué es nuestro y qué es de terceros

Narrowcast-NB **no reimplementa** una red celular. Es un **integrador y operador** de dos proyectos de código abierto que ya implementan los protocolos 3GPP, más una capa propia que los configura, los une, los protege (radio) y los observa.

```
 ┌──────────────── Código de terceros (no lo escribimos) ───────────────┐
 │                                                                      │
 │  OpenAirInterface (OAI), rama develop-nb-iot      Open5GS v2.7.5     │
 │  = el eNB: radio NB-IoT + S1AP/GTP-U              = el EPC completo  │
 │  C, ~miles de archivos, openair1/2/3              C, src/ + lib/     │
 │                                                                      │
 │  Mosquitto (broker MQTT)    MongoDB    freeDiameter (dentro de O5GS) │
 └───────────────────────────────▲──────────────────────────────────────┘
                                 │ se configuran, se compilan y se orquestan
 ┌───────────────────────────────┴──────────────────────────────────────┐
 │  Código propio de Narrowcast-NB (~5 000 líneas)                     │
 │                                                                      │
 │  • Orquestación: compose.yaml, 4 Dockerfiles, entrypoints            │
 │  • Traducción de configuración: plan RF → enb.conf de OAI            │
 │  • Seguridad de radio: rf-check.sh, rf-run.sh, corte por tiempo      │
 │  • Aprovisionamiento: subscriber-init.js (SIM → MongoDB)             │
 │  • Panel: FastAPI (app/main.py) + React (app/web/)                  │
 │  • Firmware ESP32 (SIM7080G + MQTT) y simulador (fake_device.py)     │
 └──────────────────────────────────────────────────────────────────────┘
```

Líneas propias medidas con `wc -l` (2026-11-23): `app/main.py` 621, frontend React/TypeScript (`app/web/src/`) ≈2500, simulador del Laboratorio (`app/simlab/*.py`) ≈1400, ganchos de OAI para pruebas (`lab/oai-fakerf/`) ≈380, más `firmware`, `scripts/*`, `fake_device.py` y YAML/Docker. [leído]

**Qué aporta el proyecto que ninguno de los dos tiene:**

1. Que OAI NB-IoT (2020, Ubuntu 16.04) **compile y corra dentro de un contenedor** hoy, fijando commit y corrigiendo `protobuf-c`.
2. Que OAI y Open5GS **se hablen entre sí** con la misma PLMN/TAC/IP sin tocar el código de ninguno.
3. Un **plan de RF validado** antes de emitir: ninguno de los dos proyectos impide transmitir.
4. Una **interfaz** que muestra, con datos reales de los registros, lo que ocurre dentro de ambos.
5. La **cadena de datos de aplicación** (sensor → NB-IoT → núcleo → MQTT → panel) que ni OAI ni Open5GS cubren: ellos solo transportan IP.

## Los puntos de contacto


| # | Frontera | Mecanismo | Quién escribe | Quién lee | Qué debe coincidir |
|---|---|---|---|---|---|
| 1 | **Configuración YAML** → Open5GS | archivo montado en el contenedor (`volumes` de Compose) | nuestro repo (`config/open5gs/*.yaml`) | `ogs_app_parse_local_conf()` de cada binario | PLMN, TAC, IP de cada función |
| 2 | **Configuración `.conf`** → OAI | plantilla + `sed` en `oai-enb-start.sh` | nuestro script | `enb_config.c` (libconfig) | PLMN, TAC, IP del MME y del eNB, banda y frecuencia |
| 3 | **S1AP/SCTP 36412** | red Docker `10.44.0.0/24` | `TASK_S1AP`/`TASK_SCTP` de OAI | `s1ap_state_operational` del MME | PLMN, TAC, IP |
| 4 | **GTP-U/UDP 2152** | red Docker | `TASK_GTPV1_U`/`TASK_UDP` de OAI | `_gtpv1_u_recv_cb` del SGW-U | IP del eNB, TEID (los asigna el EPC) |
| 5 | **Documento `subscribers` en MongoDB** | esquema BSON | nuestro `subscriber-init.js` y el panel (`pymongo`) | `ogs_dbi_auth_info()`/`ogs_dbi_subscription_data()` (`libmongoc`) | K y OPc iguales a los de la SIM |
| 6 | **Interfaz TUN `ogstun` + NAT** | `entrypoint.sh` crea TUN, IP y `iptables -t nat MASQUERADE` | nuestro script | `ogs_tun_open/read/write` del UPF | subred de UE `10.58.0.0/16`; necesita `NET_ADMIN` y `/dev/net/tun` |
| 7 | **freeDiameter `.conf`** | `entrypoint.sh` reescribe `ConnectPeer`/`ListenOn` con `perl` | nuestro script | freeDiameter dentro de MME/HSS/SMF/PCRF | IP fija de cada par |
| 8 | **Docker API** (`/var/run/docker.sock`) | SDK Python `docker` | el panel (`start()`/`stop()` del contenedor `nb-enb-nbiot`) | el demonio de Docker | nombre del contenedor |
| 9 | **Registros de contenedor** | `container.logs()` | los programas escriben a stdout/stderr | el panel busca `eNB-S1 accepted` | cadena exacta de Open5GS |
| 10 | **MQTT** | Mosquitto, usuario/clave | ESP32 / simulador / panel | todos | tópicos `nb/<id>/…` |
| 11 | **Inyector de OAI (laboratorio)** | UDP 9100 (comandos `SC/UT/UC/RC`) y UDP 9101 (paquetes IP de subida) | `simlab` | hilos anexados al MAC de OAI | espera de 40 s tras el arranque; rnti `0x101`, RAB 5 |
| 12 | **Relevo de bajada (laboratorio)** | UDP 9102, `OAI_RELAY_DL=ip:puerto` | gancho en `gtpv1u_eNB.c` | `simlab/net.py` | IP del módulo |
| 13 | **Contadores del UPF** | `docker exec` + `/sys/class/net/ogstun/statistics` | kernel (interfaz TUN del PGW-U) | panel (`/api/lab/upstats`) | nombre de contenedor `nb-pgwu` |

La clave de diseño: **Narrowcast-NB no enlaza código con OAI ni con Open5GS**. Los une por **configuración, red, base de datos y observación de logs**. Por eso puede usar cualquier versión de ellos siempre que hablen los mismos protocolos, y por eso no «hay que programar» el protocolo celular.

## Recorrido completo de un dato, con funciones

**A. Registro (attach)** [S1 Setup leído; el resto, estándar + funciones leídas en Open5GS]

```
Módulo                     OAI (eNB)                         Open5GS
  │ NPRACH ───────────────▶ eNB_thread_prach → MAC RA
  │ RRC Connection Setup ◀▶ TASK_RRC_ENB
  │ Attach Request (NAS) ──▶ TASK_S1AP: Initial UE Message ──▶ s1ap_handle_initial_ue_message
  │                                                             emm_state_*: ATTACH_REQUEST
  │                                                             mme_s6a_send_air ─▶ HSS: hss_ogs_diam_s6a_air_cb
  │                                                                              ogs_dbi_auth_info(MongoDB)
  │                                                                              milenage_generate + ogs_auc_kasme
  │ ◀── Authentication Request (RAND, AUTN) ◀── Downlink NAS ◀─ MME
  │ Authentication Response ─▶ Uplink NAS ──────────────────▶ emm_state_authentication (compara XRES)
  │ ◀── Security Mode Command / Complete ───────────────────▶ emm_state_security_mode
  │                                                             mme_s6a_send_ulr ─▶ HSS: hss_ogs_diam_s6a_ulr_cb
  │                                                             mme_gtp_send_create_session_request
  │                                                               ─S11▶ sgwc ─S5-C▶ smf: smf_s5c_handle_create_session_request
  │                                                                              smf_gx_send_ccr ─Gx▶ pcrf
  │                                                                              PFCP ─▶ sgwu y upf (PDR/FAR)
  │ ◀── Attach Accept (IP 10.58.x.x) ◀─ Initial Context Setup Request
  │ Attach Complete ────────▶ ... ──────────────────────────▶ emm: ATTACH_COMPLETE → registered
```

**B. Un dato de temperatura (`nb/<id>/telemetry`), ya registrado**

```
ESP32: lee DHT22 → mqtt.publish("nb/<id>/telemetry", {"temp":..})   [esp32-nbiot.ino]
  → módulo SIM7080G (NB-IoT, banda configurada)
  ~~ aire ~~ NPUSCH
  → OAI: PHY → MAC → RLC → PDCP → GTP-U (TASK_GTPV1_U)  ─UDP 2152→ sgwu
  → sgwu ─S5-U→ upf: _gtpv1u_recv_cb → ogs_tun_write(ogstun) → NAT (MASQUERADE)
  → Mosquitto 10.44.0.5:1883 (nb-mosquitto)
  → Panel (paho-mqtt on_message) → broadcast() → SSE → navegador
```

**Bajada (comando del panel al LED):** panel publica `nb/<id>/cmd` → Mosquitto → (dirección de la sesión del módulo) → `upf: _gtpv1_tun_recv_cb → upf_sess_find_by_ue_ip_address` → GTP-U → eNB → módulo → `onMessage()` del firmware.

> **Pendiente de verificar:** la **ruta de retorno** entre el broker (`10.44.0.5`) y la subred de los UE (`10.58.0.0/16`). El NAT (`MASQUERADE`) hace que el broker vea las conexiones del dispositivo como si vinieran del `pgwu`, y MQTT usa una única conexión TCP abierta por el dispositivo, así que lo esperable es que funcione en ambos sentidos. Pero no se ha probado con tráfico real.

## Resumen visual: qué proceso e hilos hay


```
CONTENEDOR nb-mme (proceso open5gs-mmed)                       CONTENEDOR nb-enb-nbiot (proceso lte-softmodem)
 ├─ hilo principal: espera señales                              ├─ hilo principal: main() → itti_wait_tasks_end()
 ├─ hilo mme_main: epoll + cola + FSM                           ├─ tareas ITTI (1 pthread c/u): L2L1, ENB_APP, SCTP, S1AP, UDP, GTPV1_U, RRC_ENB
 │     sockets: SCTP 36412, UDP 2123                            │     comunicación: mensajes ITTI (cola lock-free + eventfd + epoll)
 └─ hilos freeDiameter: callbacks S6a                           ├─ hilos de tiempo real PHY (SCHED_FIFO): single/FH/rxtx, prach, synch, asynch
        └─▶ ogs_queue_push + ogs_pollset_notify                 │     comunicación: mutex + cond + instance_cnt; llamada directa PHY→MAC→PHY
                                                                └─ hilos de UHD: muestras ↔ USRP (USB/red)
CONTENEDOR nb-hss  → hilo hss_main + hilos freeDiameter (callbacks AIR/ULR que consultan MongoDB)
CONTENEDOR nb-sgwc/pgwc → hilo xxx_main (+ freeDiameter en pgwc)       ──GTPv2-C/PFCP/Diameter por red──
CONTENEDOR nb-sgwu/pgwu → hilo xxx_main: el plano de datos corre DENTRO de los callbacks de epoll (sin cola)

CONTENEDOR nb-app (python uvicorn) → hilo asyncio + pool de hilos HTTP + hilo MQTT (paho) + hilos Timer
```
