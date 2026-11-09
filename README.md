# Narrowcast-NB

Red privada celular IoT (NB-IoT / LTE-M) sobre Open5GS. Un ESP32 con un módulo NB-IoT (SIM7080G / BG96) se conecta por radio a un USRP que actúa de eNB, y este a un núcleo Open5GS que corre en Docker. Plan completo en [`docs/PLAN Narrowcast-NB.md`](docs/PLAN%20Narrowcast-NB.md).

```
ESP32 ──UART (AT)── Módulo NB-IoT ~~ antena ~~ USRP (eNB) ── UTP ── PC (Open5GS) ── MQTT
```

## Estado

| Fase | Descripción | Estado |
|---|---|---|
| 0 | Reglas de transmisión RF | Herramientas y módulo Radio del panel listos; falta la confirmación escrita del docente (banda, potencia, antena) |
| 1 | Núcleo Open5GS dockerizado, sin radio | Hecha y validada con radio virtual |
| 2 | Cadena de radio con LTE normal (USRP + teléfono) | Omitida (sin teléfono; la comprobación del USRP pasa a la Fase 3) |
| 3 | eNB NB-IoT (OAI `develop-nb-iot`) | En curso: imagen validada y eNB configurado; el S1 Setup con el MME funciona (sin radio); falta probarlo con USRP |
| 4 | El módulo se registra | Software listo (guía, WebUI, panel); falta hardware (módulo, SIM) y eNB |
| 5 | Datos reales (MQTT) | Broker, panel y firmware listos (probados con simulador; firmware sin probar en hardware) |
| 6 | PSM, eDRX y consumo | Pendiente |
| 7 | Informe y demostración | Pendiente |

## Qué falta

El software está listo hasta donde se puede sin hardware. Lo que queda depende de cosas externas:

| Falta | De qué depende | Fase |
|---|---|---|
| Autorización escrita (banda, potencia, cable o antena) y `data/rf-plan.yaml` completo | Docente | 0 |
| Modelo de USRP; si es USB, pasar `/dev/bus/usb` al contenedor y confirmar el `tx_gain` | Laboratorio | 3 |
| Barrido de espectro, elegir portadora libre y comprobar que el eNB emite NB-IoT (punto de decisión del plan) | USRP + analizador | 3 |
| SIM programable y lector PC/SC; alta de IMSI/Ki/OPc en la WebUI | Compra o laboratorio | 4 |
| Módulo NB-IoT (SIM7080G/BG96) con la banda confirmada; que el attach funcione con OAI + Open5GS (riesgo documentado) | Compra | 4 |
| Probar el firmware del ESP32 en hardware real | Módulo + ESP32 | 5 |
| PSM/eDRX, medición de consumo (INA226 u otro instrumento) | Hardware | 6 |
| Capturas de Wireshark, tabla de consumos, informe y demostración | Todo lo anterior | 7 |

Sin resolver aún en software: el panel no tiene todavía módulos de consumo, consola AT ni captura S1.

## Requisitos

Docker con Compose v2 (y unos 10 GB libres en disco para las imágenes; la de OAI sola ocupa varios GB). Para las fases con radio real, además un USRP y el módulo con su SIM.

## Puesta en marcha paso a paso

Para quien acaba de clonar el repositorio y quiere llegar al estado actual del proyecto: núcleo Open5GS, panel, broker MQTT y eNB NB-IoT configurado (la radio real queda para cuando haya USRP y autorización). Los comandos son de Linux (probado en Ubuntu) y se ejecutan desde la raíz del repositorio.

### 1. Requisitos previos

```bash
docker --version && docker compose version    # Docker con Compose v2
df -h /                                       # unos 10 GB libres (la imagen de OAI sola pesa ~5,3 GB)
```

Si Docker no está instalado: <https://docs.docker.com/engine/install/>. Hay que poder usar `docker` sin `sudo` (`sudo usermod -aG docker $USER` y volver a iniciar sesión).

### 2. Clonar y configurar

```bash
git clone https://github.com/franco0209/Narrowcast-NB.git
cd Narrowcast-NB
cp .env.example .env
```

Editar `.env` y cambiar al menos `MQTT_PASS` (clave del broker MQTT). El resto de valores sirve tal cual; los `SUBSCRIBER_*` son valores de ejemplo públicos, solo para pruebas.

### 3. Levantar el núcleo, el broker y el panel

```bash
docker compose up -d
```

La primera vez construye las imágenes de Open5GS (compila desde fuente: tarda bastante), la WebUI y el panel. Después arranca MongoDB, el EPC completo (MME, HSS, SGW-C/U, PGW-C/U, PCRF), Mosquitto y el panel. No emite nada por radio.

Comprobar:

```bash
docker compose ps                              # todos "running" (subscriber-provisioner termina solo: es normal)
docker logs nb-mme 2>&1 | tail -5              # "MME initialize...done" y "CONNECTED TO 'hss.localdomain'"
```

- Panel: <http://127.0.0.1:8080> (pestaña **Resumen**: los contenedores deben salir en verde).
- WebUI de Open5GS: <http://127.0.0.1:9999> (`admin` / `1423`; cambiar la clave). Ahí se registrarán las SIM reales.

### 3b. Probar el panel sin hardware

```bash
docker compose exec app python fake_device.py esp32-sim
```

En la pestaña **Dispositivo** aparecen medidores y gráfico en vivo; pulsar la bombilla envía una orden de LED por MQTT y el simulador la confirma. Detener con Ctrl+C.

### 4. (Opcional) Validar el núcleo con radio virtual

Comprueba que un UE simulado se registra, obtiene IP y hace ping por el túnel. Construye además la imagen de srsRAN (tarda y ocupa espacio).

```bash
docker compose --profile sim build             # imagen de srsRAN 4G
scripts/sim.sh up
scripts/sim.sh validate                        # S1 Setup, attach, IP y ping
scripts/sim.sh down
```

### 5. Construir el eNB NB-IoT (OAI)

```bash
docker build -t narrowcast-nb/oai-nbiot:local docker/oai-nbiot
```

Tarda unos 20 minutos y necesita ~6 GB libres en el pico. Comprobar que la imagen existe y arranca:

```bash
docker run --rm --entrypoint bash narrowcast-nb/oai-nbiot:local -c 'cd /opt/oai/cmake_targets/lte_build_oai/build && ./lte-softmodem -h | head -3'
```

### 6. Crear el contenedor del eNB

```bash
docker compose --profile radio create enb-nbiot
```

No lo enciende. Solo lo deja creado para que el botón de **Radio** del panel pueda arrancarlo.

### 7. Comprobar la conexión S1 entre el eNB y el MME (sin radio)

Esta prueba no emite RF: sin USRP el eNB se conecta por S1 y se detiene. `S1_ONLY=1` se salta el plan RF, así que **solo sirve para esta prueba** y después hay que recrear el contenedor normal.

```bash
docker rm -f nb-enb-nbiot
S1_ONLY=1 docker compose --profile radio up -d --no-deps enb-nbiot
sleep 25
docker logs nb-mme 2>&1 | grep "eNB-S1 accepted"      # el MME aceptó al eNB (S1 Setup)
docker logs nb-enb-nbiot 2>&1 | tail -5               # termina con "No USRP Device Found": esperado sin hardware
# Volver al modo normal (obligatorio):
docker rm -f nb-enb-nbiot && docker compose --profile radio create enb-nbiot
```

Hasta aquí llega todo lo verificado sin hardware.

### 8. Preparar la transmisión real (requiere USRP y autorización)

Solo con la **autorización escrita del docente** (banda, potencia, cable o antena) y el USRP conectado:

1. Abrir <http://127.0.0.1:8080> → **Radio**. El plan ya trae valores seguros (B3, cable, 60 dB, ganancia 0, 120 s).
2. Elegir la banda autorizada, hacer el barrido de espectro, y solo entonces activar **Portadora libre** y escribir **Autorizado por** (nombre y fecha). Sin estas dos confirmaciones el botón queda bloqueado.
3. Si el USRP es USB, pasar el dispositivo al contenedor (ver el comentario en `compose.yaml`, servicio `enb-nbiot`) y volver a crearlo con `docker compose --profile radio create enb-nbiot`.
4. Mantener pulsado el botón rojo 1,5 s. El eNB se enciende y se corta solo al cumplirse la duración; también se puede detener a mano.

Desde la terminal, el mismo plan se valida con `scripts/rf-check.sh` (el plan vive en `data/rf-plan.yaml`).

### 9. Módulo, SIM y firmware (requiere hardware)

1. Registrar la SIM (IMSI, Ki, OPc) en la WebUI (<http://127.0.0.1:9999>) con los mismos valores programados en la SIM.
2. Firmware del ESP32: copiar `firmware/esp32-nbiot/secrets.example.h` a `secrets.h`, completar banda (`NB_BAND`), broker (`10.44.0.5`), usuario y clave MQTT (los de `.env`) y `DEVICE_ID`, y cargarlo con Arduino IDE o PlatformIO. *Sin probar en hardware real.* Además, la ruta de datos del módulo hasta el broker (PGW-U → Mosquitto, con retorno hacia `10.58.0.0/16`) aún no se ha verificado y puede requerir una ruta o NAT adicional.
3. Seguir las guías de la pestaña **Guía** del panel (comandos AT, registro y datos).

### Detener y limpiar

```bash
docker compose --profile sim --profile radio down     # detiene todo (los datos de MongoDB se conservan en su volumen)
docker compose down -v                                # además borra el volumen de MongoDB (suscriptores)
```

### Problemas frecuentes

| Síntoma | Causa y solución |
|---|---|
| El panel responde que no existe `nb-enb-nbiot` | Falta el paso 6 (`docker compose --profile radio create enb-nbiot`). |
| `no space left on device` al construir | Liberar disco: `docker builder prune -f` y `docker image prune`. |
| El puerto 8080, 9999 o 1883 está ocupado | Cambiar `APP_PORT`, `WEBUI_PORT` o `MQTT_PORT` en `.env` y repetir `docker compose up -d`. |
| El botón de transmisión sigue bloqueado | Falta **Portadora libre** o **Autorizado por** (la pestaña Radio marca con ✕ lo que falta). |
| El eNB termina con `No USRP Device Found` | Esperado sin USRP; con USRP, revisar el paso 8.3. |

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

## Fase 0: reglas de transmisión RF

RF apagada por defecto. Antes de emitir con un USRP real:

```bash
cp rf-plan.example.yaml data/rf-plan.yaml   # fuera de Git (o editarlo desde el panel web)
scripts/rf-check.sh                    # bloquea si falta algo
scripts/rf-run.sh --resultado "ok" -- <comando del eNB>
```

`rf-check.sh` exige: banda soportada por el módulo (B3, B8, B20, B28), EARFCN, `autorizado_por`, `tx_gain` ≤ 30, en modo cable atenuación ≥ 60 dB (en modo antena, permiso escrito), duración entre 1 y 600 s y portadora libre confirmada. `rf-run.sh` además corta el comando al cumplirse `duracion_max_s` y registra la sesión en `data/logs/rf-sessions.csv` (fecha, banda, ganancia, duración, resultado).

Por defecto, cable y atenuador; la antena solo con permiso escrito del docente. El script verifica que el plan esté completo, pero no mide potencia: eso se comprueba con un analizador de espectro. La radio virtual (ZMQ) de la Fase 1 no emite RF y no necesita nada de esto.

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
- **A verificar con el USRP real:** el script supone que el `tx_gain` de OAI es atenuación (atenuación = 90 − ganancia del plan, válido para B210); un USRP USB necesita pasar `/dev/bus/usb` al contenedor (ver comentario en `compose.yaml`).
- **Riesgo conocido:** la rama tiene funciones de subida marcadas como no conformes con 3GPP y se ha probado con módulos Quectel BC95 y un núcleo Nokia, no con Open5GS. Compilar no garantiza que el módulo se registre. Plan B: la rama `nb-iot-ubuntu24`.

## Panel de control (fases 0, 4 y 5)

Interfaz web en <http://127.0.0.1:8080> (servicio `app`, junto con el broker MQTT `mosquitto`; ambos arrancan con `docker compose up -d`).

| Módulo | Qué hace |
|---|---|
| **Resumen** | Mapa animado de la red (ESP32 → eNB → MME/SGW/PGW → Mosquitto → panel) con el estado real de cada contenedor; al hacer clic en un elemento muestra qué hace, sus interfaces y su registro. Las líneas se animan solo cuando ambos extremos están activos. |
| **Radio** | Plan RF con valores seguros ya cargados (B3, cable con 60 dB, ganancia 0, 120 s); se elige banda con un clic y todo se guarda solo. Solo faltan dos confirmaciones humanas: **portadora libre** y **autorizado por**. El botón de transmisión exige plan válido y mantenerlo pulsado 1,5 s; corta solo al cumplirse la duración, registra la sesión y apaga la RF si el panel se reinicia. |
| **Dispositivo** | Telemetría en vivo del ESP32 (medidores de temperatura/humedad, barras de señal, gráfico con tooltip), bombilla interactiva para el LED e intervalo de envío, por MQTT. |
| **Núcleo** | Estado de los contenedores, suscriptores (nunca Ki/OPc) y registro en vivo de cada contenedor (`/api/logs/<nb-...>`, solo lectura). |
| **Guía** | Instrucciones por fase (archivos en `docs/guide/*.md`). |

La interfaz sigue el tema claro/oscuro del sistema y no usa librerías externas. Con `?still` en la URL se desactivan las animaciones (útil para capturas).

- **MQTT:** usuario y clave en `.env` (`MQTT_USER`, `MQTT_PASS`); tópicos `nb/<id>/telemetry|cmd|status` (ver la guía 3).
- **Probar sin hardware:** `docker compose exec app python fake_device.py esp32-sim`.
- **Firmware:** `firmware/esp32-nbiot/` (Arduino IDE/PlatformIO, ESP32 + SIM7080G + DHT22 + LED). *Sin probar en hardware real.*
- **Plan RF y sesiones:** `data/rf-plan.yaml` y `data/logs/rf-sessions.csv` (fuera de Git; los usan tanto el panel como `scripts/rf-*.sh`).
- **Seguridad:** el panel monta el socket de Docker para encender el eNB, lo que equivale a acceso de administrador al equipo; por eso solo escucha en `127.0.0.1` y no debe exponerse a la red.
- **Pendiente:** el botón de transmisión controla el contenedor `nb-enb-nbiot`, que se crea con `docker compose --profile radio create enb-nbiot` (ya configurado; sin USRP el eNB arranca, hace S1 y se detiene).

## Estructura

```
compose.yaml            servicios (perfil `sim` = radio virtual)
.env.example            variables (copiar a .env)
rf-plan.example.yaml    plantilla del plan RF (se guarda en data/rf-plan.yaml)
config/open5gs/         MME, HSS, SGW-C/U, PGW-C/U (SMF/UPF), PCRF
config/srsran/          eNB y UE virtuales
config/oai/             plantilla del eNB NB-IoT (OAI)
provisioning/           alta del suscriptor en MongoDB
app/                    panel web (FastAPI + HTML/JS) y simulador de dispositivo
mosquitto/              configuración del broker MQTT
firmware/               código del ESP32
data/                   plan RF y registro de sesiones (no se versiona)
docker/                 Dockerfiles (open5gs, srsran4g, webui, oai-nbiot)
scripts/                sim.sh, validate.sh, rf-check.sh, rf-run.sh
docs/                   plan del proyecto, guías del panel y presentación de avance (Narrowcast-NB-avance.pptx)
```

`.env`, `data/`, `firmware/**/secrets.h` y los `.pcap` no se versionan.
