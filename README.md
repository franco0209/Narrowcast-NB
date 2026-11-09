# Narrowcast-NB

Red privada celular IoT (NB-IoT / LTE-M) sobre Open5GS. Plan completo en `docs/PLAN Narrowcast-NB.md`.

## Fase 1: núcleo (EPC) dockerizado, sin radio real

Compatible con el laboratorio Lain5G/OIA: mismas versiones (Open5GS v2.7.5, srsRAN 4G 23.11), pero red Docker propia (`10.44.0.0/24`, nombre `narrowcast-nb-core`), volumen y contenedores `nb-*`, de modo que pueden coexistir.

```bash
cp .env.example .env           # ajustar si hace falta (puerto WebUI, imágenes)
scripts/sim.sh up              # núcleo + eNB/UE virtuales (ZMQ)
scripts/sim.sh validate        # S1, attach, IP y ping por el túnel
```

- WebUI: <http://127.0.0.1:9999> (usuario `admin`, clave `1423`; cambiarla). Aquí se registran las SIM reales en la Fase 4.
- Solo el núcleo (sin radio virtual): `docker compose up -d`.
- PLMN `001/01`, TAC `1`, APN `internet`, subred de UE `10.58.0.0/16`.
- El suscriptor de prueba (variables `SUBSCRIBER_*` de `.env`) se carga solo en MongoDB al arrancar.
- Para reutilizar la imagen de Open5GS ya construida por Lain5G, poner `OPEN5GS_IMAGE=lain5g-lab/open5gs:local` en `.env`.

## Estructura

```
compose.yaml          servicios (perfil `sim` = radio virtual)
config/open5gs/       MME, HSS, SGW-C/U, PGW-C/U (SMF/UPF), PCRF
config/srsran/        eNB y UE virtuales
provisioning/         alta del suscriptor en MongoDB
docker/               Dockerfiles (open5gs, srsran4g, webui)
scripts/              sim.sh, validate.sh
```

## Fase 0: reglas de transmisión RF

RF apagada por defecto. Antes de emitir con un USRP real:

```bash
cp rf-plan.example.yaml rf-plan.yaml   # fuera de Git; completar con banda, EARFCN, autorización...
scripts/rf-check.sh                    # bloquea si falta algo (banda, autorización, ganancia, atenuador...)
scripts/rf-run.sh --resultado "ok" -- <comando del eNB>   # comprueba, limita la duración y registra en logs/rf-sessions.csv
```

Por defecto, cable y atenuador ≥ 60 dB; la antena solo con permiso escrito del docente. La radio virtual (ZMQ) de la Fase 1 no emite RF y no necesita esto.
