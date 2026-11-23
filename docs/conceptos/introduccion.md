# Introducción al proyecto

Lee este documento primero. Está pensado para quien programa con soltura y conoce lo básico de redes y telecomunicaciones, pero **no es experto en C ni en NB-IoT**. Explica qué es Narrowcast-NB, qué piezas tiene, cómo se relacionan y en qué orden conviene leer el resto de la documentación. No hace falta saber nada de redes celulares: se explica lo necesario y se enlaza el detalle.

## 1. Qué es, en un párrafo

Narrowcast-NB es una **red celular privada para sensores** hecha con software libre. Un sensor con un módulo NB-IoT y una SIM se conecta por radio a **tu propia estación base** y a **tu propio núcleo de red**, sin ningún operador de por medio, y sus datos aparecen en un panel web. Además incluye un **laboratorio** que reproduce toda la red sin radio ni hardware, para ver y probar por dentro cómo funciona.

Tiene dos usos, que comparten el mismo software:

| Uso | Qué necesita | Para qué sirve |
|---|---|---|
| **Red real** | Un USRP (radio por software), un módulo NB-IoT con SIM, un ESP32 y autorización escrita para emitir | Conectar un sensor real |
| **Laboratorio** | Solo Docker | Entender y probar la red sin emitir nada |

## 2. El problema que resuelve

Una red celular suele ser una caja negra que opera una empresa. Eso dificulta aprender cómo funciona (¿qué ocurre cuando un dispositivo «se registra»?) y experimentar con ella (¿qué pasa si la SIM está clonada o si el dispositivo está lejos?). Este proyecto monta **todos los elementos de la cadena** en un solo equipo y los hace visibles, con una idea de fondo: **no se programa un protocolo celular**; se integran, configuran, protegen y observan dos proyectos de código abierto que ya lo implementan.

## 3. NB-IoT en cinco ideas

**NB-IoT** (*Narrowband IoT*) es una tecnología del 3GPP, el organismo que estandariza 4G y 5G, diseñada para sensores que mandan pocos datos y deben durar años con batería.

1. **Es LTE reducido.** Usa una portadora de solo 180 kHz, dentro o junto a una portadora LTE normal, y reutiliza gran parte de la red 4G.
2. **Sacrifica velocidad.** Manda pocos bytes por mensaje; a cambio llega más lejos y a sitios con poca señal.
3. **Repite para llegar.** Con señal débil, el dispositivo repite cada transmisión muchas veces (los «niveles de cobertura» CE0, CE1 y CE2). Más repeticiones significan más alcance, más latencia y más consumo.
4. **Duerme casi todo el tiempo.** Los modos de ahorro (PSM y eDRX) apagan la radio entre envíos, y por eso una orden desde la red puede tardar en llegar: el dispositivo solo escucha en ciertos momentos.
5. **Necesita una SIM y una red.** Como un móvil, se autentica ante la red con su SIM antes de poder enviar nada.

## 4. Las piezas y cómo se conectan

```
ESP32 ──UART (AT)── Módulo NB-IoT ~~ radio ~~ Estación base (eNB) ── Núcleo (EPC) ── Broker MQTT ── Panel web
 sensor               + SIM            Uu        OAI + USRP        S1     Open5GS        Mosquitto    FastAPI + React
```

| Pieza | Qué es | Quién la aporta |
|---|---|---|
| **ESP32** | El microcontrolador del sensor. Lee sensores y manda órdenes al módulo con comandos de texto (comandos AT por un puerto serie) | Firmware propio |
| **Módulo NB-IoT + SIM** | El «teléfono» del sensor (SIM7080G). Habla por radio con la estación base | Hardware |
| **eNB (estación base)** | Traduce entre la radio NB-IoT y la red por cable. Aquí es **OpenAirInterface (OAI)** con un USRP | Terceros |
| **Núcleo (EPC)** | El «cerebro» de la red: autentica la SIM, asigna una IP y reenvía los datos. Aquí es **Open5GS** | Terceros |
| **MQTT** | Mensajería publicar/suscribir muy ligera. El sensor publica su telemetría y el panel le manda órdenes | Mosquitto (terceros) |
| **Panel** | Interfaz web para operar la red, dar de alta SIM y ver los datos | Propio |
| **Laboratorio** | Simulador del nodo y vistas internas de cada parte | Propio |

Todo lo que no es radio corre en **contenedores Docker** de un mismo equipo, con una red propia y una IP fija por contenedor.

## 5. Qué pasa cuando un sensor se conecta

Es el procedimiento central del proyecto y el que más conviene entender. Dicho sin jerga:

1. El módulo busca la señal de la estación base y le pide acceso por radio.
2. Se abre una conexión de radio y el módulo envía su **solicitud de registro** (*Attach Request*), que la estación base reenvía al núcleo.
3. El núcleo comprueba con la base de datos de SIM que el dispositivo existe y lanza un **desafío criptográfico**. La SIM lo responde usando una clave secreta que nunca viaja por el aire. Si coincide, **ambos se han autenticado entre sí**.
4. Se acuerdan los algoritmos de seguridad.
5. El núcleo crea una **sesión de datos** y le asigna una **dirección IP** al módulo (aquí, del rango `10.58.0.0/16`).
6. Desde ese momento el sensor es un equipo más de una red IP: abre una conexión MQTT y publica su telemetría, que cruza la estación base, el núcleo y llega al broker.

Si la SIM tiene otra clave (una **SIM clonada**) o no está dada de alta (un **intruso**), el paso 3 falla y la red rechaza el registro. El laboratorio permite provocar ambos casos.

## 6. Qué es del proyecto y qué es de terceros

| De terceros (no se reescribe) | Propio |
|---|---|
| El protocolo NB-IoT de la estación base (OAI) | Compilación reproducible en Docker de OAI y Open5GS |
| El núcleo 4G completo (Open5GS) | Configuración para que se hablen entre sí |
| El broker MQTT y la base de datos de SIM | Aprovisionamiento de SIM, panel web y firmware |
| | **Reglas de seguridad de radio** (la radio nace apagada) |
| | El **laboratorio** didáctico |

Un detalle importante: **emitir en una banda celular sin permiso es ilegal** y puede interferir a servicios reales. Por eso la radio está apagada por defecto y solo se activa con un plan validado, confirmación humana, límite de tiempo y registro de cada sesión ([`seguridad-rf.md`](../operacion/seguridad-rf.md)).

## 7. Real y simulado

Conviene tenerlo claro antes de leer el resto, porque la documentación lo distingue siempre.

| | Red real | Laboratorio |
|---|---|---|
| Núcleo Open5GS | Real | Real, el mismo |
| Estación base OAI | Real, con USRP | El software de OAI es real (RRC, S1AP, GTP-U, MAC); la **radio es falsa** |
| Autenticación de la SIM y datos MQTT | Reales | Reales, y los datos cruzan el túnel de OAI y el núcleo |
| Efectos de la radio (alcance, repeticiones, latencia) | Físicos | **Modelados**: se calculan, no se miden |
| Sensor y ESP32 | Reales | Un programa que imita su lógica |

El laboratorio prueba **el software** de la red, no la capa física.

## 8. Lo que ayuda saber antes de seguir

No hace falta dominarlo; con una idea general basta.

| Tema | Qué conviene saber | Dónde se explica |
|---|---|---|
| Redes IP | Dirección IP, subred, puerto, TCP frente a UDP | Conocimiento previo |
| **SCTP** | Un protocolo de transporte parecido a TCP que usa la señalización celular (puerto 36412) | [`fundamentos.md`](fundamentos.md), glosario |
| **MQTT** | Publicar/suscribir con *tópicos* y un *broker* | [`fundamentos.md`](fundamentos.md) |
| **Docker** | Imagen, contenedor y Compose | [`fundamentos.md`](fundamentos.md), [`docker-y-compilacion.md`](../operacion/docker-y-compilacion.md) |
| **Lectura de C** | Para el código de OAI y Open5GS. Basta con reconocer `struct`, punteros y funciones; en C no hay clases, y se simulan con estructuras y punteros a función | [`vision-general.md`](../arquitectura/vision-general.md#clases-en-c) |
| Procesos, hilos y colas | Un hilo que espera eventos y los procesa uno a uno | [`open5gs.md`](../arquitectura/open5gs.md) |

**Vocabulario mínimo** (el glosario completo está al final de [`fundamentos.md`](fundamentos.md)):

| Término | Significa |
|---|---|
| **UE** | *User Equipment*: el dispositivo, aquí el ESP32 con su módulo |
| **eNB** | *eNodeB*: la estación base 4G |
| **EPC** | *Evolved Packet Core*: el núcleo de red 4G |
| **MME / HSS / SGW / PGW** | Las funciones del núcleo: control y movilidad / base de datos de SIM / pasarelas de datos hacia la red |
| **NAS** | Los mensajes de señalización entre el dispositivo y el núcleo, que la estación base solo transporta |
| **S1** | La interfaz entre la estación base y el núcleo (S1-MME de señalización, S1-U de datos) |
| **Uu** | La interfaz de radio entre el dispositivo y la estación base |
| **IMSI, K, OPc** | Identidad de la SIM y sus claves secretas |
| **PLMN, TAC** | Identificadores de la red y de su zona (aquí `001/01` y `1`) |
| **GTP-U** | El túnel que lleva los datos de usuario entre la estación base y el núcleo |
| **SDR / USRP** | Radio definida por software, y la marca de radio que se usa |

## 9. Cómo recorrer el resto de la documentación

Elige según lo que quieras conseguir; cada tema está en un solo documento.

| Quiero… | Lee, en este orden |
|---|---|
| **Probar la red sin hardware** | [`puesta-en-marcha.md`](../operacion/puesta-en-marcha.md) → [`implementacion.md`](../laboratorio/implementacion.md) → [`radio-nbiot.md`](../laboratorio/radio-nbiot.md) |
| **Entender los conceptos a fondo** | [`fundamentos.md`](fundamentos.md) (NB-IoT, SIM, SDR, glosario, ejercicios) |
| **Ver cómo está construido** | [`vision-general.md`](../arquitectura/vision-general.md) → [`integracion.md`](../arquitectura/integracion.md) → [`open5gs.md`](../arquitectura/open5gs.md) y [`oai.md`](../arquitectura/oai.md) |
| **Saber qué se modificó de Open5GS y OAI** | [`modificaciones-oai-open5gs.md`](../arquitectura/modificaciones-oai-open5gs.md) |
| **Emitir radio de verdad** | [`seguridad-rf.md`](../operacion/seguridad-rf.md) → [`puesta-en-marcha.md`](../operacion/puesta-en-marcha.md) |
| **Saber qué está hecho y qué falta** | [`estado.md`](../proyecto/estado.md) |
| **Resolver una duda rápida** | [`preguntas-frecuentes.md`](../operacion/preguntas-frecuentes.md) |

Una convención a tener presente al leer el código citado: las marcas **[leído]**, **[estándar]**, **[observación]** y **[sin verificar]** indican de dónde sale cada afirmación y qué tan firme es ([`vision-general.md`](../arquitectura/vision-general.md#convenciones-y-cómo-comprobar-el-código-que-se-cita)). Lo que **no** se ha probado con hardware real está marcado como *sin verificar*; el estado completo está en [`estado.md`](../proyecto/estado.md).
