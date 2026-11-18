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
| Panel de control | `app/` | Pestañas Resumen, Suscriptores, Núcleo, eNB, Radio, Dispositivo y Ayuda; simulador de dispositivo (`fake_device.py`). |
| Firmware | `firmware/esp32-nbiot/` | Código del ESP32 (Arduino/PlatformIO): módem por AT, sensor DHT22, LED y MQTT. |
| Documentación | `docs/` | Plan del proyecto, etapas, guías del panel y presentación de avance. |

### Panel de control

Interfaz en <http://127.0.0.1:8080> que sigue el tema claro/oscuro del sistema.

- **Resumen:** mapa animado de la red (ESP32 → eNB → MME/SGW/PGW → Mosquitto → panel) con flechas y paquetes que viajan solo por los enlaces activos; clic en un nodo para ver su función, interfaces y registro.
- **Suscriptores:** alta, edición, baja e importación por CSV de las SIM (IMSI, K, OPc, AMF, APN) directamente en la base de datos del HSS, sin entrar a la WebUI de Open5GS (que queda como respaldo). Ki y OPc nunca se muestran.
- **Núcleo:** arquitectura animada del EPC con sus interfaces, puertos y parámetros reales, y el procedimiento de registro (attach) reproducible paso a paso con el mensaje y el detalle técnico de cada salto.
- **eNB (OAI):** pila de protocolos del eNB (S1AP/GTP-U, RRC, PDCP, RLC, MAC, PHY NB-IoT, UHD/USRP) con recorridos de bajada y subida, la secuencia de arranque, los parámetros tomados del plan RF y el registro en vivo.
- **Radio:** plan RF con valores seguros y botón de transmisión que exige plan válido, dos confirmaciones humanas (portadora libre y autorizado por) y mantenerlo pulsado; corta solo al cumplirse la duración.
- **Dispositivo:** telemetría en vivo, gráfico, control del LED e intervalo de envío.
- **Ayuda:** guías por fase (`docs/guide/*.md`).

Una barra superior fija muestra siempre el estado del núcleo, del dispositivo y de la RF.

El panel monta el socket de Docker para encender el eNB, lo que equivale a acceso de administrador al equipo; por eso solo escucha en `127.0.0.1` y no debe exponerse a la red.

## Estado

El software está listo hasta donde se puede sin hardware: núcleo, panel, broker y eNB configurado funcionan (S1 Setup verificado). Falta la prueba con USRP, SIM y módulo reales, que dependen de autorización y de equipos externos. El detalle por fase, lo que falta y la guía de puesta en marcha están en [`docs/etapas.md`](docs/etapas.md).

## Inicio rápido

Requiere Docker con Compose v2 y unos 10 GB libres.

```bash
git clone https://github.com/franco0209/Narrowcast-NB.git
cd Narrowcast-NB
cp .env.example .env          # cambiar al menos MQTT_PASS
docker compose up -d          # núcleo + broker + panel (no emite radio)
```

Panel: <http://127.0.0.1:8080>. Para el recorrido completo (radio virtual, eNB NB-IoT, transmisión real, firmware) y los problemas frecuentes, ver [`docs/etapas.md`](docs/etapas.md).

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
- **eNB NB-IoT:** si el contenedor `nb-enb-nbiot` no existe (por ejemplo tras `docker compose down`), recrearlo con `docker compose --profile radio create enb-nbiot`. Emitir por radio sigue exigiendo plan RF completo y autorización (ver [`docs/etapas.md`](docs/etapas.md)).
- **Ver registros:** `docker logs -f nb-mme` (o cualquier contenedor `nb-*`), o la pestaña **Núcleo** del panel.
- **Detener:** `docker compose --profile sim --profile radio down` (conserva los datos); `docker compose down -v` además borra los suscriptores.

## Estructura

```
compose.yaml            servicios (perfil `sim` = radio virtual, `radio` = eNB NB-IoT)
.env.example            variables (copiar a .env)
rf-plan.example.yaml    plantilla del plan RF (se guarda en data/rf-plan.yaml)
config/                 configuración de Open5GS, srsRAN y OAI
provisioning/           alta del suscriptor en MongoDB
app/                    panel web (FastAPI + HTML/JS) y simulador de dispositivo
mosquitto/              configuración del broker MQTT
firmware/               código del ESP32
data/                   plan RF y registro de sesiones (no se versiona)
docker/                 Dockerfiles (open5gs, srsran4g, webui, oai-nbiot)
scripts/                sim.sh, validate.sh, rf-check.sh, rf-run.sh, oai-enb-start.sh
docs/                   plan, etapas, guías del panel y presentación de avance
```

`.env`, `data/`, `firmware/**/secrets.h` y los `.pcap` no se versionan.
