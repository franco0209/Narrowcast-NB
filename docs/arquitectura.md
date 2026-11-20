# Arquitectura técnica

Este documento describe cómo está construido Narrowcast-NB: qué software de terceros se usa y en qué versión, qué parte de cada uno se emplea, cómo se comunican los componentes (interfaces, protocolos, puertos, direcciones) y qué reglas de seguridad de radio se aplican. Para la visión general, ver el [README](../README.md); para el panel, [`panel.md`](panel.md); para imágenes y compilación, [`docker-y-compilacion.md`](docker-y-compilacion.md).

## 1. Vista de capas

```
┌───────────── Dispositivo ─────────────┐   ┌──────────── Radio ─────────────┐   ┌────────── Núcleo y servicios (Docker, un PC) ──────────┐
│ ESP32 ──UART/AT── Módulo NB-IoT + SIM │~~~│ USRP ──UHD── eNB OAI (NB-IoT)  │───│ Open5GS EPC · MongoDB · Mosquitto · Panel (FastAPI)    │
└───────────────────────────────────────┘Uu └────────────────────────────────┘S1 └─────────────────────────────────────────────────────────┘
```

Solo el tramo de radio (Uu) sale al aire. Todo lo demás corre en un único PC, en contenedores sobre una red Docker propia.

| Capa | Software | Lenguaje principal | Versión / origen |
|---|---|---|---|
| Firmware del dispositivo | Sketch Arduino (TinyGSM, PubSubClient, DHT) | C++ | `firmware/esp32-nbiot/` |
| Estación base (eNB) | OpenAirInterface, rama `develop-nb-iot` | C | commit `677bbab` (2020), Ubuntu 16.04 |
| Radio virtual (pruebas) | srsRAN 4G | C++ | `release_23_11`, commit `eea87b1` |
| Núcleo (EPC) | Open5GS | C | v2.7.5, commit `7dfd9a3` |
| Almacén de suscriptores | MongoDB | — | imagen fijada por digest |
| WebUI de respaldo | Open5GS WebUI | JavaScript (Next.js) | v2.7.5 |
| Mensajería | Eclipse Mosquitto | C | imagen `eclipse-mosquitto:2` |
| Panel de control | FastAPI + HTML/CSS/JS | Python 3.12 / JavaScript | `app/` |
| Orquestación y reglas RF | Docker Compose, scripts | YAML / Bash | `compose.yaml`, `scripts/` |

## 2. Red y direccionamiento

Una sola red Docker (`narrowcast-nb-core`, bridge, `10.44.0.0/24`) con IP fija por contenedor. La red de los equipos móviles (UE) es otra, `10.58.0.0/16`, que existe solo detrás del PGW-U.

| IP | Contenedor | Función | Puertos relevantes |
|---|---|---|---|
| 10.44.0.2 | `nb-mongo` | MongoDB, base `open5gs` | TCP 27017 (solo red interna) |
| 10.44.0.3 | `nb-subscriber-provisioner` | carga el suscriptor de prueba y termina | — |
| 10.44.0.4 | `nb-webui` | WebUI de Open5GS | TCP 9999 → `127.0.0.1:9999` |
| 10.44.0.5 | `nb-mosquitto` | broker MQTT | TCP 1883 → `127.0.0.1:1883` |
| 10.44.0.6 | `nb-app` | panel de control | TCP 8080 → `127.0.0.1:8080` |
| 10.44.0.10 | `nb-mme` | MME | SCTP 36412 (S1AP), UDP 2123 (GTP-C), Diameter |
| 10.44.0.11 | `nb-hss` | HSS | Diameter (S6a) |
| 10.44.0.12 | `nb-sgwc` | SGW-C | UDP 2123 (GTP-C), UDP 8805 (PFCP) |
| 10.44.0.13 | `nb-sgwu` | SGW-U | UDP 2152 (GTP-U), UDP 8805 (PFCP) |
| 10.44.0.14 | `nb-pgwc` | PGW-C (proceso `open5gs-smfd`) | UDP 2123, UDP 8805, Diameter (Gx) |
| 10.44.0.15 | `nb-pgwu` | PGW-U (proceso `open5gs-upfd`) | UDP 2152, UDP 8805, interfaz `ogstun` |
| 10.44.0.16 | `nb-pcrf` | PCRF | Diameter (Gx) |
| 10.44.0.40 | `nb-enb-nbiot` (perfil `radio`) o `nb-enb` (perfil `sim`) | eNB | SCTP (S1AP), UDP 2152 (S1-U) |
| 10.44.0.41 | `nb-ue` (perfil `sim`) | UE virtual | — |

Solo la WebUI, el broker y el panel se publican hacia el host, y solo en `127.0.0.1`. Los puertos de señalización y de datos del núcleo (36412, 2123, 8805, 2152, Diameter) nunca salen de la red Docker. Los puertos estándar de cada interfaz (36412, 2123, 8805, 2152) son los de 3GPP; el puerto de Diameter es el de freeDiameter por defecto y no se fija en este repositorio.

Parámetros de red móvil: PLMN `001/01` (MCC 001, MNC 01, de pruebas), TAC `1`, APN `internet`, subred de UE `10.58.0.0/16` (puerta de enlace `10.58.0.1`), MTU 1400, DNS `1.1.1.1`.

## 3. Open5GS: qué partes se usan

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

### 3.1 Interfaces entre funciones

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

### 3.2 Parámetros configurados

- **MME:** S1AP y GTP-C en `10.44.0.10`; clientes GTP-C: SGW-C `10.44.0.12` y SMF `10.44.0.14`; GUMMEI con MME group 2, code 1; TAI `001/01` TAC 1; orden de seguridad NAS: integridad `EIA2 > EIA1 > EIA0`, cifrado `EEA0 > EEA1 > EEA2`; nombre de red «Narrowcast».
- **PGW-C:** subred `10.58.0.0/16`, DNN `internet`, PFCP hacia `10.44.0.15`.
- **PGW-U:** interfaz `ogstun`; el `entrypoint.sh` la crea (`ip tuntap`), le asigna `10.58.0.1/16`, la levanta y añade una regla `iptables -t nat … MASQUERADE` para la subred de UE. Necesita `NET_ADMIN` y `/dev/net/tun`.
- **Suscriptor:** documento de la colección `subscribers` (ver §6).

### 3.3 Procedimiento de registro (attach)

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

## 4. OpenAirInterface: qué partes se usan

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

### 4.1 Configuración del eNB

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

### 4.2 Limitaciones conocidas

- La rama marca funciones de subida como no conformes con 3GPP y se probó con módulos Quectel BC95 y un núcleo Nokia, no con Open5GS. Compilar no garantiza que el módulo se registre. Plan B: la rama `nb-iot-ubuntu24`.
- Solo compila en Ubuntu 14.04/16.04: de ahí la imagen base `ubuntu:16.04`.
- Se corrigió en el `Dockerfile` la versión de `protobuf-c` (v1.3.3), porque el script de OAI clona la última, que exige C++17.

## 5. Radio virtual de pruebas (srsRAN)

Con el perfil `sim`, `nb-enb` (srsENB) y `nb-ue` (srsUE) se conectan entre sí por **ZeroMQ** (puertos TCP 2000/2001) en lugar de radio real y al núcleo por S1 con la red Docker. `scripts/validate.sh` comprueba S1 Setup, attach, IP del UE y ping por el túnel. No emite RF. Es LTE normal, no NB-IoT: valida el núcleo, no la radio de OAI.

## 6. Suscriptores en MongoDB

El HSS (y el PGW-C y el PCRF) leen la base `open5gs`, colección `subscribers`. Un suscriptor es un documento:

```json
{
  "imsi": "001010000000001",
  "msisdn": [],
  "schema_version": 1,
  "subscribed_rau_tau_timer": 12, "network_access_mode": 0,
  "subscriber_status": 0, "access_restriction_data": 32,
  "security": { "k": "…32 hex…", "opc": "…32 hex…", "op": null, "amf": "8000", "sqn": "000000000000" },
  "ambr": { "uplink": {"value": 1, "unit": 3}, "downlink": {"value": 1, "unit": 3} },
  "slice": [{ "sst": 1, "default_indicator": true, "session": [{
      "name": "internet", "type": 3,
      "qos": { "index": 9, "arp": { "priority_level": 8, "pre_emption_capability": 1, "pre_emption_vulnerability": 1 } },
      "ambr": { "uplink": {"value": 1, "unit": 3}, "downlink": {"value": 1, "unit": 3} },
      "pcc_rule": [] }] }]
}
```

Cuatro herramientas escriben este mismo esquema: el *provisionador* (`provisioning/subscriber-init.js`, con `mongosh`), el módulo **Suscriptores** del panel (`pymongo`), la WebUI de Open5GS (respaldo) y, a mano, `mongosh`. HSS y SMF consultan la colección en cada procedimiento, de modo que los cambios valen en el siguiente intento de conexión sin reiniciar. Ki y OPc nunca salen de MongoDB hacia el panel ni hacia el navegador.

## 7. Datos: MQTT

El broker es Mosquitto 2 con `allow_anonymous false`, archivo de contraseñas generado al arrancar (`mosquitto_passwd`) y sin persistencia. El usuario y la clave salen de `MQTT_USER` y `MQTT_PASS` (`.env`).

| Tópico | Sentido | Carga | Notas |
|---|---|---|---|
| `nb/<id>/telemetry` | dispositivo → panel | `{"temp": °C, "hum": %, "rssi": dBm, "led": bool}` | QoS 1 |
| `nb/<id>/cmd` | panel → dispositivo | `{"led": bool}` y/o `{"interval_s": 5..86400}` | QoS 1 |
| `nb/<id>/status` | dispositivo → panel | `online` / `offline` | retenido; `offline` es el *last will* |

El dispositivo llega al broker por el camino completo: radio → eNB → S1-U → SGW-U → PGW-U → `ogstun` → broker `10.44.0.5`. **La ruta de retorno desde el broker hacia `10.58.0.0/16` aún no se ha verificado** y puede requerir una ruta o NAT adicional.

## 8. Firmware del dispositivo

`firmware/esp32-nbiot/esp32-nbiot.ino` (Arduino, C++): el ESP32 habla por el UART 2 (RX 16, TX 17) con un módulo SIM7080G mediante la biblioteca TinyGSM (comandos AT), configura la banda con `AT+CBANDCFG="NB-IOT",<banda>`, se registra y abre MQTT con PubSubClient. Lee un sensor DHT22 (GPIO 4) y gobierna un LED (GPIO 2). Los datos sensibles (banda, broker, credenciales, identificador) van en `secrets.h`, que no se versiona. **Sin probar en hardware real.**

## 9. Seguridad de radiofrecuencia

Emitir en banda celular está regulado, así que la radio nace apagada y cada emisión pasa por varias barreras. Las aplican tanto `scripts/rf-check.sh` como el panel:

| Regla | Valor |
|---|---|
| Bandas permitidas | B3, B8, B20, B28 |
| Ganancia TX | ≤ 30 dB, empezando en 0 |
| Modo cable | atenuación ≥ 60 dB (por defecto) |
| Modo antena | solo con `antena_autorizada: sí` (permiso escrito) |
| Duración | de 1 a 600 s, con corte automático |
| Portadora | `portadora_libre: sí` tras un barrido de espectro |
| Autorización | `autorizado_por` con nombre y fecha |
| Confirmación | botón mantenido 1,5 s; cada sesión se registra |

Además: el eNB solo arranca desde el panel (`docker start` del contenedor ya creado), se apaga al reiniciarse el panel, y cada sesión queda en `data/logs/rf-sessions.csv` (fecha, banda, modo, ganancia, duración, resultado). El script valida que el plan esté completo; **no mide potencia**, eso se comprueba con un analizador de espectro.

Seguridad del panel: monta `/var/run/docker.sock` para encender el eNB, lo que equivale a acceso de administrador al equipo; por eso solo escucha en `127.0.0.1` y no debe exponerse a la red.


## 10. Simulación sin hardware

Sin USRP ni ESP32, el panel distingue lo físico de lo simulado (ver `docs/panel.md` §4.3–4.5): el núcleo es real; la radio puede ser virtual (srsRAN, perfil `sim`) y el dispositivo lo emula `fake_device.py`, que publica telemetría inventada directo al broker. Valida broker, panel y comandos, no el registro de la SIM ni el túnel por el núcleo. Los `epoll failed (EINTR)` de los registros de Open5GS son ruido conocido y no afectan.
