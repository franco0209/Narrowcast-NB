# Panel de control: diseño técnico

El panel es la interfaz única del proyecto: desde el navegador se ven el estado de la red, se dan de alta las SIM, se entiende el núcleo y el eNB, se controla la radio y se observa el dispositivo. Este documento describe cómo está hecho. Para qué hace cada módulo de cara al usuario, ver el [README](../README.md).

URL: <http://127.0.0.1:8080> (servicio `app`, contenedor `nb-app`, IP `10.44.0.6`; solo escucha en `127.0.0.1`).

## 1. Piezas

```
Navegador ── HTTP/JSON + SSE ──► FastAPI (uvicorn, :8080)
                                   ├── paho-mqtt ───────► Mosquitto  (telemetría y órdenes)
                                   ├── pymongo ─────────► MongoDB    (suscriptores)
                                   ├── docker SDK ──────► /var/run/docker.sock (estado, logs, encender el eNB)
                                   └── subprocess ──────► scripts/rf-check.sh (reglas de RF)
```

| Elemento | Tecnología |
|---|---|
| Backend | Python 3.12, FastAPI 0.115, uvicorn 0.34 (`app/main.py`) |
| MQTT | paho-mqtt 2.1 (cliente `nb-panel`, suscrito a `nb/+/telemetry` y `nb/+/status`) |
| Base de datos | pymongo 4.10, URI `MONGO_URI` (por defecto `mongodb://mongo:27017/open5gs`) |
| Docker | docker SDK para Python 7.1 |
| Plan RF | PyYAML 6.0 (lectura) y escritura propia del archivo |
| Guías | markdown 3.7 (convierte `docs/guide/*.md` a HTML) |
| Frontend | HTML, CSS y JavaScript sin dependencias ni paso de compilación (`app/static/`) |

Imagen: `python:3.12-slim`, `pip install -r requirements.txt`, `uvicorn main:app --host 0.0.0.0 --port 8080`. Los archivos estáticos van dentro de la imagen: tras cambiar el frontend hay que reconstruirla (`docker compose up -d --build app`).

Volúmenes montados: `./data:/data` (plan RF y sesiones), `./docs/guide:/guide:ro`, `./scripts:/project/scripts:ro` y `/var/run/docker.sock`.

## 2. API REST

Todas las rutas están bajo `/api`. Los errores devuelven `{"detail": "mensaje"}` con el código HTTP correspondiente.

### Estado y registros

| Método y ruta | Qué hace |
|---|---|
| `GET /api/core` | Contenedores `nb-*` con su estado y lista resumida de suscriptores (sin claves). Lo consulta el panel cada 5 s |
| `GET /api/logs/{nombre}?tail=N` | Últimas líneas (hasta 300) del registro de un contenedor. Solo nombres `nb-[a-z0-9-]{1,30}`; solo lectura |
| `GET /api/enb` | Estado del eNB: estado del contenedor, plan RF, últimas 25 líneas de registro y si el MME muestra «eNB-S1 accepted» |

### Suscriptores

| Método y ruta | Cuerpo | Qué hace |
|---|---|---|
| `GET /api/subscribers` | — | Lista (IMSI, MSISDN, APN, AMF, fechas). Nunca devuelve K ni OPc |
| `POST /api/subscribers` | `{imsi, k, opc, amf?, sqn?, msisdn?, apn?}` | Crea el suscriptor; `409` si el IMSI ya existe |
| `PUT /api/subscribers/{imsi}` | igual; `k`, `opc` vacíos = no cambiar | Edita MSISDN, AMF, SQN y APN; cambia K/OPc solo si se envían |
| `DELETE /api/subscribers/{imsi}` | — | Borra el suscriptor |

Validaciones (servidor): IMSI de 5 a 15 dígitos; K y OPc, 32 caracteres hexadecimales; AMF, 4; SQN, 12; MSISDN de 3 a 15 dígitos; APN de letras, números, punto, guion o guion bajo (hasta 63). Los valores hexadecimales se guardan en mayúsculas. El documento resultante es idéntico al del provisionador y al de la WebUI (ver [`arquitectura.md`](arquitectura.md) §6).

### Radio

| Método y ruta | Qué hace |
|---|---|
| `GET /api/radio` | Plan RF actual, resultado de `rf-check.sh` y estado de la emisión |
| `PUT /api/radio/plan` | Guarda el plan en `data/rf-plan.yaml`. `409` si se está transmitiendo |
| `POST /api/radio/start` | Cuerpo `{"confirm": "EMITIR"}`. Revalida el plan, arranca el contenedor `nb-enb-nbiot` y programa un temporizador que lo detiene al cumplirse `duracion_max_s` |
| `POST /api/radio/stop` | Detiene el eNB y registra la sesión |
| `GET /api/radio/sessions` | Últimas 50 sesiones de `data/logs/rf-sessions.csv` |

La emisión nunca depende solo del navegador: el servidor valida el plan en cada `start`, el temporizador vive en el servidor y, al iniciar el panel, si el eNB quedó encendido de una sesión anterior se apaga y se registra.

### Dispositivo, guías y tiempo real

| Método y ruta | Qué hace |
|---|---|
| `GET /api/devices` | Dispositivos conocidos: estado, última lectura e historial (120 lecturas) |
| `POST /api/devices/{id}/cmd` | Publica en `nb/<id>/cmd` (QoS 1) `{led?: bool, interval_s?: 5–86400}` |
| `GET /api/guide`, `GET /api/guide/{id}` | Lista y contenido (HTML) de las guías `docs/guide/*.md` |
| `GET /api/stream` | Flujo de eventos del servidor (SSE), ver §3 |

## 3. Tiempo real: eventos SSE

`GET /api/stream` mantiene abierta una respuesta `text/event-stream`. Cada cliente tiene su propia cola; el servidor reparte los eventos con `broadcast()` (seguro entre hilos con `call_soon_threadsafe`, porque MQTT y los temporizadores corren en otros hilos) y envía un comentario `: ping` cada 15 s para mantener la conexión.

| `type` | Cuándo | Datos |
|---|---|---|
| `hello` | al conectar | estado de la radio y todos los dispositivos |
| `telemetry` | llega una lectura MQTT | `device`, `data` (con `ts`) |
| `status` | cambia `online/offline` | `device`, `online`, `seen` |
| `cmd` | se envía una orden | `device`, `cmd`, `ts` |
| `radio` | cambia la emisión | `radio`, `reason` |
| `subs` | se crea, edita o borra un suscriptor | — |

El navegador usa además sondeo periódico: `/api/core` cada 5 s, `/api/enb` cada 4 s en la pestaña eNB y los registros cada 4 s en la pestaña Núcleo.

## 4. Frontend

Sin framework ni paso de compilación. `index.html` carga tres scripts, en este orden:

| Archivo | Contenido |
|---|---|
| `diagram.js` | Motor de diagramas SVG reutilizable (§4.1) y el reproductor paso a paso |
| `app.js` | Utilidades (`api`, `toast`), pestañas, mapa del Resumen, barra de estado, Radio, Dispositivo y conexión SSE |
| `modules.js` | Módulos Suscriptores, Núcleo y eNB: datos de componentes, procedimientos y lógica de pantalla |

Los módulos se enganchan con `window.onTab(nombre)` (al cambiar de pestaña) y `window.onCore()` (al refrescar el estado de los contenedores).

### 4.1 Motor de diagramas

`makeDiagram(svg, {nodes, edges, w, h, onSelect})` construye un SVG a partir de datos:

- **Nodos:** `{id, label, sub, x, y, w, h, icon, ext}`; los iconos son trazos SVG propios; `ext` dibuja el borde discontinuo de lo que está fuera del proyecto (módulo, eNB).
- **Enlaces:** `{a, b, kind, label}` con `kind` = `ctrl` (señalización), `user` (datos) o `radio`. Se recortan al borde de los nodos y llevan flecha en ambos extremos.
- **Estado en vivo:** `setNodeUp(id, bool)` y `setLive(i, bool)` reflejan qué contenedores están activos; los enlaces activos muestran paquetes ambientales (`ambient`).
- **Paquetes:** `packet(a, b)` anima un punto entre dos nodos con la Web Animations API; `path(hops)` encadena saltos.
- **Foco y capas:** `focus(nodos, enlaces)` atenúa todo lo demás; `layer(kind)` muestra solo un tipo de enlace.
- **Accesibilidad:** los nodos son botones con teclado (Enter/Espacio); con `prefers-reduced-motion` o `?still` en la URL se desactivan las animaciones.

`makeStepper(el, diagrama, pasos)` agrega controles de reproducción, la lista de pasos y el detalle técnico. Un paso es `{title, hops, proto, msg, desc, tech}`. Los procedimientos viven como datos en `modules.js` (`ATTACH`, `LAYERS_DL`, `LAYERS_UL`, `START`): agregar un paso no requiere tocar la lógica.

### 4.2 Módulos de la interfaz

| Pestaña | Fuente de datos | Acciones |
|---|---|---|
| Resumen | `/api/core`, SSE | clic en nodo: función, interfaces y registro |
| Suscriptores | `/api/subscribers` | alta, edición, baja, importación CSV (`imsi,k,opc[,msisdn,apn]`), K/OPc aleatorios con `crypto.getRandomValues` |
| Núcleo | `/api/core`, `/api/logs` | detalle por componente, filtro de capas, attach paso a paso |
| eNB (OAI) | `/api/enb` | detalle por capa, recorridos de bajada/subida, secuencia de arranque |
| Radio | `/api/radio*` | plan RF, botón de mantener pulsado (1,5 s), historial |
| Dispositivo | SSE, `/api/devices` | telemetría, LED, intervalo; tarjeta «Equipos físicos» (PC, USRP, ESP32) y explicación de la simulación |
| Ayuda | `/api/guide*` | guías por fase |

La barra superior fija muestra tres indicadores: contenedores del núcleo activos, dispositivo en línea y RF (apagada o emitiendo).

### 4.3 Real o simulado

`hwState()` en `app.js` decide para cada equipo si está apagado (`off`), físico (`real`) o simulado (`sim`) y `renderHw()` lo pinta en la tarjeta «Equipos físicos» de la pestaña Dispositivo (LED gris, verde o azul):

| Equipo | Físico (verde) | Simulado (azul) |
|---|---|---|
| PC · núcleo | todos los contenedores del núcleo activos | — |
| USRP · radio | `nb-enb-nbiot` en marcha (solo se mantiene si UHD encuentra el USRP; si no, sale con «No USRP Device Found») | `nb-enb` (srsRAN con radio virtual) |
| ESP32 + módulo | dispositivo en línea sin `sim` en la telemetría | telemetría con `"sim": true` o `nb-ue` en marcha |

`fake_device.py` añade `"sim": true` a cada lectura; el firmware real no lo envía. Con eso la insignia del dispositivo y su tarjeta se ven azules («simulado · en línea»).

### 4.4 Qué simula `fake_device.py` y qué no

Es un proceso Python que corre dentro de `nb-app` (`docker compose exec app python fake_device.py esp32-sim`). Se conecta a Mosquitto con las credenciales MQTT, publica `online` retenido en `nb/<id>/status` (con `offline` como last will), emite cada 5 s en `nb/<id>/telemetry` valores **inventados** (temperatura 22 ± 1,5 °C, humedad 55 ± 5 %, RSSI entre −110 y −80 dBm) y atiende `nb/<id>/cmd` (LED e intervalo, ida y vuelta real por MQTT).

- **Sí prueba:** broker, panel, gráficas, comandos y eventos SSE.
- **No prueba:** attach de la SIM, autenticación, radio NB-IoT, eNB ni el túnel de datos por el núcleo. El simulador entra directo al broker por la red de Docker, sin pasar por el PGW-U.

### 4.5 Registros de los componentes del núcleo

Al pulsar un nodo del diagrama de Resumen se muestran las últimas 14 líneas de `GET /api/logs/{contenedor}`. Es solo lectura, se carga una vez y no es una consola interactiva. Los nodos sin contenedor real (el dispositivo) no muestran registro.

**`epoll failed (4:Interrupted system call)`:** aparece de forma esporádica en casi todas las funciones de Open5GS (p. ej. el PGW-U/UPF: `[core] ERROR: epoll failed … ogs-epoll.c:221`). Es `EINTR`: una señal interrumpió la espera del bucle de eventos (pausa de la VM o del contenedor, suspensión del equipo, `docker exec`). Open5GS lo registra como ERROR, pero es inofensivo: no hay reinicios ni pérdida de la asociación PFCP. Preocupan, en cambio, líneas de pérdida o tiempo agotado de PFCP/S1 o reinicios del contenedor.

## 5. Seguridad

- Solo escucha en `127.0.0.1`. No tiene autenticación: no debe exponerse a la red sin añadirla.
- Monta el socket de Docker, es decir, equivale a administrador del equipo. Solo ejecuta `start`/`stop` del contenedor del eNB, `logs` de contenedores `nb-*` y listados.
- No devuelve nunca K ni OPc; los escribe pero no los lee hacia el navegador.
- Los nombres de contenedor y de dispositivo se validan con expresiones regulares antes de usarse.
- Las contraseñas MQTT vienen de variables de entorno (`.env`), no del código.
- Pendiente: autenticación y roles si se usa en más de una persona o en red.

## 6. Cómo extender el panel

**Un endpoint nuevo:** añadir la función con `@app.get/post/...` en `main.py`; si debe notificar a la interfaz, llamar a `broadcast({"type": "…"})` y manejar el tipo en `connect()` de `app.js`.

**Una pestaña nueva:** agregar el botón en `<nav id="tabs">` y una `<section id="…" class="tab">` en `index.html`; en `modules.js` extender `window.onTab`.

**Un procedimiento animado nuevo:** definir los nodos y enlaces como datos, crear el diagrama con `makeDiagram` y los pasos con `makeStepper`.

**Probar:** `docker compose up -d --build app`, recargar con Ctrl+Shift+R y, para datos del dispositivo, `docker compose exec app python fake_device.py esp32-sim`. El simulador publica en los mismos tópicos que el firmware real.
