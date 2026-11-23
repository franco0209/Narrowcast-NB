# Docker, imágenes y compilación

Cómo se construye y se ejecuta el proyecto: qué imagen compila cada componente, con qué herramientas y versiones, cómo se orquesta con Docker Compose y qué variables controlan el comportamiento. Para la arquitectura, ver [`arquitectura.md`](../arquitectura/arquitectura.md).

## 1. Lenguajes y herramientas de construcción

| Componente | Lenguaje | Sistema de construcción | Dónde compila |
|---|---|---|---|
| Open5GS (EPC) | C | Meson + Ninja | `docker/open5gs/Dockerfile` |
| Open5GS WebUI | JavaScript (Next.js, Node 20) | `npm ci && npm run build` | `docker/webui/Dockerfile` |
| OAI eNB (NB-IoT) | C (y C++ en UHD) | script propio `build_oai` (CMake) | `docker/oai-nbiot/Dockerfile` |
| srsRAN 4G (radio virtual) | C++ | CMake | `docker/srsran4g/Dockerfile` |
| Panel | Python 3.12 (backend) + TypeScript/React (frontend) | `pip install` y `npm run build` (Vite) en dos etapas | `app/Dockerfile` |
| Mosquitto, MongoDB | — | imágenes oficiales sin modificar | — |
| Firmware ESP32 | C++ (Arduino) | Arduino IDE o PlatformIO | fuera de Docker |
| Scripts | Bash | — | `scripts/` |
| Alta de suscriptor de prueba | JavaScript (`mongosh`) | — | `provisioning/` |
| Códecs S1AP, NGAP y RRC | C generado con `asn1c` a partir de ASN.1 (`lib/asn1c`, `lib/s1ap`) | se compila con el resto de Open5GS | `docker/open5gs/Dockerfile` |
| freeDiameter (S6a, Gx) | C, biblioteca externa con hilos propios | se enlaza en las funciones de Open5GS | `docker/open5gs/Dockerfile` |
| UHD (controlador del USRP, Ettus) | C++ | se enlaza dentro de `lte-softmodem` | `docker/oai-nbiot/Dockerfile` |

Archivos de configuración por componente: YAML en Open5GS (se leen con `libyaml`), `.conf` en freeDiameter y en OAI (libconfig), variables de entorno y YAML del plan RF en el panel, `secrets.h` en el firmware y `.env` en Compose. En C no hay clases: Open5GS y OAI las simulan con `struct`, punteros a función y convenciones de nombre (detalle en [`codigo-por-dentro.md`](../arquitectura/codigo-por-dentro.md) §1).

## 2. Imágenes

| Imagen (por defecto) | Base | Contenido | Tamaño aprox. | Tiempo de construcción |
|---|---|---|---|---|
| `narrowcast-nb/open5gs:local` | `ubuntu:22.04` (fijada por digest) | Open5GS v2.7.5 compilado, freeDiameter, `iproute2`, `iptables`, `tcpdump` | varios GB | largo (compila desde fuente) |
| `narrowcast-nb/open5gs-webui:local` | `node:20-bookworm-slim` | WebUI de Open5GS v2.7.5 | — | medio |
| `narrowcast-nb/oai-nbiot:local` | `ubuntu:16.04` | OAI `develop-nb-iot` con `lte-softmodem` y UHD 3.15 | ~5,3 GB (≈6 GB libres al construir) | ~20 min |
| `narrowcast-nb/srsran4g:local` | `ubuntu:22.04` (por digest) | srsRAN 4G con ZeroMQ, sin UHD | — | largo |
| `narrowcast-nb/app:local` | `python:3.12-slim` | panel FastAPI | pequeña | segundos |

Las bases y los orígenes están **fijados** (digest de imagen o commit de Git) para que la construcción sea reproducible; el `Dockerfile` comprueba con `git rev-parse` que el código descargado es el commit esperado y falla si no.

### 2.1 Open5GS

1. `git clone --depth 1 --branch v2.7.5`, y `git fetch` + `checkout --detach` del commit `7dfd9a3` (se verifica).
2. `meson setup build --prefix=/usr/local && ninja -C build && ninja -C build install`.
3. Comprueba que existen los binarios (`command -v open5gs-…`) y borra `.git` y `build`.
4. Instala dependencias de desarrollo: `libsctp-dev` (SCTP), `libmongoc-dev`/`libbson-dev` (MongoDB), `libgnutls28-dev`, `libgcrypt20-dev` e `libidn11-dev` (freeDiameter y criptografía), `libnghttp2-dev`, `libmicrohttpd-dev`, `libyaml-dev`, `libtalloc-dev`, entre otras.
5. `entrypoint.sh` (punto de entrada): reescribe `ConnectPeer`/`ListenOn` de freeDiameter según variables de entorno, y, si el proceso es `open5gs-upfd`, crea `ogstun`, asigna la puerta de enlace, la levanta y activa `MASQUERADE`. Después hace `exec` del binario con su `-c config.yaml`.

Variable de ahorro: poner `OPEN5GS_IMAGE=lain5g-lab/open5gs:local` en `.env` reutiliza la imagen del laboratorio Lain5G (mismas versiones) y evita compilar.

### 2.2 OpenAirInterface (eNB NB-IoT)

1. `ubuntu:16.04` (la rama solo soporta 14.04/16.04).
2. Clon superficial (`--depth 1`, ~50 MB frente a varios GB del historial) de `develop-nb-iot`; falla si la punta de la rama no es `677bbab`.
3. Corrección: el script `build_helper` de OAI clona `protobuf-c` sin versión; se fija v1.3.3 con `sed` (la actual exige C++17).
4. `./build_oai -I --eNB -x -w USRP --install-system-files`: `-I` instala dependencias del sistema, `--eNB` compila el eNB, `-w USRP` incluye soporte UHD. Con `--build-arg OAI_HW=none` se compila sin radio, solo la parte de red.
5. Verifica que existe `lte_build_oai/build/lte-softmodem`.

En tiempo de ejecución, el eNB no usa el `entrypoint` de la imagen para configurarse: el servicio `enb-nbiot` ejecuta `scripts/oai-enb-start.sh`, que genera `/tmp/enb.nbiot.conf` desde la plantilla y el plan RF y lanza `lte-softmodem -O <conf> -S`.

### 2.3 srsRAN 4G

`release_23_11` (commit `eea87b1`), `cmake -DENABLE_ZEROMQ=ON -DENABLE_UHD=OFF -DENABLE_GUI=OFF`. Instala `srsenb` y `srsue`. Solo se usa en el perfil `sim`.

### 2.4 Panel y laboratorio (simlab)

El `Dockerfile` es de **dos etapas**: la etapa `web` (`node:22-alpine`) compila el front React (`npm ci && npm run build`) y la etapa final (`python:3.12-slim`) copia solo el resultado a `/app/static`; la imagen no lleva Node. En la etapa Python, capa de dependencias primero (`COPY requirements.txt` + `pip install`), luego el código. `requirements.txt` fija las versiones exactas.

El servicio `simlab` **reutiliza esta misma imagen** (`narrowcast-nb/app:local`) con otro comando (`uvicorn simlab.server:app`), así que no ocupa una imagen más. La imagen añade `iproute2` y `cryptography` (Milenage y EIA2); ya no lleva `pycrate`, porque el eNB del laboratorio es el de OAI y no hay S1AP propio. `simlab` lleva `NET_ADMIN`, `/dev/net/tun` y `rp_filter=0` para crear la interfaz TUN del módulo; el panel no.

## 3. Docker Compose

`compose.yaml` define 16 servicios en una sola red. Una plantilla YAML compartida (`x-open5gs`) evita repetir imagen, `build` y política de reinicio en los siete servicios de Open5GS.


### 3.1 Perfiles

| Perfil | Servicios | Para qué |
|---|---|---|
| *(ninguno, siempre)* | mongo, subscriber-provisioner, webui, mosquitto, app, mme, hss, sgwc, sgwu, pgwc, pgwu, pcrf | núcleo, datos y panel |
| `sim` | enb (srsRAN), ue (srsRAN) | validar el núcleo con radio virtual |
| `radio` | enb-nbiot (OAI) | radio real; no arranca solo, lo enciende el panel |

`docker compose up -d` levanta solo los servicios sin perfil. El contenedor del eNB real se crea una vez (`docker compose --profile radio create enb-nbiot`) y desde ahí el panel lo enciende y apaga con el SDK de Docker.

### 3.2 Dependencias y arranque

`mongo` tiene un *healthcheck* (`db.adminCommand('ping')`); el provisionador, el HSS y el PCRF esperan a que esté sano; el HSS espera además a que el provisionador termine (`service_completed_successfully`), de modo que el suscriptor de prueba exista antes de aceptar autenticaciones. El provisionador (`restart: "no"`) termina solo: es normal que aparezca como «exited».

### 3.3 Volúmenes y montajes

| Montaje | Servicio | Modo |
|---|---|---|
| volumen `narrowcast-nb-mongo-data` → `/data/db` | mongo | datos persistentes de MongoDB |
| `config/open5gs/<función>.yaml` → `/etc/open5gs/` | cada función de Open5GS | solo lectura |
| `config/srsran/*` | enb, ue (sim) | solo lectura |
| `config/oai/enb.nbiot.conf.tmpl`, `scripts/oai-enb-start.sh` | enb-nbiot | solo lectura |
| `data/` → `/data` | app (lectura/escritura), enb-nbiot (solo lectura) | plan RF y sesiones |
| `docs/guide/`, `scripts/` | app | solo lectura |
| `/var/run/docker.sock` | app | control del contenedor del eNB |
| `mosquitto/mosquitto.conf`, `mosquitto/entrypoint.sh` | mosquitto | solo lectura |

Configurar el núcleo sin reconstruir imágenes: los YAML se montan, de modo que basta editar y reiniciar el contenedor.

### 3.4 Privilegios y dispositivos

| Servicio | Requiere | Motivo |
|---|---|---|
| pgwu, ue | `cap_add: NET_ADMIN` y `/dev/net/tun` | crear la interfaz TUN (`ogstun`, túnel del UE) |
| enb-nbiot (USRP USB) | `/dev/bus/usb` y, si no se ve, `privileged` | acceso al USRP; hoy comentado en `compose.yaml` |
| app | socket de Docker | encender el eNB, leer estado y registros |

## 4. Variables de entorno (`.env`)

Copiar `.env.example` a `.env` (no se versiona).

| Variable | Valor por defecto | Efecto |
|---|---|---|
| `COMPOSE_PROJECT_NAME` | `narrowcast-nb` | prefijo del proyecto Compose |
| `OPEN5GS_IMAGE`, `SRSRAN_IMAGE`, `WEBUI_IMAGE`, `OAI_IMAGE`, `APP_IMAGE` | `narrowcast-nb/*:local` | permite reutilizar imágenes ya construidas |
| `WEBUI_PORT`, `APP_PORT`, `MQTT_PORT` | 9999, 8080, 1883 | puertos publicados en `127.0.0.1` |
| `SUBSCRIBER_IMSI`, `_MSISDN`, `_KEY`, `_OPC`, `_AMF`, `_SQN` | valores de ejemplo públicos | suscriptor de prueba que carga el provisionador |
| `APN_INTERNET` | `internet` | nombre del APN |
| `MQTT_USER`, `MQTT_PASS` | `nb`, **cambiar** | credenciales del broker; el panel y el simulador las usan |
| `S1_ONLY` | `0` | `1` = eNB solo para probar S1 sin emitir (no usar para transmitir) |

## 5. Comandos habituales

```bash
docker compose up -d                                  # núcleo + broker + panel
docker compose up -d --build app                      # reconstruir solo el panel
docker compose build                                  # construir todas las imágenes del núcleo
docker build -t narrowcast-nb/oai-nbiot:local docker/oai-nbiot      # eNB OAI (~20 min)
docker compose --profile radio create enb-nbiot       # crear el contenedor del eNB (una vez)
docker compose --profile sim build && scripts/sim.sh up && scripts/sim.sh validate && scripts/sim.sh down
docker logs -f nb-mme                                 # registro de un componente
docker compose --profile sim --profile radio down     # detener (conserva MongoDB)
docker compose down -v                                # detener y borrar suscriptores
```

## 6. Espacio y tiempos

La construcción completa ocupa decenas de GB entre capas intermedias e imágenes. Referencias medidas: la imagen de OAI pesa ~5,3 GB y necesita ~6 GB libres en el pico; Open5GS y srsRAN compilan desde fuente y tardan. Si falta espacio: `docker builder prune -f` y `docker image prune`.

## 7. Reproducibilidad y su límite

- Bases de imagen por digest y código por commit verificado: la misma construcción dará el mismo resultado.
- Lo que **no** está fijado: los paquetes `apt` del sistema base (se descargan al construir), las dependencias que instala el propio script de OAI (incluido UHD) y `npm` según el `package-lock.json` de Open5GS. Una construcción futura puede variar en esos puntos.
- La rama de OAI está detenida desde 2020; sus repositorios de dependencias antiguos pueden dejar de estar disponibles.
