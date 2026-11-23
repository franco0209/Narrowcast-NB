# Documentación de Narrowcast-NB

Índice de la documentación, organizada por tema. Cada documento tiene un propósito distinto; cuando un mismo asunto aparece en varios, uno explica el concepto y los demás profundizan (se enlazan entre sí).

## Qué leer según lo que busques

| Si buscas… | Lee |
|---|---|
| Una visión general rápida | [`../README.md`](../README.md) |
| Entender los conceptos (NB-IoT, EPC, SIM, SDR) y el vocabulario | [`conceptos/fundamentos.md`](conceptos/fundamentos.md) |
| Poner el sistema en marcha paso a paso y resolver problemas frecuentes | [`operacion/puesta-en-marcha.md`](operacion/puesta-en-marcha.md) |
| Saber en qué estado está cada fase y qué falta | [`proyecto/estado-por-fases.md`](proyecto/estado-por-fases.md) y [`referencia/verificacion.md`](referencia/verificacion.md) |
| IP, puertos, interfaces y reglas de RF | [`arquitectura/arquitectura.md`](arquitectura/arquitectura.md) |
| Qué hace cada función de Open5GS y OAI en el flujo | [`arquitectura/integracion-oai-open5gs.md`](arquitectura/integracion-oai-open5gs.md) |
| Lenguajes, procesos, hilos, colas y comunicación del código | [`arquitectura/codigo-por-dentro.md`](arquitectura/codigo-por-dentro.md) |
| Qué se modificó de Open5GS y OAI | [`arquitectura/modificaciones-oai-open5gs.md`](arquitectura/modificaciones-oai-open5gs.md) |
| Imágenes, compilación, Compose y comandos | [`operacion/docker-y-compilacion.md`](operacion/docker-y-compilacion.md) |
| Diseño del panel y su API | [`operacion/panel.md`](operacion/panel.md) |
| Cómo se construyó el Laboratorio | [`laboratorio/implementacion.md`](laboratorio/implementacion.md) |
| Resultados de probar OAI sin USRP | [`laboratorio/pruebas-oai.md`](laboratorio/pruebas-oai.md) |
| Respuestas breves a las dudas más repetidas | [`referencia/preguntas-recurrentes.md`](referencia/preguntas-recurrentes.md) |

## Estructura

```
docs/
├── README.md                          este índice
├── proyecto/
│   ├── plan.md                        plan original (fases, riesgos, compras)
│   └── estado-por-fases.md            estado por fases, lo que falta, detalle técnico de las fases
├── conceptos/
│   └── fundamentos.md                 conceptos, glosario, flujos de punta a punta, ejercicios
├── arquitectura/
│   ├── arquitectura.md                capas, red, partes usadas, interfaces, suscriptores, MQTT, seguridad de RF
│   ├── integracion-oai-open5gs.md     relación con OAI y Open5GS a nivel de función
│   ├── codigo-por-dentro.md           lenguajes, hilos, sincronización, comunicación; código del Laboratorio
│   └── modificaciones-oai-open5gs.md  qué se cambió de Open5GS y OAI (y qué no)
├── operacion/
│   ├── puesta-en-marcha.md            arranque paso a paso y problemas frecuentes
│   ├── docker-y-compilacion.md        imágenes, compilación, Compose, variables, comandos
│   └── panel.md                       panel: API, SSE, frontend, seguridad, Laboratorio
├── laboratorio/
│   ├── implementacion.md              cómo se implementó, decisiones, problemas, verificación
│   └── pruebas-oai.md                 pruebas de OAI con radio falsa
├── referencia/
│   ├── verificacion.md                tabla única de estado: verificado / sin verificar
│   └── preguntas-recurrentes.md       preguntas recurrentes con respuesta breve
├── archivo/
│   └── contenido-reemplazado.md       bloques que repetían otro documento (conservados tal cual)
└── guide/                             guías que muestra la pestaña Ayuda del panel (no mover: se montan en el contenedor)
```

## Niveles de detalle (para no leer lo mismo tres veces)

Open5GS y OAI se describen en tres niveles; elige según lo que necesites:

1. **Qué son y qué se usa:** [`conceptos/fundamentos.md`](conceptos/fundamentos.md) §6–7 y [`arquitectura/arquitectura.md`](arquitectura/arquitectura.md) §3–4.
2. **Qué hace cada función en el flujo de un registro o de un dato:** [`arquitectura/integracion-oai-open5gs.md`](arquitectura/integracion-oai-open5gs.md).
3. **Cómo está programado (hilos, colas, sincronización):** [`arquitectura/codigo-por-dentro.md`](arquitectura/codigo-por-dentro.md).

Lo que se **cambió** de ambos proyectos está solo en [`arquitectura/modificaciones-oai-open5gs.md`](arquitectura/modificaciones-oai-open5gs.md).

## Convenciones

- Las marcas **[leído]** indican que algo se comprobó abriendo el código fuente real dentro de las imágenes Docker.
- El estado de verificación vive en un único lugar: [`referencia/verificacion.md`](referencia/verificacion.md).
- Los comandos son de Linux y se ejecutan desde la raíz del repositorio.
