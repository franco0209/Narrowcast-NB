# Narrowcast-NB

Red celular privada para IoT (NB-IoT) construida con software libre y hardware de bajo costo. Permite que un sensor con un módulo NB-IoT se conecte por radio a una estación base propia y a un núcleo de red propio, sin depender de ningún operador, y que sus datos lleguen a un panel de control web.

```
ESP32 ──UART (AT)── Módulo NB-IoT ~~ radio ~~ USRP (eNB) ── UTP ── PC (núcleo Open5GS) ── MQTT ── Panel web
```

## Qué es

Un banco de pruebas completo de una red celular de banda angosta (NB-IoT, la tecnología LPWAN de 3GPP pensada para sensores de bajo consumo y larga duración de batería). En lugar de usar la red de un operador, el proyecto levanta **todos** los elementos de la cadena: el dispositivo, la estación base, el núcleo de red, el broker de mensajes y la interfaz de operación.

Sirve para estudiar, medir y demostrar cómo funciona una red IoT celular de punta a punta: registro del dispositivo con su SIM, asignación de IP, transporte de datos, ahorro de energía (PSM/eDRX) y operación segura de la radio.

## Qué hace

- **Registra dispositivos reales** con SIM propia: autenticación en el HSS, sesión de datos y dirección IP en la subred privada.
- **Transporta telemetría** (temperatura, humedad, calidad de señal) desde un ESP32 hasta el panel, y **envía órdenes** de vuelta (por ejemplo, encender un LED o cambiar el intervalo de envío).
- **Controla la transmisión de radio** con reglas de seguridad: la RF está apagada por defecto y solo se enciende con un plan validado, autorización escrita, potencia limitada y duración máxima.
- **Muestra el estado de toda la red** en un panel web: mapa animado de la cadena, contenedores, suscriptores, registros en vivo y datos del dispositivo.
- **Se puede probar sin hardware**: una radio virtual (ZMQ) y un simulador de dispositivo permiten validar el núcleo y el panel en cualquier PC.

## Cómo lo logra

| Capa | Solución |
|---|---|
| Dispositivo | ESP32 con módulo NB-IoT (SIM7080G o BG96) controlado por comandos AT; publica y recibe por MQTT. |
| Radio (eNB) | USRP con OpenAirInterface (rama `develop-nb-iot`), la implementación de código abierto de NB-IoT en la estación base. Corre en un contenedor Ubuntu 16.04 porque la rama no compila en sistemas más nuevos. |
| Núcleo (EPC) | Open5GS v2.7.5: MME, HSS, SGW-C/U, PGW-C/U y PCRF, con MongoDB para los suscriptores. |
| Datos | Broker MQTT Mosquitto con usuario y clave; tópicos `nb/<id>/telemetry`, `cmd` y `status`. |
| Operación | Panel web (FastAPI + HTML/JS sin librerías externas) que consulta Docker, MQTT y el plan RF. |
| Despliegue | Todo en Docker Compose, con red propia (`10.44.0.0/24`) y contenedores `nb-*`; arranca con un solo comando. |
| Seguridad de RF | Plan RF (`data/rf-plan.yaml`) validado por script y por el panel antes de emitir; sesiones registradas en un CSV. |

Parámetros de la red: PLMN `001/01`, TAC `1`, APN `internet`, subred de UE `10.58.0.0/16`.

## Módulos

| Módulo | Ubicación | Función |
|---|---|---|
| Núcleo Open5GS | `config/open5gs/`, `docker/open5gs/`, `docker/webui/` | EPC completo y WebUI (puerto 9999) para dar de alta las SIM. |
| Alta de suscriptores | `provisioning/` | Carga automática del suscriptor de prueba en MongoDB al arrancar. |
| eNB NB-IoT | `docker/oai-nbiot/`, `config/oai/`, `scripts/oai-enb-start.sh` | Imagen de OAI y arranque del eNB con banda, frecuencia y ganancia tomadas del plan RF. |
| Radio virtual | `config/srsran/`, `docker/srsran4g/`, `scripts/sim.sh`, `scripts/validate.sh` | eNB y UE simulados (srsRAN 4G) para validar el núcleo sin emitir RF. |
| Reglas de RF | `rf-plan.example.yaml`, `scripts/rf-check.sh`, `scripts/rf-run.sh` | Validación del plan, corte automático por duración y registro de sesiones. |
| Broker MQTT | `mosquitto/` | Mensajería entre el dispositivo y el panel. |
| Panel de control | `app/` | Pestañas Resumen, Suscriptores, Núcleo, eNB, Radio, Dispositivo, Laboratorio y Ayuda; simulador de dispositivo (`fake_device.py`). |
| Laboratorio de simulación | `app/simlab/`, `app/web/src/lab/`, `lab/oai-fakerf/` | Nodo de riego NB-IoT (ESP32 + SIM7080G + sensores) que se registra en Open5GS **a través del eNB real de OAI** (radio falsa) y manda MQTT real por el túnel GTP-U; vistas de detalle del UE, la RAN y el núcleo |
| Firmware | `firmware/esp32-nbiot/` | Código del ESP32 (Arduino/PlatformIO): módem por AT, sensor DHT22, LED y MQTT. |
| Documentación | `docs/` | Proyecto, conceptos, arquitectura, operación, laboratorio y referencia (índice en `docs/README.md`), más las guías del panel. |

### Panel de control

Interfaz en <http://127.0.0.1:8080> que sigue el tema claro/oscuro del sistema.

- **Resumen:** mapa animado de la red (ESP32 → eNB → MME/SGW/PGW → Mosquitto → panel) con flechas y paquetes que viajan solo por los enlaces activos; clic en un nodo para ver su función, interfaces y registro.
- **Suscriptores:** alta, edición, baja e importación por CSV de las SIM (IMSI, K, OPc, AMF, APN) directamente en la base de datos del HSS, sin entrar a la WebUI de Open5GS (que queda como respaldo). Ki y OPc nunca se muestran.
- **Núcleo:** arquitectura animada del EPC con sus interfaces, puertos y parámetros reales, y el procedimiento de registro (attach) reproducible paso a paso con el mensaje y el detalle técnico de cada salto.
- **eNB (OAI):** pila de protocolos del eNB (S1AP/GTP-U, RRC, PDCP, RLC, MAC, PHY NB-IoT, UHD/USRP) con recorridos de bajada y subida, la secuencia de arranque, los parámetros tomados del plan RF y el registro en vivo.
- **Radio:** plan RF con valores seguros y botón de transmisión que exige plan válido, dos confirmaciones humanas (portadora libre y autorizado por) y mantenerlo pulsado; corta solo al cumplirse la duración.
- **Dispositivo:** telemetría en vivo, gráfico, control del LED e intervalo de envío.
- **Laboratorio:** dispositivos IoT virtuales (foco, sensor de clima, medidor de tanque e intruso) que se registran en el núcleo real; escena animada, traza del flujo con lo que registró el núcleo y escenarios de fallo (intruso, SIM clonada, resincronización de SQN, eNB ajeno, reposo PSM). La radio es simulada.
- **Ayuda:** guías por fase (`docs/guide/*.md`).

Una barra superior fija muestra siempre el estado del núcleo, del dispositivo y de la RF.

El panel monta el socket de Docker para encender el eNB, lo que equivale a acceso de administrador al equipo; por eso solo escucha en `127.0.0.1` y no debe exponerse a la red.

## Documentación

Todo está en [`docs/`](docs/README.md), organizado por tema (el índice completo con «qué leer según lo que busques» está en [`docs/README.md`](docs/README.md)):

| Tema | Documento | Contenido |
|---|---|---|
| Proyecto | [`docs/proyecto/plan.md`](docs/proyecto/plan.md) | Plan original del proyecto |
| Proyecto | [`docs/proyecto/estado-por-fases.md`](docs/proyecto/estado-por-fases.md) | Estado de cada fase, lo que falta y el detalle técnico de las fases |
| Operación | [`docs/operacion/puesta-en-marcha.md`](docs/operacion/puesta-en-marcha.md) | Puesta en marcha paso a paso y problemas frecuentes |
| Conceptos | [`docs/conceptos/fundamentos.md`](docs/conceptos/fundamentos.md) | NB-IoT, EPC, qué son Open5GS y OAI, qué es propio, flujos de punta a punta, glosario y ejercicios |
| Arquitectura | [`docs/arquitectura/arquitectura.md`](docs/arquitectura/arquitectura.md) | Capas, red y direccionamiento, partes de Open5GS y OAI que se usan, interfaces y protocolos, suscriptores, MQTT, firmware y seguridad de RF |
| Arquitectura | [`docs/arquitectura/integracion-oai-open5gs.md`](docs/arquitectura/integracion-oai-open5gs.md) | Cómo se relaciona el proyecto con OAI y Open5GS a nivel de código (funciones, archivos, flujos) |
| Arquitectura | [`docs/arquitectura/codigo-por-dentro.md`](docs/arquitectura/codigo-por-dentro.md) | Lenguajes, procesos e hilos, sincronización, comunicación e interfaces, incluido el código del Laboratorio |
| Arquitectura | [`docs/arquitectura/modificaciones-oai-open5gs.md`](docs/arquitectura/modificaciones-oai-open5gs.md) | **Qué se modificó de Open5GS y OAI** (y qué no), con la comparación contra los originales y cómo verificarla |
| Operación | [`docs/operacion/docker-y-compilacion.md`](docs/operacion/docker-y-compilacion.md) | Lenguajes, imágenes, compilación de Open5GS/OAI/srsRAN, perfiles de Compose, volúmenes y comandos |
| Operación | [`docs/operacion/panel.md`](docs/operacion/panel.md) | Diseño técnico del panel: API REST, eventos SSE, motor de diagramas, seguridad y Laboratorio |
| Laboratorio | [`docs/laboratorio/implementacion.md`](docs/laboratorio/implementacion.md) | **Cómo se implementó el Laboratorio**: arquitectura, decisiones, problemas resueltos, verificación y limitaciones |
| Laboratorio | [`docs/laboratorio/pruebas-oai.md`](docs/laboratorio/pruebas-oai.md) | Pruebas de OAI sin USRP (radio falsa + inyector): qué funciona, hallazgos y lo que falta |
| Referencia | [`docs/referencia/verificacion.md`](docs/referencia/verificacion.md) | Estado de verificación: qué está comprobado y qué no |
| Referencia | [`docs/referencia/preguntas-recurrentes.md`](docs/referencia/preguntas-recurrentes.md) | Preguntas recurrentes con respuesta breve y enlaces al detalle |
| Panel | [`docs/guide/`](docs/guide/04-laboratorio.md) | Guías que muestra la pestaña Ayuda del panel (radio, módulo, datos, laboratorio) |

## Estado

El software está listo hasta donde se puede sin hardware: núcleo, panel, broker y eNB configurado funcionan (S1 Setup verificado). Falta la prueba con USRP, SIM y módulo reales, que dependen de autorización y de equipos externos. El detalle por fase, lo que falta y la guía de puesta en marcha están en [`docs/operacion/puesta-en-marcha.md`](docs/operacion/puesta-en-marcha.md).

## Inicio rápido

Requiere Docker con Compose v2 y unos 10 GB libres.

```bash
git clone https://github.com/franco0209/Narrowcast-NB.git
cd Narrowcast-NB
cp .env.example .env          # cambiar al menos MQTT_PASS
docker compose up -d          # núcleo + broker + panel (no emite radio)
```

Panel: <http://127.0.0.1:8080>. Para el recorrido completo (radio virtual, eNB NB-IoT, transmisión real, firmware) y los problemas frecuentes, ver [`docs/operacion/puesta-en-marcha.md`](docs/operacion/puesta-en-marcha.md).

## Reanudación

Para retomar el trabajo en la carpeta del proyecto cuando ya se hizo el inicio rápido (imágenes construidas, `.env` creado):

```bash
cd Narrowcast-NB
docker compose up -d                          # levanta núcleo, broker y panel (reutiliza las imágenes)
docker compose ps                             # todos "running" (subscriber-provisioner termina solo)
```

- **Panel:** <http://127.0.0.1:8080>. **WebUI de Open5GS:** <http://127.0.0.1:9999>.
- **Datos conservados:** los suscriptores y el plan RF (`data/rf-plan.yaml`) se mantienen entre reinicios; no hay que volver a cargarlos.
- **Actualizar el código:** `git pull` y, si cambió algo en `app/`, `docker/` o `compose.yaml`, `docker compose up -d --build`.
- **Probar sin hardware:** `docker compose exec app python fake_device.py esp32-sim`.
- **eNB NB-IoT:** si el contenedor `nb-enb-nbiot` no existe (por ejemplo tras `docker compose down`), recrearlo con `docker compose --profile radio create enb-nbiot`. Emitir por radio sigue exigiendo plan RF completo y autorización (ver [`docs/operacion/puesta-en-marcha.md`](docs/operacion/puesta-en-marcha.md)).
- **Ver registros:** `docker logs -f nb-mme` (o cualquier contenedor `nb-*`), o la pestaña **Núcleo** del panel.
- **Detener:** `docker compose --profile sim --profile radio down` (conserva los datos); `docker compose down -v` además borra los suscriptores.

## Estructura

```
compose.yaml            servicios (perfil `sim` = radio virtual, `radio` = eNB NB-IoT)
.env.example            variables (copiar a .env)
rf-plan.example.yaml    plantilla del plan RF (se guarda en data/rf-plan.yaml)
config/                 configuración de Open5GS, srsRAN y OAI
provisioning/           alta del suscriptor en MongoDB
app/                    panel web (FastAPI + React/TypeScript en `app/web/`), simulador de dispositivo y `simlab/` (laboratorio)
mosquitto/              configuración del broker MQTT
firmware/               código del ESP32
data/                   plan RF y registro de sesiones (no se versiona)
docker/                 Dockerfiles (open5gs, srsran4g, webui, oai-nbiot)
scripts/                sim.sh, validate.sh, rf-check.sh, rf-run.sh, oai-enb-start.sh
docs/                   proyecto/, conceptos/, arquitectura/, operacion/, laboratorio/, referencia/ y guide/ (guías del panel)
```

`.env`, `data/`, `firmware/**/secrets.h` y los `.pcap` no se versionan.
