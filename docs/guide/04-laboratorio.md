# 4. Laboratorio: un nodo de riego sobre una red real

Sirve para **probar la red completa sin hardware**: un nodo de riego NB-IoT se registra en el núcleo Open5GS a través del eNB de OpenAirInterface y manda datos MQTT reales por el túnel.

## El nodo

**Nodo de riego inteligente** (como los que se usan en huertos y jardines): un **ESP32** con un módulo **SIM7080G** (NB-IoT) y estos sensores y actuadores:

| Pieza | Para qué sirve |
|---|---|
| Sensor capacitivo de humedad de suelo | decide cuándo regar |
| DHT22 (temperatura y humedad del aire) | el calor seca más rápido el suelo |
| HC-SR04 (ultrasónico) sobre el tanque | mide la distancia al agua → nivel del tanque |
| Relé + bomba de agua | riega |
| LED rojo | alarma (tanque bajo, sensor tapado) |

La lógica es la del firmware `riego-nbiot.ino` (se muestra en el cuadro del UE): **riego automático** (enciende la bomba con el suelo bajo 30 %, la apaga sobre 55 %, nunca con el tanque bajo 10 %) o **manual** (manda el celular). **Solo el módulo SIM7080G tiene dirección IP**; los sensores y la bomba cuelgan de los pines del ESP32.

## Qué es real y qué es simulado

| Pieza | Estado |
|---|---|
| MME, HSS, SGW, PGW, PCRF, MongoDB, Mosquitto | **Reales** (los contenedores de siempre) |
| eNB: MAC, RRC, S1AP y GTP-U | **Reales**: es **OpenAirInterface** (imagen con la corrección del decodificador S1AP) |
| Mensajes NAS, autenticación Milenage, seguridad EIA2, sesión de datos | **Reales** |
| MQTT del nodo | **Real**: cruza OAI (GTP-U) y el núcleo hasta Mosquitto |
| Radio (Uu, capa física NB-IoT) | **Simulada**: OAI usa una radio falsa sin USRP; esta prueba **no** valida la capa física |
| ESP32 y sensores | Un programa que imita el firmware; el «mundo físico» (suelo, tanque…) lo mueves tú |

## Cómo usarlo

1. **Preparar** (una vez): da de alta en el HSS la SIM del nodo.
2. **Registrar nodo**: reinicia OAI (conecta un UE por arranque), espera ~45 s a que arranque y registra el nodo. Se ve cada paso: acceso aleatorio, RRC, Attach, autenticación, seguridad NAS, portador de datos y MQTT.
3. Pulsa un bloque del mapa — **UE**, **RAN (OAI)** o **Núcleo (Open5GS)** — para ver su interior:
   - **UE:** el código C del ESP32 (la función en ejecución se resalta), el nodo con sus sensores, la **consola AT** del módulo y controles del entorno: acerca la mano al ultrasónico (a menos de 3 cm salta la alarma), seca el suelo (la bomba arranca), baja el tanque (la bomba se bloquea)…
   - **RAN:** la pila de OAI (S1AP, RRC, PDCP, RLC, MAC, PHY, GTP-U) con el recorrido de cada mensaje y su registro en vivo.
   - **Núcleo:** los servicios de Open5GS que intervienen, su registro real y un **celular** (suscriptor MQTT) con el que mandas órdenes al nodo (automático/manual, bomba, umbrales) y ves su información.
4. Pulsa un mensaje de la **traza** para ver su contenido y **lo que registró el núcleo** en esos segundos.

## Intrusos y SIM clonada

Se eligen en el cuadro del UE (o en la barra):

- **SIM clonada**: IMSI correcto con otra clave K → «MAC failure» y Authentication Reject.
- **Intruso**: IMSI sin alta en el HSS → el MME rechaza el Attach.

Los saltos punteados (MME↔HSS, MME↔SGW↔PGW) son internos del núcleo: el simulador no los ve; se dibujan porque el procedimiento 3GPP obliga a que ocurran y se comprueban en los registros del núcleo. Detalle técnico en `pruebas-oai.md`.

## Cambiar la radio de la celda

En el bloque **RAN**, la tarjeta **Interfaz radio (Uu)** muestra la banda, las frecuencias, el ancho de banda y los parámetros NB-IoT (NPRACH, NPDCCH, paging) que OAI tiene cargados, y deja cambiarlos:

- Los cambios se **guardan** al instante, pero OAI no los usa hasta pulsar **Aplicar a OAI y reiniciar el eNB** (~45 s; el nodo pierde su sesión y se registra de nuevo).
- El deslizador de **distancia** sí actúa en el acto: cambia el nivel de señal y el nivel de cobertura del nodo (más repeticiones, más latencia y más energía por mensaje; sin cobertura no transmite).
- Una banda que el módulo no soporta (por ejemplo B7) hace que no encuentre la celda.

Los parámetros son reales; sus consecuencias son un **modelo**, no una medición.

> Cómo se construyó el laboratorio (arquitectura, decisiones, problemas y verificación): `laboratorio/implementacion.md` y `laboratorio/radio-nbiot.md` en la carpeta `docs/`.
