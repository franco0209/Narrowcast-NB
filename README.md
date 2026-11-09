# Narrowcast-NB

Red privada celular IoT (NB-IoT / LTE-M) sobre Open5GS. Un ESP32 con un módulo NB-IoT (SIM7080G / BG96) se conecta por radio a un USRP que actúa de eNB, y este a un núcleo Open5GS que corre en Docker. Plan completo en [`docs/PLAN Narrowcast-NB.md`](docs/PLAN%20Narrowcast-NB.md).

```
ESP32 ──UART (AT)── Módulo NB-IoT ~~ antena ~~ USRP (eNB) ── UTP ── PC (Open5GS) ── MQTT
```

## Estado

| Fase | Descripción | Estado |
|---|---|---|
| 0 | Reglas de transmisión RF | Herramientas listas; falta la confirmación escrita del docente (banda, potencia, antena) |
| 1 | Núcleo Open5GS dockerizado, sin radio | Hecha y validada con radio virtual |
| 2 | Cadena de radio con LTE normal (USRP + teléfono) | Pendiente |
| 3 | eNB NB-IoT (OAI `develop-nb-iot`) | Pendiente |
| 4 | El módulo se registra | Pendiente |
| 5 | Datos reales (MQTT) | Pendiente |
| 6 | PSM, eDRX y consumo | Pendiente |
| 7 | Informe y demostración | Pendiente |

## Requisitos

Docker con Compose v2. Para las fases con radio real, además un USRP y el módulo con su SIM.

## Fase 1: núcleo (EPC) dockerizado, sin radio real

Compatible con el laboratorio Lain5G/OIA: mismas versiones (Open5GS v2.7.5, srsRAN 4G 23.11), pero con red Docker propia (`10.44.0.0/24`, `narrowcast-nb-core`), volumen propio y contenedores `nb-*`, así que ambos pueden coexistir.

```bash
cp .env.example .env           # ajustar si hace falta (puerto de la WebUI, imágenes)
scripts/sim.sh up              # núcleo + eNB/UE virtuales (ZMQ)
scripts/sim.sh validate        # S1, attach, IP y ping por el túnel
scripts/sim.sh down
```

- **Solo el núcleo**, sin radio virtual (el modo para las fases con radio real): `docker compose up -d`.
- **WebUI:** <http://127.0.0.1:9999> (por defecto `admin` / `1423`; cambiar la clave). Ahí se registran las SIM reales en la Fase 4.
- **Parámetros:** PLMN `001/01`, TAC `1`, APN `internet`, subred de UE `10.58.0.0/16`.
- **Suscriptor de prueba:** las variables `SUBSCRIBER_*` de `.env` se cargan solas en MongoDB al arrancar. Son valores de ejemplo públicos; no usarlos en una red real.
- **Imágenes:** la primera vez se construyen (`docker compose build`; Open5GS y srsRAN compilan desde fuente y tardan). Para reutilizar la imagen de Open5GS que ya construyó Lain5G, poner `OPEN5GS_IMAGE=lain5g-lab/open5gs:local` en `.env`.
- **Puertos:** solo se publica la WebUI, en `127.0.0.1`. Si el puerto choca con otro servicio, cambiar `WEBUI_PORT`.

## Fase 0: reglas de transmisión RF

RF apagada por defecto. Antes de emitir con un USRP real:

```bash
cp rf-plan.example.yaml rf-plan.yaml   # fuera de Git; completar banda, EARFCN, autorización...
scripts/rf-check.sh                    # bloquea si falta algo
scripts/rf-run.sh --resultado "ok" -- <comando del eNB>
```

`rf-check.sh` exige: banda soportada por el módulo (B3, B8, B20, B28), EARFCN, `autorizado_por`, `tx_gain` ≤ 30, en modo cable atenuación ≥ 60 dB (en modo antena, permiso escrito), duración entre 1 y 600 s y portadora libre confirmada. `rf-run.sh` además corta el comando al cumplirse `duracion_max_s` y registra la sesión en `logs/rf-sessions.csv` (fecha, banda, ganancia, duración, resultado).

Por defecto, cable y atenuador; la antena solo con permiso escrito del docente. El script verifica que el plan esté completo, pero no mide potencia: eso se comprueba con un analizador de espectro. La radio virtual (ZMQ) de la Fase 1 no emite RF y no necesita nada de esto.

## Estructura

```
compose.yaml            servicios (perfil `sim` = radio virtual)
.env.example            variables (copiar a .env)
rf-plan.example.yaml    plantilla del plan RF (copiar a rf-plan.yaml)
config/open5gs/         MME, HSS, SGW-C/U, PGW-C/U (SMF/UPF), PCRF
config/srsran/          eNB y UE virtuales
provisioning/           alta del suscriptor en MongoDB
docker/                 Dockerfiles (open5gs, srsran4g, webui)
scripts/                sim.sh, validate.sh, rf-check.sh, rf-run.sh
docs/                   plan del proyecto
```

`.env`, `rf-plan.yaml`, `logs/` y los `.pcap` no se versionan.
