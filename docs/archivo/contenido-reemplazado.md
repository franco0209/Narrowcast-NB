# Contenido archivado

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
