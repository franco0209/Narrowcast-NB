# OAI con radio falsa: probar el eNB NB-IoT sin USRP

Ejercita el **MAC, RRC, RLC, PDCP, S1AP y GTP-U reales de OpenAirInterface** contra el **MME real de Open5GS**, sin hardware.
**No** prueba la capa física (la «radio» entrega ruido, no una señal NB-IoT). Resultados y hallazgos: [`docs/laboratorio/pruebas-oai.md`](../../docs/laboratorio/pruebas-oai.md).

| Archivo | Qué hace |
|---|---|
| `fakedev.c` | Biblioteca `liboai_device.so` falsa: ocupa el lugar del USRP (ruido a ritmo real, descarta lo que se transmite) |
| `inject.c` | Inyector UDP dentro de OAI. Puerto 9100: `SC` (RRCConnectionSetupComplete-NB con un NAS), `UT` (ULInformationTransfer-NB), `UC` (UECapabilityInformation mínima) y `RC` (RRCConnectionReconfigurationComplete: OAI contesta con la *Initial Context Setup Response*). Puerto 9101: paquetes IP del dispositivo → GTP-U de OAI → SGW-U (subida de datos) |
| `setup.sh` | Crea el contenedor de desarrollo `oai-dev` (con `SYS_NICE`), compila la radio falsa y genera la configuración. **No toca la imagen original** |
| `patch.sh` | Activa la simulación de RACH, instala el inyector y los enganches de NAS, corrige el decodificador S1AP y recompila solo lo necesario (~90 MB) |
| `prepare.sh` | Lo mismo que `patch.sh`, pero se ejecuta dentro del contenedor; lo usa el servicio `oai-lab` de `compose.yaml` (Laboratorio del panel, ver `app/simlab/oai.py`). Además instala el **relevo de bajada**: con `OAI_RELAY_DL=ip:puerto` los paquetes IP que el SGW-U manda al eNB (`gtpv1u_eNB.c`) se reenvían por UDP en vez de ir a PDCP. `scripts/oai-lab-start.sh` lo vuelve a ejecutar solo si cambia algún archivo de esta carpeta |
| `drive.py` | Hace de módulo: manda el Attach Request y responde a los NAS que baja el MME (reutiliza Milenage/EIA2 del laboratorio) |

## Uso

```bash
lab/oai-fakerf/setup.sh && lab/oai-fakerf/patch.sh          # una vez (compila ~1 min)
docker exec -d oai-dev sh -c 'cd /opt/oai/cmake_targets/lte_build_oai/build; \
  OAI_SIM_RACH=1 OAI_INJECT=1 timeout 100 stdbuf -o0 -e0 ./lte-softmodem -O /tmp/enb.conf -S > /tmp/oai.log 2>&1'
python3 lab/oai-fakerf/drive.py foco-01 60 [imeisv]         # OBSOLETO (ver nota)
docker rm -f oai-dev                                        # al terminar: libera el disco
```

**Nota:** `drive.py` es el conductor de la primera versión de estas pruebas. Importa `simlab.s1`, módulo que se eliminó cuando el Laboratorio pasó a usar solo OAI, y la dependencia `pycrate` ya no está en `app/requirements.txt`, así que **ya no funciona**. Se conserva como referencia histórica; el flujo vigente es el escenario «Registrar nodo» del Laboratorio (`app/simlab/oai.py` + `nas.py`), descrito en [`docs/laboratorio/implementacion.md`](../../docs/laboratorio/implementacion.md).
Si repites la prueba para el mismo IMSI, reinicia antes `nb-mme` (arrastra el IMEISV de intentos anteriores).

## Plano de datos con radio falsa

Con radio real, los paquetes de datos del módulo viajan por el portador de la interfaz Uu (PHY → MAC → RLC → PDCP). Con la radio falsa no hay portador, así que ocupa su lugar un **relevo UDP**: la subida entra a OAI por el puerto 9101 y se entrega al GTP-U exactamente como lo haría PDCP; la bajada sale del GTP-U de OAI hacia `OAI_RELAY_DL`. Lo que cruza OAI, S1-U y el núcleo es GTP-U real.

**Aviso:** inyectar mensajes RRC antes de ~40 s tras el arranque de OAI provoca un SIGSEGV de `lte-softmodem`; `app/simlab/oai.py` espera ese tiempo.
