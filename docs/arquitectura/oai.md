# OpenAirInterface (OAI): qué se usa, cómo funciona por dentro y cómo se configura

OAI es el eNB (la estación base) del proyecto. Este documento cubre qué es y por qué se usa esta rama, qué capas se emplean, su configuración, el hallazgo sobre `tx_gain`, y por dentro: tareas ITTI, hilos de tiempo real, la interfaz PHY↔MAC, el MAC de NB-IoT y el estado del código. Las convenciones **[leído]**, **[estándar]** y **[observación]** están en [`vision-general.md`](vision-general.md#convenciones-y-cómo-comprobar-el-código-que-se-cita). Lo que el proyecto modificó está en [`modificaciones-oai-open5gs.md`](modificaciones-oai-open5gs.md) §4 y §6.

## Qué es

**OpenAirInterface** es un proyecto abierto, originado en **EURECOM** (Francia) y hoy impulsado por la *OpenAirInterface Software Alliance* (OSA), que implementa **toda la pila celular en software**: eNB/gNB (estación base), UE y núcleo, para 4G y 5G, sobre hardware SDR. Es de los pocos proyectos abiertos con **capa física completa**. Se escribe en C y se organiza en `openair1` (capa física), `openair2` (MAC, RLC, PDCP, RRC) y `openair3` (interfaz con el núcleo: S1AP, SCTP, GTP-U). Su licencia es propia, la *OAI Public License v1.0* (comprobado en el `LICENSE` de la rama usada).

## La rama NB-IoT y por qué importa

OAI principal no trae NB-IoT. Hay una rama, **`develop-nb-iot`**, que lo agrega al **eNB** (no al UE ni al EPC). Su último *commit* es de 2020. Es la única implementación abierta de NB-IoT en el lado de la estación base que se conoce con capa física, y por eso se eligió, aunque con consecuencias:

- Duplica las estructuras de LTE en versiones `_NB_IoT` (más de 150 archivos), en lugar de integrarse.
- Solo compila en Ubuntu 14.04/16.04 (de ahí `ubuntu:16.04` en el Dockerfile) y exige parches menores (versión de `protobuf-c`).
- Se probó por sus autores con módulos Quectel BC95 y un núcleo comercial, **no con Open5GS**.

Esa última frase es el **principal riesgo técnico** del proyecto: S1 con Open5GS se verificó sin radio, pero que un módulo real termine el registro con esta pareja no está probado.

## Qué parte se usa

Solo el ejecutable del eNB, `lte-softmodem`; el EPC de OAI no se usa (lo reemplaza Open5GS). Para el núcleo, es un eNB cualquiera: hacia abajo habla radio NB-IoT con el módulo y hacia arriba S1AP/GTP-U con el núcleo.

Se usa la rama `develop-nb-iot` (último commit 2020), que añade NB-IoT al eNB de OAI. Solo se emplea el **eNB** (`lte-softmodem`); el EPC de OAI no se usa (lo reemplaza Open5GS).

| Capa del eNB | Papel | Particularidad en NB-IoT |
|---|---|---|
| S1AP / SCTP | señalización con el MME (puerto 36412) | `mme_ip_address` y `ENB_IPV4_ADDRESS_FOR_S1_MME` en la configuración |
| GTP-U / UDP | datos con el SGW-U (puerto 2152) | `ENB_PORT_FOR_S1U = 2152` |
| RRC | conexión, SIB-NB, transporte de NAS | `tracking_area_code`, PLMN |
| PDCP / RLC | numeración, seguridad, segmentación | portadoras SRB y DRB |
| MAC | planificación y acceso aleatorio | repeticiones para cobertura |
| PHY NB-IoT | NPSS, NSSS, NPBCH, NPDCCH, NPDSCH, NPUSCH, NPRACH | portadora de 180 kHz |
| UHD | driver del USRP | UHD 3.15 compilado en la imagen |

## Configuración y limitaciones

### Configuración del eNB

`config/oai/enb.nbiot.conf.tmpl` es una plantilla derivada de la configuración de ejemplo de OAI (`enb.nbiot.band7.tm1.50PRB.usrp210.conf`). El script `scripts/oai-enb-start.sh` la rellena y lanza el eNB:

| Marcador | Origen |
|---|---|
| `@BAND@` | `band` del plan RF (3, 8, 20 o 28) |
| `@DL_HZ@` | `dl_freq_hz` del plan RF |
| `@UL_OFFSET@` | desplazamiento UL–DL fijo por banda (B3: −95 MHz, B8: −45, B20: +41, B28: −55) |
| `@TX_GAIN@` | `tx_gain` del plan, sin convertir (ganancia en dB que OAI pasa a UHD) |
| `@MME_IP@` | `10.44.0.10` por defecto |
| `@ENB_IP@` | `10.44.0.40` por defecto |

Dos supuestos **sin verificar con el USRP real**: que `tx_gain` de OAI sea una *atenuación* respecto al máximo del equipo (válido para B210 con 90 como referencia) y que el USRP, si es USB, funcione al pasar `/dev/bus/usb` al contenedor. `rx_gain` queda fijo en 120.

Con `S1_ONLY=1` el script se salta el plan RF: sirve únicamente para probar S1 sin emitir (el eNB se detiene al no encontrar USRP) y no debe usarse para transmitir.

### Claves del `.conf` que lee OAI

`enb_config.c` (`openair2/ENB_APP`) usa **libconfig** (`config_lookup_*`) para leer el `.conf` y llenar `enb_properties` (cada clave del archivo ↔ un campo). Las claves que gestiona este proyecto: `eutra_band`, `downlink_frequency`, `uplink_frequency_offset`, `tx_gain`/`rx_gain` (aquí `rx_gain = 120`), `mme_ip_address`, `ENB_IPV4_ADDRESS_FOR_S1_MME`, `ENB_IPV4_ADDRESS_FOR_S1U`, `ENB_PORT_FOR_S1U`, `tracking_area_code`, `mobile_country_code`, `mobile_network_code`, `N_RB_DL`, y los parámetros NB-IoT (`nprach_*`, `npdcch_*`). El script `scripts/oai-enb-start.sh` rellena una plantilla con marcadores `@BAND@`, `@DL_HZ@`, etc.

### Limitaciones conocidas

- La rama marca funciones de subida como no conformes con 3GPP y se probó con módulos Quectel BC95 y un núcleo Nokia, no con Open5GS. Compilar no garantiza que el módulo se registre. Plan B: la rama `nb-iot-ubuntu24`.
- Solo compila en Ubuntu 14.04/16.04: de ahí la imagen base `ubuntu:16.04`.
- Se corrigió en el `Dockerfile` la versión de `protobuf-c` (v1.3.3), porque el script de OAI clona la última, que exige C++17.

## Árbol del código

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

## Por dentro: el ejecutable, ITTI e hilos

### Qué es el ejecutable que usamos

`lte-softmodem` (`targets/RT/USER/lte-softmodem.c`, ~2 200 líneas; `lte-enb.c`, ~2 350 líneas). Es **un solo proceso** con **muchos hilos** y arquitectura de dos mundos que conviven:

- **Capa física en tiempo real**: hilos de POSIX (`pthread`) con prioridad `SCHED_FIFO`, sincronizados con **mutex + variable de condición**, ligados a la llegada de muestras del USRP.
- **Capas altas (RRC, S1AP, SCTP, UDP, GTP-U)**: **tareas ITTI** (cada una es también un `pthread`) que se comunican por **mensajes** en colas.

Licencia: *OAI Public License v1.0* (archivo `LICENSE` de la rama). En `cmake_targets/CMakeLists.txt` las opciones `ENABLE_ITTI` y `ENABLE_USE_MME` («eNB conectado a un MME, interfaz S1-C») vienen activadas por defecto; son las que incluyen estos subsistemas.

### Arranque de `main()` (resumen)

[leído, `targets/RT/USER/lte-softmodem.c`, `main()` desde la línea 1472]:

1. `set_latency_target()`; lectura de opciones de línea de comandos (`-O <archivo .conf>`, `-S`, etc.).
2. `itti_init(TASK_MAX, THREAD_MAX, …, tasks_info, …)` (~l.1601): crea las colas y los `eventfd` de todas las tareas.
3. Lee el `.conf` (`enb_config.c`, biblioteca **libconfig**) → estructura `enb_properties`; llena `frame_parms` y `frame_parms_NB_IoT` (PRB, antenas, banda, `Nid_cell`).
4. Inicializa capa 2: `l2_init(...)` (LTE) y **`l2_init_eNB_NB_IoT()`** (`openair2/LAYER2/MAC/main_NB_IoT.c`), «complementaria» a la inicialización LTE.
5. `create_tasks()` (`targets/COMMON/create_tasks.c`): crea las tareas ITTI (ver «Cómo se registra el eNB en el MME»).
6. `init_eNB(...)` (en `lte-enb.c`): crea las estructuras PHY, abre el USRP, registra el módulo de interfaz L1/L2 y **crea los hilos de tiempo real** (ver «Los hilos de tiempo real de la capa física»).
7. `mlockall(MCL_CURRENT | MCL_FUTURE)` (fija memoria para evitar fallos de página en tiempo real).
8. Espera 3 s, y hace `pthread_cond_broadcast(&sync_cond)` con `sync_var = 0`: es la **«señal de largada»** que libera a todos los hilos de tiempo real, que esperaban en `wait_sync()`.
9. `itti_wait_tasks_end()`: el hilo principal queda esperando; `signal(SIGINT, …)` provoca la terminación ordenada.

### ITTI: la mensajería entre tareas

ITTI (*Inter-Task Interface*, `common/utils/itti/intertask_interface.c`) es el mecanismo de comunicación entre las capas altas de OAI. Está construido así [leído]:

| Elemento | Implementación |
|---|---|
| **Cola de mensajes por tarea** | cola **sin bloqueo (lock-free)** de la biblioteca **liblfds611** (`lfds611_queue_enqueue`/`dequeue`) |
| **Aviso al receptor** | **`eventfd`** creado con `EFD_SEMAPHORE` por cada tarea: es un **semáforo del kernel**. `itti_send_msg_to_task()` encola y luego hace `write(task_event_fd, &1, 8)` (equivale a *post*) |
| **Espera del receptor** | `itti_receive_msg()` llama a **`epoll_wait`** (bloqueante, o con timeout 0 en modo *polling*) sobre el `epoll_fd` de la tarea; al despertar hace `read(task_event_fd)` (equivale a *wait*) y `lfds611_queue_dequeue()` |
| **Otros descriptores** | `itti_subscribe_event_fd(task, fd)` agrega un socket al mismo `epoll` de la tarea; así la tarea SCTP espera a la vez mensajes ITTI y datos del socket |
| **Mensaje** | `MessageDef` = `MessageHeader` (`messageId`, `originTaskId`, `destinationTaskId`, `instance`, `ittiMsgSize`, `lte_time`) + unión `ittiMsg` con la carga (`s1ap_register_enb_req_t`, `sctp_data_req_t`, `gtpv1u_enb_tunnel_data_req_t`, …) |
| **Memoria** | `itti_alloc_new_message()` / `itti_free()` (reserva en *pools*, no `malloc` directo) |
| **Prioridad / hilo** | `TASK_DEF(nombre, prioridad, tamaño_cola)` en `openair2/COMMON/tasks_def.h`; cada tarea corre en su propio `pthread` creado con `itti_create_task()` |

Es decir: **semáforo (eventfd) + cola lock-free + epoll**. Es el sustituto, en OAI, de lo que Open5GS hace con mutex + cola acotada + epoll.

Tareas definidas para el eNB [leído, `tasks_def.h`, `create_tasks.c`]:

| Tarea | Hilo de | Archivo principal | Función de entrada |
|---|---|---|---|
| `TASK_L2L1` (+ subtareas `PHY_ENB`, `MAC_ENB`, `RLC_ENB`, `PDCP_ENB`) | `l2l1_task` | `lte-softmodem.c` | Espera `INITIALIZE_MESSAGE` (activa `start_eNB = 1`) y `TERMINATE_MESSAGE` |
| `TASK_ENB_APP` | `eNB_app_task` | `openair2/ENB_APP/enb_app.c` | Lee la configuración y **envía** `S1AP_REGISTER_ENB_REQ` y `RRC_CONFIGURATION_REQ` |
| `TASK_SCTP` | `sctp_eNB_task` | `openair3/SCTP/sctp_eNB_task.c` | Transporte SCTP del S1AP |
| `TASK_S1AP` | `s1ap_eNB_task` | `openair3/S1AP/s1ap_eNB.c` | Procedimientos S1AP |
| `TASK_UDP` | `udp_eNB_task` | `openair3/UDP/udp_eNB_task.c` | Sockets UDP (para GTP-U) |
| `TASK_GTPV1_U` | `gtpv1u_eNB_task` | `openair3/GTPV1-U/gtpv1u_eNB.c` | Túneles GTP-U |
| `TASK_RRC_ENB` | `rrc_enb_task` | `openair2/RRC/LITE/rrc_eNB.c` | RRC (tanto LTE como NB-IoT) |

`create_tasks()` los crea **en este orden**, con `itti_wait_ready(1)` al inicio y `itti_wait_ready(0)` al final para que todos queden listos antes de que `TASK_ENB_APP` empiece a enviar mensajes (el comentario dice «*Last task to create, others task must be ready before its start*»).

### Cómo se registra el eNB en el MME (flujo de mensajes ITTI, hilo por hilo)

[leído en `enb_app.c`, `s1ap_eNB.c`, `sctp_eNB_task.c`]

```
TASK_ENB_APP                 itti_alloc_new_message(TASK_ENB_APP, S1AP_REGISTER_ENB_REQ)
                             rellena eNB_id, tac, mcc, mnc, nb_mme, IPs  → itti_send_msg_to_task(TASK_S1AP, …)
TASK_S1AP (s1ap_eNB_task)    case S1AP_REGISTER_ENB_REQ: s1ap_eNB_handle_register_eNB()
                               → pide asociación:  SCTP_NEW_ASSOCIATION_REQ  → TASK_SCTP
TASK_SCTP (sctp_eNB_task)    sctp_handle_new_association_req():
                               socket(AF_INET, SOCK_STREAM, IPPROTO_SCTP); connect() al MME:36412
                               itti_subscribe_event_fd(TASK_SCTP, sd)       ← el socket entra al epoll de la tarea
                               → SCTP_NEW_ASSOCIATION_RESP → TASK_S1AP
TASK_S1AP                    s1ap_eNB_handle_sctp_association_resp(): arma y manda S1 SETUP REQUEST
                               → SCTP_DATA_REQ → TASK_SCTP → sctp_sendmsg()
TASK_SCTP                    en el bucle: sctp_eNB_flush_sockets() → sctp_recvmsg()
                               → SCTP_DATA_IND → TASK_S1AP  (llega S1 SETUP RESPONSE del MME)
```

Aquí está el **primer punto de contacto con Open5GS**: el `S1 Setup Request` que genera `TASK_S1AP` es el que `s1ap_handle_s1_setup_request()` del MME valida (PLMN y TAC), y la línea de registro `eNB-S1 accepted` es la prueba de que esta cadena funciona. Está **verificado sin radio** en este proyecto.

La tarea SCTP merece mención: su bucle alterna entre `itti_receive_msg()` (mensajes de otras tareas) y `sctp_eNB_flush_sockets(events, nb_events)` (datos en sockets suscritos), usando `itti_get_events()`.

### Los hilos de tiempo real de la capa física

[leído, `targets/RT/USER/lte-enb.c`, `init_eNB_proc()` desde la línea ~1808]

| Hilo | Función | Qué hace | Sincronización |
|---|---|---|---|
| **`eNB_thread_single`** o **`eNB_thread_FH` + `eNB_thread_rxtx`×2** | `eNB_thread_single()` / `eNB_thread_FH()` / `eNB_thread_rxtx()` | Bucle por **subtrama** (1 ms): recibe muestras, procesa RX, llama al MAC, genera TX. Con `single_thread_flag` se usa un solo hilo; si no, `FH` (front-haul, cada 1 ms) reparte el trabajo a dos hilos `rxtx` (subtramas pares/impares) | `mutex_rxtx` + `cond_rxtx` + contador `instance_cnt_rxtx` |
| **`eNB_thread_prach`** | `eNB_thread_prach()` | Detecta el preámbulo de acceso aleatorio: llama a **`prach_procedures_NB_IoT(eNB)`** | `mutex_prach` + `cond_prach` + `instance_cnt_prach` |
| **`eNB_thread_synch`** | `eNB_thread_synch()` | Sincronización (relevante cuando el eNB es esclavo de un RRU) | `mutex_synch` + `cond_synch` |
| **`eNB_thread_asynch_rxtx`** | `eNB_thread_asynch_rxtx()` | Procesos asíncronos (interfaz IF4p5 entre unidades remotas) | `mutex_asynch_rxtx` + `cond_asynch_rxtx` |
| hilos `fep`, `td`, `te` | `init_fep_thread`, … | Procesamiento en paralelo (transformada, decodificación turbo, codificación) cuando no se usa un solo hilo | su propio mutex + cond |
| (UHD interno) | dentro de la biblioteca UHD | Transporte de muestras con el USRP (hilos de la biblioteca) | — |

Prioridades: `thread_top_init()` y `pthread_setschedparam(..., SCHED_FIFO, sched_get_priority_max)` ponen los hilos en **tiempo real FIFO**; afinidad de CPU: la CPU 0 se reserva para UHD y la 1 para los hilos RX/TX (comentario del código, `CPU_AFFINITY`). Por esto el contenedor de OAI necesita poder usar `SCHED_FIFO` (en Linux eso normalmente exige `CAP_SYS_NICE` o `privileged`); `compose.yaml` hoy no lo declara, así que **debe comprobarse al probar con el USRP real** (si el eNB se queja de `pthread_setschedparam`, ese es el motivo).

#### El patrón de sincronización de la capa física (contador de instancias + condición)

Todos esos hilos usan **el mismo patrón**, definido por tres funciones *inline* en `openair1/PHY/defs_NB_IoT.h` (y `defs.h`) [leído]:

```c
// Hilo trabajador (espera trabajo)
wait_on_condition(&proc->mutex_rxtx, &proc->cond_rxtx, &proc->instance_cnt_rxtx, nombre);
    pthread_mutex_lock(mutex);
    while (*instance_cnt < 0)                  // -1 = «sin trabajo»
        pthread_cond_wait(cond, mutex);        // libera el mutex mientras duerme
    pthread_mutex_unlock(mutex);

// ... procesa la subtrama ...

release_thread(&proc->mutex_rxtx, &proc->instance_cnt_rxtx, nombre);
    pthread_mutex_lock(mutex);  (*instance_cnt)--;  pthread_mutex_unlock(mutex);   // vuelve a -1
```

```c
// Hilo productor (el de front-haul), `wakeup_rxtx()` en lte-enb.c
if (pthread_mutex_timedlock(&proc_rxtx->mutex_rxtx, &wait) != 0) → error
++proc_rxtx->instance_cnt_rxtx;                // 0 = «hay trabajo»
// fija frame_tx, subframe_tx = (subframe_rx + 4) % 10, timestamp_tx = timestamp_rx + 4*samples_per_tti
pthread_cond_signal(&proc_rxtx->cond_rxtx);
pthread_mutex_unlock(&proc_rxtx->mutex_rxtx);
```

Significado del contador: **−1** libre, **0** ocupado procesando. Si el productor encuentra el valor 0 (el hilo aún no terminó la subtrama anterior) espera hasta 10×500 µs (`usleep(500)`), y si sigue ocupado ejecuta **`exit_fun("TX thread busy")`**: **el eNB se aborta** porque no llegó a tiempo. Esa es la forma de OAI de decir «no cumplí el tiempo real». También se usa `pthread_mutex_timedlock` con un plazo de 5 ms. Los eventos de tiempo real **no se pierden en silencio, matan el proceso**, y por eso un PC lento o con otros procesos puede hacer fallar el eNB.

El «+4» es fundamental en LTE: lo que se recibe en la subtrama *n* determina lo que se transmite en la *n+4* (por eso el hilo `rxtx` procesa RX de *n* y TX de *n+4* en la misma iteración).

El resto de la sincronización global: `sync_cond` + `sync_mutex` + `sync_var` (la «señal de largada» de «Arranque de `main()`»), y `pthread_mutex_t UL_INFO_mutex` que protege la estructura `UL_INFO` mientras el hilo `rxtx` la rellena y llama al MAC. **No hay `sem_wait`/`sem_post` en el camino de la capa física ni en ITTI** [leído]; solo en archivos de prueba (`condtest.c`, `msg_helper.c`).

## NB-IoT en la capa física y el MAC

### El bucle por subtrama y cómo se conecta con NB-IoT

Dentro de `eNB_thread_single()` / `rxtx()` [leído, `lte-enb.c`]:

```
rx_fh(eNB, &frame, &subframe)       = rx_rf()  → trx_read_func()  lee 1 ms de muestras del USRP (bloquea hasta tenerlas)
  rxtx(eNB, proc_rxtx, nombre):
     do_prach(eNB, frame, subframe)                (si está asignado)
     phy_procedures_eNB_common_RX(eNB, proc)
     eNB->proc_uespec_rx(eNB, proc)                = phy_procedures_eNB_uespec_RX_NB_IoT   (decodifica NPUSCH, rellena UL_INFO)
     pthread_mutex_lock(&eNB->UL_INFO_mutex)
       eNB->UL_INFO.{frame,subframe,hypersfn,...} = ...
       eNB->if_inst->UL_indication(&eNB->UL_INFO)  = UL_indication_NB_IoT   ← entra el MAC
     pthread_mutex_unlock(&eNB->UL_INFO_mutex)
     eNB->proc_tx(eNB, proc, ...)                  = proc_tx_full  → (usa lo que el MAC dejó en schedule_response)
     release_thread(...)
```

**Dónde se escoge NB-IoT** [leído, `lte-enb.c` ~l.2143 y ~l.2224]: en `init_eNB()`, para `node_function = eNodeB_3GPP` (el caso de un eNB normal, ver `-O enb.nbiot...conf`):

```c
eNB->if_inst                      = IF_Module_init_NB_IoT(inst);
eNB->if_inst->schedule_response   = schedule_response_NB_IoT;
eNB->if_inst->PHY_config_req      = PHY_config_req_NB_IoT;
eNB->proc_uespec_rx               = phy_procedures_eNB_uespec_RX_NB_IoT;   // la línea LTE queda comentada
eNB->proc_tx                      = proc_tx_full;
eNB->rx_fh                        = rx_rf;
```

y en `eNB_thread_prach()` se llama a `prach_procedures_NB_IoT()`. Es decir, la rama **sustituye** punteros a función de la versión LTE por los NB-IoT: es el mecanismo de extensión de OAI (**punteros a función en el `struct PHY_VARS_eNB`**, el equivalente en C a un método virtual).

[observación] En el mismo archivo existe una función `rxtx_NB_IoT()` que está **casi toda comentada** con la nota «*Remove comments after testing phase 1*», y el hilo realmente usa `rxtx()` (la de LTE) con los punteros NB-IoT. El código de la rama es de investigación: conserva mucho código de prueba.

### La interfaz PHY ↔ MAC (estilo FAPI/nFAPI)

[leído, `openair2/PHY_INTERFACE/IF_Module_NB_IoT.h`, `.c`, `IF_Module_L2_primitives_NB_IoT.c`, `openair1/SCHED/IF_Module_L1_primitives_NB_IoT.c`]

La separación PHY/MAC usa un **struct de punteros a función** (patrón de «interfaz» en C):

```c
typedef struct IF_Module_s {
    void (*UL_indication)(UL_IND_NB_IoT_t *UL_INFO);          // PHY → MAC
    void (*schedule_response)(Sched_Rsp_NB_IoT_t *Sched_INFO);// MAC → PHY
    void (*PHY_config_req)(PHY_Config_NB_IoT_t *config_INFO); // MAC → PHY (configuración)
} IF_Module_NB_IoT_t;
```

Las estructuras de intercambio reutilizan los tipos **nFAPI** (`openair2/PHY_INTERFACE/nfapi_interface.h`):

- `UL_IND_NB_IoT_t`: `frame`, `subframe`, `hypersfn`, `nrach_ind` (preámbulos detectados: `initial_sc`, `nrach_ce_level`, `timing_advance`), `nb_harq_ind`, `RX_NPUSCH` (PDUs de datos), `crc_ind`.
- `Sched_Rsp_NB_IoT_t`: punteros a `DL_req`, `UL_req`, `HI_DCI0_req`, `TX_req` (qué transmitir: NPDCCH/DCI, NPDSCH, MIB-NB/SIB).

Cómo se ejecutan, **en el mismo hilo** (no es una cola, es una llamada de función):

```
hilo rxtx → UL_indication_NB_IoT(UL_INFO)                              (IF_Module_L2_primitives_NB_IoT.c)
              ├─ si hay preámbulo (nrach_ind.number_of_initial_scs_detected > 0) → init_RA_NB_IoT(...)
              ├─ procesa RX_NPUSCH (Msg3 / datos) → receive_msg3_NB_IoT / mac_rlc_data_ind / rrc_data_ind
              ├─ abs_subframe = hypersfn*10240 + frame*10 + subframe + 4
              ├─ eNB_dlsch_ulsch_scheduler_NB_IoT(mac_inst, abs_subframe)   ← planifica 4 subtramas adelante
              └─ mac_inst->if_inst_NB_IoT->schedule_response(&mac_inst->Sched_INFO)  → schedule_response_NB_IoT()
                                                                                         (L1: carga lo que debe transmitirse)
```

Es decir: **el planificador MAC no tiene hilo propio**: corre **dentro del hilo de tiempo real de la PHY**, disparado por la llegada de cada subtrama (`UL_indication` actúa de «tic»). Por eso el MAC debe ser rápido.

### El MAC de NB-IoT

[leído, `openair2/LAYER2/MAC/*_NB_IoT.c`]

| Archivo | Función principal |
|---|---|
| `main_NB_IoT.c` | `l2_init_eNB_NB_IoT()`, `mac_top_init_eNB_NB_IoT()`, `init_mac_NB_IoT()` |
| `eNB_scheduler_NB_IoT.c` | `eNB_dlsch_ulsch_scheduler_NB_IoT()`: calcula banderas de qué planificar (`eNB_scheduler_computing_flag_NB_IoT`), reserva recursos del NPRACH según `nprach_Periodicity`, llama a `schedule_RA_NB_IoT()`, programa búsqueda común (`flag_css_type1/2`) y específica de usuario (`schedule_uss_NB_IoT`), MIB/SIB1 |
| `eNB_scheduler_RA_NB_IoT.c` | Acceso aleatorio: `init_RA_NB_IoT()`, `schedule_rar_NB_IoT()` (Msg2), `receive_msg3_NB_IoT()`, `schedule_msg4_NB_IoT()`, `receive_msg4_ack_NB_IoT()` |
| `eNB_scheduler_bch_NB_IoT.c` | MIB-NB (NPBCH) |
| `eNB_scheduler_dlsch_NB_IoT.c`, `…_ulsch_NB_IoT.c` | Datos de bajada y subida |
| `output_handler_NB_IoT.c` | Traduce las decisiones del planificador a las estructuras nFAPI de salida |
| `config_NB_IoT.c` | Parámetros NB-IoT (NPRACH, NPDCCH, temporizadores) desde la configuración |

El acceso aleatorio NB-IoT sigue los 4 mensajes estándar: **Msg1** (preámbulo NPRACH) → **Msg2** (respuesta, `fill_rar_NB_IoT`) → **Msg3** (RRC Connection Request en NPUSCH) → **Msg4** (resolución de contención, `fill_msg4_NB_IoT`).

## RRC, S1AP, GTP-U y el acceso a la radio

### RRC, S1AP y GTP-U: su conexión con las capas bajas

- **RRC** (`openair2/RRC/LITE/rrc_eNB.c`, `rrc_common_NB_IoT.c`, `L2_interface_NB_IoT.c`): `rrc_enb_task()` es la tarea ITTI. Para NB-IoT existen funciones como `rrc_eNB_process_RRCConnectionSetupComplete_NB_IoT()`, que al recibir el *RRCConnectionSetupComplete-NB* activa SRB1bis/SRB1 y, **si hay MME (`EPC_MODE_ENABLED`)**, llama a **`rrc_eNB_send_S1AP_NAS_FIRST_REQ()`**. Esta función envía el mensaje ITTI `S1AP_NAS_FIRST_REQ` a `TASK_S1AP`, que lo convierte en el *Initial UE Message* hacia el MME. Los NAS de bajada vuelven como `S1AP_DOWNLINK_NAS` / `S1AP_INITIAL_CONTEXT_SETUP_REQ`, procesados con `rrc_eNB_process_S1AP_DOWNLINK_NAS()` y similares. **Este es el puente entre la radio NB-IoT y el núcleo.** [observación] El comentario del código junto a esa llamada dice que no existían «funciones S1AP» específicas de NB-IoT, es decir, se reutiliza el camino LTE; cualquier diferencia de los mensajes S1AP de NB-IoT (por ejemplo, el tipo de RAT) que Open5GS espere no está verificada.
- **PDCP/RLC**: se reutilizan de LTE (`LAYER2/PDCP_v10.1.0`, `RLC`). `mac_rlc_data_ind()` (MAC→RLC) y `rrc_data_ind()` (hacia RRC).
- **GTP-U** (`openair3/GTPV1-U/gtpv1u_eNB.c`): `gtpv1u_eNB_task` mantiene una pila **nw-gtpv1u** de terceros (`nwGtpv1uProcessUdpReq`, `nwGtpv1uProcessUlpReq`) y **no abre su propio socket**: envía y recibe mediante la **tarea UDP** por mensajes ITTI (`UDP_DATA_REQ` hacia `TASK_UDP`, `UDP_DATA_IND` desde ella). Una tabla hash `ue_mapping` (`rnti` → `teid_eNB`/`teid_sgw`/IP del SGW) decide por qué túnel enviar. Datos de subida: el mensaje `GTPV1U_ENB_TUNNEL_DATA_REQ` llega con los bytes; se encapsulan y se envían al SGW-U (UDP 2152). Datos de bajada: `data_recv_callback` entrega a PDCP con `pdcp_data_req()`.
- **UDP** (`openair3/UDP/udp_eNB_task.c`): tarea con `epoll` y su lista de sockets protegida por `pthread_mutex_t udp_socket_list_mutex`; usa `sendto`/`recvfrom` y reenvía lo recibido con `itti_send_msg_to_task` a la tarea dueña del socket (aquí `TASK_GTPV1_U`).

### El acceso a la radio: una «interfaz» de dispositivo en C y C++

[leído, `targets/ARCH/COMMON/common_lib.h`, `targets/ARCH/USRP/USERSPACE/LIB/usrp_lib.cpp`]

OAI abstrae el hardware con `struct openair0_device_t` (en C), que es una **tabla de punteros a función**:

```c
struct openair0_device_t {
    int (*trx_start_func)(openair0_device *device);
    int (*trx_write_func)(openair0_device *device, openair0_timestamp ts, void **buff, int nsamps, int antenna_id, int flags);
    int (*trx_read_func) (openair0_device *device, openair0_timestamp *ts, void **buff, int nsamps, int antenna_id);
    int (*trx_set_freq_func)(openair0_device *device, openair0_config_t *cfg, int dump);
    int (*trx_stop_func)(openair0_device *device);
    ...
};
int openair0_device_load(openair0_device *device, openair0_config_t *cfg);   // elige la implementación (USRP, ExpressMIMO, ...)
```

La implementación USRP (`usrp_lib.cpp`, **C++**) rellena esos punteros con funciones `trx_usrp_*` y usa la API de **UHD**:

| OAI | UHD (C++) |
|---|---|
| `device_init()` | `uhd::device::find(args)`, `uhd::usrp::multi_usrp::make(args)` (objeto), `set_clock_source("internal"/"external")`, `set_master_clock_rate(...)`, `set_rx_rate/tx_rate` |
| `trx_usrp_start()` | `uhd::stream_cmd_t(STREAM_MODE_START_CONTINUOUS)` con `time_spec` = ahora + 50 ms; `issue_stream_cmd` |
| `trx_usrp_read()` | `rx_stream->recv(buff, nsamps, rx_md)`; devuelve el **timestamp** de la primera muestra |
| `trx_usrp_write()` | `tx_md.time_spec = time_spec_t::from_ticks(timestamp, sample_rate)`; `tx_stream->send(buff, nsamps, tx_md, 1e-3)` |
| ganancia y frecuencia | `usrp->set_tx_gain(cfg.tx_gain[0])` (línea ~345), `set_rx_gain(rx_gain - rx_gain_offset)` (~353), `set_tx_freq`, `set_rx_freq` (~285) |

**Los timestamps** son lo que mantiene todo sincronizado: la capa física pide muestras y las envía con una **marca de tiempo** en ticks del reloj de muestreo. La transmisión se programa para un instante futuro exacto (`from_ticks`), y las muestras de TX de la subtrama *n+4* se entregan con un `timestamp_tx = timestamp_rx + 4 * samples_per_tti`.

Aquí está el **segundo punto de contacto «físico»**: la línea `set_tx_gain(openair0_cfg[0].tx_gain[0])` es la que recibe el `tx_gain` del plan RF (ver «Un hallazgo sobre `tx_gain`» más abajo): es una **ganancia** y no una atenuación.

## Un hallazgo sobre `tx_gain`

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

## Observaciones sobre el estado del código de la rama NB-IoT

Resultado de leer el código, útil para responder con honestidad cuánto cubre esta rama. **[observación]**, a confirmar con hardware:

1. **El MAC NB-IoT usa estado global e identificador temporal fijo.** `UE_state_machine` es una variable global (`vars_NB_IoT.h:143`, valores `initial_access`, `rach_for_auth_rsp`, `rach_for_next`, `rach_for_TAU`) que gobierna el tratamiento de los mensajes de subida en `eNB_scheduler_ulsch_NB_IoT.c:280-335` y en `UL_indication_NB_IoT()`. El RNTI temporal es `static uint16_t tc_rnti = 0x0101` (`eNB_scheduler_RA_NB_IoT.c:112`) y su incremento está comentado (`//tc_rnti++`, línea 305). Además el bucle de preámbulos procesa **solo el primero** de cada indicación (`for(i=0;i<1;i++)`). Matiz: el acceso aleatorio sí admite varios procedimientos en curso (`RA_template[MAX_NUMBER_OF_UE_MAX_NB_IoT]`), así que el límite no es «un solo UE» literal. Consecuencias probables: (a) con varios dispositivos habría colisión de identificador y estado compartido; (b) incluso con uno, el MAC espera una **secuencia de mensajes concreta** (probablemente la de los equipos con que lo probaron sus autores) y otro orden podría dejar mal la dirección de planificación; (c) un segundo acceso tras reinicio o PSM podría fallar hasta reiniciar el eNB. Ninguna de las tres está comprobada con hardware. Es el mayor riesgo técnico de la combinación OAI+Open5GS.
2. **Hay código de simulación desactivado** (`simulate_preamble`, `simulate_msg3`, `enable_preamble_simulation(UL_INFO, 0)`): el último parámetro `0` los mantiene apagados. Es para pruebas sin radio.
3. **`rxtx_NB_IoT()` está comentada** y se usa `rxtx()` con punteros a función NB-IoT (ver «El bucle por subtrama»).
4. **La rama es de 2020 y de investigación** (muchos `printf`, comentarios «testing phase»), probada por sus autores con un núcleo y módulos distintos a los de este proyecto.

Estas observaciones no invalidan el proyecto (el software integrado funciona hasta S1), pero explican por qué la prueba con módulo real es el punto crítico.
