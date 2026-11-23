# Estado por fases

Este documento reúne el desarrollo por fases de Narrowcast-NB: en qué estado está cada una, qué falta y el detalle técnico de cada fase. Cómo ponerlo en marcha y los problemas frecuentes están en [`puesta-en-marcha.md`](../operacion/puesta-en-marcha.md); el estado de verificación, en [`verificacion.md`](../referencia/verificacion.md). Para una visión general del proyecto, ver el [README](../../README.md); el plan completo está en [`plan.md`](plan.md).

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
| — | Laboratorio de simulación (nodo de riego sobre OAI con radio falsa + Open5GS) | Hecho: registro, datos MQTT y escenarios de ataque verificados sin radio (ver [`implementacion.md`](../laboratorio/implementacion.md)) |

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

Sin resolver aún en software: el panel no tiene todavía módulo de energía/consumo, consola AT real (el Laboratorio tiene una simulada), captura S1 ni diagnóstico guiado.

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
- **A verificar con el USRP real:** el `tx_gain` del plan se pasa tal cual a OAI, que lo entrega a UHD como ganancia (según el código; medir la potencia real con analizador antes de usar antena); un USRP USB necesita pasar `/dev/bus/usb` al contenedor (ver comentario en `compose.yaml`).
- **Riesgo conocido:** la rama tiene funciones de subida marcadas como no conformes con 3GPP y se ha probado con módulos Quectel BC95 y un núcleo Nokia, no con Open5GS. Compilar no garantiza que el módulo se registre. Plan B: la rama `nb-iot-ubuntu24`.
