# El código propio

Lo que escribió este proyecto, componente por componente: orquestación, aprovisionamiento, traducción del plan RF, panel, firmware y scripts. Cada apartado dice qué hace y, donde importa, cómo trabaja por dentro (hilos, comunicación). El Laboratorio tiene su propio documento: [`../laboratorio/implementacion.md`](../laboratorio/implementacion.md); las reglas de radio, [`../operacion/seguridad-rf.md`](../operacion/seguridad-rf.md).

## Orquestación (`compose.yaml` + Dockerfiles)

- Una red Docker `narrowcast-nb-core` (`10.44.0.0/24`) con IP fija por contenedor. Las IP fijas son lo que permite que las configuraciones YAML de Open5GS y el `.conf` de OAI usen direcciones literales.
- **`docker/open5gs/Dockerfile`**: parte de `ubuntu:22.04` fijado por *digest*, clona Open5GS **v2.7.5** y verifica el *commit* exacto (`git rev-parse HEAD`), compila con `meson`/`ninja`, borra `.git` y `build/` para ahorrar espacio.
- **`docker/oai-nbiot/Dockerfile`**: `ubuntu:16.04`, clon superficial de OAI con verificación del *commit*; parchea con `sed` el script `build_helper` de OAI para fijar `protobuf-c v1.3.3` (el script original clona la última versión, que exige C++17); compila `lte-softmodem` con soporte USRP.
- **Perfiles de Compose**: `sim` (srsRAN virtual), `radio` (eNB OAI real). El eNB real **no arranca con `docker compose up`**; solo lo enciende el panel.

## Aprovisionamiento de suscriptores (`provisioning/subscriber-init.js`)

Script de `mongosh` que valida (IMSI 5–15 dígitos, K/OPc de 32 hex, AMF 4 hex, SQN 12 hex) y hace `db.subscribers.updateOne(..., {upsert: true})` con **el mismo esquema** que lee `ogs_dbi_auth_info()` (ver [`open5gs.md`](open5gs.md), «Qué lee Open5GS de MongoDB»). Se ejecuta una vez (`restart: "no"`) y el HSS depende de que termine bien (`service_completed_successfully`).

## Traducción del plan RF al eNB (`scripts/oai-enb-start.sh`)

Se ejecuta **dentro** del contenedor del eNB [leído]:

1. Lee `band`, `dl_freq_hz`, `tx_gain` de `rf-plan.yaml` con `sed`.
2. Elige el desplazamiento UL–DL según la banda (`case`: B3 −95 MHz, B8 −45, B20 +41, B28 −55).
3. Reemplaza los marcadores `@BAND@`, `@DL_HZ@`, `@UL_OFFSET@`, `@TX_GAIN@`, `@MME_IP@`, `@ENB_IP@` en `config/oai/enb.nbiot.conf.tmpl` y genera `/tmp/enb.nbiot.conf`.
4. Lanza `exec lte-softmodem -O /tmp/enb.nbiot.conf -S`.

La plantilla viene de la de ejemplo de OAI. Se fijan PLMN `001/01`, TAC `1` (deben coincidir con `mme.yaml`: de lo contrario el MME rechaza el S1 Setup), 50 PRB, 1 antena, y los parámetros NB-IoT (`nprach_*`, `npdcch_*`, temporizadores `_NB`) se dejan en los de OAI.

## Seguridad de radio

Las barreras de emisión (plan RF, confirmación, corte y registro) están en [`seguridad-rf.md`](../operacion/seguridad-rf.md).

## Panel (`app/main.py`)

### Qué integra

Un solo proceso Python que integra **cinco fuentes** distintas en una API [leído]:

| Integración | Biblioteca | Qué hace |
|---|---|---|
| Docker | `docker` (SDK, vía `/var/run/docker.sock`) | Lista contenedores `nb-*`, enciende/apaga el eNB, lee sus registros (`c.logs(tail=…)`) |
| MongoDB | `pymongo` | CRUD de suscriptores (`/api/subscribers`); **nunca devuelve K ni OPc** (`sub_view`) |
| MQTT | `paho-mqtt` | Se suscribe a `nb/+/telemetry` y `nb/+/status`; publica comandos en `nb/<id>/cmd` con QoS 1 |
| Scripts | `subprocess` | Ejecuta `rf-check.sh` y convierte las líneas `PASS/FAIL` en JSON |
| Navegador | SSE (`/api/stream`) | Empuja eventos en vivo (telemetría, estado de radio, cambios de suscriptores) con `StreamingResponse` |

Para saber si el eNB está conectado, `/api/enb` **lee los registros del contenedor `nb-mme`** y busca la cadena `eNB-S1 accepted` (el mensaje que genera `s1ap_handle_s1_setup_request`, ver [`open5gs.md`](open5gs.md)). Es decir, el panel observa a Open5GS a través de sus registros, sin modificarlo.

El frontend (`app/web/`) es React + TypeScript: `components/Diagram.tsx` dibuja los diagramas animados del flujo, cada pestaña es un componente de `tabs/` y `store.ts` guarda el estado global y la conexión SSE.

### Concurrencia y comunicación

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

## Frontend (`app/web/src/`)

Aplicación **React 18 + TypeScript** compilada con Vite (detalle de archivos en [`panel.md`](../operacion/panel.md), «Frontend»). Corre en el **único hilo** del navegador: `fetch()` para la API REST, **`EventSource('/api/stream')`** para los eventos del servidor (`store.ts` los convierte en estado global leído con `useSyncExternalStore`) y **SVG animado** (`components/Diagram.tsx`) para los diagramas. Cada pestaña es un componente en `tabs/`; el laboratorio tiene su propio motor de reproducción de eventos (`lab/engine.ts`).

## Firmware del dispositivo

- **`firmware/esp32-nbiot/esp32-nbiot.ino`** (86 líneas): el ESP32 habla por UART 2 con el SIM7080G usando **TinyGSM** (comandos AT). `attach()` envía `AT+CMNB=2` (modo NB-IoT), `AT+CBANDCFG="NB-IOT",<banda>` y `AT+COPS=1,2,"<PLMN>"` (selección manual de la red 001/01), espera registro y abre PDP/APN. Luego publica JSON por MQTT y atiende comandos `{"led":…,"interval_s":…}`. Usa un *last will* (`offline`, retenido) para que el panel detecte desconexiones. **Sin probar en hardware.**
- **`app/fake_device.py`**: simula el ESP32 publicando telemetría inventada directo al broker. Su carga incluye `"sim": true` para que el panel lo marque. **No ejercita el núcleo ni la radio.**

### Cómo está organizado (`setup()` y `loop()`)

Modelo **`setup()` + `loop()`** (un bucle principal, sin sistema operativo visible; el ESP32 corre FreeRTOS por debajo pero el sketch es de un solo hilo). Objetos (clases C++): `HardwareSerial SerialAT(2)` (UART 2), `TinyGsm modem` (control del módem por **comandos AT**), `TinyGsmClient net` (cliente TCP sobre el módem), `PubSubClient mqtt` (cliente MQTT) y `DHT dht` (sensor). Flujo del `loop()`: si no hay red, `attach()` (`AT+CMNB=2`, `AT+CBANDCFG`, `AT+COPS`), luego `connectMqtt()` (con *last will* `offline` retenido) y cada `intervalMs` publica el JSON. El *callback* `onMessage` atiende comandos (`{"led":..., "interval_s":...}`) cuando `mqtt.loop()` procesa mensajes entrantes (es **sondeo**, no interrupciones).

## Simulador de telemetría (`app/fake_device.py`)

Cliente `paho-mqtt` en Python que publica telemetría inventada y escucha `nb/<id>/cmd`; añade `"sim": true`. Es independiente del Laboratorio.

## Scripts y contenedores

| Archivo | Lenguaje | Qué hace |
|---|---|---|
| `docker/open5gs/entrypoint.sh` | Bash + `perl` | Reescribe `ConnectPeer`/`ListenOn` de freeDiameter; para `open5gs-upfd` crea `ogstun` (`ip tuntap`), le asigna IP, la levanta y añade la regla `iptables … MASQUERADE`; termina con `exec "$@"` (el programa pasa a ser el proceso principal del contenedor, PID 1, y recibe las señales de Docker) |
| `scripts/oai-enb-start.sh` | Bash + `sed` | Plan RF → `.conf` del eNB → `exec lte-softmodem -O … -S` |
| `scripts/rf-check.sh`, `rf-run.sh` | Bash | Validan el plan; ejecutan con `timeout` y registro |
| `provisioning/subscriber-init.js` | JavaScript (`mongosh`) | Valida y hace `updateOne(…, {upsert: true})` del suscriptor |
| `compose.yaml` | YAML | Servicios, red con IP fija, perfiles (`sim`, `radio`), dependencias (`depends_on` con `service_healthy` / `service_completed_successfully`) |

## Cómo seguir explorando el código

1. Elegir un camino y seguirlo con `grep` dentro del contenedor. Por ejemplo, el *S1 Setup*:
   `grep -rn "s1ap_handle_s1_setup_request" /opt/open5gs/src` y luego `grep -rn "S1AP_REGISTER_ENB_REQ" /opt/oai/openair2 /opt/oai/openair3`.
2. Leer en este orden en Open5GS: `src/main.c` → `src/mme/mme-init.c` → `lib/core/ogs-queue.c`, `ogs-fsm.c` → `src/mme/mme-sm.c` → `s1ap-sm.c` → `emm-sm.c`.
3. Leer en este orden en OAI: `common/utils/itti/intertask_interface.c` → `targets/COMMON/create_tasks.c` → `openair2/ENB_APP/enb_app.c` → `openair3/S1AP/s1ap_eNB.c` → `targets/RT/USER/lte-enb.c` (`init_eNB_proc`, `eNB_thread_single`) → `openair2/PHY_INTERFACE/IF_Module_L2_primitives_NB_IoT.c` → `openair2/LAYER2/MAC/eNB_scheduler_NB_IoT.c`.
4. Probar en caliente (sin radio): `docker logs nb-mme` mientras `docker compose --profile sim up -d`, e identificar en el registro los eventos de «Recorrido de un registro» en [`open5gs.md`](open5gs.md).
