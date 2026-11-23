# Seguridad de radiofrecuencia

Transmitir en una banda celular sin permiso puede interferir a operadores reales (incluidos servicios de emergencia) y es ilegal. **Ni OAI ni Open5GS impiden emitir**, así que la protección la pone este proyecto: la radio nace apagada y cada emisión pasa por varias barreras, que aplican tanto `scripts/rf-check.sh` como el panel.

## Reglas del plan RF

Emitir en banda celular está regulado, así que la radio nace apagada y cada emisión pasa por varias barreras. Las aplican tanto `scripts/rf-check.sh` como el panel:

| Regla | Valor |
|---|---|
| Bandas permitidas | B3, B8, B20, B28 |
| Ganancia TX | ≤ 30 dB, empezando en 0 |
| Modo cable | atenuación ≥ 60 dB (por defecto) |
| Modo antena | solo con `antena_autorizada: sí` (permiso escrito) |
| Duración | de 1 a 600 s, con corte automático |
| Portadora | `portadora_libre: sí` tras un barrido de espectro |
| Autorización | `autorizado_por` con nombre y fecha |
| Confirmación | botón mantenido 1,5 s; cada sesión se registra |

Además: el eNB solo arranca desde el panel (`docker start` del contenedor ya creado), se apaga al reiniciarse el panel, y cada sesión queda en `data/logs/rf-sessions.csv` (fecha, banda, modo, ganancia, duración, resultado). El script valida que el plan esté completo; **no mide potencia**, eso se comprueba con un analizador de espectro.

Seguridad del panel: monta `/var/run/docker.sock` para encender el eNB, lo que equivale a acceso de administrador al equipo; por eso solo escucha en `127.0.0.1` y no debe exponerse a la red.

## Las barreras, en capas


Ni OAI ni Open5GS impiden emitir. Nuestras barreras, **en capas**:

1. **`rf-check.sh`** valida `rf-plan.yaml`: banda en {3, 8, 20, 28}, `tx_gain` ≤ 30, modo cable con `atenuacion_db` ≥ 60 o modo antena con permiso escrito, duración 1–600 s, portadora libre confirmada, `autorizado_por` no vacío. Devuelve código ≠ 0 si algo falla.
2. **Panel** (`app/main.py`): `POST /api/radio/start` exige escribir `EMITIR`, vuelve a ejecutar `run_checks()` (invoca el mismo script), y recién entonces `docker.containers.get(...).start()`. Programa un `threading.Timer(dur, stop_radio)` que apaga el contenedor al vencer `duracion_max_s`.
3. **Apagado por defecto**: en `startup()` si el contenedor del eNB está encendido (de una sesión anterior), el panel lo detiene.
4. **Registro**: cada sesión se anota en `data/logs/rf-sessions.csv` (`log_session`).
5. **`rf-run.sh`**: envoltorio para ejecutar cualquier comando que emita con las mismas comprobaciones, `timeout` y registro.

**Lo que no hace:** medir potencia. El plan se valida, no se mide (hace falta analizador de espectro).

## Cómo se usa


RF apagada por defecto. Antes de emitir con un USRP real:

```bash
cp rf-plan.example.yaml data/rf-plan.yaml   # fuera de Git (o editarlo desde el panel web)
scripts/rf-check.sh                    # bloquea si falta algo
scripts/rf-run.sh --resultado "ok" -- <comando del eNB>
```

`rf-check.sh` exige: banda soportada por el módulo (B3, B8, B20, B28), EARFCN, `autorizado_por`, `tx_gain` ≤ 30, en modo cable atenuación ≥ 60 dB (en modo antena, permiso escrito), duración entre 1 y 600 s y portadora libre confirmada. `rf-run.sh` además corta el comando al cumplirse `duracion_max_s` y registra la sesión en `data/logs/rf-sessions.csv` (fecha, banda, ganancia, duración, resultado).

Por defecto, cable y atenuador; la antena solo con permiso escrito del docente. El script verifica que el plan esté completo, pero no mide potencia: eso se comprueba con un analizador de espectro. La radio virtual (ZMQ) de la Fase 1 no emite RF y no necesita nada de esto.
