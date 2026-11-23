# Open5GS: qué se usa, cómo funciona por dentro y qué función interviene en cada paso

Open5GS es el núcleo de red (EPC 4G) del proyecto. Este documento va de lo general a lo concreto: qué es y qué parte se usa, sus interfaces y el procedimiento de registro, cómo está organizado su código y cómo trabajan sus procesos, hilos y colas, y qué función atiende cada paso. Las convenciones **[leído]**, **[estándar]**, **[observación]** y cómo comprobarlas en el código están en [`vision-general.md`](vision-general.md#convenciones-y-cómo-comprobar-el-código-que-se-cita). Lo que el proyecto modificó (nada del código) está en [`modificaciones-oai-open5gs.md`](modificaciones-oai-open5gs.md) §3.

## Qué es

**Open5GS** es una implementación **de código abierto, escrita en C**, de los núcleos de red **4G (EPC)** y **5G (5GC)** según 3GPP. Es mantenido principalmente por Sukchan Lee y una comunidad, y se usa mucho en redes privadas, laboratorios y proyectos de investigación. Su licencia es AGPL-3.0 (comprobado en el `LICENSE` del código que usa el proyecto). Aquí se usa la versión **v2.7.5**.

No contiene radio ni estación base: solo el núcleo. Por eso necesita un eNB aparte (aquí OAI, o srsRAN en las pruebas virtuales).

## Open5GS: qué partes se usan

Open5GS implementa a la vez el núcleo 4G (EPC) y el 5G (5GC). Este proyecto usa **solo el EPC**, porque la rama de NB-IoT de OAI se apoya en 4G (S1AP). La imagen compila el repositorio completo, de modo que los binarios 5G existen (`open5gs-nrfd`, `amfd`, `udmd`…) pero no se arrancan.

| Función EPC | Binario de Open5GS | Archivo de configuración | Qué hace aquí |
|---|---|---|---|
| MME | `open5gs-mmed` | `config/open5gs/mme.yaml` | Acepta al eNB (S1 Setup), autentica al UE, negocia seguridad NAS, pide la sesión, hace paging |
| HSS | `open5gs-hssd` | `hss.yaml` | Entrega vectores de autenticación (Milenage) y el perfil del suscriptor; lee MongoDB |
| SGW-C | `open5gs-sgwcd` | `sgwc.yaml` | Control del Serving GW: S11 con el MME, S5-C con el PGW-C, PFCP con el SGW-U |
| SGW-U | `open5gs-sgwud` | `sgwu.yaml` | Reenvía GTP-U entre S1-U y S5-U |
| PGW-C | `open5gs-smfd` (modo EPC) | `pgwc.yaml` | Crea la sesión, asigna IP, consulta al PCRF por Gx, programa al PGW-U por PFCP |
| PGW-U | `open5gs-upfd` (modo EPC) | `pgwu.yaml` | Desencapsula GTP-U y entrega IP por la interfaz TUN `ogstun` |
| PCRF | `open5gs-pcrfd` | `pcrf.yaml` | Políticas por defecto (QCI 9); sin reglas dinámicas |

En el modo EPC, Open5GS reutiliza los demonios del núcleo 5G con funciones 4G: `smfd` hace de PGW-C y `upfd` de PGW-U.

### Interfaces entre funciones

| Interfaz | Entre | Protocolo | Transporte | Contenido |
|---|---|---|---|---|
| S1-MME | eNB ↔ MME | S1AP | SCTP 36412 | señalización, NAS encapsulado |
| S1-U | eNB ↔ SGW-U | GTP-U | UDP 2152 | datos de usuario |
| S6a | MME ↔ HSS | Diameter | TCP/SCTP (freeDiameter) | autenticación y perfil (AIR/AIA, ULR/ULA) |
| S11 | MME ↔ SGW-C | GTPv2-C | UDP 2123 | Create Session, Modify Bearer |
| S5-C | SGW-C ↔ PGW-C | GTPv2-C | UDP 2123 | sesión entre gateways |
| S5-U | SGW-U ↔ PGW-U | GTP-U | UDP 2152 | datos entre gateways |
| Sxa / Sxb | SGW-C ↔ SGW-U / PGW-C ↔ PGW-U | PFCP | UDP 8805 | reglas de reenvío (PDR/FAR) |
| Gx | PGW-C ↔ PCRF | Diameter | freeDiameter | políticas PCC |
| SGi | PGW-U → red de datos | IP | `ogstun` + NAT | salida hacia el broker |
| — | HSS, PGW-C, PCRF → MongoDB | MongoDB wire | TCP 27017 | `mongodb://mongo/open5gs` |

Diameter lo resuelve la biblioteca **freeDiameter**, que Open5GS compila e instala en `/usr/local/etc/freeDiameter/`. Como los contenedores tienen IP fija, el `entrypoint.sh` de la imagen reescribe en esos archivos, con `perl`, las líneas `ConnectPeer` y `ListenOn` a partir de las variables `FD_LISTEN_ON` y `FD_*_CONNECT_TO` del `compose.yaml`.

### Parámetros configurados

- **MME:** S1AP y GTP-C en `10.44.0.10`; clientes GTP-C: SGW-C `10.44.0.12` y SMF `10.44.0.14`; GUMMEI con MME group 2, code 1; TAI `001/01` TAC 1; orden de seguridad NAS: integridad `EIA2 > EIA1 > EIA0`, cifrado `EEA0 > EEA1 > EEA2`; nombre de red «Narrowcast».
- **PGW-C:** subred `10.58.0.0/16`, DNN `internet`, PFCP hacia `10.44.0.15`.
- **PGW-U:** interfaz `ogstun`; el `entrypoint.sh` la crea (`ip tuntap`), le asigna `10.58.0.1/16`, la levanta y añade una regla `iptables -t nat … MASQUERADE` para la subred de UE. Necesita `NET_ADMIN` y `/dev/net/tun`.
- **Suscriptor:** documento de la colección `subscribers` (ver [`vision-general.md`](vision-general.md#suscriptores-en-mongodb)).

### Procedimiento de registro (attach)

Resumen; el panel lo reproduce paso a paso en la pestaña **Núcleo**.

1. El UE sincroniza con el eNB, hace NPRACH y establece la conexión RRC; el *Attach Request* NAS viaja dentro de RRC.
2. El eNB lo encapsula en un `Initial UE Message` (S1AP) hacia el MME.
3. El MME pide un vector al HSS (`Authentication-Information-Request`, S6a). El HSS lee K, OPc y SQN de MongoDB, calcula con Milenage (RAND, AUTN, XRES, KASME) y responde.
4. Autenticación mutua con el UE (`Authentication Request/Response`) y *Security Mode Command* (algoritmos NAS).
5. `Update-Location` (S6a): el MME recibe el perfil (APN, QoS, AMBR).
6. `Create Session Request` (S11 → S5-C). El PGW-C consulta al PCRF (Gx), reserva una IP de `10.58.0.0/16` y programa SGW-U y PGW-U por PFCP.
7. `Create Session Response` de vuelta; el MME envía al eNB `Initial Context Setup Request` con el *Attach Accept*.
8. *Attach Complete* y `Modify Bearer` (con el TEID del eNB). El túnel GTP-U queda completo y el UE tiene IP.

En NB-IoT existen optimizaciones CIoT (por ejemplo, datos sobre NAS sin portadora S1-U). **No se han verificado con esta combinación OAI + Open5GS**; el flujo descrito es el attach convencional.

## Estructura del código fuente


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

Los servicios de Compose se llaman `mme`, `hss`, `sgwc`, `sgwu`, `pgwc`, `pgwu` y `pcrf` (la tabla de binarios y archivos está arriba).

`smfd` y `upfd` son los demonios del núcleo 5G que, si el YAML trae `gtpc`/`gtpu` y `freeDiameter` (en vez de `sbi`), **actúan como PGW-C y PGW-U** del EPC. [leído en `pgwc.yaml`: tiene `gtpc`, `pfcp`, `freeDiameter`, sin `sbi`.]

## Cómo funciona por dentro: procesos, hilos y colas

### Un proceso por función de red

Cada función del EPC es un **ejecutable independiente** con su propio `main()` (`src/main.c`, el mismo código para todas; lo que cambia es `app_initialize()`, definido en cada carpeta, p. ej. `src/mme/app-init.c`). Esto se corresponde con un contenedor por función en `compose.yaml`. Se comunican **solo por red** (sockets), nunca por memoria compartida.

Secuencia de arranque de `open5gs-mmed` [leído, `src/main.c`, `src/mme/app-init.c`, `src/mme/mme-init.c`]:

```
main()                                            (hilo principal)
 ├─ ogs_signal_init(); ogs_setup_signal_thread()
 ├─ ogs_app_initialize()                          lee el YAML (-c), crea cola, temporizadores y pollset
 ├─ app_initialize()  →  mme_initialize()
 │     ├─ ogs_app_parse_local_conf("mme")         parsea mme.yaml
 │     ├─ mme_context_init() / mme_context_parse_config()   crea pools de objetos
 │     ├─ mme_fd_init()                           arranca freeDiameter (hilos propios)
 │     ├─ mme_gtp_open()                          socket UDP 2123 (S11)
 │     ├─ s1ap_open()                             socket SCTP 36412
 │     └─ ogs_thread_create(mme_main, NULL)       ← hilo de trabajo (bucle de eventos)
 └─ ogs_signal_thread(check_signal)               el hilo principal queda esperando señales
                                                  (SIGINT/SIGTERM terminan; SIGHUP rota el log)
```

Detalle de `ogs_app_initialize()` [leído, `lib/app/ogs-init.c` líneas ~160-164]: se crean **tres objetos globales por proceso**, accesibles con `ogs_app()`:

- `ogs_app()->queue = ogs_queue_create(pool.event)`: la cola de eventos.
- `ogs_app()->timer_mgr = ogs_timer_mgr_create(pool.timer)`: el administrador de temporizadores.
- `ogs_app()->pollset = ogs_pollset_create(pool.socket)`: el conjunto de descriptores vigilados (epoll).

### Qué hilos tiene un proceso de Open5GS

| Hilo | Quién lo crea | Qué hace |
|---|---|---|
| **Principal** | el SO | Después de iniciar, solo espera señales (`ogs_signal_thread`). No procesa mensajes. |
| **`xxx_main`** (p. ej. `mme_main`) | `ogs_thread_create()` en `xxx_initialize()` | **El hilo que hace todo el trabajo del protocolo**: bucle de eventos + máquinas de estados. Uno por proceso. |
| **freeDiameter** (varios) | la biblioteca, al llamar `ogs_diam_start()` | Atienden las conexiones Diameter (S6a, Gx). Ejecutan **callbacks** (`fd_disp_register`) en sus propios hilos. Solo en MME, HSS, SMF (PGW-C) y PCRF. |
| **MongoDB (driver)** | el driver C `libmongoc` | El HSS, el SMF y el PCRF acceden a MongoDB con él (`lib/dbi/ogs-mongoc.c`: un único `mongoc_client_t`). |

Esa estructura (**un hilo de trabajo + hilos de la biblioteca Diameter**) es la clave para entender dónde hay concurrencia real.

### Las primitivas de `lib/core`

Open5GS trae una pequeña biblioteca de sistema (`lib/core`) y todo el código se apoya en ella. Es el equivalente a un mini-framework de eventos [leído]:

| Primitiva | Archivo | Implementación real | Para qué se usa |
|---|---|---|---|
| **`ogs_thread_t`** | `ogs-thread.c` | `pthread_create`; el creador espera con **mutex + variable de condición** a que el hilo confirme que arrancó (`running = true`, `cond_signal`) | Crear `xxx_main` |
| **`ogs_thread_mutex_t`**, **`ogs_thread_cond_t`** | `ogs-thread.h` | alias directos de `pthread_mutex_t` / `pthread_cond_t` | Sincronización |
| **`ogs_queue_t`** | `ogs-queue.c` | **cola circular acotada** (`void **data`, índices `in`/`out`, `nelts`, `bounds`) protegida por **un mutex (`one_big_mutex`) y dos condiciones (`not_empty`, `not_full`)** | Pasar eventos hacia el hilo de trabajo |
| **`ogs_pollset_t`** | `ogs-poll.c`, `ogs-epoll.c` | **epoll** en Linux (kqueue/select en otros SO) | Esperar sockets y temporizadores |
| **`ogs_notify`** | `ogs-notify.c` | **`eventfd`** agregado al pollset | «Despertar» al hilo desde otro hilo (`ogs_pollset_notify`) |
| **`ogs_timer_t`** | `ogs-timer.c` | árbol rojo-negro (`ogs-rbtree`) ordenado por vencimiento; `ogs_timer_mgr_next()` da el tiempo al próximo vencimiento | Reintentos, temporizadores NAS/GTP |
| **`ogs_fsm_t`** | `ogs-fsm.c` | puntero a función = estado actual; `ogs_fsm_dispatch()` lo llama; cambia de estado con `OGS_FSM_TRAN` y dispara señales `ENTRY`/`EXIT` | Máquinas de estados de cada función |
| **`ogs_pkbuf_t`** | `ogs-pkbuf.c` | buffer de paquete con cabeceras reservadas (`head`, `data`, `tail`; `push`/`pull`/`put`/`trim`) | Mensajes de red sin copiar |
| **`ogs_pool_*`** | `ogs-pool.h` | *pools* de tamaño fijo con índice y **`ogs_pool_id_t`** (identificador entero) | Objetos de contexto (eNB, UE, sesión) |
| **`ogs_sock_t`, `ogs_sockaddr_t`** | `ogs-socket.c`, `lib/sctp/` | envoltorio de sockets; SCTP con `lksctp` (kernel) o `usrsctp` (espacio de usuario) | Todas las interfaces de red |

**Semáforos:** Open5GS no usa semáforos POSIX (`sem_t`) en este camino. La sincronización es **mutex + variable de condición** (en `ogs_queue` y `ogs_thread`) y **`eventfd`** para despertar al `epoll` [leído; no hay `sem_wait`/`sem_post` en `src/` ni `lib/core`].

#### Cómo funciona la cola (`ogs_queue_push` / `ogs_queue_trypop`)

- `push` (`queue_push`): toma el mutex; si la cola está llena espera en `not_full` (o devuelve `OGS_RETRY` si es no bloqueante); escribe en `data[in]`, avanza `in` circularmente, incrementa `nelts`; si hay consumidores esperando hace `cond_signal(not_empty)`; suelta el mutex.
- `trypop`: toma el mutex; si está vacía devuelve `OGS_RETRY` sin bloquear; si no, saca de `data[out]`.
- Capacidad = `ogs_app()->pool.event` (fijada al arrancar a partir de la configuración de límites de la aplicación). `OGS_STATIC_ASSERT(OGS_EVENT_SIZE >= sizeof(mme_event_t))` en `mme-event.h` garantiza que el evento cabe en el *pool*.

### El bucle de eventos (el patrón idéntico de todas las funciones)

`mme_main()` [leído, `src/mme/mme-init.c:115-159`; HSS, UPF, SGW-C/U, SMF, PCRF tienen el mismo esqueleto]:

```c
static void mme_main(void *data) {
    ogs_fsm_t mme_sm;
    ogs_fsm_init(&mme_sm, mme_state_initial, mme_state_final, 0);

    for ( ;; ) {
        ogs_pollset_poll(ogs_app()->pollset,
                         ogs_timer_mgr_next(ogs_app()->timer_mgr));   // 1. espera sockets o el próximo timer
        ogs_timer_mgr_expire(ogs_app()->timer_mgr);                    // 2. dispara temporizadores vencidos
        for ( ;; ) {
            mme_event_t *e = NULL;
            rv = ogs_queue_trypop(ogs_app()->queue, (void**)&e);       // 3. vacía la cola de eventos
            if (rv == OGS_DONE)  goto done;
            if (rv == OGS_RETRY) break;
            ogs_fsm_dispatch(&mme_sm, e);                              // 4. máquina de estados maestra
            mme_event_free(e);
        }
    }
done:
    ogs_fsm_fini(&mme_sm, 0);
}
```

Por eso el aviso `epoll failed (EINTR)` de los registros es inofensivo: `epoll_wait` fue interrumpido por una señal y el bucle simplemente reintenta (ver `docs/operacion/puesta-en-marcha.md`).

**Idea central:** el hilo `xxx_main` es **de un solo hilo para la lógica de protocolo**. Todo mensaje que llega (socket, Diameter, temporizador) se convierte en un **evento** `mme_event_t` y se procesa **uno a uno**. Esto evita bloqueos y condiciones de carrera dentro de la lógica del MME (no necesita mutex para sus estructuras `mme_ue_t`, etc.), a cambio de que **ningún callback de socket deba hacer trabajo pesado**.

### De dónde salen los eventos (tres fuentes)

**a) Sockets, vía el pollset (mismo hilo `mme_main`).** Ejemplo S1AP [leído, `src/mme/s1ap-sctp.c`, `s1ap-path.c`, `mme-event.c`]:

1. `s1ap_open()` → `s1ap_server()` → `ogs_sctp_server(SOCK_STREAM, …)` abre el socket SCTP en la IP del MME, puerto 36412, y lo registra con `ogs_pollset_add(pollset, OGS_POLLIN, sock->fd, lksctp_accept_handler, sock)`.
2. Cuando llega una conexión del eNB, `epoll` avisa; `lksctp_accept_handler` → `s1ap_accept_handler()` hace `ogs_sock_accept()` y publica `s1ap_event_push(MME_EVENT_S1AP_LO_ACCEPT, …)` (línea del registro **`eNB-S1 accepted[...] in s1_path module`**, la que busca nuestro panel).
3. Cuando llegan datos, `s1ap_recv_handler()` hace `ogs_sctp_recvmsg()` en un `ogs_pkbuf_t`. Si el SCTP trae una **notificación** (`MSG_NOTIFICATION`: `SCTP_ASSOC_CHANGE` → `SCTP_COMM_UP`, `SCTP_SHUTDOWN_COMP`, `SCTP_COMM_LOST`) genera `MME_EVENT_S1AP_LO_SCTP_COMM_UP` o `…_LO_CONNREFUSED`; si son datos, genera `MME_EVENT_S1AP_MESSAGE` con el `pkbuf`.
4. `mme_sctp_event_push()` crea el evento con `mme_event_new(id)` y hace `ogs_queue_push(ogs_app()->queue, e)`. En el mismo hilo, así que el `push` no compite.

**b) Callbacks de freeDiameter (otro hilo → hay que cruzar entre hilos).** Cuando el MME manda un *Authentication-Information-Request* con `fd_msg_send(&req, mme_s6a_aia_cb, svg)` [leído, `mme-fd-path.c:860`], la **respuesta** se entrega en `mme_s6a_aia_cb`, ejecutado **en un hilo de freeDiameter**, no en `mme_main`. Ese callback (a) decodifica los AVP (`fd_msg_search_avp`: `ogs_diam_s6a_rand`, `…_xres`, `…_autn`, `…_kasme`), (b) crea un `MME_EVENT_S6A_MESSAGE` con el resultado en `e->s6a_message`, (c) hace `ogs_queue_push(...)` (el **mutex de la cola** protege el cruce de hilos) y (d) **`ogs_pollset_notify()`** para despertar a `mme_main` (que podría estar dormido en `epoll_wait`) mediante el `eventfd`. También usa `pthread_mutex_lock(&ogs_diam_stats_self()->stats_lock)` para contadores de estadísticas Diameter compartidos. Al final libera el mensaje con `fd_msg_free`.

**c) Temporizadores.** `ogs_timer_add(timer_mgr, callback, data)` + `ogs_timer_start(timer, duración)`; al vencer, `ogs_timer_mgr_expire()` (llamada en el bucle) ejecuta el callback, que típicamente publica un evento `*_TIMER` (por ejemplo `MME_EVENT_EMM_TIMER` para reenviar un mensaje NAS no respondido).

### Hilos y datos compartidos en el HSS (caso distinto)

El HSS [leído, `src/hss/hss-init.c`, `hss-sm.c`, `hss-s6a-path.c`] tiene también `hss_main()` con el mismo bucle, **pero** su máquina de estados casi no hace nada (solo `HSS_EVENT_DBI_POLL_TIMER`, un temporizador de 100 ms para observar cambios en MongoDB con *change stream* cuando está disponible). El trabajo real ocurre en los **callbacks Diameter**, que corren en **hilos de freeDiameter**:

- `hss_ogs_diam_s6a_air_cb()` (Authentication-Information), `hss_ogs_diam_s6a_ulr_cb()` (Update-Location), `…_pur_cb()` (Purge-UE) se registran con `fd_disp_register`.
- Dentro del callback consulta MongoDB (`ogs_dbi_auth_info()` en `lib/dbi/subscription.c`, con `mongoc_collection_find`), calcula Milenage (`milenage_generate()` en `lib/crypt/milenage.c`), arma la respuesta con `fd_msg_avp_new` y la devuelve directamente.

[observación] Es decir, en el HSS **no pasa por la cola de eventos**: varias peticiones Diameter pueden ejecutarse en paralelo en hilos distintos compartiendo el mismo cliente MongoDB. Con la carga de este proyecto (un puñado de dispositivos) no es relevante.

### Las «clases» del MME: contexto y *pools*

[leído, `src/mme/mme-context.h`, `mme-event.h`]. El estado del MME vive en estructuras en *pools* (no se usa `malloc` por mensaje), referenciadas por **IDs enteros** (`ogs_pool_id_t`) y no por punteros, para evitar usar un objeto ya liberado:

| Tipo (`struct`) | Representa | Cada instancia tiene |
|---|---|---|
| `mme_enb_t` | un eNB conectado (socket SCTP) | su `ogs_fsm_t sm` (máquina `s1ap_state_*`), `enb_id`, `max_num_of_ostreams` |
| `enb_ue_t` | el UE visto desde el eNB (ids S1AP: `enb_ue_s1ap_id`, `mme_ue_s1ap_id`) | referencia a `enb_id` y a `mme_ue_t` |
| `mme_ue_t` | el UE **como suscriptor** (IMSI, claves, estado NAS) | su `ogs_fsm_t sm` (máquina `emm_state_*`), vectores de autenticación, `K_ASME`, clave NAS |
| `sgw_ue_t` | contexto del UE hacia el SGW-C | TEIDs de control |
| `mme_sess_t` | una sesión PDN/APN | referencia a bearers |
| `mme_bearer_t` | una portadora | su `ogs_fsm_t sm` (máquina `esm_state_*`), TEIDs |

El evento `mme_event_t` (`mme-event.h`) lleva **exactamente los IDs** que el despachador necesita: `enb_id`, `enb_ue_id`, `sgw_ue_id`, `mme_ue_id`, `bearer_id`, `gtp_xact_id`, más los mensajes decodificados (`s1ap_message`, `nas_message`, `s6a_message`) y el `pkbuf`.

#### Máquinas de estados anidadas (cómo se despacha)

```
mme_main → ogs_fsm_dispatch(&mme_sm, e)                  mme_state_operational()   (mme-sm.c)
   switch (e->id):
     MME_EVENT_S1AP_LO_ACCEPT / COMM_UP / CONNREFUSED →  crea o borra mme_enb_t (mme_enb_add / mme_enb_remove)
     MME_EVENT_S1AP_MESSAGE → decodifica S1AP (ogs_s1ap_decode) →
            ogs_fsm_dispatch(&enb->sm, e)                s1ap_state_operational()  (s1ap-sm.c)
                switch (procedureCode):  S1Setup → s1ap_handle_s1_setup_request()
                                         initialUEMessage → s1ap_handle_initial_ue_message()
                                         uplinkNASTransport → s1ap_handle_uplink_nas_transport() ...
     MME_EVENT_EMM_MESSAGE → ogs_fsm_dispatch(&mme_ue->sm, e)   emm_state_*()      (emm-sm.c)
     MME_EVENT_ESM_MESSAGE → ogs_fsm_dispatch(&bearer->sm, e)   esm_state_*()      (esm-sm.c)
     MME_EVENT_S6A_MESSAGE → mme_s6a_handle_aia() / _ula()                          (mme-s6a-handler.c)
     MME_EVENT_S11_MESSAGE → mme_s11_handle_create_session_response() ...           (mme-s11-handler.c)
```

Los estados EMM (`emm-sm.c`) son funciones: `emm_state_de_registered`, `emm_state_authentication`, `emm_state_security_mode`, `emm_state_initial_context_setup`, `emm_state_registered`, `emm_state_exception`. Cambiar de estado es `OGS_FSM_TRAN(s, &emm_state_registered)`; el motor llama automáticamente a la función antigua con `OGS_FSM_EXIT_SIG` y a la nueva con `OGS_FSM_ENTRY_SIG`.

### Plano de datos: el UPF no usa cola, trabaja dentro de los callbacks

El camino de los **paquetes de usuario** debe ser rápido, así que el UPF [leído, `src/upf/gtp-path.c`] **no genera eventos** para cada paquete: los procesa directamente en los callbacks del pollset (en el mismo hilo `upf_main`):

- `upf_gtp_open()` (línea ~769) abre el socket UDP 2152 (`ogs_pollset_add(..., _gtpv1_u_recv_cb, sock)`) y la interfaz TUN `ogs_tun_open("ogstun", …)` registrando `_gtpv1_tun_recv_cb` para lectura. Aplica `ogs_tun_set_ip()` con la IP del gateway.
- **Subida:** `_gtpv1_u_recv_cb(fd)` asigna un `ogs_pkbuf_t` (con `OGS_TUN_MAX_HEADROOM`), `ogs_recvfrom()` el datagrama UDP, interpreta la cabecera GTP-U (`ogs_gtp2_header_t`, TEID), busca la sesión y su **PDR/FAR**, **verifica que la IP de origen coincida con la del UE** (anti-*spoofing*: si no coincide, registra `[DROP] Source IP-4 Spoofing` y descarta), contabiliza (`upf_sess_urr_acc_add`) y escribe en la TUN con `ogs_tun_write(dev->fd, pkbuf)`.
- **Bajada:** `_gtpv1_tun_recv_cb` lee de la TUN con `ogs_tun_read()`, busca la sesión por IP de destino (`upf_sess_find_by_ue_ip_address()`), elige el PDR de bajada, y `ogs_pfcp_up_handle_pdr()` **encapsula en GTP-U** y la envía por UDP al SGW-U.
- El SGW-U (`src/sgwu/gtp-path.c`) tiene la misma forma: `_gtpv1_u_recv_cb` registrado con `ogs_pollset_add(…, OGS_POLLIN, sock->fd, _gtpv1_u_recv_cb, sock)`, que reenvía según las reglas PFCP.

Las reglas (PDR/FAR) las instala el plano de control: SMF y SGW-C envían **PFCP Session Establishment/Modification** (UDP 8805), que `upf`/`sgwu` procesan **como eventos** (esto sí pasa por `ogs_queue`, pero es señalización poco frecuente) en `n4-handler.c` / `sxa-handler.c`.

## Qué hace cada función en el flujo

### El MME: tres máquinas de estados anidadas

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

### El HSS: autenticación con Milenage y MongoDB

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

### Plano de usuario: SGW y PGW separados en control y usuario

Desde la versión 2 Open5GS separa cada pasarela en **-C** (control) y **-U** (usuario) hablando **PFCP** (UDP 8805):

- `sgwc` (`src/sgwc/`): `s11-handler.c` (con el MME, GTPv2-C), `s5c-handler.c`, `sxa-build.c`/`sxa-handler.c` (PFCP hacia `sgwu`).
- `smf` en modo PGW-C (`src/smf/`): `s5c-handler.c` → **`smf_s5c_handle_create_session_request()`** reserva la IP del UE y llama a `smf_gx_send_ccr()` (`gsm-sm.c`) para consultar al PCRF por **Gx**; después programa al UPF con `n4-build.c` (PFCP *Session Establishment*).
- `upf` en modo PGW-U (`src/upf/`): `n4-handler.c` → **`upf_n4_handle_session_establishment_request()`** instala reglas **PDR/FAR** (qué paquetes y adónde).

El reenvío real de paquetes está en `src/upf/gtp-path.c` [leído]:

- **Subida (UE → red):** `_gtpv1_u_recv_cb()` recibe GTP-U en UDP 2152, quita la cabecera GTP y hace **`ogs_tun_write()`** hacia la interfaz TUN `ogstun`.
- **Bajada (red → UE):** `_gtpv1_tun_recv_cb()` lee de `ogstun` con `ogs_tun_read()`, localiza la sesión por la IP de destino con **`upf_sess_find_by_ue_ip_address()`** (`rule-match.c`), la encapsula en GTP-U y la envía al SGW-U.
- La interfaz `ogstun` se abre con `ogs_tun_open()` (`lib/tun/linux-setup.c`, `ioctl(TUNSETIFF)`).

Aquí interviene **nuestro `docker/open5gs/entrypoint.sh`**: antes de lanzar `open5gs-upfd` crea la TUN (`ip tuntap add name ogstun mode tun`), le pone `10.58.0.1/16`, la levanta y añade `iptables -t nat … MASQUERADE` para que los paquetes de los UE salgan con la IP del contenedor. Necesita `cap_add: [NET_ADMIN]` y `/dev/net/tun` (están en `compose.yaml`).

### El truco de Diameter en contenedores

freeDiameter se configura con archivos `.conf` (`ConnectPeer`, `ListenOn`) que traen direcciones de `localhost`. En Docker cada función está en otra IP, así que el `entrypoint.sh` **reescribe esos archivos al arrancar** con `perl -0pi -e 's/ConnectPeer = "hss\.localdomain" …/'` usando variables de entorno (`FD_LISTEN_ON`, `FD_HSS_CONNECT_TO`, …) definidas en `compose.yaml`. Es código propio y es la razón de que S6a y Gx funcionen entre contenedores sin modificar Open5GS.

### Qué lee Open5GS de MongoDB

La colección `open5gs.subscribers` es la **única fuente de verdad de las SIM**. `lib/dbi/subscription.c` expone `ogs_dbi_auth_info()` (K, OPc, AMF, SQN) y `ogs_dbi_subscription_data()` (APN, QoS, AMBR). HSS, SMF y PCRF abren `db_uri: mongodb://mongo/open5gs` (visible en sus YAML). Como consultan **en cada procedimiento**, un suscriptor añadido desde nuestro panel vale en el siguiente intento de registro sin reiniciar nada.

## Interfaces de programación y protocolos que el código usa

| Interfaz | Implementación [leído] | Funciones/estructuras típicas |
|---|---|---|
| **S1AP** (eNB ↔ MME) | ASN.1 PER aligned; códec generado por `asn1c` en `lib/s1ap/`; transporte SCTP | `ogs_s1ap_decode()`, `s1ap_build_*()`, `S1AP_S1AP_PDU_t` |
| **NAS-EPS** (UE ↔ MME) | codificadores/decodificadores manuales en `lib/nas/eps/` | `ogs_nas_eps_decode/encode`, `ogs_nas_eps_message_t`; `emm-build.c` y `esm-build.c` construyen mensajes |
| **GTPv2-C** (S11, S5-C) | `lib/gtp/v2/`, **transacciones** `ogs_gtp_xact_t` con reintentos por temporizador | `ogs_gtp2_message_t`, `mme_s11_build_create_session_request()` |
| **GTP-U** (S1-U, S5-U) | `lib/gtp/`, cabecera `ogs_gtp2_header_t`; paquete en `pkbuf` | usado en `gtp-path.c` de SGW-U y UPF |
| **PFCP** (Sxa/Sxb) | `lib/pfcp/`, transacciones `ogs_pfcp_xact_t`; `n4-build.c`, `sxa-build.c` | `ogs_pfcp_up_handle_pdr()`, PDR/FAR/URR |
| **Diameter** (S6a, Gx) | `lib/diameter/` + freeDiameter; diccionario de AVP `ogs_diam_*` | `fd_msg_new`, `fd_msg_avp_new`, `fd_msg_send`, `fd_disp_register` |
| **MongoDB** | `lib/dbi/` con `libmongoc` | `ogs_dbi_auth_info()`, `ogs_dbi_subscription_data()`, `ogs_dbi_update_sqn()` |
| **Criptografía** | `lib/crypt/` | `milenage_generate()`, `ogs_auc_kasme()`, `ogs_kdf_*`, AES, SNOW3G, ZUC |
| **TUN/TAP** | `lib/tun/` | `ogs_tun_open()` (`ioctl TUNSETIFF`), `ogs_tun_read/write` |
| **SBI** (HTTP/2, REST 5G) | `lib/sbi/` | **No se usa**: es solo del núcleo 5G. Las funciones del EPC no exponen API REST. |

**Cómo están configurados:** `mme.yaml` (por ejemplo) se carga con `ogs_app_parse_local_conf("mme")`, que recorre el YAML con `libyaml`; luego `mme_context_parse_config()` convierte las claves (`s1ap`, `gtpc`, `gummei`, `tai`, `security`) en `ogs_socknode_t` y estructuras del contexto. **Cambiar el YAML cambia dónde escucha el socket y qué PLMN/TAC acepta el MME** (de ahí que deban coincidir con el `.conf` del eNB).

## Recorrido de un registro (attach) **por hilos y colas**

1. Hilo `mme_main` ← **epoll**: llega SCTP; `s1ap_recv_handler` → evento `MME_EVENT_S1AP_MESSAGE` → cola → `mme_state_operational` → `s1ap_state_operational` → `s1ap_handle_initial_ue_message` (decodifica el NAS dentro) → evento `MME_EVENT_EMM_MESSAGE` → `emm_state_de_registered` ve `ATTACH_REQUEST`.
2. El MME llama `mme_s6a_send_air()` → `fd_msg_send` (envía por Diameter y **retorna enseguida**; no bloquea).
3. **Hilo freeDiameter del HSS**: `hss_ogs_diam_s6a_air_cb` → MongoDB → Milenage → responde.
4. **Hilo freeDiameter del MME**: `mme_s6a_aia_cb` → `ogs_queue_push` + `ogs_pollset_notify`.
5. Hilo `mme_main`: evento `MME_EVENT_S6A_MESSAGE` → `mme_s6a_handle_aia()` → se envía *Authentication Request* por S1AP (`s1ap_send_to_enb_ue`, que escribe en el socket SCTP).
6. Respuesta del UE: de vuelta al paso 1 como `uplinkNASTransport`; `emm_state_authentication` compara; sigue `security_mode` → `mme_s6a_send_ulr` → … → `mme_gtp_send_create_session_request` (UDP a SGW-C, también asíncrono, con **transacción GTP** y temporizador de reintento).

Observe el patrón: **todas las llamadas de red son asíncronas**. Nunca se espera una respuesta bloqueando; se registra un callback o un estado de la FSM y se sigue procesando otros eventos. La «espera» es el propio estado de la máquina (p. ej. `emm_state_authentication`).
