# Cómo se relaciona Narrowcast-NB con OpenAirInterface y Open5GS (nivel de código)

Este documento explica **qué hace Narrowcast-NB, qué hacen por dentro OAI y Open5GS, y cómo se conectan**, hasta el nivel de archivos fuente, funciones, hilos, protocolos y archivos de configuración. Complementa a [`arquitectura.md`](arquitectura.md) (que lista versiones, IP y puertos) y a [`panel.md`](../operacion/panel.md).

Convención de honestidad técnica usada en todo el texto:

- **[leído]** lo comprobé abriendo el código fuente real que hay dentro de las imágenes Docker del proyecto (`/opt/open5gs` y `/opt/oai`) o los archivos de este repositorio.
- **[estándar]** viene de la especificación 3GPP o de cómo funciona el protocolo, no de leer una línea concreta.
- **[sin verificar]** es un supuesto que solo se confirma con hardware real.

---

## 1. La idea central: qué es nuestro y qué es de terceros

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
 │  Código propio de Narrowcast-NB (~6 000 líneas)                     │
 │                                                                      │
 │  • Orquestación: compose.yaml, 4 Dockerfiles, entrypoints            │
 │  • Traducción de configuración: plan RF → enb.conf de OAI            │
 │  • Seguridad de radio: rf-check.sh, rf-run.sh, corte por tiempo      │
 │  • Aprovisionamiento: subscriber-init.js (SIM → MongoDB)             │
 │  • Panel: FastAPI (app/main.py) + React (app/web/)                  │
 │  • Firmware ESP32 (SIM7080G + MQTT) y simulador (fake_device.py)     │
 └──────────────────────────────────────────────────────────────────────┘
```

Líneas propias medidas con `wc -l`: `app/main.py` 621, frontend React/TypeScript (`app/web/src/`) ≈2 800, simulador del Laboratorio (`app/simlab/*.py`) ≈1 100, ganchos de OAI para pruebas (`lab/oai-fakerf/`: `inject.c`, `fakedev.c`, `prepare.sh`) ≈240, `firmware` 86, `scripts/*` ≈130, `fake_device.py` 31, más YAML/Docker. [leído]

**Qué aporta el proyecto que ninguno de los dos tiene:**

1. Que OAI NB-IoT (2020, Ubuntu 16.04) **compile y corra dentro de un contenedor** hoy, fijando commit y corrigiendo `protobuf-c`.
2. Que OAI y Open5GS **se hablen entre sí** con la misma PLMN/TAC/IP sin tocar el código de ninguno.
3. Un **plan de RF validado** antes de emitir: ninguno de los dos proyectos impide transmitir.
4. Una **interfaz** que muestra, con datos reales de los registros, lo que ocurre dentro de ambos.
5. La **cadena de datos de aplicación** (sensor → NB-IoT → núcleo → MQTT → panel) que ni OAI ni Open5GS cubren: ellos solo transportan IP.

---

## 2. Open5GS por dentro

### 2.1 Qué es y qué parte usamos

Open5GS implementa el núcleo 4G (EPC) y el 5G (5GC) en C. Está organizado así [leído]:

```
open5gs/
├── lib/                  ← bibliotecas compartidas por todas las funciones de red
│   ├── core/    ogs-fsm.c ogs-poll.c ogs-epoll.c ogs-timer.c ogs-queue.c ogs-thread.c ogs-pkbuf.c ...
│   ├── s1ap/    codec ASN.1 de S1AP (generado con asn1c)
│   ├── nas/     codec de mensajes NAS (EMM/ESM)
│   ├── gtp/     GTPv1-U y GTPv2-C (v1/, v2/)
│   ├── pfcp/    PFCP (control entre -C y -U)
│   ├── diameter/ + freeDiameter (S6a, Gx, ...)
│   ├── crypt/   milenage.c, ogs-kdf.c, kasumi, snow-3g, zuc, aes, sha...
│   ├── dbi/     acceso a MongoDB: subscription.c, session.c
│   ├── tun/     linux-setup.c (ogs_tun_open con ioctl TUNSETIFF), tunio.c
│   └── sbi/ ngap/ ...   ← solo 5G; NO se usan en este proyecto
└── src/                  ← un ejecutable por función de red
    ├── mme/  hss/  sgwc/  sgwu/  smf/  upf/  pcrf/     ← EPC (los que arrancamos)
    └── amf/ ausf/ udm/ udr/ nrf/ nssf/ pcf/ ...         ← 5GC (compilados, no arrancados)
```

Open5GS compila **todo** (la imagen ejecuta `meson setup build` + `ninja`) y en `compose.yaml` solo arrancamos siete binarios EPC:

Servicios, binarios y YAML de cada función: ver la tabla de [`arquitectura.md` §3](arquitectura.md#3-open5gs-qué-partes-se-usan) (los servicios de Compose se llaman `mme`, `hss`, `sgwc`, `sgwu`, `pgwc`, `pgwu`, `pcrf`).

`smfd` y `upfd` son los demonios del núcleo 5G que, si el YAML trae `gtpc`/`gtpu` y `freeDiameter` (en vez de `sbi`), **actúan como PGW-C y PGW-U** del EPC. [leído en `pgwc.yaml`: tiene `gtpc`, `pfcp`, `freeDiameter`, sin `sbi`.]

### 2.2 Modelo de ejecución de cada función de red (idéntico en todas)

Cada binario es **un proceso** con un patrón de bucle de eventos [leído en `src/mme/mme-init.c`]:

1. `mme_initialize()` crea un hilo con `ogs_thread_create(mme_main, NULL)`.
2. `mme_main()` entra en un bucle: `ogs_pollset_poll(...)` (sobre **epoll**, `lib/core/ogs-epoll.c`) espera sockets y temporizadores.
3. Los callbacks de socket **no procesan nada**: convierten lo recibido en un *evento* (`mme_event_t`) y lo meten en una cola, `ogs_queue`.
4. El bucle saca eventos con `ogs_queue_trypop(...)` y los despacha con `ogs_fsm_dispatch(&mme_sm, e)` a una **máquina de estados finita** (`lib/core/ogs-fsm.c`).

Los tipos de evento del MME están en `src/mme/mme-event.h` [leído]: `MME_EVENT_S1AP_MESSAGE`, `MME_EVENT_EMM_MESSAGE`, `MME_EVENT_ESM_MESSAGE`, `MME_EVENT_S6A_MESSAGE`, `MME_EVENT_S11_MESSAGE`, más sus `*_TIMER`. Es decir, **cada interfaz del EPC es una fuente de eventos hacia una máquina de estados**.

> Esto explica el aviso `epoll failed (EINTR)` que sale en los registros: `epoll_wait` fue interrumpido por una señal; el bucle reintenta. Es inofensivo (documentado en `docs/operacion/puesta-en-marcha.md`).

### 2.3 El MME: tres máquinas de estados anidadas

El MME (`src/mme/`) es el componente más importante para entender el *attach* [leído]:

| Archivo | Máquina de estados | Qué decide |
|---|---|---|
| `mme-sm.c` | `mme_state_operational` | Reparte cada evento al subsistema correcto (S1AP, EMM, ESM, S6A, S11) |
| `s1ap-sm.c` | `s1ap_state_operational` | Una por **eNB**: según el `ProcedureCode` S1AP (`S1Setup`, `initialUEMessage`, `uplinkNASTransport`, `InitialContextSetup`, …) llama a su función `s1ap_handle_*` |
| `emm-sm.c` | `emm_state_de_registered → authentication → security_mode → initial_context_setup → registered` (+ `exception`) | Una por **UE**: la gestión de movilidad/registro NAS (Attach, TAU, Detach) |
| `esm-sm.c` | estados ESM | Una por **sesión/portadora**: gestión de sesión (PDN connectivity) |

Funciones concretas que importan [leído en `s1ap-handler.c` y `emm-sm.c`]:

- **`s1ap_handle_s1_setup_request()`**: decodifica el `Global_ENB_ID` y la lista de TAC soportados; rechaza con `s1ap_send_s1_setup_failure()` si la PLMN del eNB es ajena (`enb_plmn_id_is_foreign`) o si el TAI no está configurado (`served_tai_is_found`, con el aviso literal «Check 'mme.tai' configuration»); si todo cuadra, `s1ap_send_s1_setup_response()` y en el registro aparece **`eNB-S1 accepted`**. *Esa es la línea que busca nuestro panel (`/api/enb`) y `validate.sh` para decir que el eNB está conectado.*
- **`s1ap_handle_initial_ue_message()`**: es el primer mensaje del UE; extrae el NAS (Attach Request) y genera `MME_EVENT_EMM_MESSAGE`.
- **`emm_state_registered` / `emm_state_de_registered`**: ante `OGS_NAS_EPS_ATTACH_REQUEST` llama a **`mme_s6a_send_air()`** (pide el vector de autenticación al HSS).
- **`emm_state_authentication`**: espera `OGS_NAS_EPS_AUTHENTICATION_RESPONSE`.
- **`emm_state_security_mode`**: al recibir `SECURITY_MODE_COMPLETE` llama a **`mme_s6a_send_ulr()`** (Update-Location) y, con el perfil recibido, **`mme_gtp_send_create_session_request()`**.
- **`emm_state_initial_context_setup`**: espera `OGS_NAS_EPS_ATTACH_COMPLETE`.

Los parámetros de `mme.yaml` que escribimos se convierten en esas condiciones: `tai` y `gummei` alimentan `served_tai_is_found`/`enb_plmn_id_is_foreign`; `security.integrity_order` / `ciphering_order` son el orden de preferencia con el que el MME elige el algoritmo NAS en el *Security Mode Command* (EIA2/EEA…).

### 2.4 El HSS: autenticación con Milenage y MongoDB

El HSS (`src/hss/`) responde por **Diameter S6a** (`hss-s6a-path.c`). Cada comando es un callback de freeDiameter [leído]:

| Callback | Comando S6a | Qué hace |
|---|---|---|
| `hss_ogs_diam_s6a_air_cb` | Authentication-Information (AIR/AIA) | Genera un **vector de autenticación** |
| `hss_ogs_diam_s6a_ulr_cb` | Update-Location (ULR/ULA) | Entrega el perfil (APN, QoS, AMBR) con `hss_s6a_avp_add_subscription_data` |
| `hss_ogs_diam_s6a_pur_cb` | Purge-UE | Libera el registro |

Dentro de `hss_ogs_diam_s6a_air_cb` el cálculo criptográfico es este [leído]:

```
ogs_dbi_auth_info(imsi, &auth_info)          ← lib/dbi/subscription.c: lee K, OPc, AMF, SQN de MongoDB
milenage_opc(k, op, opc)                     ← si hay OP en vez de OPc, lo deriva
ogs_auc_sqn(...)                             ← resincronización de SQN si el UE la pidió
hss_db_update_sqn / hss_db_increment_sqn     ← escribe el nuevo SQN en MongoDB
milenage_generate(opc, amf, k, sqn, rand, autn, ik, ck, ak, xres, ...)   ← lib/crypt/milenage.c
ogs_auc_kasme(ck, ik, plmn, sqn, ak, kasme)  ← lib/crypt/ogs-kdf.c: deriva K_ASME
```

Resultado: se devuelven al MME `RAND`, `AUTN`, `XRES` y `K_ASME` dentro de AVPs (`avp_rand`, `avp_autn`, `avp_xres`, `avp_kasme`). El UE (el módulo con su SIM) calcula lo mismo con su **K** y **OPc**; si coinciden, se autentican mutuamente. **Por eso K/OPc de la SIM deben ser idénticos a los guardados en MongoDB**, que es lo que escribe nuestro aprovisionamiento.

### 2.5 Plano de usuario: SGW y PGW separados en control y usuario

Desde la versión 2 Open5GS separa cada pasarela en **-C** (control) y **-U** (usuario) hablando **PFCP** (UDP 8805):

- `sgwc` (`src/sgwc/`): `s11-handler.c` (con el MME, GTPv2-C), `s5c-handler.c`, `sxa-build.c`/`sxa-handler.c` (PFCP hacia `sgwu`).
- `smf` en modo PGW-C (`src/smf/`): `s5c-handler.c` → **`smf_s5c_handle_create_session_request()`** reserva la IP del UE y llama a `smf_gx_send_ccr()` (`gsm-sm.c`) para consultar al PCRF por **Gx**; después programa al UPF con `n4-build.c` (PFCP *Session Establishment*).
- `upf` en modo PGW-U (`src/upf/`): `n4-handler.c` → **`upf_n4_handle_session_establishment_request()`** instala reglas **PDR/FAR** (qué paquetes y adónde).

El reenvío real de paquetes está en `src/upf/gtp-path.c` [leído]:

- **Subida (UE → red):** `_gtpv1_u_recv_cb()` recibe GTP-U en UDP 2152, quita la cabecera GTP y hace **`ogs_tun_write()`** hacia la interfaz TUN `ogstun`.
- **Bajada (red → UE):** `_gtpv1_tun_recv_cb()` lee de `ogstun` con `ogs_tun_read()`, localiza la sesión por la IP de destino con **`upf_sess_find_by_ue_ip_address()`** (`rule-match.c`), la encapsula en GTP-U y la envía al SGW-U.
- La interfaz `ogstun` se abre con `ogs_tun_open()` (`lib/tun/linux-setup.c`, `ioctl(TUNSETIFF)`).

Aquí interviene **nuestro `docker/open5gs/entrypoint.sh`**: antes de lanzar `open5gs-upfd` crea la TUN (`ip tuntap add name ogstun mode tun`), le pone `10.58.0.1/16`, la levanta y añade `iptables -t nat … MASQUERADE` para que los paquetes de los UE salgan con la IP del contenedor. Necesita `cap_add: [NET_ADMIN]` y `/dev/net/tun` (están en `compose.yaml`).

### 2.6 El truco de Diameter en contenedores

freeDiameter se configura con archivos `.conf` (`ConnectPeer`, `ListenOn`) que traen direcciones de `localhost`. En Docker cada función está en otra IP, así que el `entrypoint.sh` **reescribe esos archivos al arrancar** con `perl -0pi -e 's/ConnectPeer = "hss\.localdomain" …/'` usando variables de entorno (`FD_LISTEN_ON`, `FD_HSS_CONNECT_TO`, …) definidas en `compose.yaml`. Es código propio y es la razón de que S6a y Gx funcionen entre contenedores sin modificar Open5GS.

### 2.7 Qué lee Open5GS de MongoDB

La colección `open5gs.subscribers` es la **única fuente de verdad de las SIM**. `lib/dbi/subscription.c` expone `ogs_dbi_auth_info()` (K, OPc, AMF, SQN) y `ogs_dbi_subscription_data()` (APN, QoS, AMBR). HSS, SMF y PCRF abren `db_uri: mongodb://mongo/open5gs` (visible en sus YAML). Como consultan **en cada procedimiento**, un suscriptor añadido desde nuestro panel vale en el siguiente intento de registro sin reiniciar nada.

---

## 3. OpenAirInterface (OAI) por dentro

### 3.1 Qué es y qué parte usamos

OAI es una implementación libre de LTE/5G que incluye eNB, UE y EPC. Nosotros usamos **solo el eNB** de la rama **`develop-nb-iot`** (commit `677bbab`, 2020), que añade NB-IoT. El EPC de OAI **no** se usa: lo reemplaza Open5GS. El ejecutable es `lte-softmodem`, que el `Dockerfile` compila con `./build_oai -I --eNB -x -w USRP`. [leído]

Árbol del código [leído], organizado por capas del modelo celular:

```
openairinterface5g/
├── openair1/                    ← CAPA FÍSICA (L1)
│   ├── PHY/LTE_TRANSPORT/       nprach_NB_IoT.c, dci_NB_IoT.c, dlsch_coding_NB_IoT.c,
│   │                            ulsch_decoding_NB_IoT.c, ulsch_demodulation_NB_IoT.c, nsss_NB_IoT.h ...
│   └── SCHED/                   phy_procedures_lte_eNb_NB_IoT.c, IF_Module_L1_primitives_NB_IoT.c
├── openair2/                    ← CAPA 2 (MAC, RLC, PDCP) y RRC
│   ├── LAYER2/MAC/              eNB_scheduler_NB_IoT.c, ..._RA_NB_IoT.c, ..._dlsch_NB_IoT.c,
│   │                            ..._ulsch_NB_IoT.c, ..._bch_NB_IoT.c, config_NB_IoT.c
│   ├── LAYER2/RLC, PDCP_v10.1.0 (compartidos con LTE)
│   ├── RRC/LITE/                rrc_*_NB_IoT.c, MESSAGES/asn1_msg_NB_IoT.c (mensajes RRC/SIB-NB)
│   ├── PHY_INTERFACE/           IF_Module_NB_IoT.c, IF_Module_L2_primitives_NB_IoT.c
│   └── ENB_APP/                 enb_config.c, enb_config_NB_IoT.c  (lectura del .conf)
├── openair3/                    ← INTERFAZ CON EL NÚCLEO
│   ├── S1AP/                    s1ap_eNB.c, s1ap_eNB_handlers.c, s1ap_eNB_nas_procedures.c ...
│   ├── SCTP/                    sctp_eNB_task.c   (transporte de S1AP)
│   └── GTPV1-U/                 gtpv1u_eNB.c, gtpv1u_task.c   (datos de usuario)
└── targets/
    ├── RT/USER/                 lte-softmodem.c, lte-enb.c    ← main() y los hilos de tiempo real
    ├── ARCH/USRP/USERSPACE/LIB/ usrp_lib.cpp                   ← puente a UHD (el USRP)
    └── PROJECTS/GENERIC-LTE-EPC/CONF/enb.nbiot.band7.tm1.50PRB.usrp210.conf   ← plantilla de config
```

**Hay más de 150 archivos con sufijo `_NB_IoT`**: la rama NB-IoT **duplica en paralelo** las estructuras de LTE (PHY, MAC, RRC) en vez de modificarlas. Eso explica por qué `lte-softmodem.c` declara a la vez `frame_parms` (LTE) y `frame_parms_NB_IoT`. [leído]

### 3.2 Hilos y tareas de `lte-softmodem`

Dos mecanismos conviven:

**a) Hilos de tiempo real de la capa física** (`targets/RT/USER/lte-enb.c`) [leído]: `eNB_thread_rxtx` (dos instancias, subtramas pares/impares), `eNB_thread_FH` (front-haul: lee/escribe muestras del USRP), `eNB_thread_single`, `eNB_thread_prach` (detecta el preámbulo de acceso aleatorio), `eNB_thread_synch`, `eNB_thread_asynch_rxtx`. Todos creados con `pthread_create` en `init_eNB_proc()`.

**b) ITTI (Inter-Task Interface)**, la mensajería interna de OAI entre tareas que no son de tiempo real [leído en `openair2/COMMON/tasks_def.h`]:

| Tarea ITTI | Archivo | Función |
|---|---|---|
| `TASK_L2L1` (subtareas `TASK_PHY_ENB`, `TASK_MAC_ENB`, `TASK_RLC_ENB`, `TASK_PDCP_ENB`) | `openair2/` y `openair1/` | Pila de radio |
| `TASK_RRC_ENB` | `openair2/RRC/LITE/` | Conexión RRC, SIB, transporte de NAS |
| `TASK_S1AP` | `openair3/S1AP/s1ap_eNB.c` (`s1ap_eNB_task`) | Señalización con el MME |
| `TASK_SCTP` | `openair3/SCTP/sctp_eNB_task.c` | Asociación SCTP con el MME |
| `TASK_GTPV1_U` | `openair3/GTPV1-U/gtpv1u_task.c` | Túnel de datos con el SGW-U |

Cada tarea tiene una cola de mensajes; se comunican con mensajes ITTI (por ejemplo `S1AP_REGISTER_ENB_REQ`, `SCTP_NEW_ASSOCIATION_REQ`).

### 3.3 Separación L1/L2 en NB-IoT: interfaz tipo FAPI

La rama NB-IoT separa PHY y MAC con una interfaz inspirada en **FAPI** (la de small cells), en `PHY_INTERFACE/IF_Module_NB_IoT.c` [leído]. Son solo dos funciones de enlace:

- **`UL_indication_NB_IoT()`** (PHY → MAC, `IF_Module_L2_primitives_NB_IoT.c`): el PHY informa de lo recibido (por ejemplo un NPRACH detectado o datos NPUSCH). Dentro llama a **`eNB_dlsch_ulsch_scheduler_NB_IoT(mac_inst, abs_subframe)`**, es decir, el **planificador MAC corre cuando llega una indicación del PHY**.
- **`schedule_response_NB_IoT()`** (MAC → PHY, `IF_Module_L1_primitives_NB_IoT.c`): el MAC le devuelve al PHY qué transmitir en la subtrama (NPDCCH, NPDSCH, SIB-NB…).

En `lte-enb.c` se asigna `eNB->if_inst->schedule_response = schedule_response_NB_IoT` para conectar ambos lados. La documentación del propio repositorio de OAI está en `targets/DOCS/NB-IoT_Docs/` (diseño del MAC NB-IoT, de un grupo de la NTUST de Taiwán).

### 3.4 Lo que ocurre cuando el eNB arranca

Secuencia de arranque [parte leída, parte estándar]:

1. `main()` en `lte-softmodem.c` lee el `.conf` con `enb_config.c` (parser libconfig): claves como `mme_ip_address`, `ENB_IPV4_ADDRESS_FOR_S1_MME`, `tracking_area_code`, `eutra_band`, `downlink_frequency`, `tx_gain`, `nprach_*`, `npdcch_*`.
2. Inicializa PHY/MAC/RRC (`init_eNB`, `init_eNB_proc`) y abre el USRP vía `usrp_lib.cpp` (`device_init`), que llama a la API de UHD: frecuencia, ganancia (`set_tx_gain`, `set_rx_gain`) y tasa de muestreo.
3. ITTI crea las tareas. **`s1ap_eNB_handle_register_eNB()`** → **`s1ap_eNB_register_mme()`** pide a `TASK_SCTP` abrir una asociación SCTP al `mme_ip_address` (puerto 36412).
4. Con la asociación establecida, el eNB envía **S1 Setup Request** con su `eNB_ID`, PLMN y TAC. El MME de Open5GS lo valida (§2.3) y responde. **Esa parte no necesita radio y ya está verificada en este proyecto** (`eNB-S1 accepted`).
5. Con radio: emite NPSS/NSSS (sincronización), NPBCH (MIB-NB) y SIB-NB; escucha NPRACH (los dispositivos piden acceso); y a partir de ahí el RRC y el MAC atienden al módulo.

### 3.5 Un hallazgo importante sobre `tx_gain` (corregido)

La cadena de código real es [leído]:

```
enb.conf: tx_gain = X
  → openair2/ENB_APP/enb_config.c      (propiedades del eNB)
  → targets/RT/USER/lte-softmodem.c    tx_gain[CC][k] = enb_properties->tx_gain   (línea ~1235)
                                       openair0_cfg[card].tx_gain[i] = tx_gain    (línea ~1454)
  → targets/ARCH/USRP/.../usrp_lib.cpp s->usrp->set_tx_gain(openair0_cfg[0].tx_gain[i], i)
```

Es decir, en esta rama **`tx_gain` del `.conf` se pasa tal cual a `set_tx_gain` de UHD como una GANANCIA, no como una atenuación**.

**Corregido:** una versión anterior de `scripts/oai-enb-start.sh` suponía lo contrario (`TX_ATT = 90 − tx_gain`), de modo que un plan de `tx_gain: 10` habría pedido 80 dB de ganancia (potencia casi máxima). Ahora el script escribe el `tx_gain` del plan sin convertir (marcador `@TX_GAIN@`). Sigue pendiente **medir la potencia real con un analizador de espectro**, porque la potencia de salida depende del modelo de USRP y de la frecuencia; hasta entonces, usar siempre cable con atenuación externa de ≥ 60 dB.

### 3.6 Limitaciones de la rama (y por qué importan)

- Es una rama de 2020, probada por sus autores con módulos Quectel BC95 y un núcleo comercial, **no con Open5GS**. Que el *attach* funcione con un módulo real es el **riesgo técnico principal** del proyecto.
- Solo compila en Ubuntu 14.04/16.04 → el `Dockerfile` usa `ubuntu:16.04`.
- Duplica estructuras NB-IoT/LTE, así que parte del flujo (por ejemplo optimizaciones CIoT del núcleo) puede no estar implementada. **Sin verificar** con esta combinación.

---

## 4. Código propio, componente por componente

### 4.1 Orquestación (`compose.yaml` + Dockerfiles)

- Una red Docker `narrowcast-nb-core` (`10.44.0.0/24`) con IP fija por contenedor. Las IP fijas son lo que permite que las configuraciones YAML de Open5GS y el `.conf` de OAI usen direcciones literales.
- **`docker/open5gs/Dockerfile`**: parte de `ubuntu:22.04` fijado por *digest*, clona Open5GS **v2.7.5** y verifica el *commit* exacto (`git rev-parse HEAD`), compila con `meson`/`ninja`, borra `.git` y `build/` para ahorrar espacio.
- **`docker/oai-nbiot/Dockerfile`**: `ubuntu:16.04`, clon superficial de OAI con verificación del *commit*; parchea con `sed` el script `build_helper` de OAI para fijar `protobuf-c v1.3.3` (el script original clona la última versión, que exige C++17); compila `lte-softmodem` con soporte USRP.
- **Perfiles de Compose**: `sim` (srsRAN virtual), `radio` (eNB OAI real). El eNB real **no arranca con `docker compose up`**; solo lo enciende el panel.

### 4.2 Aprovisionamiento de suscriptores (`provisioning/subscriber-init.js`)

Script de `mongosh` que valida (IMSI 5–15 dígitos, K/OPc de 32 hex, AMF 4 hex, SQN 12 hex) y hace `db.subscribers.updateOne(..., {upsert: true})` con **el mismo esquema** que lee `ogs_dbi_auth_info()` (§2.7). Se ejecuta una vez (`restart: "no"`) y el HSS depende de que termine bien (`service_completed_successfully`).

### 4.3 Traducción del plan RF al eNB (`scripts/oai-enb-start.sh`)

Se ejecuta **dentro** del contenedor del eNB [leído]:

1. Lee `band`, `dl_freq_hz`, `tx_gain` de `rf-plan.yaml` con `sed`.
2. Elige el desplazamiento UL–DL según la banda (`case`: B3 −95 MHz, B8 −45, B20 +41, B28 −55).
3. Reemplaza los marcadores `@BAND@`, `@DL_HZ@`, `@UL_OFFSET@`, `@TX_GAIN@`, `@MME_IP@`, `@ENB_IP@` en `config/oai/enb.nbiot.conf.tmpl` y genera `/tmp/enb.nbiot.conf`.
4. Lanza `exec lte-softmodem -O /tmp/enb.nbiot.conf -S`.

La plantilla viene de la de ejemplo de OAI. Se fijan PLMN `001/01`, TAC `1` (deben coincidir con `mme.yaml`: de lo contrario el MME rechaza el S1 Setup), 50 PRB, 1 antena, y los parámetros NB-IoT (`nprach_*`, `npdcch_*`, temporizadores `_NB`) se dejan en los de OAI.

### 4.4 Seguridad de radiofrecuencia (`rf-check.sh`, `rf-run.sh`, panel)

Ni OAI ni Open5GS impiden emitir. Nuestras barreras, **en capas**:

1. **`rf-check.sh`** valida `rf-plan.yaml`: banda en {3, 8, 20, 28}, `tx_gain` ≤ 30, modo cable con `atenuacion_db` ≥ 60 o modo antena con permiso escrito, duración 1–600 s, portadora libre confirmada, `autorizado_por` no vacío. Devuelve código ≠ 0 si algo falla.
2. **Panel** (`app/main.py`): `POST /api/radio/start` exige escribir `EMITIR`, vuelve a ejecutar `run_checks()` (invoca el mismo script), y recién entonces `docker.containers.get(...).start()`. Programa un `threading.Timer(dur, stop_radio)` que apaga el contenedor al vencer `duracion_max_s`.
3. **Apagado por defecto**: en `startup()` si el contenedor del eNB está encendido (de una sesión anterior), el panel lo detiene.
4. **Registro**: cada sesión se anota en `data/logs/rf-sessions.csv` (`log_session`).
5. **`rf-run.sh`**: envoltorio para ejecutar cualquier comando que emita con las mismas comprobaciones, `timeout` y registro.

**Lo que no hace:** medir potencia. El plan se valida, no se mide (hace falta analizador de espectro).

### 4.5 El panel (`app/main.py`, FastAPI)

Un solo proceso Python que integra **cinco fuentes** distintas en una API [leído]:

| Integración | Biblioteca | Qué hace |
|---|---|---|
| Docker | `docker` (SDK, vía `/var/run/docker.sock`) | Lista contenedores `nb-*`, enciende/apaga el eNB, lee sus registros (`c.logs(tail=…)`) |
| MongoDB | `pymongo` | CRUD de suscriptores (`/api/subscribers`); **nunca devuelve K ni OPc** (`sub_view`) |
| MQTT | `paho-mqtt` | Se suscribe a `nb/+/telemetry` y `nb/+/status`; publica comandos en `nb/<id>/cmd` con QoS 1 |
| Scripts | `subprocess` | Ejecuta `rf-check.sh` y convierte las líneas `PASS/FAIL` en JSON |
| Navegador | SSE (`/api/stream`) | Empuja eventos en vivo (telemetría, estado de radio, cambios de suscriptores) con `StreamingResponse` |

Para saber si el eNB está conectado, `/api/enb` **lee los registros del contenedor `nb-mme`** y busca la cadena `eNB-S1 accepted` (el mensaje que genera `s1ap_handle_s1_setup_request`, §2.3). Es decir, el panel observa a Open5GS a través de sus registros, sin modificarlo.

El frontend (`app/web/`) es React + TypeScript: `components/Diagram.tsx` dibuja los diagramas animados del flujo, cada pestaña es un componente de `tabs/` y `store.ts` guarda el estado global y la conexión SSE.

### 4.6 Dispositivo: firmware y simulador

- **`firmware/esp32-nbiot/esp32-nbiot.ino`** (86 líneas): el ESP32 habla por UART 2 con el SIM7080G usando **TinyGSM** (comandos AT). `attach()` envía `AT+CMNB=2` (modo NB-IoT), `AT+CBANDCFG="NB-IOT",<banda>` y `AT+COPS=1,2,"<PLMN>"` (selección manual de la red 001/01), espera registro y abre PDP/APN. Luego publica JSON por MQTT y atiende comandos `{"led":…,"interval_s":…}`. Usa un *last will* (`offline`, retenido) para que el panel detecte desconexiones. **Sin probar en hardware.**
- **`app/fake_device.py`**: simula el ESP32 publicando telemetría inventada directo al broker. Su carga incluye `"sim": true` para que el panel lo marque. **No ejercita el núcleo ni la radio.**

---

## 5. Cómo se conectan: los tres puntos de contacto

Los tres proyectos se tocan en muy pocos lugares, y todos son **interfaces estándar**, por eso se pueden combinar sin modificar el código fuente de ninguno:

| # | Punto de contacto | Protocolo | Quién habla con quién | Qué debe coincidir |
|---|---|---|---|---|
| 1 | **S1-MME** | S1AP sobre SCTP 36412 | `TASK_S1AP` de OAI ↔ `s1ap_sm` del MME | PLMN `001/01` y TAC `1` en `enb.nbiot.conf` y `mme.yaml`; IP del MME |
| 2 | **S1-U** | GTP-U sobre UDP 2152 | `TASK_GTPV1_U` de OAI ↔ `sgwu` | IP del eNB (`10.44.0.40`) |
| 3 | **Suscriptor** | Documento en MongoDB | Nuestro panel/script → HSS (vía `ogs_dbi_auth_info`) | K y OPc de la SIM = los del documento |

El plano de radio (Uu) lo gestiona solo OAI; el EPC solo ve S1.

---

## 6. Recorrido completo de un dato, con funciones

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

---

## 7. Qué está verificado y qué no

Ver la tabla única de estado en [`verificacion.md`](../referencia/verificacion.md).

---

## 8. Preguntas recurrentes

Ver [`preguntas-recurrentes.md`](../referencia/preguntas-recurrentes.md) (secciones 1, 2 y 8).
