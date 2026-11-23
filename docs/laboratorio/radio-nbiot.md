# Radio NB-IoT de la celda del laboratorio

La vista de la RAN muestra y permite cambiar los parámetros de radio del eNB de OAI del laboratorio. Hay que separar lo real de lo modelado.

**Real (lo carga OAI).** Banda (B3, B7, B8, B20, B28) con sus frecuencias DL/UL y EARFCN, portadora LTE anfitriona (`N_RB_DL`: 6 a 100 PRB), ganancia de TX, periodicidad de NPRACH, repeticiones de NPDCCH del acceso aleatorio y ciclo de paging. El panel guarda la elección en `data/lab-radio.json`. `scripts/oai-lab-start.sh` ejecuta `lab/oai-fakerf/radio_cfg.py`, que la escribe en `/tmp/enb.conf` y deja lo cargado en `data/lab-radio.applied.json`. OAI solo lee su `.conf` al arrancar: **«Aplicar a OAI» reinicia el eNB** (~45 s) y el nodo debe registrarse de nuevo. El panel distingue «guardado» de «aplicado» y lista los cambios pendientes. `inject.c` informa al eNB de la banda real del UE (`OAI_UE_BAND`).

**Modelo (`app/simlab/radio.py`, no medido).** Con radio falsa no hay señal que degradar, así que se calcula: pérdida de propagación (espacio libre a 1 m + exponente 3), RSRP con 20 dBm + ganancia, nivel de cobertura (CE0 ≥ −105, CE1 ≥ −115, CE2 ≥ −128 dBm; 1, 8 y 64 repeticiones), tiempo en el aire (120 ms por repetición) y energía (0,8 W transmitiendo). Consecuencias sobre el nodo simulado:

| Parámetro | Efecto |
|---|---|
| Banda que el módulo no soporta (p. ej. B7) | `AT+CBANDCFG` falla, el módulo no encuentra la celda y el registro no se intenta |
| Distancia (se aplica al instante, sin reiniciar) | Cambia el RSRP y el nivel de cobertura; fuera de −128 dBm el nodo no transmite ni recibe |
| Nivel de cobertura | Cada mensaje se repite y tarda más en el aire; sube la energía por mensaje |
| NPRACH | El mensaje de subida espera hasta la siguiente oportunidad de preámbulo |
| Ciclo de paging | Una orden del celular espera hasta la siguiente ocasión de paging antes de llegar al nodo |
| `N_RB_DL` | Solo cambia la portadora anfitriona; no altera la velocidad por nodo |

Las bandas NB-IoT del SIM7080G salen de listados de terceros (Waveshare, M5Stack, everythingrf) y faltan de confirmar con la hoja de datos de SIMCom.

## Cómo se usa

En el panel: **Laboratorio → bloque RAN → «Interfaz radio (Uu)»**.

1. Cambia banda, portadora anfitriona, ganancia, NPRACH, NPDCCH o paging. Cada cambio se **guarda** al instante, pero OAI sigue con lo anterior hasta que se aplique: la tarjeta lista los cambios pendientes (antes → después).
2. **«Aplicar a OAI y reiniciar el eNB»** reinicia `nb-oai-lab` con la radio nueva (~45 s). El nodo pierde su sesión y hay que registrarlo de nuevo.
3. El deslizador de **distancia** no necesita reiniciar: cambia el RSRP y el nivel de cobertura del nodo en el acto (se ve también en la vista del UE y en `AT+CSQ`).

## Qué se probó (2026-11-23)

| Prueba | Resultado |
|---|---|
| B28 a 800 m, aplicada y con el nodo registrado | OAI cargó B28 (DL 780 MHz, UL 725 MHz); RSRP −108 dBm, CE1. La telemetría tardó ~1,2 s en salir (8 repeticiones) y una orden del celular ~2 s en llegar (1 s de espera de paging) |
| Nodo a 4 km | RSRP −129 dBm: sin cobertura, el nodo deja de transmitir y no recibe órdenes |
| B7 (el módulo no la soporta en NB-IoT) | `AT+CBANDCFG="NB-IOT",7` devuelve `+CME ERROR`, el módulo no encuentra la celda y el registro ni se intenta |
| B7 con 25 PRB | OAI arranca y se mantiene estable |

## Dónde está cada cosa

| Qué | Dónde |
|---|---|
| Parámetros, tablas de bandas y modelo | `app/simlab/radio.py` |
| Rutas `POST /api/lab/radio/config` (guarda) y `POST /api/lab/radio/apply` (reinicia OAI) | `app/main.py` → `app/simlab/server.py` |
| Escritura del `.conf` y registro de lo aplicado | `lab/oai-fakerf/radio_cfg.py`, invocado por `scripts/oai-lab-start.sh` |
| Estado deseado y estado aplicado | `data/lab-radio.json` y `data/lab-radio.applied.json` |
| Banda del UE en `UECapabilityInformation` | `lab/oai-fakerf/inject.c` (variable `OAI_UE_BAND`) |
| Tarjeta de la interfaz | `app/web/src/lab/views/RadioCard.tsx` |

## Límites

- Las fórmulas y los umbrales son aproximaciones didácticas, no mediciones; la tarjeta lo dice.
- Las bandas NB-IoT del SIM7080G (B1, B2, B3, B4, B5, B8, B12, B13, B18, B19, B20, B25, B26, B28, B66, B71 y B85) salen de listados de terceros (Waveshare, M5Stack, everythingrf), no de la hoja de datos oficial de SIMCom: pendiente de confirmar.
- El modo de operación (in-band, guard-band o standalone) se deduce de `N_RB_DL`; OAI no lo expone.
- Con radio real, `tx_gain` y la banda no se cambian desde aquí: los gobierna el plan RF ([`seguridad-rf.md`](../operacion/seguridad-rf.md)).

