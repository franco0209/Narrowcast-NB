# Estado de verificación

Qué está comprobado, qué se comprobó sin radio y qué sigue sin verificar. Es la única tabla de estado del proyecto: los demás documentos remiten aquí.

Convención: lo que se afirma sobre el funcionamiento está comprobado en este repositorio; lo que es teoría general (3GPP, NB-IoT) es conocimiento estándar; lo que **no** se ha probado con hardware real se marca como *sin verificar*.

## Tabla de estado

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
| `tx_gain` como ganancia (no atenuación) | **Corregido** según el código leído; falta medir potencia real | [`integracion-oai-open5gs.md`](../arquitectura/integracion-oai-open5gs.md) §3.5 |
| Publicación inmediata de la telemetría al cambiar la bomba y tarjeta «Registro del plano de usuario» con contadores de `ogstun` | **Implementado, sin comprobar en vivo** (los contadores se leen; falta verlos subir con un nodo registrado) | Laboratorio |
| USRP emitiendo NB-IoT real | **Sin verificar** (falta equipo y autorización) | — |
| Registro de un módulo NB-IoT real contra OAI + Open5GS | **Sin verificar** (riesgo principal) | — |
| Firmware ESP32 con SIM7080G | **Sin verificar** | — |
| Potencia real de salida del USRP | **Sin medir** | — |
| Optimizaciones CIoT (datos sobre NAS) / PSM / eDRX con esta pareja | **Sin verificar** | — |
| Ruta de retorno broker ↔ subred de UE con tráfico real | **Sin verificar** | — |

## Resumen

Toda la parte de software está implementada y validada hasta donde se puede sin hardware; falta la prueba con USRP, SIM y módulo reales. Lo que el Laboratorio demuestra es el software (núcleo, RRC, S1AP, GTP-U, NAS y datos), no la capa física: la radio es falsa.

Limitaciones del Laboratorio: [`implementacion.md`](../laboratorio/implementacion.md) §7.
