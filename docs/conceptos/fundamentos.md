# Fundamentos: entender Narrowcast-NB desde cero

Esta guía reúne los **fundamentos para entender y explicar el proyecto**: qué problema resuelve, qué es NB-IoT, qué es Open5GS, qué es OpenAirInterface (OAI), qué hace el código propio y cómo se conecta todo. Parte de los conceptos básicos y va subiendo de nivel. Los detalles de código, IP y puertos ya están en otros documentos; aquí se enlazan en vez de repetirse.

| Si quieres… | Lee |
|---|---|
| Entender el contexto y los conceptos | Esta guía, §1 a §5 |
| Saber qué hace cada pieza de terceros | §6 (Open5GS) y §7 (OAI) |
| Saber qué es propio y cómo funciona de punta a punta | §8 a §11 |
| Consultar estado, glosario, preguntas y ejercicios | §13 (estado de verificación), §14 (glosario), §15 (preguntas recurrentes), §16 (ejercicios) |
| Ver funciones, archivos y líneas concretas | [`integracion-oai-open5gs.md`](../arquitectura/integracion-oai-open5gs.md) |
| Entender el código: lenguajes, hilos, colas, semáforos, comunicación e interfaces | [`codigo-por-dentro.md`](../arquitectura/codigo-por-dentro.md) |
| Saber qué se modificó de Open5GS y OAI | [`modificaciones-oai-open5gs.md`](../arquitectura/modificaciones-oai-open5gs.md) |
| Probar todo el flujo sin hardware (pestaña **Laboratorio**) | [`panel.md` §7](../operacion/panel.md) y la guía «Laboratorio» de la pestaña Ayuda |
| Ver IP, puertos, interfaces y reglas RF | [`arquitectura.md`](../arquitectura/arquitectura.md) |
| Ver cómo se construye el panel | [`panel.md`](../operacion/panel.md) |
| Ver Docker y compilación | [`docker-y-compilacion.md`](../operacion/docker-y-compilacion.md) |

Convención: lo que afirmo sobre el funcionamiento del proyecto está comprobado en este repositorio. Lo que es teoría general (3GPP, NB-IoT) es conocimiento estándar. Lo que **no** se ha probado con hardware real se marca como *sin verificar* (resumen en §13 y [`verificacion.md`](../referencia/verificacion.md)).

---

## 1. El proyecto en un minuto

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
| Firmware del ESP32 y simulador de dispositivo | **Propio** (usa la biblioteca TinyGSM) |

Resumen honesto: **no programamos un protocolo celular**. Integramos, configuramos, protegemos y observamos dos proyectos que ya lo implementan. Ese trabajo de integración, que hay que entender a fondo, es el aporte.

---

## 2. Fundamentos: de IoT a la red celular

### 2.1 IoT y LPWAN

IoT (Internet de las Cosas) son dispositivos pequeños (sensores, medidores) que envían pocos datos de vez en cuando. Sus necesidades son distintas a las de un teléfono:

- **Batería de años** (no se recarga).
- **Muy bajo costo** por dispositivo.
- **Buena cobertura**, incluso en sótanos o zonas rurales.
- **Poco tráfico**: unos bytes cada minutos u horas.

Las redes **LPWAN** (Low Power Wide Area Network) están hechas para eso. Hay de dos tipos: las que usan espectro libre (LoRa/LoRaWAN, Sigfox) y las **celulares** (NB-IoT y LTE-M), que usan espectro licenciado de un operador y la infraestructura celular existente, con SIM, seguridad y roaming.

### 2.2 3GPP y las generaciones

**3GPP** es el consorcio que escribe los estándares celulares. Los estándares se publican por versiones (*Release*). 4G es **LTE** (EPC como núcleo), 5G es NR (5GC como núcleo). NB-IoT apareció en el **Release 13** (2016) como parte de LTE, no de 5G, aunque se mantiene en 5G como tecnología IoT.

### 2.3 Qué es NB-IoT

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

### 2.4 La arquitectura LTE/EPC y su vocabulario

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

Funciones del EPC (cada una es un proceso de Open5GS, ver §6):

- **MME**: el "cerebro" de señalización. Acepta eNB, autentica UE, negocia seguridad, pide la sesión, hace *paging* (busca al UE).
- **HSS**: la base de datos de suscriptores y el "centro de autenticación".
- **SGW** (*Serving Gateway*): ancla de los datos del lado de la red de acceso.
- **PGW** (*PDN Gateway*): el borde hacia Internet; asigna la IP al UE.
- **PCRF**: políticas y cobro (aquí solo políticas por defecto).

SGW y PGW se dividen en **-C** (control, decide) y **-U** (usuario, reenvía paquetes). Se hablan por **PFCP**.

---

## 3. La SIM y la autenticación

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

---

## 4. Radio definida por software (SDR)

Una estación base comercial usa hardware dedicado. Aquí se usa **SDR** (*Software Defined Radio*): el procesamiento de señal (modulación, codificación, protocolos) lo hace un **programa** en un PC (OAI), y un equipo genérico, el **USRP** de Ettus Research, solo convierte entre señal digital y radiofrecuencia (conversores ADC/DAC y amplificadores). El PC y el USRP se comunican por la biblioteca **UHD** (USRP Hardware Driver) por USB o red.

Ventajas: flexible y barato, ideal para investigación. Desventajas: el PC debe cumplir plazos de tiempo real (OAI usa hilos de tiempo real) y **la potencia de salida depende del modelo y de la ganancia configurada**, por lo que no es seguro asumir cuánto emite sin medirlo. De ahí las reglas de RF (§10).

---

## 5. Docker en este proyecto

**Docker** empaqueta un programa con sus dependencias en un contenedor, y **Docker Compose** levanta varios contenedores de un solo archivo (`compose.yaml`). Aquí se usa porque:

- OAI NB-IoT **solo compila en Ubuntu 14.04/16.04**; Open5GS usa Ubuntu 22.04; el panel, Python 3.12. Cada uno vive en su contenedor con su sistema.
- Todos se conectan por una red propia (`10.44.0.0/24`) con **IP fija por contenedor**, lo que permite que los archivos de configuración usen direcciones literales.
- Se arranca con un solo comando y es reproducible: las imágenes fijan versiones y *commits* exactos.

Los perfiles de Compose (`sim`, `radio`) permiten activar piezas opcionales: `sim` agrega radio virtual para pruebas, `radio` el eNB real, que además **nunca arranca solo** (solo lo enciende el panel).

---

## 6. Open5GS en profundidad

### 6.1 Qué es

**Open5GS** es una implementación **de código abierto, escrita en C**, de los núcleos de red **4G (EPC)** y **5G (5GC)** según 3GPP. Es mantenido principalmente por Sukchan Lee y una comunidad, y se usa mucho en redes privadas, laboratorios y proyectos de investigación. Su licencia es AGPL-3.0 (comprobado en el `LICENSE` del código que usa el proyecto). Aquí se usa la versión **v2.7.5**.

No contiene radio ni estación base: solo el núcleo. Por eso necesita un eNB aparte (aquí OAI, o srsRAN en las pruebas virtuales).

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

## 7. OpenAirInterface (OAI) en profundidad

### 7.1 Qué es

**OpenAirInterface** es un proyecto abierto, originado en **EURECOM** (Francia) y hoy impulsado por la *OpenAirInterface Software Alliance* (OSA), que implementa **toda la pila celular en software**: eNB/gNB (estación base), UE y núcleo, para 4G y 5G, sobre hardware SDR. Es de los pocos proyectos abiertos con **capa física completa**. Se escribe en C y se organiza en `openair1` (capa física), `openair2` (MAC, RLC, PDCP, RRC) y `openair3` (interfaz con el núcleo: S1AP, SCTP, GTP-U). Su licencia es propia, la *OAI Public License v1.0* (comprobado en el `LICENSE` de la rama usada).

### 7.2 La rama NB-IoT y por qué importa

OAI principal no trae NB-IoT. Hay una rama, **`develop-nb-iot`**, que lo agrega al **eNB** (no al UE ni al EPC). Su último *commit* es de 2020. Es la única implementación abierta de NB-IoT en el lado de la estación base que se conoce con capa física, y por eso se eligió, aunque con consecuencias:

- Duplica las estructuras de LTE en versiones `_NB_IoT` (más de 150 archivos), en lugar de integrarse.
- Solo compila en Ubuntu 14.04/16.04 (de ahí `ubuntu:16.04` en el Dockerfile) y exige parches menores (versión de `protobuf-c`).
- Se probó por sus autores con módulos Quectel BC95 y un núcleo comercial, **no con Open5GS**.

Esa última frase es el **principal riesgo técnico** del proyecto: S1 con Open5GS se verificó sin radio, pero que un módulo real termine el registro con esta pareja no está probado.

### 7.3 Qué parte se usa

Solo el ejecutable del eNB, `lte-softmodem`. Su pila, de arriba a abajo:

Tabla de capas del eNB (S1AP/SCTP, GTP-U, RRC, PDCP, RLC, MAC, PHY NB-IoT, UHD): ver [`arquitectura.md` §4](../arquitectura/arquitectura.md#4-openairinterface-qué-partes-se-usan).

El eNB es, en esencia, un **traductor**: hacia abajo habla radio NB-IoT con el módulo; hacia arriba habla S1AP/GTP-U con el núcleo. Para el núcleo, es un eNB cualquiera.

### 7.4 Lo que hace el proyecto sobre OAI (sin modificar su lógica)

1. **Compilarlo** en una imagen reproducible (con el parche de `protobuf-c`).
2. **Configurarlo** con una plantilla (`config/oai/enb.nbiot.conf.tmpl`): PLMN, TAC, IP del MME, 50 PRB, 1 antena.
3. **Generar la configuración desde el plan RF** (`scripts/oai-enb-start.sh`): banda, frecuencia y ganancia se toman del plan validado, se calcula el desplazamiento de subida según la banda y se lanza `lte-softmodem`.
4. **Proteger la emisión**: el eNB solo arranca desde el panel con plan válido y autorización.

Hallazgo para contar: una versión inicial del script trataba `tx_gain` como atenuación (`90 − tx_gain`), lo que habría pedido casi la máxima potencia con un valor "seguro". Leyendo el código de OAI se comprobó que `tx_gain` llega tal cual a `set_tx_gain` de UHD como **ganancia**, y se corrigió. Sigue pendiente medir la potencia real con un analizador de espectro. Detalle en [`integracion-oai-open5gs.md` §3.5](../arquitectura/integracion-oai-open5gs.md).

### 7.5 srsRAN: el "eNB virtual" de pruebas

Para validar el núcleo **sin emitir radio** se usa **srsRAN 4G**, otra pila celular libre. Con el perfil `sim`, un eNB (`srsenb`) y un UE (`srsue`) se conectan por **ZeroMQ** (un socket TCP en vez de radio) y el eNB habla S1 con Open5GS por la red Docker. Es LTE normal, no NB-IoT: **valida el núcleo, no la radio de OAI**. `scripts/validate.sh` comprueba S1 Setup, registro, IP del UE y un `ping` por el túnel.

---

## 8. Cómo funciona el proyecto de punta a punta

### 8.1 Arranque del sistema

`docker compose up -d` levanta, en orden de dependencias:

1. **MongoDB**, con una comprobación de salud.
2. **El aprovisionador** (`nb-subscriber-provisioner`): carga el suscriptor de prueba con `mongosh` y termina. El HSS no arranca hasta que termine bien.
3. **Funciones del núcleo** (HSS, PCRF, SGW-C/U, PGW-C/U, MME), cada una con su IP fija.
4. **Mosquitto** (broker MQTT con usuario y clave) y **WebUI** de Open5GS.
5. **El panel** (`nb-app`).

El eNB real **no** arranca aquí: queda creado y apagado. El panel lo enciende.

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

### 8.5 MQTT en una línea

MQTT es un protocolo de mensajería **publicar/suscribir** muy liviano, ideal para IoT. Nadie habla directamente con nadie: todos hablan con el **broker** (Mosquitto) y se intercambian mensajes por **tópicos**.

| Tópico | Sentido | Contenido |
|---|---|---|
| `nb/<id>/telemetry` | dispositivo → panel | `{"temp","hum","rssi","led"}` |
| `nb/<id>/cmd` | panel → dispositivo | `{"led": bool}` y/o `{"interval_s": n}` |
| `nb/<id>/status` | dispositivo → panel | `online`/`offline` (retenido; `offline` es el *last will*) |

*QoS 1* garantiza entrega al menos una vez. El *last will* es un mensaje que el broker publica solo si el dispositivo se cae sin despedirse: así el panel detecta la desconexión.

### 8.6 El panel

Un solo proceso **FastAPI** (Python) que integra cinco fuentes: **Docker** (estado y registros de contenedores; encender/apagar el eNB), **MongoDB** (CRUD de suscriptores, sin devolver K ni OPc), **MQTT** (telemetría y órdenes), **scripts** (validación del plan RF) y el **navegador** (eventos en vivo por **SSE**, *Server-Sent Events*). El frontend es JavaScript sin librerías: `diagram.js` dibuja los diagramas animados, `modules.js` implementa las pestañas.

Detalle clave: para saber si el eNB está conectado, el panel **lee los registros del MME** y busca la línea `eNB-S1 accepted`. Observa a Open5GS sin modificarlo.

Pestañas: Resumen (mapa animado), Suscriptores, Núcleo, eNB, Radio, Dispositivo y Ayuda. Ver [`panel.md`](../operacion/panel.md).

---

## 9. Real o simulado

| Pieza | Real | Simulado |
|---|---|---|
| Núcleo Open5GS, MongoDB, Mosquitto, panel | Siempre real | — |
| Radio | USRP + OAI NB-IoT (requiere equipo y autorización) | srsRAN con ZeroMQ (perfil `sim`), LTE sin emitir |
| Dispositivo | ESP32 + SIM7080G | `fake_device.py`, que publica telemetría inventada directo al broker |

El simulador de dispositivo valida broker, panel y comandos, **pero no** el registro de la SIM ni el paso por el núcleo. El panel lo distingue con la marca `"sim": true` en la telemetría y la tarjeta *Equipos físicos*.

---

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

## 11. Decisiones de diseño y su razón

| Decisión | Razón |
|---|---|
| 4G (EPC) y no 5G | La rama NB-IoT de OAI habla S1AP/EPC; el 5GC no aplica |
| Open5GS como núcleo | Libre, liviano, mantenido, con configuración YAML simple y MongoDB para suscriptores |
| OAI rama NB-IoT como eNB | Es la implementación abierta de NB-IoT con capa física completa |
| Todo en Docker con IP fijas | OAI exige Ubuntu 16.04; reproducibilidad; configuraciones con direcciones literales |
| Perfiles `sim` y `radio` | Permiten validar sin emitir radio |
| MQTT con Mosquitto | Protocolo liviano estándar de IoT |
| Plan RF + validación + corte automático | Cumplimiento legal y seguridad; el software de terceros no lo trae |
| Panel propio (FastAPI, JS sin frameworks) | Operar, observar y *enseñar* la red; los diagramas explican el procedimiento |
| Versiones y *commits* fijados | Reproducibilidad (ver [`docker-y-compilacion.md` §7](../operacion/docker-y-compilacion.md)) |

---

## 12. Mapa del repositorio

| Carpeta | Contenido |
|---|---|
| `compose.yaml` | Todos los servicios, la red y los perfiles |
| `docker/` | Dockerfiles y `entrypoint.sh` de open5gs, oai-nbiot, srsran4g, webui |
| `config/open5gs/` | YAML de cada función del EPC |
| `config/oai/` | Plantilla del eNB NB-IoT |
| `config/srsran/` | Configuración del eNB/UE virtuales |
| `provisioning/` | Alta del suscriptor de prueba |
| `scripts/` | `rf-check.sh`, `rf-run.sh`, `oai-enb-start.sh`, `sim.sh`, `validate.sh` |
| `mosquitto/` | Broker MQTT |
| `app/` | Panel (`main.py`, `static/`) y `fake_device.py` |
| `firmware/esp32-nbiot/` | Sketch del ESP32 |
| `docs/` | Esta documentación |

---

## 13. Qué está verificado y qué no

La tabla de estado está en [`verificacion.md`](../referencia/verificacion.md). En resumen: la parte de software está implementada y validada hasta donde se puede sin hardware; falta la prueba con USRP, SIM y módulo reales.

---

## 14. Glosario

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

---

## 15. Preguntas recurrentes

Las preguntas frecuentes sobre el proyecto están reunidas en [`preguntas-recurrentes.md`](../referencia/preguntas-recurrentes.md).

---

## 16. Ejercicios prácticos

Con el sistema levantado (`docker compose up -d`):

1. **Ver los contenedores y sus IP:** `docker compose ps`. Relaciona cada `nb-*` con su función (§6.2).
2. **Ver una SIM en la base de datos:** `docker exec -it nb-mongo mongosh open5gs --eval 'db.subscribers.find({}, {imsi:1, "slice.session.name":1})'`. Identifica IMSI y APN.
3. **Crear un suscriptor desde el panel** (pestaña Suscriptores) y comprobar que aparece en la WebUI (`:9999`). Se aprovecha que el HSS lee MongoDB en cada procedimiento.
4. **Generar telemetría simulada:** `docker compose exec app python fake_device.py esp32-sim`. Ver tarjeta y gráfico en Dispositivo; mandar un comando LED y ver cómo llega.
5. **Seguir el registro en vivo con radio virtual:** `docker compose --profile sim up -d`, luego `scripts/validate.sh`, y observar `docker logs nb-mme`, `nb-hss`, `nb-pgwc`. Identifica en los registros cada paso del attach (§8.2).
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

## 17. Cómo seguir

- Lectura del estándar: 3GPP TS 23.401 (arquitectura EPC), TS 36.413 (S1AP), TS 29.272 (S6a), TS 33.401 (seguridad LTE), TS 36.211/36.213 (capa física; NB-IoT en las mismas series, Release 13).
- Código: [Open5GS](https://github.com/open5gs/open5gs) y [OpenAirInterface](https://gitlab.eurecom.fr/oai/openairinterface5g) (rama `develop-nb-iot`).
- Para ver el código real que usa este proyecto, ya compilado en las imágenes: `docker run --rm -it narrowcast-nb/open5gs:local bash` (código en `/opt/open5gs`, si la imagen conserva las fuentes) y recorrido guiado en [`integracion-oai-open5gs.md`](../arquitectura/integracion-oai-open5gs.md).
