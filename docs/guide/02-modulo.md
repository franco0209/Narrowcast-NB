# 2. Registrar el módulo NB-IoT

## SIM y núcleo
1. Carga **IMSI, Ki y OPc** en la SIM programable (sysmoISIM / OpenCells con lector PC/SC).
2. Registra los mismos valores como suscriptor en la **WebUI de Open5GS** (`http://127.0.0.1:9999`, APN `internet`).
3. PLMN `001/01`, TAC `1`.

## Comandos AT
Conecta el módulo por USB-serie (o al ESP32) y comprueba antes el firmware: `ATI`, `AT+CGMR`.

| Paso | SIM7080G | BG96 |
|---|---|---|
| Modo NB-IoT | `AT+CMNB=2` | `AT+QCFG="iotopmode",1` |
| Banda | `AT+CBANDCFG="NB-IOT",<banda>` | `AT+QCFG="band"` |
| Ver bandas | `AT+CBANDCFG?` | `AT+QCFG="band"` |

Búsqueda manual de red y APN:

```
AT+COPS=1,2,"00101"
AT+CGDCONT=1,"IP","internet"
```

## Si el attach falla
- Revisa el log del MME: `docker compose logs mme`.
- Causas habituales: clave mal cargada, PLMN o TAC distintos, banda no soportada.
- Captura el tráfico **S1** con Wireshark y busca *Attach Request → Authentication → Attach Accept*.
