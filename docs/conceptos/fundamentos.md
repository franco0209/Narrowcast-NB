# Fundamentos: entender Narrowcast-NB desde cero

Esta guía reúne lo necesario para **entender** el proyecto desde cero: qué problema resuelve, qué es NB-IoT, cómo es una red celular, qué es una SIM, un SDR y Docker, cómo funciona el sistema de punta a punta, qué decisiones se tomaron, un glosario y ejercicios. No repite el detalle técnico: lo enlaza.


| Si quieres… | Lee |
|---|---|
| Una primera visión y un mapa de lectura, sin conocimientos previos de NB-IoT | [`introduccion.md`](introduccion.md) |
| Entender el contexto y los conceptos | Esta guía |
| Saber qué hace Open5GS o OAI y cómo funcionan por dentro | [`open5gs.md`](../arquitectura/open5gs.md) y [`oai.md`](../arquitectura/oai.md) |
| Ver IP, puertos, MQTT y suscriptores | [`vision-general.md`](../arquitectura/vision-general.md) |
| Ver cómo se unen las piezas y cómo viaja un dato | [`integracion.md`](../arquitectura/integracion.md) |
| Saber qué se modificó de Open5GS y OAI | [`modificaciones-oai-open5gs.md`](../arquitectura/modificaciones-oai-open5gs.md) |
| Poner el sistema en marcha | [`puesta-en-marcha.md`](../operacion/puesta-en-marcha.md) |
| Probar todo sin hardware | [`implementacion.md`](../laboratorio/implementacion.md) y la guía «Laboratorio» de la pestaña Ayuda |
| Ver el estado de verificación | [`estado.md`](../proyecto/estado.md) |
| Resolver dudas rápidas | [`preguntas-frecuentes.md`](../operacion/preguntas-frecuentes.md) |

Convención: lo que se afirma sobre el funcionamiento del proyecto está comprobado en este repositorio. Lo que es teoría general (3GPP, NB-IoT) es conocimiento estándar. Lo que **no** se ha probado con hardware real se marca como *sin verificar*.

---

## El proyecto en un minuto

**Narrowcast-NB** es una red celular privada de NB-IoT hecha con software libre. Una red celular tiene siempre las mismas partes: un **dispositivo** con SIM, una **estación base** que habla por radio con él, un **núcleo de red** que autentica, controla y reenvía el tráfico, y una **aplicación** al final. Normalmente todo menos el dispositivo lo pone un operador (Movistar, Claro…). Aquí lo montamos nosotros:

```
ESP32 ──UART (AT)── Módulo NB-IoT ~~ radio ~~ USRP + OAI (eNB) ── UTP ── Open5GS (núcleo) ── MQTT ── Panel web
 sensor               (SIM7080G)       Uu        estación base       S1       EPC 4G       broker    operación
```

Qué se logra: que un sensor se registre con su SIM en **nuestra** red, obtenga una IP, mande temperatura/humedad y reciba órdenes (encender un LED), todo visible en un panel web. Además, el panel **controla la transmisión de radio** con reglas de seguridad, porque emitir en bandas celulares sin autorización es ilegal.

Qué es propio y qué es de terceros (la pregunta más importante del proyecto):

| Pieza | ¿De quién es? |
|---|---|
| Protocolo NB-IoT en la estación base (radio, MAC, RRC, S1AP) | **OAI** (tercero) |
| Núcleo de red 4G (MME, HSS, SGW, PGW, PCRF) | **Open5GS** (tercero) |
| Broker MQTT | **Mosquitto** (tercero) |
| Base de datos de SIM | **MongoDB** (tercero) |
| Configuración, orquestación en Docker, redes e IP fijas | **Propio** |
| Compilación reproducible de OAI y Open5GS | **Propio** (Dockerfiles) |
| Aprovisionamiento de suscriptores | **Propio** |
| Traducción del plan RF a la configuración del eNB, y reglas de seguridad de RF | **Propio** |
| Panel web (API, diagramas animados, módulos) | **Propio** |
| Laboratorio didáctico (simulador del nodo, radio falsa e inyector para OAI, vistas UE/RAN/núcleo, modelo de radio) | **Propio** |
| Firmware del ESP32 y simulador de dispositivo | **Propio** (usa la biblioteca TinyGSM) |

Resumen honesto: **no programamos un protocolo celular**. Integramos, configuramos, protegemos y observamos dos proyectos que ya lo implementan. Ese trabajo de integración, que hay que entender a fondo, es el aporte.

## Fundamentos: de IoT a la red celular

### IoT y LPWAN

IoT (Internet de las Cosas) son dispositivos pequeños (sensores, medidores) que envían pocos datos de vez en cuando. Sus necesidades son distintas a las de un teléfono:

- **Batería de años** (no se recarga).
- **Muy bajo costo** por dispositivo.
- **Buena cobertura**, incluso en sótanos o zonas rurales.
- **Poco tráfico**: unos bytes cada minutos u horas.

Las redes **LPWAN** (Low Power Wide Area Network) están hechas para eso. Hay de dos tipos: las que usan espectro libre (LoRa/LoRaWAN, Sigfox) y las **celulares** (NB-IoT y LTE-M), que usan espectro licenciado de un operador y la infraestructura celular existente, con SIM, seguridad y roaming.

### 3GPP y las generaciones

**3GPP** es el consorcio que escribe los estándares celulares. Los estándares se publican por versiones (*Release*). 4G es **LTE** (EPC como núcleo), 5G es NR (5GC como núcleo). NB-IoT apareció en el **Release 13** (2016) como parte de LTE, no de 5G, aunque se mantiene en 5G como tecnología IoT.

### Qué es NB-IoT

**NB-IoT** (*Narrowband IoT*) es una variante de LTE reducida para IoT:

| Característica | Valor / idea |
|---|---|
| Ancho de banda | **180 kHz** (un solo bloque de recursos de LTE; con bandas de guarda ocupa unos 200 kHz) |
| Modos de despliegue | *in-band* (dentro de una portadora LTE), *guard-band* (en la banda de guarda de LTE) y *standalone* (en espectro propio, p. ej. de GSM) |
| Velocidad | Baja: del orden de decenas de kbps |
| Cobertura | Hasta ~164 dB de pérdida admisible (mejor que LTE), gracias a **repeticiones** (el mismo mensaje se envía muchas veces y el receptor lo combina) |
| Duplex | *Half-duplex* (no transmite y recibe a la vez; el módulo es más simple y barato) |
| Ahorro de energía | **PSM** (*Power Saving Mode*, el módulo "duerme" y es inalcanzable) y **eDRX** (escucha al núcleo cada varios segundos/minutos en vez de continuamente) |
| Movilidad | Limitada (pensado para sensores fijos o casi fijos) |

Canales físicos de NB-IoT (aparecen en el código de OAI como archivos `*_NB_IoT.c`):

| Canal | Sentido | Para qué |
|---|---|---|
| NPSS / NSSS | bajada | Sincronización: el módulo se "engancha" al eNB y detecta la celda |
| NPBCH | bajada | Información básica de la celda (MIB-NB) |
| NPDCCH | bajada | Control: dice cuándo y dónde hay datos |
| NPDSCH | bajada | Datos hacia el dispositivo |
| NPRACH | subida | El dispositivo "pide la palabra" (acceso aleatorio) |
| NPUSCH | subida | Datos desde el dispositivo |

Optimizaciones **CIoT** (Cellular IoT) del núcleo, definidas en 3GPP: enviar datos pequeños dentro de los mensajes de señalización (NAS) sin crear la portadora de datos clásica, y negociar PSM/eDRX en el registro. En este proyecto **no se han verificado con la combinación OAI + Open5GS**; se usa el registro 4G convencional.

### La arquitectura LTE/EPC y su vocabulario

| Término | Qué es |
|---|---|
| **UE** | *User Equipment*: el dispositivo (aquí, el módulo NB-IoT con SIM) |
| **eNB** (eNodeB) | La estación base 4G. Habla por radio con el UE y por red IP con el núcleo |
| **EPC** | *Evolved Packet Core*: el núcleo 4G |
| **Uu** | Interfaz de radio entre UE y eNB |
| **S1** | Interfaz entre eNB y núcleo. **S1-MME** (señalización, con el MME) y **S1-U** (datos de usuario, con el SGW) |
| **PLMN** | Identificador de operador: **MCC** (país) + **MNC** (red). Aquí `001/01`, valores reservados para pruebas |
| **TAC / TAI** | Código de área de seguimiento: agrupa celdas para localizar al UE. Aquí TAC `1` |
| **IMSI** | Identificador único de la SIM (15 dígitos: MCC + MNC + número). Aquí `001010000000001` |
| **APN** | Nombre del "punto de salida a Internet" al que se conecta el UE. Aquí `internet` |
| **Bearer / portadora** | "Tubo" lógico con una calidad de servicio por el que viajan los datos del UE |
| **QCI** | Clase de calidad de servicio de una portadora (aquí QCI 9, la de "mejor esfuerzo") |
| **NAS** | Mensajes entre **UE y MME** (registro, autenticación, sesión). El eNB los transporta sin entenderlos |
| **AS** | Mensajes entre UE y eNB (RRC, radio) |
| **RRC** | Control de la conexión de radio (establecer, reconfigurar, liberar) |

Funciones del EPC (cada una es un proceso de Open5GS, ver [`open5gs.md`](../arquitectura/open5gs.md)):

- **MME**: el "cerebro" de señalización. Acepta eNB, autentica UE, negocia seguridad, pide la sesión, hace *paging* (busca al UE).
- **HSS**: la base de datos de suscriptores y el "centro de autenticación".
- **SGW** (*Serving Gateway*): ancla de los datos del lado de la red de acceso.
- **PGW** (*PDN Gateway*): el borde hacia Internet; asigna la IP al UE.
- **PCRF**: políticas y cobro (aquí solo políticas por defecto).

SGW y PGW se dividen en **-C** (control, decide) y **-U** (usuario, reenvía paquetes). Se hablan por **PFCP**.

## La SIM y la autenticación

La seguridad de una red celular se basa en un **secreto compartido** entre la SIM y el HSS, que nunca viaja por el aire:

| Dato | Dónde está | Para qué |
|---|---|---|
| **IMSI** | SIM y HSS | Identifica al suscriptor |
| **K** (Ki), 128 bits | SIM y HSS | Clave maestra secreta |
| **OPc**, 128 bits | SIM y HSS | Constante del operador derivada de OP, mezclada con K |
| **SQN** | SIM y HSS | Contador de secuencia, evita repetir vectores (ataques de repetición) |
| **AMF** | SIM y HSS | Campo de gestión de autenticación (aquí `8000`) |

Cómo se autentican mutuamente (**EPS-AKA con el algoritmo Milenage**):

1. El MME pide al HSS un **vector de autenticación** para ese IMSI.
2. El HSS lee K, OPc y SQN de MongoDB, genera un número aleatorio **RAND** y calcula con Milenage: **AUTN** (token para que el UE autentique a la red), **XRES** (respuesta esperada), **CK/IK** y de ahí la clave **K_ASME**.
3. El MME envía RAND y AUTN al UE.
4. La SIM calcula lo mismo con su K y su OPc. Si el AUTN coincide, **el UE confía en la red**. Devuelve su respuesta (**RES**).
5. El MME compara RES con XRES. Si coinciden, **la red confía en el UE**.
6. De K_ASME se derivan las claves de cifrado e integridad de la señalización.

Consecuencia práctica, clave en el proyecto: **K y OPc de la SIM física deben ser idénticos a los del suscriptor cargado en MongoDB**. Si no, la autenticación falla y el módulo no se registra. Por eso el panel tiene un módulo de **Suscriptores** y por eso K y OPc nunca se muestran de vuelta en pantalla.

## Radio definida por software (SDR)

Una estación base comercial usa hardware dedicado. Aquí se usa **SDR** (*Software Defined Radio*): el procesamiento de señal (modulación, codificación, protocolos) lo hace un **programa** en un PC (OAI), y un equipo genérico, el **USRP** de Ettus Research, solo convierte entre señal digital y radiofrecuencia (conversores ADC/DAC y amplificadores). El PC y el USRP se comunican por la biblioteca **UHD** (USRP Hardware Driver) por USB o red.

Ventajas: flexible y barato, ideal para investigación. Desventajas: el PC debe cumplir plazos de tiempo real (OAI usa hilos de tiempo real) y **la potencia de salida depende del modelo y de la ganancia configurada**, por lo que no es seguro asumir cuánto emite sin medirlo. De ahí las reglas de RF ([`seguridad-rf.md`](../operacion/seguridad-rf.md)).

## Docker en este proyecto

**Docker** empaqueta un programa con sus dependencias en un contenedor, y **Docker Compose** levanta varios contenedores de un solo archivo (`compose.yaml`). Aquí se usa porque:

- OAI NB-IoT **solo compila en Ubuntu 14.04/16.04**; Open5GS usa Ubuntu 22.04; el panel, Python 3.12. Cada uno vive en su contenedor con su sistema.
- Todos se conectan por una red propia (`10.44.0.0/24`) con **IP fija por contenedor**, lo que permite que los archivos de configuración usen direcciones literales.
- Se arranca con un solo comando y es reproducible: las imágenes fijan versiones y *commits* exactos.

Los perfiles de Compose (`sim`, `radio`) permiten activar piezas opcionales: `sim` agrega radio virtual para pruebas, `radio` el eNB real, que además **nunca arranca solo** (solo lo enciende el panel).

## Cómo funciona el proyecto de punta a punta

### Arranque del sistema

`docker compose up -d` levanta, en orden de dependencias:

1. **MongoDB**, con una comprobación de salud.
2. **El aprovisionador** (`nb-subscriber-provisioner`): carga el suscriptor de prueba con `mongosh` y termina. El HSS no arranca hasta que termine bien.
3. **Funciones del núcleo** (HSS, PCRF, SGW-C/U, PGW-C/U, MME), cada una con su IP fija.
4. **Mosquitto** (broker MQTT con usuario y clave) y **WebUI** de Open5GS.
5. **El panel** (`nb-app`).

El eNB real **no** arranca aquí: queda creado y apagado. El panel lo enciende.

### MQTT en una línea

MQTT es un protocolo de mensajería **publicar/suscribir** muy liviano, ideal para IoT. Nadie habla directamente con nadie: todos hablan con el **broker** (Mosquitto) y se intercambian mensajes por **tópicos**.

| Tópico | Sentido | Contenido |
|---|---|---|
| `nb/<id>/telemetry` | dispositivo → panel | `{"temp","hum","rssi","led"}` |
| `nb/<id>/cmd` | panel → dispositivo | `{"led": bool}` y/o `{"interval_s": n}` |
| `nb/<id>/status` | dispositivo → panel | `online`/`offline` (retenido; `offline` es el *last will*) |

*QoS 1* garantiza entrega al menos una vez. El *last will* es un mensaje que el broker publica solo si el dispositivo se cae sin despedirse: así el panel detecta la desconexión.

El registro de un dispositivo y el recorrido de un dato, con las funciones de cada paso, están en [`integracion.md`](../arquitectura/integracion.md). El panel está descrito en [`panel.md`](../operacion/panel.md).

## Real o simulado

| Pieza | Real | Simulado |
|---|---|---|
| Núcleo Open5GS, MongoDB, Mosquitto, panel | Siempre real | — |
| Radio | USRP + OAI NB-IoT (requiere equipo y autorización) | srsRAN con ZeroMQ (perfil `sim`), LTE sin emitir |
| Dispositivo | ESP32 + SIM7080G | `fake_device.py`, que publica telemetría inventada directo al broker; en el Laboratorio, un nodo de riego cuya lógica imita el firmware |
| ENB en el Laboratorio | — | OAI real (RRC, S1AP, GTP-U, MAC) con **radio falsa** y un inyector de mensajes; el núcleo y el NAS son reales, solo la capa física no |
| Efectos de la radio (cobertura, repeticiones, latencia, energía) | Físicos, con USRP | **Modelados** en el Laboratorio ([`radio-nbiot.md`](../laboratorio/radio-nbiot.md)); no medidos |

El simulador de dispositivo valida broker, panel y comandos, **pero no** el registro de la SIM ni el paso por el núcleo. El panel lo distingue con la marca `"sim": true` en la telemetría y la tarjeta *Equipos físicos*.

## Seguridad de radiofrecuencia

La radio está apagada por defecto y cada emisión pasa por un plan validado, confirmación humana, corte automático y registro. Detalle en [`seguridad-rf.md`](../operacion/seguridad-rf.md).

## Decisiones de diseño y su razón

| Decisión | Razón |
|---|---|
| 4G (EPC) y no 5G | La rama NB-IoT de OAI habla S1AP/EPC; el 5GC no aplica |
| Open5GS como núcleo | Libre, liviano, mantenido, con configuración YAML simple y MongoDB para suscriptores |
| OAI rama NB-IoT como eNB | Es la implementación abierta de NB-IoT con capa física completa |
| Todo en Docker con IP fijas | OAI exige Ubuntu 16.04; reproducibilidad; configuraciones con direcciones literales |
| Perfiles `sim`, `oailab` y `radio` | Permiten validar y practicar sin emitir radio |
| MQTT con Mosquitto | Protocolo liviano estándar de IoT |
| Plan RF + validación + corte automático | Cumplimiento legal y seguridad; el software de terceros no lo trae |
| Panel propio (FastAPI + React/TypeScript) | Operar, observar y *enseñar* la red; los diagramas explican el procedimiento |
| Versiones y *commits* fijados | Reproducibilidad (ver [`docker-y-compilacion.md`](../operacion/docker-y-compilacion.md), «Reproducibilidad y su límite») |

## Mapa del repositorio

| Carpeta | Contenido |
|---|---|
| `compose.yaml` | Todos los servicios, la red y los perfiles |
| `docker/` | Dockerfiles y `entrypoint.sh` de open5gs, oai-nbiot, srsran4g, webui |
| `config/open5gs/` | YAML de cada función del EPC |
| `config/oai/` | Plantilla del eNB NB-IoT |
| `config/srsran/` | Configuración del eNB/UE virtuales |
| `provisioning/` | Alta del suscriptor de prueba |
| `scripts/` | `rf-check.sh`, `rf-run.sh`, `oai-enb-start.sh`, `oai-lab-start.sh`, `sim.sh`, `validate.sh` |
| `mosquitto/` | Broker MQTT |
| `app/` | Panel: `main.py` (FastAPI), `web/` (React + TypeScript), `simlab/` (simulador del laboratorio) y `fake_device.py` |
| `lab/oai-fakerf/` | Radio falsa, inyector y relevo de datos para el eNB de OAI del laboratorio |
| `firmware/esp32-nbiot/` | Sketch del ESP32 |
| `docs/` | Esta documentación |

## Glosario

| Término | Significado |
|---|---|
| 3GPP | Organismo que estandariza redes celulares |
| AKA | *Authentication and Key Agreement*: autenticación mutua UE-red |
| AMBR | Velocidad máxima agregada permitida a un suscriptor |
| AMF (autenticación) | Campo de gestión en la autenticación (`8000`); no confundir con la función AMF de 5G |
| AT (comandos) | Lenguaje de texto para controlar un módem (`AT+CMNB=2`) |
| ASN.1 | Notación con que se definen los mensajes S1AP y RRC |
| Attach | Registro del UE en la red |
| AUTN, RAND, XRES, RES | Elementos del desafío de autenticación |
| Bearer | Portadora; "tubo" de datos con calidad de servicio |
| CIoT | Cellular IoT: optimizaciones para dispositivos de bajo consumo |
| DHT22 | Sensor de temperatura y humedad |
| Diameter | Protocolo de autenticación y políticas (S6a, Gx) |
| eDRX / PSM | Mecanismos de ahorro de energía |
| EARFCN | Número que codifica una frecuencia de portadora LTE |
| eNB | Estación base 4G |
| EPC | Núcleo 4G |
| freeDiameter | Biblioteca de Diameter usada por Open5GS |
| GTP-C / GTP-U | Túneles de control y de datos entre elementos del núcleo y el eNB |
| HSS | Base de datos de suscriptores y centro de autenticación |
| IMSI | Identificador de la SIM |
| ITTI | Mensajería entre tareas dentro de OAI |
| K, OPc | Claves secretas de la SIM |
| LPWAN | Red de bajo consumo y gran alcance |
| Milenage | Algoritmo que calcula los vectores de autenticación |
| MME | Función de señalización del EPC |
| MQTT | Mensajería publicar/suscribir para IoT |
| NAS | Señalización UE ↔ MME |
| NB-IoT | LTE de banda angosta para IoT (180 kHz) |
| NPRACH, NPUSCH, NPDSCH… | Canales físicos de NB-IoT |
| OAI | OpenAirInterface |
| PCRF | Políticas y cobro |
| PDR / FAR | Reglas de PFCP: qué paquetes capturar y qué hacer con ellos |
| PFCP | Protocolo entre función de control y de usuario (UDP 8805) |
| PLMN | MCC + MNC: identifica la red |
| PRB | Bloque de recursos de radio |
| RRC | Control de la conexión de radio |
| S1AP | Protocolo de señalización eNB ↔ MME |
| SCTP | Transporte (como TCP/UDP) usado por S1AP |
| SDR | Radio definida por software |
| SGW / PGW | Pasarelas de datos del EPC |
| SQN | Contador de secuencia de autenticación |
| SSE | Eventos enviados del servidor al navegador |
| TAC / TAI | Código / identidad de área de seguimiento |
| TUN (`ogstun`) | Interfaz de red virtual por la que el PGW-U entrega paquetes IP |
| UE | Dispositivo del usuario |
| UHD | Controlador de los USRP |
| USRP | Radio SDR de Ettus Research |
| Uu | Interfaz de radio UE ↔ eNB |

## Ejercicios prácticos

Con el sistema levantado (`docker compose up -d`):

1. **Ver los contenedores y sus IP:** `docker compose ps`. Relaciona cada `nb-*` con su función (ver [`open5gs.md`](../arquitectura/open5gs.md)).
2. **Ver una SIM en la base de datos:** `docker exec -it nb-mongo mongosh open5gs --eval 'db.subscribers.find({}, {imsi:1, "slice.session.name":1})'`. Identifica IMSI y APN.
3. **Crear un suscriptor desde el panel** (pestaña Suscriptores) y comprobar que aparece en la WebUI (`:9999`). Se aprovecha que el HSS lee MongoDB en cada procedimiento.
4. **Generar telemetría simulada:** `docker compose exec app python fake_device.py esp32-sim`. Ver tarjeta y gráfico en Dispositivo; mandar un comando LED y ver cómo llega.
5. **Seguir el registro en vivo con radio virtual:** `docker compose --profile sim up -d`, luego `scripts/validate.sh`, y observar `docker logs nb-mme`, `nb-hss`, `nb-pgwc`. Identifica en los registros cada paso del attach (ver el recorrido en [`integracion.md`](../arquitectura/integracion.md)).
6. **Reproducir el attach paso a paso** en la pestaña Núcleo y asociar cada salto con una interfaz y un protocolo.
7. **Probar la validación RF:** en la pestaña Radio, dejar un campo vacío (por ejemplo *autorizado por*) y ver qué comprobación falla. Nunca emitir sin autorización.
8. **Leer una configuración:** abrir `config/open5gs/mme.yaml` y localizar PLMN, TAC y las IP; comparar con `config/oai/enb.nbiot.conf.tmpl`. Explicar qué pasa si el TAC no coincide.

### Autoevaluación

Puntos que conviene poder explicar tras recorrer la guía:

- Qué hace cada elemento de la cadena ESP32 → módulo → eNB → EPC → broker → panel.
- Qué es NB-IoT y qué lo diferencia de LTE normal.
- Para qué sirve cada función del EPC y qué interfaz las une.
- Cómo se autentica la SIM y por qué K y OPc deben coincidir.
- Qué es propio del proyecto y qué es de Open5GS y OAI.
- Qué está probado y qué falta, y por qué.
- Cómo se protege la emisión de radio.

---

## Cómo seguir

- Lectura del estándar: 3GPP TS 23.401 (arquitectura EPC), TS 36.413 (S1AP), TS 29.272 (S6a), TS 33.401 (seguridad LTE), TS 36.211/36.213 (capa física; NB-IoT en las mismas series, Release 13).
- Código: [Open5GS](https://github.com/open5gs/open5gs) y [OpenAirInterface](https://gitlab.eurecom.fr/oai/openairinterface5g) (rama `develop-nb-iot`).
- Para ver el código real que usa este proyecto, ya compilado en las imágenes: `docker run --rm -it narrowcast-nb/open5gs:local bash` (código en `/opt/open5gs`, si la imagen conserva las fuentes) y recorrido guiado en [`integracion.md`](../arquitectura/integracion.md).
