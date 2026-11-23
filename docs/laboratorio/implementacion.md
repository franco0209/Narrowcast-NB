# Cómo se implementó el Laboratorio

Este documento cuenta **cómo se construyó** el Laboratorio del panel: qué problema resolvía, qué arquitectura se eligió, qué obstáculos aparecieron y cómo se resolvieron, y qué está verificado y qué no. Para usarlo, ver [`guide/04-laboratorio.md`](../guide/04-laboratorio.md); para la radio NB-IoT de la celda y su modelo, [`radio-nbiot.md`](radio-nbiot.md); para lo que se cambió en OAI, [`modificaciones-oai-open5gs.md`](../arquitectura/modificaciones-oai-open5gs.md) §5; para los resultados de las pruebas de OAI, [`pruebas-oai.md`](pruebas-oai.md).

---

## 1. El problema

El proyecto monta una red celular NB-IoT: núcleo **Open5GS** (EPC 4G), eNB de **OpenAirInterface** (OAI, rama `develop-nb-iot`) y un nodo con ESP32 + módulo SIM7080G. La radio real necesita un USRP (SDR) que no siempre está disponible, y además no se puede mostrar por dentro qué hace cada parte de la red.

Se quería un laboratorio que:

1. **Funcione sin hardware** pero use el **software real**: el núcleo Open5GS y el eNB de OAI, no una imitación.
2. **Muestre el interior** de cada parte (UE, RAN, núcleo) con el flujo animado paso a paso.
3. Tenga un **nodo con sentido** (un riego automático con sensores y bomba que realmente funcionan) en lugar de dispositivos genéricos.
4. Lleve **datos reales** (MQTT) por el túnel de OAI, no solo el registro.
5. Permita probar **ataques**: SIM clonada e intruso.

La primera versión (previa a este trabajo) hablaba S1AP directamente con el MME desde Python, sin pasar por OAI. Se **eliminó**: ahora todo pasa por OAI.

---

## 2. Decisiones de diseño

| Decisión | Alternativa descartada | Motivo |
|---|---|---|
| **Radio falsa** (biblioteca que reemplaza al USRP) + **inyector** de mensajes RRC dentro de OAI | Simular el eNB completo en Python | Así corren el MAC, RRC, S1AP y GTP-U **reales** de OAI. Solo se simula la capa física (Uu) |
| **NAS auténtico** en Python (Milenage, EIA2) | NAS de mentira | El MME y el HSS reales validan la autenticación: una SIM clonada o un intruso fallan de verdad |
| Datos de usuario por **UDP + TUN** (`simue0`) hacia el GTP-U de OAI | Publicar MQTT directo al broker | Que el tráfico del nodo **cruce OAI y el núcleo** de verdad (túnel GTP-U, SGW-U, PGW-U) |
| El simulador es un **contenedor aparte** (`nb-simlab`, misma imagen que el panel) | Meterlo en el panel | Necesita `NET_ADMIN` y `/dev/net/tun`; el panel no debe tener esos permisos |
| Los ganchos de prueba se instalan **al arrancar** `nb-oai-lab` (`prepare.sh`) | Modificar la imagen de producción | La imagen de producción lleva solo la corrección del S1AP; las pruebas no la contaminan |
| **Frontend React** con motor de eventos propio | Seguir con JavaScript plano | Animaciones, tres vistas interiores y estado compartido necesitaban componentes |
| Ningún dispositivo ficticio: **un solo nodo** con lógica espejo del firmware | Varios dispositivos genéricos | Solo el módulo 7080 tiene IP; el ESP32 no se simula electrónicamente, solo su lógica |

---

## 3. Arquitectura

```
 Navegador (React)  ──HTTP/SSE──►  nb-app (panel)  ──proxy /api/lab/*──►  nb-simlab  (10.44.0.42)
                                      │  ▲                                  │  NAS, nodo, TUN simue0
                                      │  │ docker API (logs, reinicio,      │
                                      │  │  contadores de ogstun)           │ UDP 9100 (comandos SC/UT/UC/RC)
                                      ▼  │                                  │ UDP 9101 (IP del nodo → OAI)
                              Open5GS: MME HSS SGW-C PGW-C PCRF             ▼ UDP 9102 (OAI → nodo)
                                      ▲   SGW-U PGW-U(ogstun)          nb-oai-lab  (10.44.0.43)
                                      │ S1AP/SCTP 36412 · GTP-U 2152     eNB OAI + radio falsa
                                      └──────────────────────────────────┘
```

Tres caminos:

| Camino | Recorrido |
|---|---|
| **Control** (registro) | `simlab` (NAS) → UDP 9100 → inyector de OAI → RRC → S1AP → MME → HSS / SGW-C / PGW-C / PCRF |
| **Datos de subida** | app del nodo → TUN `simue0` → `simlab/net.py` → UDP 9101 → OAI (`GTPV1U_ENB_TUNNEL_DATA_REQ`) → GTP-U → SGW-U → PGW-U (`ogstun`) → Mosquitto |
| **Datos de bajada** | Mosquitto → PGW-U → SGW-U → GTP-U → OAI → gancho `narrowcast_dl_relay` → UDP 9102 → `net.py` → TUN → app del nodo |

**Qué es real y qué es simulado**

| Real | Simulado |
|---|---|
| Open5GS completo (MME, HSS, SGW-C/U, PGW-C/U, PCRF, MongoDB) | La **radio** (Uu): no se prueba la capa física |
| RRC, S1AP, GTP-U y MAC de OAI | El **acceso aleatorio**: OAI lo simula una vez por arranque |
| NAS: Milenage, EIA2, SMC | La electrónica del ESP32 (se reproduce su lógica, no el hardware) |
| Datos MQTT por el túnel GTP-U, IP asignada por el PGW-C | Los sensores (se mueven con deslizadores) |

---

## 4. Cómo se construyó, por partes

### 4.1 La radio falsa y el inyector (OAI)

1. **`fakedev.c`**: OAI carga su dispositivo de radio con `dlopen("liboai_device.so")`. Se compiló una biblioteca de ~54 líneas que entrega ruido a ritmo real y descarta lo transmitido; los enlaces simbólicos hacen que OAI cargue esa en vez de la del USRP. Los hilos de tiempo real corren sin hardware (requiere `SYS_NICE`).
2. **Acceso aleatorio**: OAI trae ganchos de simulación de preámbulo y Msg3 desactivados; `OAI_SIM_RACH=1` los activa. Solo se simula **un UE por arranque**.
3. **`inject.c`** (se anexa al planificador MAC): un hilo escucha **UDP 9100** y entrega al RRC real mensajes de subida: `SC` (RRCConnectionSetupComplete con el NAS), `UT` (UL Information Transfer), `UC` (RRCConnectionReconfigurationComplete) y `RC` (la respuesta de contexto inicial).
4. **Datos de subida**: un segundo hilo escucha **UDP 9101**; cada datagrama es un paquete IP del nodo y se entrega a la tarea GTP-U como `GTPV1U_ENB_TUNNEL_DATA_REQ` (rnti `0x101`, RAB 5).
5. **Bajada**: gancho en `gtpv1u_eNB.c` (`OAI_RELAY_DL=ip:puerto`) que reenvía por UDP los paquetes que llegan del SGW-U, en vez de mandarlos a PDCP.

Todo lo instala `lab/oai-fakerf/prepare.sh`, que se vuelve a ejecutar solo si cambia algún archivo de `lab/` (huella md5 en `/opt/fake/.ready`).

### 4.2 El simulador `simlab` (Python)

- **`nas.py`**: genera el *Attach Request*, responde a la autenticación (Milenage con K y OPc de la SIM), el *Security Mode* (EIA2) y protege los NAS siguientes.
- **`oai.py`**: orquesta el registro por OAI: espera el arranque, inyecta `SC` → `UT` → `UC` → `RC`, vigila caídas y reintenta.
- **`net.py`**: crea la interfaz `simue0` con la IP que asignó el núcleo y enruta el tráfico del nodo por el relevo UDP.
- **`node.py`**: el **nodo de riego**: física (suelo que se seca, tanque que baja, bomba), DHT22, HC-SR04, modo automático/manual con umbrales, consola de comandos AT del módulo y cliente MQTT enlazado a la IP del módulo. Es un **espejo del firmware** (`riego-nbiot.ino`), que el laboratorio muestra con resaltado.
- **`server.py`**: API interna y escenarios (**registrar**, **clon**, **intruso**, **baja**); **`bus.py`**: bus de eventos que alimenta la traza.

### 4.3 El panel

Proxy `/api/lab/*` con **lista blanca** (`LAB_OK`) hacia `simlab`, más funciones que solo el panel puede hacer (tiene el socket de Docker):

- Reinicia `nb-oai-lab` antes de cada registro (un acceso aleatorio por arranque) y responde **409** si ya hay un trabajo en curso, para no reiniciar dos veces.
- `oai_watchdog`: reinicia OAI si cae (código distinto de 0/137/143) mientras hay un trabajo.
- `/api/lab/corelog`: líneas de los registros de MME, HSS, SGW-C, PGW-C y PCRF filtradas por IMSI.
- `/api/lab/upstats`: contadores de `ogstun` del PGW-U (paquetes y bytes de subida y bajada).
- `POST /api/lab/node/env?soil=&temp=&tank=&hand=`: mueve el «mundo físico» del nodo. Las órdenes del celular usan la API de siempre (`POST /api/devices/riego-01/cmd` con `mode`, `pump`, `soil_low`, `soil_high`, `interval_s`): salen por el broker real y entran al nodo por el túnel.
- `POST /api/lab/radio/config` y `POST /api/lab/radio/apply`: radio NB-IoT de la celda ([`radio-nbiot.md`](radio-nbiot.md)).

### 4.4 El frontend

- **Migración a React 18 + TypeScript + Vite** manteniendo el aspecto original (migración primero, mejoras después). `store.ts` + `useSyncExternalStore` para el estado, SSE para eventos del servidor. Se construye en una etapa de Docker y se sirve como estáticos.
- **`lab/engine.ts` (`LabEngine`)**: cola de eventos con velocidad, pausa y «siguiente paso»; `PATHS` define los saltos de cada tipo de mensaje; `pending` es el indicador de «trabajando» que desactiva los botones para no colapsar el sistema.
- **`lab/flow.tsx`**: paquetes animados con `requestAnimationFrame` sobre rutas SVG; **`lab/art.tsx`**: dibujos SVG detallados de cada dispositivo (placa ESP32, módulo SIM7080, sondas, bomba, torre, servidor, celular).
- **Tres secciones interiores** (`lab/views/`): **UE** (código C del firmware con la línea activa resaltada, sensores interactivos —p. ej. acercar la mano al sensor de distancia—, consola AT, selector de SIM), **RAN** (capas de OAI y su registro) y **Núcleo** (servicios de Open5GS, registro del núcleo y un «celular» MQTT mínimo que manda órdenes y ve el nodo). Las interfaces se muestran donde corresponde: el UE solo tiene Uu a la derecha; la RAN tiene Uu y S1; el núcleo solo S1 a la izquierda.
- **`tabs/Lab.tsx`**: traza (con el recorrido completo de cada mensaje), detalle y la tarjeta **«Registro del plano de usuario»**.

### 4.5 Visibilidad del plano de usuario

Al principio la traza ocultaba la telemetría y, tras el registro, no se veía a OAI ni al núcleo actuar. Se corrigió en tres pasos:

1. La telemetría periódica (cada 10 s) se muestra **por defecto** y cada fila indica **todo el recorrido** (módulo → OAI → SGW-U → PGW-U → broker → celular).
2. Al cambiar la bomba el nodo publica **al instante** (antes esperaba el siguiente ciclo).
3. Como el plano de control **no interviene** en los datos, su registro queda vacío. Para demostrar que el paquete sí cruzó el núcleo se añadió la tarjeta del plano de usuario: por cada mensaje de datos muestra el recorrido por GTP-U y, ~0,9 s después, la variación de los contadores de `ogstun` (paquetes y bytes ↑/↓). Subida = `rx` de la interfaz (lo que el UE escribe al túnel) y bajada = `tx`.

---

## 5. Problemas encontrados y cómo se resolvieron

| Problema | Causa | Solución |
|---|---|---|
| OAI cae con **SIGSEGV** al inyectar | Se inyectaba antes de que el eNB terminara de arrancar | Esperar `SETTLE_S = 40` s desde el arranque |
| Caídas intermitentes de OAI (código 139), también tras el `RC` | Inestabilidad de la rama | `oai.py` detecta el reinicio por el id de arranque y reintenta (máx. 2); el panel vigila y reinicia |
| `Encoding of S1ap-E-RABSetupListCtxtSURes failed` al responder el contexto inicial | El estado del E-RAB solo pasa a *DONE* tras generar la reconfiguración RRC | Inyectar **`UC` primero** y luego `RC` |
| OAI descarta el *Initial Context Setup Request* | Decodificador S1AP antiguo (R10.5) no conoce `Masked-IMEISV` (criticidad *ignore*) | Corrección de una línea (`return -1` → `break`), ya en la imagen (ver `modificaciones-oai-open5gs.md` §6) |
| La app del nodo reportó **«timed out»** tras registrarse | (a) los hilos de datos morían por `OSError`; (b) la ruta por defecto de la tabla 100 desaparecía (Linux la borra si la interfaz pierde su última IPv4); (c) caídas de OAI | Hilos tolerantes; `ip route replace` en cada alta; reintentos |
| Doble clic reiniciaba OAI dos veces | Sin control de trabajo en curso | Comprobar el trabajo antes de reiniciar (409) y `pending` en la interfaz |
| Capturas de pantalla colgadas | SSE impide el modo de tiempo virtual del navegador | Script CDP con Chrome sin cabeza |
| Cuadrícula del UE solapada | El código con `white-space: pre` ensanchaba las columnas | `minmax(0, 1fr)` |
| `scrollIntoView` desplazaba toda la página | Afecta al documento | `scrollTo` del contenedor |
| El firmware salía como JSON y fallaba | Se proxeaba como JSON | `PlainTextResponse` |
| No se veía actividad de OAI/núcleo tras el registro | La traza ocultaba la telemetría y no mostraba el recorrido | Sección 4.5 |

---

## 6. Verificación

**Verificado en ejecución**
- Registro del nodo por OAI contra Open5GS: **4 registros consecutivos correctos** tras corregir la ruta y los hilos de datos.
- Datos reales: conexión y publicación **MQTT** y **ping** por el túnel de OAI; escenarios de clon, intruso y baja.
- Interfaz: capturas con Chrome sin cabeza (CDP) de las tres vistas y de la traza.
- Lectura de los contadores de `ogstun` desde el panel (`/api/lab/upstats` responde con paquetes y bytes).

**Verificado con el nodo registrado (2026-11-23)**
- **Publicación inmediata:** al bajar la humedad del suelo a 10 % la bomba se enciende y el nodo publica su telemetría en el mismo instante (+~0,2 s de espera del modelo de radio), sin esperar al intervalo.
- **Contadores del plano de usuario:** los de `ogstun` (`/api/lab/upstats`) suben con el nodo registrado y publicando (por ejemplo, subida 766 → 768 paquetes en 5 s con una publicación y su confirmación), y la tarjeta «Registro del plano de usuario» muestra la variación junto a cada mensaje de datos. Los contadores cuentan todo el tráfico del núcleo, no solo el del nodo.

---

## 7. Limitaciones (para responder con honestidad)

- **No se prueba la capa física**: la radio es falsa; no hay modulación ni potencia reales. La cobertura, las repeticiones, la latencia y la energía **se modelan** (no se miden): ver [`radio-nbiot.md`](radio-nbiot.md).
- **Un UE por arranque de OAI**: cada registro reinicia el eNB (~45 s).
- Los ganchos de prueba **no están en la imagen de producción**; viven en `nb-oai-lab`.
- La electrónica del ESP32 y los sensores no se simulan; se simula su lógica.
- Los saltos internos del núcleo (MME↔HSS, MME↔SGW-C↔PGW-C) **no los ve el simulador**: se muestran como inferidos (punteados) y se contrastan con el registro del núcleo.
- Los contadores de `ogstun` son globales del PGW-U.

---

## 8. Cómo repetirlo

```bash
# una sola vez: crear el contenedor del eNB de pruebas
docker compose --profile oailab create oai-lab
docker compose up -d            # núcleo, panel, simlab
# en el panel: Laboratorio → «Registrar nodo» (~45 s la primera vez, OAI se prepara y arranca)
```

Después: abrir cada bloque (UE, RAN, Núcleo), mover el nivel de humedad en el UE para ver encenderse la bomba, mandar órdenes desde el «celular» del Núcleo y observar la traza y el registro del plano de usuario.

---

## 9. Dónde está cada cosa

| Qué | Dónde |
|---|---|
| Radio falsa, inyector, preparación de OAI | `lab/oai-fakerf/` (`fakedev.c`, `inject.c`, `prepare.sh`) |
| Arranque del eNB de pruebas | `scripts/oai-lab-start.sh`, servicio `oai-lab` de `compose.yaml` |
| Simulador | `app/simlab/` |
| Rutas del panel | `app/main.py` (`/api/lab/*`) |
| Frontend | `app/web/src/lab/`, `app/web/src/tabs/Lab.tsx` |
| Corrección del S1AP | `docker/oai-nbiot/patch-s1ap.py` |
| Radio NB-IoT de la celda y su modelo | [`radio-nbiot.md`](radio-nbiot.md) |

---

## 10. Referencia de `app/simlab/`

| Archivo | Hilos / mecanismo | Qué hace |
|---|---|---|
| `server.py` | FastAPI; `SCENARIOS` ejecutados en hilos | API interna: `/state`, `/events`, `/reset`, `/provision`, `/scenario/*` (registrar, clon, intruso, baja), `/node/env`, `/node/ping`, `/node/firmware`, `/oai/log`. Nodo `riego-01` (IMSI `001010000010001`); intruso con otro IMSI |
| `oai.py` | Clase `OaiUE.run()` | Espera `SETTLE_S`, inyecta por UDP 9100 los mensajes de subida con el NAS dentro (`SC`→`UT`→`UC`→`RC`), lee del registro de OAI los NAS que baja el MME, detecta caídas por el id de arranque del log y reintenta (máx. 2) |
| `nas.py` | `NasUE` | NAS de verdad: `_auth_req` (Milenage), `_smc` (EIA2), `_protect`, `_accept_nas`. Genera el *Attach Request*, *Authentication Response*, *Security Mode Complete*; procesa el *Attach Accept* y el *Detach* |
| `net.py` | `UserPlane`: hilos de lectura TUN y UDP 9102 | Crea `simue0` con la IP asignada, una regla `ip rule from <ip> lookup 100` y la ruta por defecto en la tabla 100 (se reaplica con `ip route replace`: Linux la borra si la interfaz pierde su última IP). Los hilos toleran `OSError` para no morir |
| `node.py` | `IrrigationNode`: hilo de física y de control | Espejo del firmware: suelo, tanque, bomba, DHT22, HC-SR04; consola de comandos AT; cliente MQTT enlazado a la IP del módulo y ping ICMP real. `_pump(on, why, notify=True)` publica **al instante** al cambiar la bomba |
| `riego-nbiot.ino` | — | Firmware C que el laboratorio muestra y resalta en la vista del UE; coincide con la lógica de `node.py` |
| `crypto.py` | — | Milenage (TS 35.206), KDF de claves LTE (TS 33.401), EIA2 (AES-CMAC) y AUTS para la resincronización |
| `bus.py` | — | Bus de eventos con campos `seq`, `dev`, `stage`, `proto`, `src`, `dst`, `ok`, `label`, `detail` (`emit(...)`) que alimenta la traza |
| `radio.py` | — | Radio del laboratorio: parámetros de la celda (banda, PRB, NPRACH, NPDCCH, paging, ganancia), lo guardado frente a lo aplicado en OAI, y el modelo de consecuencias (RSRP, cobertura, esperas, energía). Ver [`radio-nbiot.md`](radio-nbiot.md) |



**Concurrencia a tener en cuenta:** el nodo (`node.py`), la lectura TUN, la recepción UDP 9102 y los escenarios corren en hilos de `simlab`; el estado compartido se protege con bloqueos y el bus de eventos. En OAI, el inyector corre en hilos propios (`pthread`, `detach`) separados de los hilos de tiempo real.

**Aislamiento:** `simlab` reutiliza la imagen del panel (sin imagen nueva) pero es otro contenedor con `NET_ADMIN` y `/dev/net/tun`. El panel no recibe esos permisos.

## 11. Cómo extender el laboratorio

**Un escenario nuevo:** función en `simlab/server.py`, registrarla en `SCENARIOS` y añadir el botón en `SCEN` de `tabs/Lab.tsx`. Si necesita un eNB recién arrancado, añadir su ruta a `OAI_SCENARIOS` en `main.py`.
