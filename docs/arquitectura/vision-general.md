# Visión general de la arquitectura

Cómo está construido Narrowcast-NB: capas, software de terceros y su versión, red Docker con sus IP, datos (MQTT y suscriptores) y firmware. Cada pieza de terceros tiene su propio documento ([`open5gs.md`](open5gs.md), [`oai.md`](oai.md)); cómo se unen, en [`integracion.md`](integracion.md); lo que se modificó, en [`modificaciones-oai-open5gs.md`](modificaciones-oai-open5gs.md); las reglas de radio, en [`../operacion/seguridad-rf.md`](../operacion/seguridad-rf.md).

## Vista de capas

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
| Panel de control | FastAPI + React/TypeScript (Vite) | Python 3.12 / TypeScript | `app/`, `app/web/` |
| Orquestación y reglas RF | Docker Compose, scripts | YAML / Bash | `compose.yaml`, `scripts/` |

## Red y direccionamiento

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
| 10.44.0.42 | `nb-simlab` | módulo del nodo de riego del **Laboratorio** (NAS real, MQTT real; su tráfico sale por OAI) | SCTP hacia 36412, UDP 2152, API 8090 → `127.0.0.1:8090` |

Solo la WebUI, el broker y el panel se publican hacia el host, y solo en `127.0.0.1`. Los puertos de señalización y de datos del núcleo (36412, 2123, 8805, 2152, Diameter) nunca salen de la red Docker. Los puertos estándar de cada interfaz (36412, 2123, 8805, 2152) son los de 3GPP; el puerto de Diameter es el de freeDiameter por defecto y no se fija en este repositorio.

Parámetros de red móvil: PLMN `001/01` (MCC 001, MNC 01, de pruebas), TAC `1`, APN `internet`, subred de UE `10.58.0.0/16` (puerta de enlace `10.58.0.1`), MTU 1400, DNS `1.1.1.1`.

## Radio virtual de pruebas (srsRAN)

Con el perfil `sim`, `nb-enb` (srsENB) y `nb-ue` (srsUE) se conectan entre sí por **ZeroMQ** (puertos TCP 2000/2001) en lugar de radio real y al núcleo por S1 con la red Docker. `scripts/validate.sh` comprueba S1 Setup, attach, IP del UE y ping por el túnel. No emite RF. Es LTE normal, no NB-IoT: valida el núcleo, no la radio de OAI.

## Suscriptores en MongoDB

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

## Datos: MQTT

El broker es Mosquitto 2 con `allow_anonymous false`, archivo de contraseñas generado al arrancar (`mosquitto_passwd`) y sin persistencia. El usuario y la clave salen de `MQTT_USER` y `MQTT_PASS` (`.env`).

| Tópico | Sentido | Carga | Notas |
|---|---|---|---|
| `nb/<id>/telemetry` | dispositivo → panel | `{"temp": °C, "hum": %, "rssi": dBm, "led": bool}` | QoS 1 |
| `nb/<id>/cmd` | panel → dispositivo | `{"led": bool}` y/o `{"interval_s": 5..86400}` | QoS 1 |
| `nb/<id>/status` | dispositivo → panel | `online` / `offline` | retenido; `offline` es el *last will* |

El dispositivo llega al broker por el camino completo: radio → eNB → S1-U → SGW-U → PGW-U → `ogstun` → broker `10.44.0.5`. **La ruta de retorno desde el broker hacia `10.58.0.0/16` aún no se ha verificado** y puede requerir una ruta o NAT adicional.

## Firmware del dispositivo

`firmware/esp32-nbiot/esp32-nbiot.ino` (Arduino, C++): el ESP32 habla por el UART 2 (RX 16, TX 17) con un módulo SIM7080G mediante la biblioteca TinyGSM (comandos AT), configura la banda con `AT+CBANDCFG="NB-IOT",<banda>`, se registra y abre MQTT con PubSubClient. Lee un sensor DHT22 (GPIO 4) y gobierna un LED (GPIO 2). Los datos sensibles (banda, broker, credenciales, identificador) van en `secrets.h`, que no se versiona. **Sin probar en hardware real.**

## Simulación sin hardware

Sin USRP ni ESP32, el panel distingue lo físico de lo simulado (ver [`panel.md`](../operacion/panel.md), «Real o simulado» y «Qué simula `fake_device.py`»): el núcleo es real; la radio puede ser virtual (srsRAN, perfil `sim`) y el dispositivo lo emula `fake_device.py`, que publica telemetría inventada directo al broker. Valida broker, panel y comandos, no el registro de la SIM ni el túnel por el núcleo. Los `epoll failed (EINTR)` de los registros de Open5GS son ruido conocido y no afectan.

## Convenciones y cómo comprobar el código que se cita

Todo lo marcado como **[leído]** se comprobó abriendo el código fuente real que viene dentro de las imágenes Docker del proyecto: `/opt/open5gs` (v2.7.5) y `/opt/oai` (rama `develop-nb-iot`). Para verlo usted mismo:

```bash
docker run --rm -it narrowcast-nb/open5gs:local bash                    # código en /opt/open5gs
docker run --rm -it --entrypoint bash narrowcast-nb/oai-nbiot:local     # código en /opt/oai
```

Las rutas de archivo del texto son relativas a esas carpetas. Lo marcado **[estándar]** viene de la especificación o de la documentación de la biblioteca. **[observación]** es una conclusión mía a partir de lo leído: conviene tratarla como hipótesis hasta probarla con hardware.

Tamaño de lo que se usa (líneas de C, aproximado): MME 32 000, SMF 27 000 (incluye código 5G que no se ejecuta), HSS 5 900, SGW-C 7 600, UPF 4 200, PCRF 3 300, SGW-U 2 300. OAI aporta unos 1 850 archivos C/C++/H en `openair1`, `openair2`, `openair3`, `targets` y `common`.

**[sin verificar]** es un supuesto que solo se confirma con hardware real.

### Clases en C

Por qué importa: en C no hay clases. Open5GS y OAI **simulan** la orientación a objetos con `struct` + punteros a función + convenciones de nombre (`mme_enb_t`, `mme_enb_add()`, `mme_enb_remove()`). Cuando aquí se habla de «clase» en C se refiere a ese patrón. Las clases reales (en el sentido de lenguaje) solo aparecen en el C++ del puente UHD, en el firmware (objetos `TinyGsm`, `PubSubClient`, `DHT`) y en el panel (clases `pydantic`, `FastAPI`).
