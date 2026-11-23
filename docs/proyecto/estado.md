# Estado del proyecto

En qué fase está cada parte, qué falta y qué está verificado. Es la única tabla de estado: los demás documentos remiten aquí. El plan original (fases, riesgos y compras) está en [`plan.md`](plan.md).

Convención: lo que se afirma sobre el funcionamiento está comprobado en este repositorio; lo que es teoría general (3GPP, NB-IoT) es conocimiento estándar; lo que **no** se ha probado con hardware real se marca como *sin verificar*.

## Estado por fases

| Fase | Descripción | Estado |
|---|---|---|
| 0 | Reglas de transmisión RF | Herramientas y módulo Radio del panel listos; falta la confirmación escrita del docente (banda, potencia, antena) |
| 1 | Núcleo Open5GS dockerizado, sin radio | Hecha y validada con radio virtual |
| 2 | Cadena de radio con LTE normal (USRP + teléfono) | Omitida (sin teléfono; la comprobación del USRP pasa a la Fase 3) |
| 3 | eNB NB-IoT (OAI `develop-nb-iot`) | En curso: imagen validada y eNB configurado; el S1 Setup con el MME funciona (sin radio); falta probarlo con USRP |
| 4 | El módulo se registra | Software listo (guía, WebUI, panel); falta hardware (módulo, SIM) y eNB |
| 5 | Datos reales (MQTT) | Broker, panel y firmware listos (probados con simulador; firmware sin probar en hardware) |
| 6 | PSM, eDRX y consumo | Pendiente |
| 7 | Informe y demostración | Pendiente |
| — | Laboratorio de simulación (nodo de riego sobre OAI con radio falsa + Open5GS) | Hecho: registro, datos MQTT, escenarios de ataque y radio NB-IoT de la celda verificados sin radio (ver [`implementacion.md`](../laboratorio/implementacion.md) y [`radio-nbiot.md`](../laboratorio/radio-nbiot.md)) |

## Qué falta

El software está listo hasta donde se puede sin hardware. Lo que queda depende de cosas externas:

| Falta | De qué depende | Fase |
|---|---|---|
| Autorización escrita (banda, potencia, cable o antena) y `data/rf-plan.yaml` completo | Docente | 0 |
| Modelo de USRP; si es USB, pasar `/dev/bus/usb` al contenedor y confirmar el `tx_gain` | Laboratorio | 3 |
| Barrido de espectro, elegir portadora libre y comprobar que el eNB emite NB-IoT (punto de decisión del plan) | USRP + analizador | 3 |
| SIM programable y lector PC/SC; alta de IMSI/Ki/OPc en la WebUI | Compra o laboratorio | 4 |
| Módulo NB-IoT (SIM7080G/BG96) con la banda confirmada; que el attach funcione con OAI + Open5GS (riesgo documentado) | Compra | 4 |
| Probar el firmware del ESP32 en hardware real | Módulo + ESP32 | 5 |
| PSM/eDRX, medición de consumo (INA226 u otro instrumento) | Hardware | 6 |
| Capturas de Wireshark, tabla de consumos, informe y demostración | Todo lo anterior | 7 |

Sin resolver aún en software: el panel no tiene todavía módulo de energía/consumo, consola AT real (el Laboratorio tiene una simulada), captura S1 ni diagnóstico guiado.

## Tabla de verificación

| Elemento | Estado | Dónde se comprueba |
|---|---|---|
| Open5GS compila; el EPC arranca; S6a, Gx y PFCP funcionan entre contenedores | **Verificado** (Fase 1) | `docker compose up -d` |
| Registro completo con UE virtual (srsRAN) y `ping` por el túnel | **Verificado** | `scripts/validate.sh` |
| OAI NB-IoT compila (`lte-softmodem`) | **Verificado** | `docker build` |
| S1 Setup entre OAI y el MME de Open5GS (`eNB-S1 accepted`) | **Verificado, sin radio** | panel, pestaña eNB |
| Panel, MQTT, aprovisionamiento, CRUD de suscriptores | **Verificado** (con simulador) | panel |
| Registro de un nodo por el eNB de OAI con radio falsa contra Open5GS (NAS real, RRC y S1AP de OAI, *Initial Context Setup*) | **Verificado, sin radio**: 4 registros consecutivos correctos | Laboratorio ([`pruebas-oai.md`](../laboratorio/pruebas-oai.md)) |
| Datos MQTT y ping por el túnel GTP-U de OAI (subida y bajada) y escenarios de SIM clonada, intruso y baja | **Verificado, sin radio** | Laboratorio |
| Corrección del decodificador S1AP de OAI (`Masked-IMEISV`) | **Verificado**: sin ella el registro se queda sin respuesta; con ella completa | Laboratorio |
| `tx_gain` como ganancia (no atenuación) | **Corregido** según el código leído; falta medir potencia real | [`oai.md`](../arquitectura/oai.md), «Un hallazgo sobre `tx_gain`» |
| Publicación inmediata de la telemetría al cambiar la bomba y tarjeta «Registro del plano de usuario» con contadores de `ogstun` | **Verificado, sin radio** (2026-11-23): la bomba se enciende y el nodo publica al instante; los contadores suben con cada mensaje | Laboratorio ([`implementacion.md`](../laboratorio/implementacion.md) §6) |
| Radio NB-IoT de la celda: banda, PRB, NPRACH, NPDCCH, paging y ganancia cargados en el `.conf` de OAI al reiniciar el eNB | **Verificado, sin radio** (B3, B7, B28; 25 y 50 PRB) | Laboratorio ([`radio-nbiot.md`](../laboratorio/radio-nbiot.md)) |
| Efectos de la radio en el laboratorio (RSRP, cobertura, repeticiones, latencia, energía, banda no soportada por el módulo) | **Modelo, no medido**: aproximaciones didácticas | [`radio-nbiot.md`](../laboratorio/radio-nbiot.md) |
| USRP emitiendo NB-IoT real | **Sin verificar** (falta equipo y autorización) | — |
| Registro de un módulo NB-IoT real contra OAI + Open5GS | **Sin verificar** (riesgo principal) | — |
| Firmware ESP32 con SIM7080G | **Sin verificar** | — |
| Potencia real de salida del USRP | **Sin medir** | — |
| Optimizaciones CIoT (datos sobre NAS) / PSM / eDRX con esta pareja | **Sin verificar** | — |
| Ruta de retorno broker ↔ subred de UE con tráfico real | **Sin verificar** | — |

## Resumen

Toda la parte de software está implementada y validada hasta donde se puede sin hardware; falta la prueba con USRP, SIM y módulo reales. Lo que el Laboratorio demuestra es el software (núcleo, RRC, S1AP, GTP-U, NAS y datos), no la capa física: la radio es falsa.

Limitaciones del Laboratorio: [`implementacion.md`](../laboratorio/implementacion.md), «Limitaciones».
