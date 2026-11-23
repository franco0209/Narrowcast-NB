# Contenido archivado

Bloques que se **sacaron de su lugar original porque repetían información que ya está en otro documento**. Se conservan aquí tal cual estaban (nada se borró salvo lo que era falso). Cada uno indica de dónde vino, por qué se movió y dónde está ahora la versión vigente.

Los nombres de documento de los bloques más antiguos (`arquitectura.md`, `fundamentos.md`, `integracion-oai-open5gs.md`, `codigo-por-dentro.md`, `panel.md`, `estado-por-fases.md`) son los de antes de la reorganización de la documentación.

Bloques que se **sacaron de su lugar original porque repetían información que ya está en otro documento**. Se conservan aquí tal cual estaban (nada se borró). Cada uno indica de dónde vino, por qué se movió y dónde está ahora la versión vigente.


---

## Fundamentos §6.2: funciones de Open5GS que se usan

- **Origen:** `conceptos/fundamentos.md`
- **Motivo:** Misma tabla (función, binario, YAML, papel) que `arquitectura.md` §3, que además incluye las interfaces.
- **Versión vigente:** [`arquitectura/arquitectura.md`](../arquitectura/arquitectura.md) §3

| Función | Proceso | Configuración propia | Qué hace en el proyecto |
|---|---|---|---|
| MME | `open5gs-mmed` | `config/open5gs/mme.yaml` | Acepta el eNB (S1 Setup), autentica, negocia seguridad, pide la sesión |
| HSS | `open5gs-hssd` | `hss.yaml` | Genera vectores Milenage y entrega el perfil; lee MongoDB |
| SGW-C / SGW-U | `open5gs-sgwcd` / `-sgwud` | `sgwc.yaml` / `sgwu.yaml` | Control y reenvío de datos del lado de acceso |
| PGW-C / PGW-U | `open5gs-smfd` / `-upfd` | `pgwc.yaml` / `pgwu.yaml` | Crean la sesión, asignan IP y entregan los paquetes por la interfaz `ogstun` |
| PCRF | `open5gs-pcrfd` | `pcrf.yaml` | Política por defecto (QCI 9) |


---

## Fundamentos §7.3: capas de OAI que se usan

- **Origen:** `conceptos/fundamentos.md`
- **Motivo:** Misma tabla de capas que `arquitectura.md` §4.
- **Versión vigente:** [`arquitectura/arquitectura.md`](../arquitectura/arquitectura.md) §4

| Capa | Función en el eNB |
|---|---|
| S1AP + SCTP | Señalización con el MME (puerto 36412) |
| GTP-U | Datos de usuario con el SGW-U (UDP 2152) |
| RRC | Conexión de radio, información de la celda (SIB-NB), transporte de mensajes NAS |
| PDCP | Numeración y seguridad de paquetes |
| RLC | Segmentación y retransmisión |
| MAC | Planificación: decide quién transmite cuándo; maneja el acceso aleatorio |
| PHY NB-IoT | NPSS, NSSS, NPBCH, NPDCCH, NPDSCH, NPUSCH, NPRACH |
| UHD | Controla el USRP (frecuencia, ganancia, muestras) |


---

## Integración §2.1: servicios de Compose y binarios

- **Origen:** `arquitectura/integracion-oai-open5gs.md`
- **Motivo:** Misma información que la tabla de `arquitectura.md` §3.
- **Versión vigente:** [`arquitectura/arquitectura.md`](../arquitectura/arquitectura.md) §3

| Servicio compose | Binario | Archivo de config propio |
|---|---|---|
| `mme` | `open5gs-mmed` | `config/open5gs/mme.yaml` |
| `hss` | `open5gs-hssd` | `hss.yaml` |
| `sgwc` / `sgwu` | `open5gs-sgwcd` / `open5gs-sgwud` | `sgwc.yaml` / `sgwu.yaml` |
| `pgwc` | **`open5gs-smfd`** | `pgwc.yaml` |
| `pgwu` | **`open5gs-upfd`** | `pgwu.yaml` |
| `pcrf` | `open5gs-pcrfd` | `pcrf.yaml` |


---

## Código por dentro §1: lenguajes y construcción

- **Origen:** `arquitectura/codigo-por-dentro.md`
- **Motivo:** Misma tabla que `docker-y-compilacion.md` §1; sus filas adicionales (asn1c, freeDiameter, UHD, archivos de configuración) se incorporaron allí.
- **Versión vigente:** [`operacion/docker-y-compilacion.md`](../operacion/docker-y-compilacion.md) §1

| Parte | Lenguaje | Se compila / ejecuta con | Archivos de configuración |
|---|---|---|---|
| Open5GS (EPC) | **C** (estándar C11, GNU) | `meson` + `ninja` → un ejecutable por función (`open5gs-mmed`, …) | **YAML** (se lee con `libyaml`, `lib/app/ogs-yaml.c`) |
| Códecs S1AP, NGAP, RRC | **C generado** con `asn1c` a partir de ASN.1 (`lib/asn1c`, `lib/s1ap`) | se compila con el resto | — |
| Diameter | **C**, biblioteca externa **freeDiameter** (usa hilos propios) | se enlaza | `.conf` de freeDiameter |
| OAI eNB | **C** casi todo; **C++** solo el puente al USRP (`targets/ARCH/USRP/USERSPACE/LIB/usrp_lib.cpp`) | script `cmake_targets/build_oai` (envoltorio de `cmake`/`make`) → `lte-softmodem` | **libconfig** (`.conf` con llaves y `=`) |
| Radio | biblioteca **UHD** (C++) del fabricante Ettus | se enlaza dentro de `lte-softmodem` | — |
| Panel (backend) | **Python 3.12**, FastAPI + Uvicorn | `uvicorn main:app` | variables de entorno, YAML del plan RF |
| Panel (frontend) | **TypeScript + React 18** (Vite, `app/web/`), CSS | se compila en la imagen de Docker a JS estático | — |
| Firmware | **C++ de Arduino** (ESP32) | Arduino IDE / PlatformIO | `secrets.h` |
| Orquestación y utilitarios | **YAML** (Compose), **Bash**, **JavaScript** (`mongosh`), `perl` en un `entrypoint` | Docker Compose | `.env` |


---

## Panel §7: archivos de `app/simlab/`

- **Origen:** `operacion/panel.md`
- **Motivo:** Misma tabla que `codigo-por-dentro.md` §5.6; el detalle adicional de este texto se incorporó allí.
- **Versión vigente:** [`arquitectura/codigo-por-dentro.md`](../arquitectura/codigo-por-dentro.md) §5.6

| Archivo | Rol |
|---|---|
| `oai.py` | Registro por OAI: inyecta por UDP (9100 de OAI) los mensajes RRC de subida con el NAS dentro, lee del registro de OAI los NAS que baja el MME y completa el contexto (`UECapabilityInformation` y `RRCConnectionReconfigurationComplete` → OAI envía la *Initial Context Setup Response*). Espera ~40 s tras el arranque de OAI (antes se cae) |
| `nas.py` | Motor NAS del terminal: Milenage, seguridad EIA2, Attach Accept, Detach |
| `crypto.py` | Milenage (TS 35.206), KDF de claves LTE (TS 33.401), EIA2 (AES-CMAC), AUTS para la resincronización |
| `net.py` | Interfaz TUN `simue0`, reglas `ip rule from <IP>` y **relevo de datos con OAI**: subida por UDP 9101 hacia OAI (que la encapsula en GTP-U), bajada por UDP 9102 (OAI reenvía los T-PDU del SGW-U) |
| `node.py` | El nodo: «mundo físico» (suelo, tanque, temperatura, mano frente al ultrasónico), lógica del firmware, consola AT del módulo, MQTT enlazado a la IP del módulo y ping ICMP real |
| `riego-nbiot.ino` | Firmware C++ del ESP32 que el panel muestra (el simulador replica sus funciones) |
| `server.py` | API HTTP, alta de la SIM en MongoDB, escenarios (`registrar`, `clon`, `intruso`, `baja`) y SSE de eventos |
| `bus.py` | Traza de eventos (`seq`, `dev`, `stage`, `proto`, `src`, `dst`, `ok`, `label`, `detail`) |

---

## Fundamentos §6.2–6.4: qué parte de Open5GS se usa, cómo funciona (resumen) y qué hace el proyecto

- **Origen:** `conceptos/fundamentos.md`
- **Motivo:** Mismo contenido que `open5gs.md` (funciones y procesos) y que `modificaciones-oai-open5gs.md` §3 (lo que hace el proyecto sobre Open5GS).
- **Versión vigente:** `arquitectura/open5gs.md` y `arquitectura/modificaciones-oai-open5gs.md`

### 6.2 Qué parte se usa

Solo el **EPC 4G**, porque la rama NB-IoT de OAI habla S1AP (4G). Las funciones 5G se compilan pero no se arrancan.

Tabla de funciones, binarios y archivos de configuración: ver [`arquitectura.md` §3](../arquitectura/arquitectura.md#3-open5gs-qué-partes-se-usan) (MME, HSS, SGW-C/U, PGW-C/U y PCRF).

Dato curioso útil: en modo EPC, Open5GS reutiliza los programas 5G `smfd` y `upfd` para hacer de PGW-C y PGW-U. Lo que decide el rol es la configuración (`gtpc`/`freeDiameter` en vez de `sbi`).

### 6.3 Cómo funciona por dentro (resumen)

- Cada función es **un proceso** con un bucle de eventos (epoll) y una **máquina de estados**. Los mensajes de red se convierten en eventos y se despachan a la máquina de estados correspondiente.
- El MME tiene máquinas de estados anidadas: una por eNB (S1AP), una por UE (EMM, el registro) y una por sesión (ESM).
- Los protocolos están en bibliotecas propias: S1AP, NAS, GTP, PFCP, Diameter (con **freeDiameter**) y criptografía (Milenage).
- Los suscriptores se leen de **MongoDB** en cada procedimiento, de modo que un suscriptor nuevo vale sin reiniciar.

Referencia de funciones y archivos: [`integracion-oai-open5gs.md` §2](../arquitectura/integracion-oai-open5gs.md).

### 6.4 Lo que hace el proyecto sobre Open5GS (sin modificar su código)

1. **Compilarlo** en una imagen reproducible (versión y *commit* exactos).
2. **Configurarlo** con siete YAML: PLMN `001/01`, TAC `1`, IP de cada función, subred de UE `10.58.0.0/16`, orden de algoritmos de seguridad.
3. **Entrypoint propio** (`docker/open5gs/entrypoint.sh`): crea la interfaz TUN `ogstun`, le asigna `10.58.0.1/16`, activa NAT (`MASQUERADE`) y reescribe las direcciones de freeDiameter, que por defecto apuntan a `localhost`.
4. **Alimentar su base de datos** con el aprovisionamiento y el módulo Suscriptores.


---

## Integración §2.2: modelo de ejecución de cada función de red

- **Origen:** `arquitectura/integracion-oai-open5gs.md`
- **Motivo:** Resume el bucle de eventos que `open5gs.md` explica en detalle (hilos, cola, máquina de estados).
- **Versión vigente:** `arquitectura/open5gs.md`, sección «Cómo funciona por dentro»

### 2.2 Modelo de ejecución de cada función de red (idéntico en todas)

Cada binario es **un proceso** con un patrón de bucle de eventos [leído en `src/mme/mme-init.c`]:

1. `mme_initialize()` crea un hilo con `ogs_thread_create(mme_main, NULL)`.
2. `mme_main()` entra en un bucle: `ogs_pollset_poll(...)` (sobre **epoll**, `lib/core/ogs-epoll.c`) espera sockets y temporizadores.
3. Los callbacks de socket **no procesan nada**: convierten lo recibido en un *evento* (`mme_event_t`) y lo meten en una cola, `ogs_queue`.
4. El bucle saca eventos con `ogs_queue_trypop(...)` y los despacha con `ogs_fsm_dispatch(&mme_sm, e)` a una **máquina de estados finita** (`lib/core/ogs-fsm.c`).

Los tipos de evento del MME están en `src/mme/mme-event.h` [leído]: `MME_EVENT_S1AP_MESSAGE`, `MME_EVENT_EMM_MESSAGE`, `MME_EVENT_ESM_MESSAGE`, `MME_EVENT_S6A_MESSAGE`, `MME_EVENT_S11_MESSAGE`, más sus `*_TIMER`. Es decir, **cada interfaz del EPC es una fuente de eventos hacia una máquina de estados**.

> Esto explica el aviso `epoll failed (EINTR)` que sale en los registros: `epoll_wait` fue interrumpido por una señal; el bucle reintenta. Es inofensivo (documentado en `docs/operacion/puesta-en-marcha.md`).


---

## Fundamentos §7.4–7.5: lo que hace el proyecto sobre OAI y srsRAN

- **Origen:** `conceptos/fundamentos.md`
- **Motivo:** La configuración del eNB y el hallazgo de `tx_gain` están en `oai.md`; la radio virtual de srsRAN, en `vision-general.md`; lo que se modificó, en `modificaciones-oai-open5gs.md` §4.
- **Versión vigente:** `arquitectura/oai.md`, `arquitectura/vision-general.md` y `arquitectura/modificaciones-oai-open5gs.md`

### 7.4 Lo que hace el proyecto sobre OAI (sin modificar su lógica)

1. **Compilarlo** en una imagen reproducible (con el parche de `protobuf-c`).
2. **Configurarlo** con una plantilla (`config/oai/enb.nbiot.conf.tmpl`): PLMN, TAC, IP del MME, 50 PRB, 1 antena.
3. **Generar la configuración desde el plan RF** (`scripts/oai-enb-start.sh`): banda, frecuencia y ganancia se toman del plan validado, se calcula el desplazamiento de subida según la banda y se lanza `lte-softmodem`.
4. **Proteger la emisión**: el eNB solo arranca desde el panel con plan válido y autorización.

Hallazgo para contar: una versión inicial del script trataba `tx_gain` como atenuación (`90 − tx_gain`), lo que habría pedido casi la máxima potencia con un valor "seguro". Leyendo el código de OAI se comprobó que `tx_gain` llega tal cual a `set_tx_gain` de UHD como **ganancia**, y se corrigió. Sigue pendiente medir la potencia real con un analizador de espectro. Detalle en [`integracion-oai-open5gs.md` §3.5](../arquitectura/integracion-oai-open5gs.md).

### 7.5 srsRAN: el "eNB virtual" de pruebas

Para validar el núcleo **sin emitir radio** se usa **srsRAN 4G**, otra pila celular libre. Con el perfil `sim`, un eNB (`srsenb`) y un UE (`srsue`) se conectan por **ZeroMQ** (un socket TCP en vez de radio) y el eNB habla S1 con Open5GS por la red Docker. Es LTE normal, no NB-IoT: **valida el núcleo, no la radio de OAI**. `scripts/validate.sh` comprueba S1 Setup, registro, IP del UE y un `ping` por el túnel.


---

## Integración §3.2–3.4 y §3.6: hilos y tareas, interfaz L1/L2, arranque y limitaciones de la rama

- **Origen:** `arquitectura/integracion-oai-open5gs.md`
- **Motivo:** Resumen de lo que `oai.md` explica con más detalle (tareas ITTI, hilos de tiempo real, interfaz PHY↔MAC, arranque) y de las limitaciones ya recogidas en «Limitaciones conocidas» y «Estado del código de la rama NB-IoT».
- **Versión vigente:** `arquitectura/oai.md`

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

### 3.6 Limitaciones de la rama (y por qué importan)

- Es una rama de 2020, probada por sus autores con módulos Quectel BC95 y un núcleo comercial, **no con Open5GS**. Que el *attach* funcione con un módulo real es el **riesgo técnico principal** del proyecto.
- Solo compila en Ubuntu 14.04/16.04 → el `Dockerfile` usa `ubuntu:16.04`.
- Duplica estructuras NB-IoT/LTE, así que parte del flujo (por ejemplo optimizaciones CIoT del núcleo) puede no estar implementada. **Sin verificar** con esta combinación.


---

## Integración §5: los tres puntos de contacto

- **Origen:** `arquitectura/integracion-oai-open5gs.md`
- **Motivo:** Es un subconjunto de la tabla de 13 fronteras de `integracion.md` (S1-MME, S1-U y suscriptor).
- **Versión vigente:** `arquitectura/integracion.md`, sección «Los puntos de contacto»

## 5. Cómo se conectan: los tres puntos de contacto

Los tres proyectos se tocan en muy pocos lugares, y todos son **interfaces estándar**, por eso se pueden combinar sin modificar el código fuente de ninguno:

| # | Punto de contacto | Protocolo | Quién habla con quién | Qué debe coincidir |
|---|---|---|---|---|
| 1 | **S1-MME** | S1AP sobre SCTP 36412 | `TASK_S1AP` de OAI ↔ `s1ap_sm` del MME | PLMN `001/01` y TAC `1` en `enb.nbiot.conf` y `mme.yaml`; IP del MME |
| 2 | **S1-U** | GTP-U sobre UDP 2152 | `TASK_GTPV1_U` de OAI ↔ `sgwu` | IP del eNB (`10.44.0.40`) |
| 3 | **Suscriptor** | Documento en MongoDB | Nuestro panel/script → HSS (vía `ogs_dbi_auth_info`) | K y OPc de la SIM = los del documento |

El plano de radio (Uu) lo gestiona solo OAI; el EPC solo ve S1.


---

## Fundamentos §10: seguridad de radiofrecuencia

- **Origen:** `conceptos/fundamentos.md`
- **Motivo:** Misma lista de barreras que `seguridad-rf.md` (que además trae la tabla de reglas y el uso).
- **Versión vigente:** `operacion/seguridad-rf.md`

## 10. Seguridad de radiofrecuencia

Transmitir en una banda celular sin permiso puede interferir a operadores reales (incluidos servicios de emergencia) y es ilegal. Por eso **ni OAI ni Open5GS impiden emitir** y la protección la pone este proyecto, en capas:

1. **Apagada por defecto**: si al arrancar el panel encuentra el eNB encendido, lo detiene.
2. **Plan RF** (`data/rf-plan.yaml`) validado por `scripts/rf-check.sh`: bandas B3/B8/B20/B28, ganancia ≤ 30 dB, modo cable con atenuación ≥ 60 dB (antena solo con permiso escrito), duración de 1 a 600 s, portadora libre confirmada tras un barrido de espectro y nombre de quien autoriza.
3. **Confirmación humana** en el panel: dos casillas (portadora libre, autorizado por) y mantener pulsado el botón 1,5 s; el panel envía a la API la confirmación `EMITIR`, que el servidor exige.
4. **Corte automático** al cumplirse la duración.
5. **Registro** de cada sesión en `data/logs/rf-sessions.csv`.

Lo que **no** hace: medir potencia. Eso exige un analizador de espectro; el plan se valida, no se mide. Por eso se trabaja con cable y atenuador de ≥ 60 dB.

También hay una cuestión de seguridad del propio panel: monta el socket de Docker (equivale a acceso de administrador del equipo), así que solo escucha en `127.0.0.1`.


---

## Estado por fases: detalle de las Fases 1 y 3

- **Origen:** `proyecto/estado-por-fases.md`
- **Motivo:** Los comandos y datos de la Fase 1 (núcleo, radio virtual, WebUI, imágenes) y de la Fase 3 (imagen de OAI, plantilla, arranque, verificación sin radio) están en la puesta en marcha y en Docker y compilación.
- **Versión vigente:** `operacion/puesta-en-marcha.md`, `operacion/docker-y-compilacion.md`, `arquitectura/oai.md` y `arquitectura/modificaciones-oai-open5gs.md`

## Fase 1: núcleo (EPC) dockerizado, sin radio real

Compatible con el laboratorio Lain5G/OIA: mismas versiones (Open5GS v2.7.5, srsRAN 4G 23.11), pero con red Docker propia (`10.44.0.0/24`, `narrowcast-nb-core`), volumen propio y contenedores `nb-*`, así que ambos pueden coexistir.

```bash
cp .env.example .env           # ajustar si hace falta (puerto de la WebUI, imágenes)
scripts/sim.sh up              # núcleo + eNB/UE virtuales (ZMQ)
scripts/sim.sh validate        # S1, attach, IP y ping por el túnel
scripts/sim.sh down
```

- **Solo el núcleo**, sin radio virtual (el modo para las fases con radio real): `docker compose up -d`.
- **WebUI:** <http://127.0.0.1:9999> (por defecto `admin` / `1423`; cambiar la clave). Ahí se registran las SIM reales en la Fase 4.
- **Parámetros:** PLMN `001/01`, TAC `1`, APN `internet`, subred de UE `10.58.0.0/16`.
- **Suscriptor de prueba:** las variables `SUBSCRIBER_*` de `.env` se cargan solas en MongoDB al arrancar. Son valores de ejemplo públicos; no usarlos en una red real.
- **Imágenes:** la primera vez se construyen (`docker compose build`; Open5GS y srsRAN compilan desde fuente y tardan). Para reutilizar la imagen de Open5GS que ya construyó Lain5G, poner `OPEN5GS_IMAGE=lain5g-lab/open5gs:local` en `.env`.
- **Puertos:** solo se publica la WebUI, en `127.0.0.1`. Si el puerto choca con otro servicio, cambiar `WEBUI_PORT`.

## Fase 3: eNB NB-IoT (OAI), en curso

Imagen `docker/oai-nbiot/`: OpenAirInterface rama `develop-nb-iot`, fijada al commit `677bbab` (punta de la rama, 2020). Esa rama solo soporta Ubuntu 14.04/16.04, así que la imagen parte de `ubuntu:16.04` y compila el eNB con soporte USRP (UHD).

```bash
docker build -t narrowcast-nb/oai-nbiot:local docker/oai-nbiot   # ~20 min; la imagen resultante pesa ~5.3 GB y el build necesita ~6 GB libres en el pico
```

- El código se baja con clon superficial (`--depth 1`, ~50 MB); el historial completo pesa varios GB. El build falla si la punta de la rama deja de ser el commit fijado.
- Para compilar sin radio (solo S1/stack): `--build-arg OAI_HW=none`.
- Configuración base de ejemplo (B7, a adaptar a la banda autorizada): `targets/PROJECTS/GENERIC-LTE-EPC/CONF/enb.nbiot.band7.tm1.50PRB.usrp210.conf` dentro del repositorio de OAI.
- **Corrección necesaria:** el script de OAI clona `protobuf-c` sin fijar versión y la actual exige C++17, que Ubuntu 16.04 no tiene. El `Dockerfile` fija la v1.3.3 (compatible con el protobuf 2.6.1 del mismo script).
- **Estado:** validado de principio a fin: `docker build` produce la imagen `narrowcast-nb/oai-nbiot:local` con el eNB (`lte-softmodem`, UHD 3.15, dispositivo USRP), que arranca (`-h`) y no tiene librerías faltantes. No se ha probado con radio real. Pendiente: barrido de espectro y prueba con USRP.
- **Configuración y arranque (sin rebuild):** `config/oai/enb.nbiot.conf.tmpl` (PLMN 001/01, TAC 1, MME `10.44.0.10`) y `scripts/oai-enb-start.sh`, que rellenan banda, frecuencia y ganancia desde `data/rf-plan.yaml` y lanzan `lte-softmodem`. Servicio `enb-nbiot` (perfil `radio`, contenedor `nb-enb-nbiot`, IP `10.44.0.40`); se crea una vez con `docker compose --profile radio create enb-nbiot` y lo enciende el panel.
- **Verificado sin radio:** con `S1_ONLY=1` (solo pruebas, ignora el plan RF) el eNB hace `S1 Setup` y el MME lo registra (`eNB-S1 accepted`, `Number of eNBs is now 1`); después se detiene porque no hay USRP (`No USRP Device Found`). Es la prueba de que la parte de red funciona, no de la radio.
- **A verificar con el USRP real:** el `tx_gain` del plan se pasa tal cual a OAI, que lo entrega a UHD como ganancia (según el código; medir la potencia real con analizador antes de usar antena); un USRP USB necesita pasar `/dev/bus/usb` al contenedor (ver comentario en `compose.yaml`).
- **Riesgo conocido:** la rama tiene funciones de subida marcadas como no conformes con 3GPP y se ha probado con módulos Quectel BC95 y un núcleo Nokia, no con Open5GS. Compilar no garantiza que el módulo se registre. Plan B: la rama `nb-iot-ubuntu24`.


---

## Fundamentos §8.2–8.4 y §8.6: registro, dato hacia arriba, orden hacia abajo y panel

- **Origen:** `conceptos/fundamentos.md`
- **Motivo:** Versión resumida de «Recorrido completo de un dato, con funciones» (`integracion.md`); la descripción del panel estaba desactualizada (JavaScript sin librerías) y el panel está descrito en `panel.md`.
- **Versión vigente:** `arquitectura/integracion.md` y `operacion/panel.md`

### 8.2 Registro de un dispositivo (attach)

1. El módulo busca celdas, se sincroniza (NPSS/NSSS), lee la información de la celda (NPBCH, SIB-NB) y pide acceso por **NPRACH**.
2. Se establece la conexión **RRC** con el eNB. El *Attach Request* NAS viaja dentro.
3. El eNB lo reenvía al MME en un `Initial UE Message` (**S1AP**).
4. El MME pide al HSS el vector de autenticación (**S6a/Diameter**). El HSS lee K y OPc de MongoDB y calcula con Milenage.
5. Autenticación mutua con el módulo y negociación de seguridad NAS.
6. El MME pide la sesión (**S11 → S5-C**, GTPv2-C). El PGW-C consulta al PCRF (**Gx**), **reserva una IP de `10.58.0.0/16`** y programa SGW-U y PGW-U por **PFCP**.
7. El MME responde al eNB (*Initial Context Setup*) con el *Attach Accept*, que lleva la IP.
8. El módulo confirma; el túnel **GTP-U** queda completo.

El panel reproduce este procedimiento paso a paso en la pestaña **Núcleo**.

### 8.3 Un dato de temperatura, hacia arriba

```
ESP32 lee el DHT22 ─ publica JSON en nb/<id>/telemetry (MQTT por AT)
  → módulo NB-IoT ~~ radio (NPUSCH) ~~ eNB (PHY→MAC→RLC→PDCP)
  → GTP-U (UDP 2152) → SGW-U → PGW-U → interfaz ogstun → NAT
  → Mosquitto (10.44.0.5:1883) → panel (suscrito a nb/+/telemetry)
  → evento SSE → navegador: tarjeta y gráfico
```

### 8.4 Una orden hacia abajo (encender el LED)

El panel publica `{"led": true}` en `nb/<id>/cmd` → Mosquitto → por la conexión TCP/MQTT que el dispositivo mantiene abierta → PGW-U (busca la sesión por IP del UE) → GTP-U → eNB → radio → ESP32 (`onMessage`). El dispositivo responde con su estado en la siguiente telemetría.

Pendiente de verificar con tráfico real: la ruta de retorno entre el broker y la subred de UE. Lo esperable es que funcione porque el NAT hace que el broker vea la conexión como proveniente del PGW-U.

### 8.6 El panel

Un solo proceso **FastAPI** (Python) que integra cinco fuentes: **Docker** (estado y registros de contenedores; encender/apagar el eNB), **MongoDB** (CRUD de suscriptores, sin devolver K ni OPc), **MQTT** (telemetría y órdenes), **scripts** (validación del plan RF) y el **navegador** (eventos en vivo por **SSE**, *Server-Sent Events*). El frontend es JavaScript sin librerías: `diagram.js` dibuja los diagramas animados, `modules.js` implementa las pestañas.

Detalle clave: para saber si el eNB está conectado, el panel **lee los registros del MME** y busca la línea `eNB-S1 accepted`. Observa a Open5GS sin modificarlo.

Pestañas: Resumen (mapa animado), Suscriptores, Núcleo, eNB, Radio, Dispositivo y Ayuda. Ver [`panel.md`](../operacion/panel.md).


---

## Fundamentos §13 y §15: punteros a estado y a preguntas

- **Origen:** `conceptos/fundamentos.md`
- **Motivo:** Eran solo enlaces a otros documentos.
- **Versión vigente:** `proyecto/estado.md` y `operacion/preguntas-frecuentes.md`

## 13. Qué está verificado y qué no

La tabla de estado está en [`verificacion.md`](../referencia/verificacion.md). En resumen: la parte de software está implementada y validada hasta donde se puede sin hardware; falta la prueba con USRP, SIM y módulo reales.

## 15. Preguntas recurrentes

Las preguntas frecuentes sobre el proyecto están reunidas en [`preguntas-recurrentes.md`](../referencia/preguntas-recurrentes.md).


---

## Panel §7: laboratorio de simulación (piezas, conexión con el panel e interfaz)

- **Origen:** `operacion/panel.md`
- **Motivo:** Repite lo que `implementacion.md` cuenta en «Cómo se construyó, por partes» (panel, frontend, plano de usuario) y en «Dónde está cada cosa». Lo único propio (aislamiento y cómo añadir un escenario) se incorporó allí.
- **Versión vigente:** `laboratorio/implementacion.md`

## 7. Laboratorio de simulación

Pestaña **Laboratorio** (`web/src/tabs/Lab.tsx`, `web/src/lab/`) más el servicio `simlab` (`app/simlab/`) y el eNB `oai-lab`. Un **nodo de riego NB-IoT** (ESP32 + SIM7080G + sensores y bomba) se registra en el núcleo Open5GS real **a través del eNB real de OpenAirInterface** y manda MQTT real por el túnel GTP-U de OAI. Lo único simulado es la radio (Uu).

**Piezas del servidor (`app/simlab/`)**

Tabla de archivos de `app/simlab/` (rol, hilos y mecanismo de cada uno): ver [`codigo-por-dentro.md` §5.6](../arquitectura/codigo-por-dentro.md#56-laboratorio-nodo-de-riego-sobre-oai--open5gs-reales).

**Del lado de OAI** (`lab/oai-fakerf/`, ver su README): radio falsa, inyector (`inject.c`: comandos `SC`, `UT`, `UC`, `RC` y el puerto de datos 9101) y relevo de bajada (`OAI_RELAY_DL`) que `prepare.sh` instala en el contenedor `nb-oai-lab`.

**Cómo se conecta con el panel**

- `main.py` reenvía `/api/lab/*` al simulador (lista blanca de rutas). Los escenarios `registrar`, `clon` e `intruso` **reinician antes el contenedor de OAI** (conecta un UE por arranque). Un hilo (`lab_bridge`) lee el `/stream` del simulador y lo retransmite al navegador como eventos `{"type":"lab"}`.
- `GET /api/lab/corelog?since=&until=&imsi=` lee los registros de `nb-mme`, `nb-hss`, `nb-sgwc`, `nb-pgwc` y `nb-pcrf` filtrados por IMSI; `GET /api/lab/oai/log` devuelve las líneas relevantes del registro de OAI. `GET /api/lab/upstats` lee los contadores de la interfaz `ogstun` del PGW-U (paquetes y bytes de subida/bajada): los datos MQTT no dejan rastro en el registro del plano de control, y la tarjeta «Registro del plano de usuario» del laboratorio usa estos contadores como prueba de que cruzaron OAI y el núcleo.
- `POST /api/lab/node/env?soil=&temp=&tank=&hand=` mueve el «mundo físico» del nodo. Las órdenes del celular usan la API de siempre (`POST /api/devices/riego-01/cmd` con `mode`, `pump`, `soil_low`, `soil_high`, `interval_s`): salen por el broker real y entran al nodo por el túnel.

**Interfaz (`web/src/lab/`)**

| Archivo | Rol |
|---|---|
| `engine.ts` | Cola de eventos con velocidad, pausa y «siguiente paso»; `PATHS` (recorrido del mapa por etapa) |
| `flow.tsx` | Paquetes animados sobre enlaces SVG (cápsulas con estela) y conexión de cada vista al motor |
| `art.tsx` | Ilustraciones SVG: ESP32, SIM7080G, sensores, bomba, tanque, torre, rack, celular |
| `views/Overview.tsx` | Mapa de tres bloques (UE · RAN OAI · Núcleo Open5GS) con sus interfaces: el UE solo sale por **Uu**, la RAN tiene Uu a un lado y **S1-MME / S1-U** al otro, el núcleo solo recibe S1 |
| `views/UEView.tsx` | Código C resaltado según la función en ejecución, nodo interactivo, consola AT y SIM (legítima / clonada / intruso) |
| `views/RANView.tsx` | Pila de OAI con el recorrido de cada mensaje y su registro en vivo |
| `views/CoreView.tsx` | Servicios de Open5GS con su estado real, registro del núcleo y el celular (suscriptor MQTT) |

**Qué es real y qué no:** el núcleo, OAI (MAC, RRC, S1AP, GTP-U), el NAS y el MQTT son reales. Con radio falsa no hay portador de datos por el aire: el tramo Uu de los datos lo cubre el relevo UDP de pruebas; la capa física NB-IoT no se prueba.

**Aislamiento:** `simlab` reutiliza la imagen del panel (sin imagen nueva) pero es otro contenedor con `NET_ADMIN` y `/dev/net/tun`. El panel no recibe esos permisos.

**Para añadir un escenario:** función en `simlab/server.py`, registrarla en `SCENARIOS` y añadir el botón en `SCEN` de `tabs/Lab.tsx`.


---

## Código por dentro §5.6: ruta de los mensajes, panel y frontend del laboratorio

- **Origen:** `arquitectura/codigo-por-dentro.md`
- **Motivo:** Repite el camino de control y de datos y la descripción del panel y del frontend de `implementacion.md` §3–4. La tabla de `app/simlab/` y la concurrencia se incorporaron a `implementacion.md`.
- **Versión vigente:** `laboratorio/implementacion.md`

### 5.6 Laboratorio: nodo de riego sobre OAI + Open5GS reales

Es la parte más compleja del código propio. Reúne cuatro procesos: el **panel** (`nb-app`), el simulador **`simlab`** (`nb-simlab`, misma imagen que el panel, con `NET_ADMIN` y `/dev/net/tun`), el **eNB de OAI con radio falsa** (`nb-oai-lab`) y el **núcleo** Open5GS. Qué es real y qué simulado: real el núcleo, el RRC/S1AP/GTP-U de OAI, el NAS (Milenage, EIA2) y los datos MQTT; simulados la radio (Uu) y la electrónica del ESP32.

**Ruta de los mensajes**

| Plano | Camino |
|---|---|
| Control | `simlab` (NAS) → UDP 9100 → hilo inyector de OAI → RRC → S1AP/SCTP → MME → HSS/SGW-C/PGW-C/PCRF |
| Datos de subida | app del nodo → TUN `simue0` → `simlab/net.py` → UDP 9101 → OAI (`GTPV1U_ENB_TUNNEL_DATA_REQ`) → GTP-U/UDP 2152 → SGW-U → PGW-U (`ogstun`) → Mosquitto |
| Datos de bajada | Mosquitto → PGW-U → SGW-U → GTP-U → OAI → gancho `narrowcast_dl_relay` → UDP 9102 → `net.py` → TUN → app del nodo |

El plano de control **no interviene** en los datos: por eso el registro del núcleo no muestra nada cuando el nodo publica. La prueba de que el paquete cruzó el núcleo son los contadores de `ogstun` (abajo).

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


---

## Integración §1 (cifras de líneas de código) y §7–8: punteros

- **Origen:** `arquitectura/integracion-oai-open5gs.md`
- **Motivo:** Eran solo punteros a otros documentos.
- **Versión vigente:** `arquitectura/integracion.md` y `operacion/preguntas-frecuentes.md`

## 7. Qué está verificado y qué no

Ver la tabla única de estado en [`verificacion.md`](../referencia/verificacion.md).

---

## 8. Preguntas recurrentes

Ver [`preguntas-recurrentes.md`](../referencia/preguntas-recurrentes.md) (secciones 1, 2 y 8).
