# Puesta en marcha

Cómo levantar y operar el sistema paso a paso, y qué hacer ante los problemas frecuentes. El estado de cada fase está en [`estado.md`](../proyecto/estado.md).

Los comandos son de Linux (probado en Ubuntu) y se ejecutan desde la raíz del repositorio.

## Requisitos

Docker con Compose v2 (y unos 10 GB libres en disco para las imágenes; la de OAI sola ocupa varios GB). Para las fases con radio real, además un USRP y el módulo con su SIM.

## Puesta en marcha paso a paso

Para quien acaba de clonar el repositorio y quiere llegar al estado actual del proyecto: núcleo Open5GS, panel, broker MQTT y eNB NB-IoT configurado (la radio real queda para cuando haya USRP y autorización). Los comandos son de Linux (probado en Ubuntu) y se ejecutan desde la raíz del repositorio.

### 1. Requisitos previos

```bash
docker --version && docker compose version    # Docker con Compose v2
df -h /                                       # unos 10 GB libres (la imagen de OAI sola pesa ~5,3 GB)
```

Si Docker no está instalado: <https://docs.docker.com/engine/install/>. Hay que poder usar `docker` sin `sudo` (`sudo usermod -aG docker $USER` y volver a iniciar sesión).

### 2. Clonar y configurar

```bash
git clone https://github.com/franco0209/Narrowcast-NB.git
cd Narrowcast-NB
cp .env.example .env
```

Editar `.env` y cambiar al menos `MQTT_PASS` (clave del broker MQTT). El resto de valores sirve tal cual; los `SUBSCRIBER_*` son valores de ejemplo públicos, solo para pruebas.

### 3. Levantar el núcleo, el broker y el panel

```bash
docker compose up -d
```

La primera vez construye las imágenes de Open5GS (compila desde fuente: tarda bastante), la WebUI y el panel. Después arranca MongoDB, el EPC completo (MME, HSS, SGW-C/U, PGW-C/U, PCRF), Mosquitto y el panel. No emite nada por radio.

Comprobar:

```bash
docker compose ps                              # todos "running" (subscriber-provisioner termina solo: es normal)
docker logs nb-mme 2>&1 | tail -5              # "MME initialize...done" y "CONNECTED TO 'hss.localdomain'"
```

- Panel: <http://127.0.0.1:8080> (pestaña **Resumen**: los contenedores deben salir en verde).
- WebUI de Open5GS: <http://127.0.0.1:9999> (`admin` / `1423`; cambiar la clave). Ahí se registrarán las SIM reales.

### 3b. Probar el panel sin hardware

```bash
docker compose exec app python fake_device.py esp32-sim
```

En la pestaña **Dispositivo** aparecen medidores y gráfico en vivo; pulsar la bombilla envía una orden de LED por MQTT y el simulador la confirma. Detener con Ctrl+C.

### 4. (Opcional) Validar el núcleo con radio virtual

Comprueba que un UE simulado se registra, obtiene IP y hace ping por el túnel. Construye además la imagen de srsRAN (tarda y ocupa espacio).

```bash
docker compose --profile sim build             # imagen de srsRAN 4G
scripts/sim.sh up
scripts/sim.sh validate                        # S1 Setup, attach, IP y ping
scripts/sim.sh down
```

### 5. Construir el eNB NB-IoT (OAI)

```bash
docker build -t narrowcast-nb/oai-nbiot:local docker/oai-nbiot
```

Tarda unos 20 minutos y necesita ~6 GB libres en el pico. Comprobar que la imagen existe y arranca:

```bash
docker run --rm --entrypoint bash narrowcast-nb/oai-nbiot:local -c 'cd /opt/oai/cmake_targets/lte_build_oai/build && ./lte-softmodem -h | head -3'
```

### 6. Crear el contenedor del eNB

```bash
docker compose --profile radio create enb-nbiot
```

No lo enciende. Solo lo deja creado para que el botón de **Radio** del panel pueda arrancarlo.

### 7. Comprobar la conexión S1 entre el eNB y el MME (sin radio)

Esta prueba no emite RF: sin USRP el eNB se conecta por S1 y se detiene. `S1_ONLY=1` se salta el plan RF, así que **solo sirve para esta prueba** y después hay que recrear el contenedor normal.

```bash
docker rm -f nb-enb-nbiot
S1_ONLY=1 docker compose --profile radio up -d --no-deps enb-nbiot
sleep 25
docker logs nb-mme 2>&1 | grep "eNB-S1 accepted"      # el MME aceptó al eNB (S1 Setup)
docker logs nb-enb-nbiot 2>&1 | tail -5               # termina con "No USRP Device Found": esperado sin hardware
# Volver al modo normal (obligatorio):
docker rm -f nb-enb-nbiot && docker compose --profile radio create enb-nbiot
```

Hasta aquí llega todo lo verificado sin hardware.

### 8. Preparar la transmisión real (requiere USRP y autorización)

Solo con la **autorización escrita del docente** (banda, potencia, cable o antena) y el USRP conectado:

1. Abrir <http://127.0.0.1:8080> → **Radio**. El plan ya trae valores seguros (B3, cable, 60 dB, ganancia 0, 120 s).
2. Elegir la banda autorizada, hacer el barrido de espectro, y solo entonces activar **Portadora libre** y escribir **Autorizado por** (nombre y fecha). Sin estas dos confirmaciones el botón queda bloqueado.
3. Si el USRP es USB, pasar el dispositivo al contenedor (ver el comentario en `compose.yaml`, servicio `enb-nbiot`) y volver a crearlo con `docker compose --profile radio create enb-nbiot`.
4. Mantener pulsado el botón rojo 1,5 s. El eNB se enciende y se corta solo al cumplirse la duración; también se puede detener a mano.

Desde la terminal, el mismo plan se valida con `scripts/rf-check.sh` (el plan vive en `data/rf-plan.yaml`).

### 9. Módulo, SIM y firmware (requiere hardware)

1. Registrar la SIM (IMSI, Ki, OPc) en la WebUI (<http://127.0.0.1:9999>) con los mismos valores programados en la SIM.
2. Firmware del ESP32: copiar `firmware/esp32-nbiot/secrets.example.h` a `secrets.h`, completar banda (`NB_BAND`), broker (`10.44.0.5`), usuario y clave MQTT (los de `.env`) y `DEVICE_ID`, y cargarlo con Arduino IDE o PlatformIO. *Sin probar en hardware real.* Además, la ruta de datos del módulo hasta el broker (PGW-U → Mosquitto, con retorno hacia `10.58.0.0/16`) aún no se ha verificado y puede requerir una ruta o NAT adicional.
3. Seguir las guías de la pestaña **Guía** del panel (comandos AT, registro y datos).

### Detener y limpiar

```bash
docker compose --profile sim --profile radio down     # detiene todo (los datos de MongoDB se conservan en su volumen)
docker compose down -v                                # además borra el volumen de MongoDB (suscriptores)
```

### Problemas frecuentes

| Síntoma | Causa y solución |
|---|---|
| El panel responde que no existe `nb-enb-nbiot` | Falta el paso 6 (`docker compose --profile radio create enb-nbiot`). |
| `no space left on device` al construir | Liberar disco: `docker builder prune -f` y `docker image prune`. |
| El puerto 8080, 9999 o 1883 está ocupado | Cambiar `APP_PORT`, `WEBUI_PORT` o `MQTT_PORT` en `.env` y repetir `docker compose up -d`. |
| El botón de transmisión sigue bloqueado | Falta **Portadora libre** o **Autorizado por** (la pestaña Radio marca con ✕ lo que falta). |
| El eNB termina con `No USRP Device Found` | Esperado sin USRP; con USRP, revisar el paso 8.3. |
