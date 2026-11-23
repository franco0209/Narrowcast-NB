# Pruebas de OpenAirInterface sin USRP (radio falsa)

Objetivo: ejercitar **el software de OAI** (no la señal de radio) contra Open5GS. Los guiones están en [`lab/oai-fakerf/`](../../lab/oai-fakerf/README.md). Todo se hizo en un contenedor de desarrollo aparte (`oai-dev`); la imagen de OAI no recibe estos ganchos de prueba (solo la corrección del hallazgo 1).

## Cómo se hizo

1. **Radio falsa.** OAI carga el dispositivo de radio con `dlopen("liboai_device.so")`. Se compiló una biblioteca de ~60 líneas que entrega ruido a ritmo real (1 ms de muestras tarda 1 ms) y descarta lo que OAI transmite. Los hilos de tiempo real de la capa física y el planificador MAC giran sin hardware (requiere `SYS_NICE` por `SCHED_FIFO`).
2. **Acceso aleatorio.** OAI trae ganchos de simulación de preámbulo y Msg3, desactivados con un `0`. Se activan con `OAI_SIM_RACH=1` y se recompila solo ese archivo.
3. **Inyector.** Un hilo dentro de OAI recibe por UDP un NAS, lo codifica en RRC con el ASN.1 de OAI y lo entrega con `rrc_data_ind`, el mismo punto por el que entra lo que decodifica el RLC/PDCP.
4. **Conductor.** En esta primera etapa, `drive.py` hacía de módulo con la SIM de `foco-01` (hoy obsoleto: lo reemplazó el simulador `app/simlab/`, ver [`implementacion.md`](implementacion.md)).

## Resultados

| Etapa | Resultado |
|---|---|
| OAI arranca con la radio falsa, hilos PHY/PRACH/synch en `SCHED_FIFO`, S1 aceptado por el MME | **Funciona** |
| Acceso aleatorio: preámbulo → RAR (Msg2) → Msg3 → `RRCConnectionSetup-NB` → Msg4 → concesión de subida | **Funciona** (RRC decodifica el `RRCConnectionRequest-NB`; MAC, RLC y PDCP configuran SRB1) |
| `RRCConnectionSetupComplete` con Attach Request → S1AP de OAI → MME de Open5GS | **Funciona** (el MME responde con Authentication Request) |
| NAS de bajada → RRC `DLInformationTransfer-NB`; autenticación Milenage y Security Mode Command | **Funciona** (MAC-A y EIA2 verificados) |
| `Initial Context Setup Request` del MME | **FALLA** con el OAI original (hallazgo 1) |
| Con la corrección de una línea: túnel GTP-U creado, claves derivadas, Security Mode Command de RRC generado | **Funciona** |

## Hallazgos

**1. OAI no decodifica el `Initial Context Setup Request` de Open5GS cuando incluye Masked-IMEISV.**
Open5GS añade el IE `Masked-IMEISV` (id 192, criticidad *ignore*) al mensaje cuando el terminal devuelve su IMEISV en el Security Mode Complete, algo que un módulo real normalmente hace porque el MME lo pide siempre. El decodificador S1AP de OAI (generado de ASN.1 R10.5) no conoce ese IE y devuelve error: `Unknown protocol IE id (192)… Failed to decode PDU`. El mensaje se descarta, OAI nunca responde y el MME acaba reintentando el Attach Accept hasta rendirse (`Retransmission … failed`). **Un módulo real no podría registrarse con esta combinación sin corregirlo.**
- Verificado: sin IMEISV (y con el MME recién reiniciado) OAI procesa el mensaje; con IMEISV falla.
- Corrección probada: en `s1ap_decoder.c` generado, el `default:` del decodificador de ese mensaje hace `return -1`; cambiarlo por `break` (omitir el IE ignorable) basta. Con ella OAI procesa el mensaje aun con IMEISV. `patch.sh` la aplica. **Ya aplicada a la imagen de producción** (`docker/oai-nbiot/patch-s1ap.py`, ver `modificaciones-oai-open5gs.md` §6) y verificada con el escenario «Registrar por OAI» del Laboratorio.

**2. La máquina de estados del MAC se guía por cuántas veces hace acceso aleatorio el dispositivo.** El registro de OAI lo dice: `It is the second time that this UE try to rach`. Hay una variable global (`UE_state_machine`) y un RNTI temporal fijo (`0x0101`). Coincide con lo que se leyó en el código y sigue siendo un riesgo con un módulo real, pero **aquí está mezclado con un artefacto de la prueba** (la simulación repite el preámbulo en cada hiperframe), así que no es una demostración limpia.

**3. El RRC de NB-IoT solo acepta los formatos de Msg3 de «la prueba actual».** Mensajes `unknown MSG3 format for NB-IoT for current test` aparecen cuando llega un Msg3 distinto del de los autores. Es código de investigación.

## Lo que NO se probó

- La **capa física NB-IoT**: la radio falsa no entrega señal. Eso solo lo prueba un USRP real.
- El resto del registro tras el Security Mode Command de RRC: SecurityModeComplete, UECapability, RRCConnectionReconfiguration, la respuesta `Initial Context Setup Response`, el Attach Complete y el plano de datos. Cada uno requiere más mensajes RRC inyectados; no llegué a ellos.
- Que un módulo real se comporte como el conductor (orden de mensajes, IMEISV, capacidades).

## Efectos secundarios de las pruebas

Se reinició `nb-mme` dos veces para limpiar el contexto de los dispositivos del Laboratorio; el simulador abre su S1 de nuevo al usarlo. El contenedor `oai-dev` se elimina al terminar (`docker rm -f oai-dev`); los guiones lo recrean.

## Desde el panel: Laboratorio

El módulo **Laboratorio** del panel lanza estas pruebas sin comandos y las muestra animadas (ver [`panel.md`](../operacion/panel.md) §7). El contenedor `nb-oai-lab` se crea una vez: `docker compose --profile oailab create oai-lab`; el panel lo arranca solo.

1. **Preparar**: alta de la SIM del nodo en el HSS.
2. **Registrar nodo** (o **SIM clonada** / **Intruso**): el panel reinicia OAI (conecta un UE simulado por arranque), `simlab` espera ~40 s a que OAI esté listo y registra el nodo. La primera vez `prepare.sh` instala los ganchos de prueba y recompila (1-2 min).
3. Tras el Attach Accept el módulo completa el contexto (inyección de `UECapabilityInformation` y `RRCConnectionReconfigurationComplete`): OAI envía la *Initial Context Setup Response* al MME y se abre el túnel S1-U.
4. El módulo abre MQTT con el broker: **los paquetes IP entran a OAI por UDP 9101, OAI los encapsula en GTP-U hacia el SGW-U y la bajada vuelve por `OAI_RELAY_DL`**.

**Resultado verificado:** registro completo por OAI, *Initial Context Setup Response* correcta, telemetría MQTT del nodo que llega al panel y `ping` de ida y vuelta al broker (~0,6 ms) a través de OAI y el núcleo. Rechazos por SIM clonada e intruso desde OAI.

**Alcance:** no prueba la capa física ni el acceso aleatorio real (la radio es falsa). El tramo Uu de los datos lo sustituye el relevo UDP de pruebas.

**Hallazgo nuevo:** si se inyecta un mensaje RRC a OAI antes de ~40 s tras su arranque, `lte-softmodem` termina con SIGSEGV (el RRC/PDCP aún se inicializa). Por eso `oai.py` espera `SETTLE_S`.
