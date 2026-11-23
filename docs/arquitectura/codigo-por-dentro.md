# El código por dentro: lenguajes, procesos, hilos, sincronización, comunicación e interfaces

Este documento explica **cómo está hecho el software** que usa Narrowcast-NB, a nivel de programación: en qué lenguaje está escrito cada componente, qué procesos e hilos crea, cómo se sincronizan, cómo se comunican las partes (colas, sockets, APIs, protocolos) y qué estructuras y funciones intervienen. Se centra en **la parte de OpenAirInterface (OAI) y de Open5GS que usa este proyecto**, y al final cubre el código propio.

Complementa a [`fundamentos.md`](../conceptos/fundamentos.md) (conceptos), [`integracion-oai-open5gs.md`](integracion-oai-open5gs.md) (qué hace cada función en el flujo) y [`arquitectura.md`](arquitectura.md) (IP, puertos).

## Cómo se obtuvo esta información (y cómo comprobarla)

Todo lo marcado como **[leído]** se comprobó abriendo el código fuente real que viene dentro de las imágenes Docker del proyecto: `/opt/open5gs` (v2.7.5) y `/opt/oai` (rama `develop-nb-iot`). Para verlo usted mismo:

```bash
docker run --rm -it narrowcast-nb/open5gs:local bash                    # código en /opt/open5gs
docker run --rm -it --entrypoint bash narrowcast-nb/oai-nbiot:local     # código en /opt/oai
```

Las rutas de archivo del texto son relativas a esas carpetas. Lo marcado **[estándar]** viene de la especificación o de la documentación de la biblioteca. **[observación]** es una conclusión mía a partir de lo leído: conviene tratarla como hipótesis hasta probarla con hardware.

Tamaño de lo que se usa (líneas de C, aproximado): MME 32 000, SMF 27 000 (incluye código 5G que no se ejecuta), HSS 5 900, SGW-C 7 600, UPF 4 200, PCRF 3 300, SGW-U 2 300. OAI aporta unos 1 850 archivos C/C++/H en `openair1`, `openair2`, `openair3`, `targets` y `common`.

---

## 1. Lenguajes y herramientas de construcción

Tabla de lenguajes y herramientas de construcción: ver [`docker-y-compilacion.md` §1](../operacion/docker-y-compilacion.md#1-lenguajes-y-herramientas-de-construcción), que reúne todos los componentes (Open5GS, códecs asn1c, freeDiameter, OAI, UHD, panel, firmware y utilitarios).

Por qué esto importa: en C no hay clases. Open5GS y OAI **simulan** la orientación a objetos con `struct` + punteros a función + convenciones de nombre (`mme_enb_t`, `mme_enb_add()`, `mme_enb_remove()`). Cuando aquí se habla de «clase» en C se refiere a ese patrón. Las clases reales (en el sentido de lenguaje) solo aparecen en el C++ del puente UHD, en el firmware (objetos `TinyGsm`, `PubSubClient`, `DHT`) y en el panel (clases `pydantic`, `FastAPI`).

---

## 2. Open5GS por dentro

### 2.1 Un proceso por función de red

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

### 2.2 Qué hilos tiene un proceso de Open5GS

| Hilo | Quién lo crea | Qué hace |
|---|---|---|
| **Principal** | el SO | Después de iniciar, solo espera señales (`ogs_signal_thread`). No procesa mensajes. |
| **`xxx_main`** (p. ej. `mme_main`) | `ogs_thread_create()` en `xxx_initialize()` | **El hilo que hace todo el trabajo del protocolo**: bucle de eventos + máquinas de estados. Uno por proceso. |
| **freeDiameter** (varios) | la biblioteca, al llamar `ogs_diam_start()` | Atienden las conexiones Diameter (S6a, Gx). Ejecutan **callbacks** (`fd_disp_register`) en sus propios hilos. Solo en MME, HSS, SMF (PGW-C) y PCRF. |
| **MongoDB (driver)** | el driver C `libmongoc` | El HSS, el SMF y el PCRF acceden a MongoDB con él (`lib/dbi/ogs-mongoc.c`: un único `mongoc_client_t`). |

Esa estructura (**un hilo de trabajo + hilos de la biblioteca Diameter**) es la clave para entender dónde hay concurrencia real.

### 2.3 Las primitivas de `lib/core`

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

### 2.4 El bucle de eventos (el patrón idéntico de todas las funciones)

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

### 2.5 De dónde salen los eventos (tres fuentes)

**a) Sockets, vía el pollset (mismo hilo `mme_main`).** Ejemplo S1AP [leído, `src/mme/s1ap-sctp.c`, `s1ap-path.c`, `mme-event.c`]:

1. `s1ap_open()` → `s1ap_server()` → `ogs_sctp_server(SOCK_STREAM, …)` abre el socket SCTP en la IP del MME, puerto 36412, y lo registra con `ogs_pollset_add(pollset, OGS_POLLIN, sock->fd, lksctp_accept_handler, sock)`.
2. Cuando llega una conexión del eNB, `epoll` avisa; `lksctp_accept_handler` → `s1ap_accept_handler()` hace `ogs_sock_accept()` y publica `s1ap_event_push(MME_EVENT_S1AP_LO_ACCEPT, …)` (línea del registro **`eNB-S1 accepted[...] in s1_path module`**, la que busca nuestro panel).
3. Cuando llegan datos, `s1ap_recv_handler()` hace `ogs_sctp_recvmsg()` en un `ogs_pkbuf_t`. Si el SCTP trae una **notificación** (`MSG_NOTIFICATION`: `SCTP_ASSOC_CHANGE` → `SCTP_COMM_UP`, `SCTP_SHUTDOWN_COMP`, `SCTP_COMM_LOST`) genera `MME_EVENT_S1AP_LO_SCTP_COMM_UP` o `…_LO_CONNREFUSED`; si son datos, genera `MME_EVENT_S1AP_MESSAGE` con el `pkbuf`.
4. `mme_sctp_event_push()` crea el evento con `mme_event_new(id)` y hace `ogs_queue_push(ogs_app()->queue, e)`. En el mismo hilo, así que el `push` no compite.

**b) Callbacks de freeDiameter (otro hilo → hay que cruzar entre hilos).** Cuando el MME manda un *Authentication-Information-Request* con `fd_msg_send(&req, mme_s6a_aia_cb, svg)` [leído, `mme-fd-path.c:860`], la **respuesta** se entrega en `mme_s6a_aia_cb`, ejecutado **en un hilo de freeDiameter**, no en `mme_main`. Ese callback (a) decodifica los AVP (`fd_msg_search_avp`: `ogs_diam_s6a_rand`, `…_xres`, `…_autn`, `…_kasme`), (b) crea un `MME_EVENT_S6A_MESSAGE` con el resultado en `e->s6a_message`, (c) hace `ogs_queue_push(...)` (el **mutex de la cola** protege el cruce de hilos) y (d) **`ogs_pollset_notify()`** para despertar a `mme_main` (que podría estar dormido en `epoll_wait`) mediante el `eventfd`. También usa `pthread_mutex_lock(&ogs_diam_stats_self()->stats_lock)` para contadores de estadísticas Diameter compartidos. Al final libera el mensaje con `fd_msg_free`.

**c) Temporizadores.** `ogs_timer_add(timer_mgr, callback, data)` + `ogs_timer_start(timer, duración)`; al vencer, `ogs_timer_mgr_expire()` (llamada en el bucle) ejecuta el callback, que típicamente publica un evento `*_TIMER` (por ejemplo `MME_EVENT_EMM_TIMER` para reenviar un mensaje NAS no respondido).

### 2.6 Hilos y datos compartidos en el HSS (caso distinto)

El HSS [leído, `src/hss/hss-init.c`, `hss-sm.c`, `hss-s6a-path.c`] tiene también `hss_main()` con el mismo bucle, **pero** su máquina de estados casi no hace nada (solo `HSS_EVENT_DBI_POLL_TIMER`, un temporizador de 100 ms para observar cambios en MongoDB con *change stream* cuando está disponible). El trabajo real ocurre en los **callbacks Diameter**, que corren en **hilos de freeDiameter**:

- `hss_ogs_diam_s6a_air_cb()` (Authentication-Information), `hss_ogs_diam_s6a_ulr_cb()` (Update-Location), `…_pur_cb()` (Purge-UE) se registran con `fd_disp_register`.
- Dentro del callback consulta MongoDB (`ogs_dbi_auth_info()` en `lib/dbi/subscription.c`, con `mongoc_collection_find`), calcula Milenage (`milenage_generate()` en `lib/crypt/milenage.c`), arma la respuesta con `fd_msg_avp_new` y la devuelve directamente.

[observación] Es decir, en el HSS **no pasa por la cola de eventos**: varias peticiones Diameter pueden ejecutarse en paralelo en hilos distintos compartiendo el mismo cliente MongoDB. Con la carga de este proyecto (un puñado de dispositivos) no es relevante.

### 2.7 Las «clases» del MME: contexto y *pools*

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

### 2.8 Plano de datos: el UPF no usa cola, trabaja dentro de los callbacks

El camino de los **paquetes de usuario** debe ser rápido, así que el UPF [leído, `src/upf/gtp-path.c`] **no genera eventos** para cada paquete: los procesa directamente en los callbacks del pollset (en el mismo hilo `upf_main`):

- `upf_gtp_open()` (línea ~769) abre el socket UDP 2152 (`ogs_pollset_add(..., _gtpv1_u_recv_cb, sock)`) y la interfaz TUN `ogs_tun_open("ogstun", …)` registrando `_gtpv1_tun_recv_cb` para lectura. Aplica `ogs_tun_set_ip()` con la IP del gateway.
- **Subida:** `_gtpv1_u_recv_cb(fd)` asigna un `ogs_pkbuf_t` (con `OGS_TUN_MAX_HEADROOM`), `ogs_recvfrom()` el datagrama UDP, interpreta la cabecera GTP-U (`ogs_gtp2_header_t`, TEID), busca la sesión y su **PDR/FAR**, **verifica que la IP de origen coincida con la del UE** (anti-*spoofing*: si no coincide, registra `[DROP] Source IP-4 Spoofing` y descarta), contabiliza (`upf_sess_urr_acc_add`) y escribe en la TUN con `ogs_tun_write(dev->fd, pkbuf)`.
- **Bajada:** `_gtpv1_tun_recv_cb` lee de la TUN con `ogs_tun_read()`, busca la sesión por IP de destino (`upf_sess_find_by_ue_ip_address()`), elige el PDR de bajada, y `ogs_pfcp_up_handle_pdr()` **encapsula en GTP-U** y la envía por UDP al SGW-U.
- El SGW-U (`src/sgwu/gtp-path.c`) tiene la misma forma: `_gtpv1_u_recv_cb` registrado con `ogs_pollset_add(…, OGS_POLLIN, sock->fd, _gtpv1_u_recv_cb, sock)`, que reenvía según las reglas PFCP.

Las reglas (PDR/FAR) las instala el plano de control: SMF y SGW-C envían **PFCP Session Establishment/Modification** (UDP 8805), que `upf`/`sgwu` procesan **como eventos** (esto sí pasa por `ogs_queue`, pero es señalización poco frecuente) en `n4-handler.c` / `sxa-handler.c`.

### 2.9 Interfaces de programación y protocolos que el código usa

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

### 2.10 Recorrido de un registro (attach) **por hilos y colas**

1. Hilo `mme_main` ← **epoll**: llega SCTP; `s1ap_recv_handler` → evento `MME_EVENT_S1AP_MESSAGE` → cola → `mme_state_operational` → `s1ap_state_operational` → `s1ap_handle_initial_ue_message` (decodifica el NAS dentro) → evento `MME_EVENT_EMM_MESSAGE` → `emm_state_de_registered` ve `ATTACH_REQUEST`.
2. El MME llama `mme_s6a_send_air()` → `fd_msg_send` (envía por Diameter y **retorna enseguida**; no bloquea).
3. **Hilo freeDiameter del HSS**: `hss_ogs_diam_s6a_air_cb` → MongoDB → Milenage → responde.
4. **Hilo freeDiameter del MME**: `mme_s6a_aia_cb` → `ogs_queue_push` + `ogs_pollset_notify`.
5. Hilo `mme_main`: evento `MME_EVENT_S6A_MESSAGE` → `mme_s6a_handle_aia()` → se envía *Authentication Request* por S1AP (`s1ap_send_to_enb_ue`, que escribe en el socket SCTP).
6. Respuesta del UE: de vuelta al paso 1 como `uplinkNASTransport`; `emm_state_authentication` compara; sigue `security_mode` → `mme_s6a_send_ulr` → … → `mme_gtp_send_create_session_request` (UDP a SGW-C, también asíncrono, con **transacción GTP** y temporizador de reintento).

Observe el patrón: **todas las llamadas de red son asíncronas**. Nunca se espera una respuesta bloqueando; se registra un callback o un estado de la FSM y se sigue procesando otros eventos. La «espera» es el propio estado de la máquina (p. ej. `emm_state_authentication`).

---

## 3. OpenAirInterface (OAI) por dentro

### 3.1 Qué es el ejecutable que usamos

`lte-softmodem` (`targets/RT/USER/lte-softmodem.c`, ~2 200 líneas; `lte-enb.c`, ~2 350 líneas). Es **un solo proceso** con **muchos hilos** y arquitectura de dos mundos que conviven:

- **Capa física en tiempo real**: hilos de POSIX (`pthread`) con prioridad `SCHED_FIFO`, sincronizados con **mutex + variable de condición**, ligados a la llegada de muestras del USRP.
- **Capas altas (RRC, S1AP, SCTP, UDP, GTP-U)**: **tareas ITTI** (cada una es también un `pthread`) que se comunican por **mensajes** en colas.

Licencia: *OAI Public License v1.0* (archivo `LICENSE` de la rama). En `cmake_targets/CMakeLists.txt` las opciones `ENABLE_ITTI` y `ENABLE_USE_MME` («eNB conectado a un MME, interfaz S1-C») vienen activadas por defecto; son las que incluyen estos subsistemas.

### 3.2 Arranque de `main()` (resumen)

[leído, `targets/RT/USER/lte-softmodem.c`, `main()` desde la línea 1472]:

1. `set_latency_target()`; lectura de opciones de línea de comandos (`-O <archivo .conf>`, `-S`, etc.).
2. `itti_init(TASK_MAX, THREAD_MAX, …, tasks_info, …)` (~l.1601): crea las colas y los `eventfd` de todas las tareas.
3. Lee el `.conf` (`enb_config.c`, biblioteca **libconfig**) → estructura `enb_properties`; llena `frame_parms` y `frame_parms_NB_IoT` (PRB, antenas, banda, `Nid_cell`).
4. Inicializa capa 2: `l2_init(...)` (LTE) y **`l2_init_eNB_NB_IoT()`** (`openair2/LAYER2/MAC/main_NB_IoT.c`), «complementaria» a la inicialización LTE.
5. `create_tasks()` (`targets/COMMON/create_tasks.c`): crea las tareas ITTI (§3.4).
6. `init_eNB(...)` (en `lte-enb.c`): crea las estructuras PHY, abre el USRP, registra el módulo de interfaz L1/L2 y **crea los hilos de tiempo real** (§3.5).
7. `mlockall(MCL_CURRENT | MCL_FUTURE)` (fija memoria para evitar fallos de página en tiempo real).
8. Espera 3 s, y hace `pthread_cond_broadcast(&sync_cond)` con `sync_var = 0`: es la **«señal de largada»** que libera a todos los hilos de tiempo real, que esperaban en `wait_sync()`.
9. `itti_wait_tasks_end()`: el hilo principal queda esperando; `signal(SIGINT, …)` provoca la terminación ordenada.

### 3.3 ITTI: la mensajería entre tareas

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

### 3.4 Cómo se registra el eNB en el MME (flujo de mensajes ITTI, hilo por hilo)

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

### 3.5 Los hilos de tiempo real de la capa física

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

El resto de la sincronización global: `sync_cond` + `sync_mutex` + `sync_var` (la «señal de largada» de §3.2), y `pthread_mutex_t UL_INFO_mutex` que protege la estructura `UL_INFO` mientras el hilo `rxtx` la rellena y llama al MAC. **No hay `sem_wait`/`sem_post` en el camino de la capa física ni en ITTI** [leído]; solo en archivos de prueba (`condtest.c`, `msg_helper.c`).

### 3.6 El bucle por subtrama y cómo se conecta con NB-IoT

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

### 3.7 La interfaz PHY ↔ MAC (estilo FAPI/nFAPI)

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

### 3.8 El MAC de NB-IoT

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

### 3.9 RRC, S1AP, GTP-U y su conexión con las capas bajas

- **RRC** (`openair2/RRC/LITE/rrc_eNB.c`, `rrc_common_NB_IoT.c`, `L2_interface_NB_IoT.c`): `rrc_enb_task()` es la tarea ITTI. Para NB-IoT existen funciones como `rrc_eNB_process_RRCConnectionSetupComplete_NB_IoT()`, que al recibir el *RRCConnectionSetupComplete-NB* activa SRB1bis/SRB1 y, **si hay MME (`EPC_MODE_ENABLED`)**, llama a **`rrc_eNB_send_S1AP_NAS_FIRST_REQ()`**. Esta función envía el mensaje ITTI `S1AP_NAS_FIRST_REQ` a `TASK_S1AP`, que lo convierte en el *Initial UE Message* hacia el MME. Los NAS de bajada vuelven como `S1AP_DOWNLINK_NAS` / `S1AP_INITIAL_CONTEXT_SETUP_REQ`, procesados con `rrc_eNB_process_S1AP_DOWNLINK_NAS()` y similares. **Este es el puente entre la radio NB-IoT y el núcleo.** [observación] El comentario del código junto a esa llamada dice que no existían «funciones S1AP» específicas de NB-IoT, es decir, se reutiliza el camino LTE; cualquier diferencia de los mensajes S1AP de NB-IoT (por ejemplo, el tipo de RAT) que Open5GS espere no está verificada.
- **PDCP/RLC**: se reutilizan de LTE (`LAYER2/PDCP_v10.1.0`, `RLC`). `mac_rlc_data_ind()` (MAC→RLC) y `rrc_data_ind()` (hacia RRC).
- **GTP-U** (`openair3/GTPV1-U/gtpv1u_eNB.c`): `gtpv1u_eNB_task` mantiene una pila **nw-gtpv1u** de terceros (`nwGtpv1uProcessUdpReq`, `nwGtpv1uProcessUlpReq`) y **no abre su propio socket**: envía y recibe mediante la **tarea UDP** por mensajes ITTI (`UDP_DATA_REQ` hacia `TASK_UDP`, `UDP_DATA_IND` desde ella). Una tabla hash `ue_mapping` (`rnti` → `teid_eNB`/`teid_sgw`/IP del SGW) decide por qué túnel enviar. Datos de subida: el mensaje `GTPV1U_ENB_TUNNEL_DATA_REQ` llega con los bytes; se encapsulan y se envían al SGW-U (UDP 2152). Datos de bajada: `data_recv_callback` entrega a PDCP con `pdcp_data_req()`.
- **UDP** (`openair3/UDP/udp_eNB_task.c`): tarea con `epoll` y su lista de sockets protegida por `pthread_mutex_t udp_socket_list_mutex`; usa `sendto`/`recvfrom` y reenvía lo recibido con `itti_send_msg_to_task` a la tarea dueña del socket (aquí `TASK_GTPV1_U`).

### 3.10 El acceso a la radio: una «interfaz» de dispositivo en C y C++

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

Aquí está el **segundo punto de contacto «físico»**: la línea `set_tx_gain(openair0_cfg[0].tx_gain[0])` es la que recibe el `tx_gain` del plan RF (ver `integracion-oai-open5gs.md` §3.5): es una **ganancia** y no una atenuación.

### 3.11 Configuración del eNB

`enb_config.c` (`openair2/ENB_APP`) usa **libconfig** (`config_lookup_*`) para leer el `.conf` y llenar `enb_properties` (cada clave del archivo ↔ un campo). Las claves que gestiona este proyecto: `eutra_band`, `downlink_frequency`, `uplink_frequency_offset`, `tx_gain`/`rx_gain` (aquí `rx_gain = 120`), `mme_ip_address`, `ENB_IPV4_ADDRESS_FOR_S1_MME`, `ENB_IPV4_ADDRESS_FOR_S1U`, `ENB_PORT_FOR_S1U`, `tracking_area_code`, `mobile_country_code`, `mobile_network_code`, `N_RB_DL`, y los parámetros NB-IoT (`nprach_*`, `npdcch_*`). El script `scripts/oai-enb-start.sh` rellena una plantilla con marcadores `@BAND@`, `@DL_HZ@`, etc.

### 3.12 Observaciones sobre el estado del código de la rama NB-IoT

Resultado de leer el código, útil para responder con honestidad cuánto cubre esta rama. **[observación]**, a confirmar con hardware:

1. **El MAC NB-IoT usa estado global e identificador temporal fijo.** `UE_state_machine` es una variable global (`vars_NB_IoT.h:143`, valores `initial_access`, `rach_for_auth_rsp`, `rach_for_next`, `rach_for_TAU`) que gobierna el tratamiento de los mensajes de subida en `eNB_scheduler_ulsch_NB_IoT.c:280-335` y en `UL_indication_NB_IoT()`. El RNTI temporal es `static uint16_t tc_rnti = 0x0101` (`eNB_scheduler_RA_NB_IoT.c:112`) y su incremento está comentado (`//tc_rnti++`, línea 305). Además el bucle de preámbulos procesa **solo el primero** de cada indicación (`for(i=0;i<1;i++)`). Matiz: el acceso aleatorio sí admite varios procedimientos en curso (`RA_template[MAX_NUMBER_OF_UE_MAX_NB_IoT]`), así que el límite no es «un solo UE» literal. Consecuencias probables: (a) con varios dispositivos habría colisión de identificador y estado compartido; (b) incluso con uno, el MAC espera una **secuencia de mensajes concreta** (probablemente la de los equipos con que lo probaron sus autores) y otro orden podría dejar mal la dirección de planificación; (c) un segundo acceso tras reinicio o PSM podría fallar hasta reiniciar el eNB. Ninguna de las tres está comprobada con hardware. Es el mayor riesgo técnico de la combinación OAI+Open5GS.
2. **Hay código de simulación desactivado** (`simulate_preamble`, `simulate_msg3`, `enable_preamble_simulation(UL_INFO, 0)`): el último parámetro `0` los mantiene apagados. Es para pruebas sin radio.
3. **`rxtx_NB_IoT()` está comentada** y se usa `rxtx()` con punteros a función NB-IoT (§3.6).
4. **La rama es de 2020 y de investigación** (muchos `printf`, comentarios «testing phase»), probada por sus autores con un núcleo y módulos distintos a los de este proyecto.

Estas observaciones no invalidan el proyecto (el software integrado funciona hasta S1), pero explican por qué la prueba con módulo real es el punto crítico.

---

## 4. Cómo se tocan los tres mundos (interfaces entre Narrowcast-NB, OAI y Open5GS)

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

---

## 5. El código propio: lenguajes, concurrencia y comunicación

### 5.1 Panel (`app/main.py`, Python 3.12, FastAPI)

**Modelo de ejecución:** `uvicorn` ejecuta un **bucle de eventos `asyncio`** en el hilo principal; los endpoints declarados con `async def` (p. ej. `/api/stream`) corren en ese bucle, y los declarados con `def` normal (la mayoría) los ejecuta FastAPI en un **pool de hilos** (`anyio`), de modo que varias peticiones HTTP pueden correr a la vez.

| Mecanismo | Dónde | Para qué |
|---|---|---|
| `paho-mqtt` con `c.loop_start()` | `start_mqtt()` | **Crea un hilo propio** que mantiene la conexión MQTT. `on_message` se ejecuta en ese hilo. |
| `loop.call_soon_threadsafe(q.put_nowait, event)` | `broadcast()` | **Cruza de hilo a bucle asyncio** de forma segura: el hilo MQTT (o un hilo del pool) empuja un evento a las colas `asyncio.Queue` de los navegadores suscritos. |
| `asyncio.Queue` por cliente + `StreamingResponse` | `/api/stream` | **Server-Sent Events**: cada navegador abierto tiene una cola; el endpoint espera con `asyncio.wait_for(q.get(), timeout=15)` y envía un comentario de *keep-alive* si no hay eventos. |
| `threading.Lock` (`radio_lock`) | `stop_radio()`, `radio_start()` | Protege el estado de la radio (`radio` dict) de accesos concurrentes. |
| `threading.Timer(dur, stop_radio)` | `radio_start()` | **Corte automático**: hilo temporizador (`daemon`) que apaga el eNB al vencer `duracion_max_s`. |
| `subprocess.run(["bash", rf-check.sh])` | `run_checks()` | Ejecuta el script de validación y convierte sus líneas `PASS`/`FAIL` en JSON. |
| SDK `docker` | `docker.from_env()` | Habla con el socket `/var/run/docker.sock`: `containers.get(...).start()/stop()/logs()`. |
| `pymongo.MongoClient` | `sub_db()` | CRUD de la colección `open5gs.subscribers`; `sub_view()` **omite** K y OPc. |
| `pydantic.BaseModel` | `StartReq`, `Cmd`, `SubIn` | **Clases** que validan automáticamente el cuerpo JSON de las peticiones. |
| `@app.on_event("startup")` | `startup()` | Guarda el bucle `asyncio`, apaga el eNB si quedó encendido y arranca MQTT. |

La API REST (rutas `@app.get/post/put/delete`) está documentada en [`panel.md`](../operacion/panel.md).

### 5.2 Frontend (`app/web/src/`)

Aplicación **React 18 + TypeScript** compilada con Vite (detalle de archivos en [`panel.md`](../operacion/panel.md) §4). Corre en el **único hilo** del navegador: `fetch()` para la API REST, **`EventSource('/api/stream')`** para los eventos del servidor (`store.ts` los convierte en estado global leído con `useSyncExternalStore`) y **SVG animado** (`components/Diagram.tsx`) para los diagramas. Cada pestaña es un componente en `tabs/`; el laboratorio tiene su propio motor de reproducción de eventos (`lab/engine.ts`).

### 5.3 Firmware (`firmware/esp32-nbiot/esp32-nbiot.ino`, C++ de Arduino)

Modelo **`setup()` + `loop()`** (un bucle principal, sin sistema operativo visible; el ESP32 corre FreeRTOS por debajo pero el sketch es de un solo hilo). Objetos (clases C++): `HardwareSerial SerialAT(2)` (UART 2), `TinyGsm modem` (control del módem por **comandos AT**), `TinyGsmClient net` (cliente TCP sobre el módem), `PubSubClient mqtt` (cliente MQTT) y `DHT dht` (sensor). Flujo del `loop()`: si no hay red, `attach()` (`AT+CMNB=2`, `AT+CBANDCFG`, `AT+COPS`), luego `connectMqtt()` (con *last will* `offline` retenido) y cada `intervalMs` publica el JSON. El *callback* `onMessage` atiende comandos (`{"led":..., "interval_s":...}`) cuando `mqtt.loop()` procesa mensajes entrantes (es **sondeo**, no interrupciones).

### 5.4 Simulador de telemetría (`app/fake_device.py`)

Cliente `paho-mqtt` en Python que publica telemetría inventada y escucha `nb/<id>/cmd`; añade `"sim": true`. Es independiente del Laboratorio (§5.6).

### 5.5 Scripts y contenedores

| Archivo | Lenguaje | Qué hace |
|---|---|---|
| `docker/open5gs/entrypoint.sh` | Bash + `perl` | Reescribe `ConnectPeer`/`ListenOn` de freeDiameter; para `open5gs-upfd` crea `ogstun` (`ip tuntap`), le asigna IP, la levanta y añade la regla `iptables … MASQUERADE`; termina con `exec "$@"` (el programa pasa a ser el proceso principal del contenedor, PID 1, y recibe las señales de Docker) |
| `scripts/oai-enb-start.sh` | Bash + `sed` | Plan RF → `.conf` del eNB → `exec lte-softmodem -O … -S` |
| `scripts/rf-check.sh`, `rf-run.sh` | Bash | Validan el plan; ejecutan con `timeout` y registro |
| `provisioning/subscriber-init.js` | JavaScript (`mongosh`) | Valida y hace `updateOne(…, {upsert: true})` del suscriptor |
| `compose.yaml` | YAML | Servicios, red con IP fija, perfiles (`sim`, `radio`), dependencias (`depends_on` con `service_healthy` / `service_completed_successfully`) |

### 5.6 Laboratorio: nodo de riego sobre OAI + Open5GS reales

Es la parte más compleja del código propio. Reúne cuatro procesos: el **panel** (`nb-app`), el simulador **`simlab`** (`nb-simlab`, misma imagen que el panel, con `NET_ADMIN` y `/dev/net/tun`), el **eNB de OAI con radio falsa** (`nb-oai-lab`) y el **núcleo** Open5GS. Qué es real y qué simulado: real el núcleo, el RRC/S1AP/GTP-U de OAI, el NAS (Milenage, EIA2) y los datos MQTT; simulados la radio (Uu) y la electrónica del ESP32.

**Ruta de los mensajes**

| Plano | Camino |
|---|---|
| Control | `simlab` (NAS) → UDP 9100 → hilo inyector de OAI → RRC → S1AP/SCTP → MME → HSS/SGW-C/PGW-C/PCRF |
| Datos de subida | app del nodo → TUN `simue0` → `simlab/net.py` → UDP 9101 → OAI (`GTPV1U_ENB_TUNNEL_DATA_REQ`) → GTP-U/UDP 2152 → SGW-U → PGW-U (`ogstun`) → Mosquitto |
| Datos de bajada | Mosquitto → PGW-U → SGW-U → GTP-U → OAI → gancho `narrowcast_dl_relay` → UDP 9102 → `net.py` → TUN → app del nodo |

El plano de control **no interviene** en los datos: por eso el registro del núcleo no muestra nada cuando el nodo publica. La prueba de que el paquete cruzó el núcleo son los contadores de `ogstun` (abajo).

**`app/simlab/` (Python)**

| Archivo | Hilos / mecanismo | Qué hace |
|---|---|---|
| `server.py` | FastAPI; `SCENARIOS` ejecutados en hilos | API interna: `/state`, `/events`, `/reset`, `/provision`, `/scenario/*` (registrar, clon, intruso, baja), `/node/env`, `/node/ping`, `/node/firmware`, `/oai/log`. Nodo `riego-01` (IMSI `001010000010001`); intruso con otro IMSI |
| `oai.py` | Clase `OaiUE.run()` | Espera `SETTLE_S`, inyecta por UDP 9100 los mensajes de subida con el NAS dentro (`SC`→`UT`→`UC`→`RC`), lee del registro de OAI los NAS que baja el MME, detecta caídas por el id de arranque del log y reintenta (máx. 2) |
| `nas.py` | `NasUE` | NAS de verdad: `_auth_req` (Milenage), `_smc` (EIA2), `_protect`, `_accept_nas`. Genera el *Attach Request*, *Authentication Response*, *Security Mode Complete*; procesa el *Attach Accept* y el *Detach* |
| `net.py` | `UserPlane`: hilos de lectura TUN y UDP 9102 | Crea `simue0` con la IP asignada, una regla `ip rule from <ip> lookup 100` y la ruta por defecto en la tabla 100 (se reaplica con `ip route replace`: Linux la borra si la interfaz pierde su última IP). Los hilos toleran `OSError` para no morir |
| `node.py` | `IrrigationNode`: hilo de física y de control | Espejo del firmware: suelo, tanque, bomba, DHT22, HC-SR04; consola de comandos AT; cliente MQTT enlazado a la IP del módulo y ping ICMP real. `_pump(on, why, notify=True)` publica **al instante** al cambiar la bomba |
| `riego-nbiot.ino` | — | Firmware C que el laboratorio muestra y resalta en la vista del UE; coincide con la lógica de `node.py` |
| `crypto.py` | — | Milenage (TS 35.206), KDF de claves LTE (TS 33.401), EIA2 (AES-CMAC) y AUTS para la resincronización |
| `bus.py` | — | Bus de eventos con campos `seq`, `dev`, `stage`, `proto`, `src`, `dst`, `ok`, `label`, `detail` (`emit(...)`) que alimenta la traza |

**Panel (`app/main.py`)** — rutas `/api/lab/*` con lista blanca (`LAB_OK`) que reenvía a `simlab`:
- Antes de cada escenario de registro **reinicia `nb-oai-lab`** (un acceso aleatorio por arranque) y comprueba si hay un trabajo en curso (responde **409** para no reiniciar dos veces).
- `oai_watchdog` (hilo): reinicia OAI si sale con un código fuera de (0, 137, 143) mientras haya trabajo.
- `GET /api/lab/corelog?since&until&imsi`: lee los registros de MME, HSS, SGW-C, PGW-C y PCRF (SDK `docker`) filtrados por IMSI.
- `GET /api/lab/upstats`: ejecuta en `nb-pgwu` la lectura de `/sys/class/net/ogstun/statistics/{rx,tx}_{packets,bytes}`. En un TUN, lo que escribe el UE al túnel es `rx` (**subida**) y lo que el UPF lee hacia el UE es `tx` (**bajada**). Cuenta todo el tráfico del núcleo.
- Las órdenes del celular siguen yendo por `POST /api/devices/<id>/cmd` (MQTT), ampliadas (`pump`, `mode`, `soil_low`, `soil_high`).

**Frontend del laboratorio (`app/web/src/lab/` y `tabs/Lab.tsx`)**
- `engine.ts` (`LabEngine`): cola de eventos con velocidad/pausa/paso, instantánea para `useSyncExternalStore`, `PATHS` (saltos por tipo de mensaje; los mensajes de datos recorren módulo → OAI → SGW → PGW → broker) y `pending` (indicador de ocupado para no pulsar dos veces).
- `flow.tsx`: paquetes animados con `requestAnimationFrame` sobre rutas SVG; `art.tsx`: dibujos SVG de los dispositivos.
- `views/UEView`, `RANView`, `CoreView`: las tres secciones; reutilizan `Diagram` y `Stepper`.
- `Lab.tsx`: la traza (columna **ruta** con el recorrido completo; en los datos se nombran **SGW-U** y **PGW-U (UPF)** y la telemetría periódica se muestra por defecto), el panel de detalle y la tarjeta **«Registro del plano de usuario»** (`UserPlaneLog`): por cada mensaje de datos añade una línea con la dirección, el recorrido por GTP-U y, ~0,9 s después, la diferencia de los contadores de `/api/lab/upstats` (por ejemplo `↑ 1 paq / 140 B · ↓ 1 paq / 52 B`). Es la evidencia de que el paquete cruzó OAI y el núcleo aunque el registro del plano de control esté vacío.

**Concurrencia a tener en cuenta:** el nodo (`node.py`), la lectura TUN, la recepción UDP 9102 y los escenarios corren en hilos de `simlab`; el estado compartido se protege con bloqueos y el bus de eventos. En OAI, el inyector corre en hilos propios (`pthread`, `detach`) separados de los hilos de tiempo real.

---

## 6. Resumen visual: qué hilo/proceso hace qué

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

---

## 7. Preguntas recurrentes sobre el código

Ver [`preguntas-recurrentes.md`](../referencia/preguntas-recurrentes.md) §5.

---

## 8. Cómo seguir explorando el código

1. Elegir un camino y seguirlo con `grep` dentro del contenedor. Por ejemplo, el *S1 Setup*:
   `grep -rn "s1ap_handle_s1_setup_request" /opt/open5gs/src` y luego `grep -rn "S1AP_REGISTER_ENB_REQ" /opt/oai/openair2 /opt/oai/openair3`.
2. Leer en este orden en Open5GS: `src/main.c` → `src/mme/mme-init.c` → `lib/core/ogs-queue.c`, `ogs-fsm.c` → `src/mme/mme-sm.c` → `s1ap-sm.c` → `emm-sm.c`.
3. Leer en este orden en OAI: `common/utils/itti/intertask_interface.c` → `targets/COMMON/create_tasks.c` → `openair2/ENB_APP/enb_app.c` → `openair3/S1AP/s1ap_eNB.c` → `targets/RT/USER/lte-enb.c` (`init_eNB_proc`, `eNB_thread_single`) → `openair2/PHY_INTERFACE/IF_Module_L2_primitives_NB_IoT.c` → `openair2/LAYER2/MAC/eNB_scheduler_NB_IoT.c`.
4. Probar en caliente (sin radio): `docker logs nb-mme` mientras `docker compose --profile sim up -d`, e identificar en el registro los eventos de §2.10.
