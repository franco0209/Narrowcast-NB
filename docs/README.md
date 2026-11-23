# Documentación de Narrowcast-NB

La documentación está organizada **por lo que quieres hacer**, y cada tema vive en un solo lugar: cuando un asunto aparece en más de un documento, uno lo explica y los demás lo enlazan. Todo está en español.

## Por dónde empezar

| Quiero… | Lee |
|---|---|
| Una visión general rápida | [`../README.md`](../README.md) |
| **Empezar aquí:** qué es el proyecto y cómo leer el resto, sin ser experto en C ni en NB-IoT | [`conceptos/introduccion.md`](conceptos/introduccion.md) |
| Entender los conceptos a fondo (NB-IoT, red celular, SIM, SDR, glosario, ejercicios) | [`conceptos/fundamentos.md`](conceptos/fundamentos.md) |
| Poner el sistema en marcha y resolver problemas | [`operacion/puesta-en-marcha.md`](operacion/puesta-en-marcha.md) |
| Probar toda la red **sin hardware** | [`laboratorio/implementacion.md`](laboratorio/implementacion.md) |
| Saber qué está hecho, qué falta y qué está verificado | [`proyecto/estado.md`](proyecto/estado.md) |
| Respuestas breves a las dudas más repetidas | [`operacion/preguntas-frecuentes.md`](operacion/preguntas-frecuentes.md) |

## Estructura

```
docs/
├── README.md                          este índice
├── conceptos/
│   ├── introduccion.md                introducción al proyecto y mapa de lectura (empezar aquí)
│   └── fundamentos.md                 qué es NB-IoT y una red celular, SIM, SDR, Docker, glosario, ejercicios
├── operacion/                         cómo usarlo y operarlo
│   ├── puesta-en-marcha.md            arranque paso a paso y problemas frecuentes
│   ├── docker-y-compilacion.md        imágenes, compilación, Compose, variables, comandos
│   ├── panel.md                       panel de control: API, tiempo real, frontend, seguridad
│   ├── seguridad-rf.md                reglas de emisión de radio y cómo se hacen cumplir
│   └── preguntas-frecuentes.md        respuestas breves
├── arquitectura/                      cómo está construido
│   ├── vision-general.md              capas, red e IP, MQTT, suscriptores, firmware; cómo comprobar el código citado
│   ├── open5gs.md                     el núcleo: qué se usa, procesos e hilos, función por función
│   ├── oai.md                         el eNB: qué se usa, ITTI, hilos de tiempo real, MAC NB-IoT, configuración
│   ├── integracion.md                 qué es propio y de terceros, puntos de contacto, recorrido de un dato
│   ├── modificaciones-oai-open5gs.md  qué se cambió de Open5GS y OAI (y qué no)
│   └── codigo-propio.md               orquestación, aprovisionamiento, panel, firmware y scripts
├── laboratorio/                       probar la red sin hardware
│   ├── implementacion.md              diseño, construcción, problemas, verificación y referencia de código
│   ├── radio-nbiot.md                 radio de la celda (banda, PRB, NPRACH, paging) y su modelo de consecuencias
│   └── pruebas-oai.md                 resultados de probar OAI con radio falsa
├── proyecto/
│   ├── plan.md                        plan original (fases, riesgos, compras)
│   └── estado.md                      estado por fases, lo que falta y tabla de verificación
├── archivo/
│   └── contenido-reemplazado.md       bloques que repetían otro documento (conservados tal cual)
└── guide/                             guías que muestra la pestaña Ayuda del panel (no mover: se montan en el contenedor)
```

## Cómo leer Open5GS y OAI sin repetirse

Cada uno tiene **un solo documento**, de lo general a lo concreto:

1. Qué es y qué parte se usa.
2. Sus interfaces y el procedimiento de registro.
3. Cómo está organizado el código (procesos, hilos, colas, máquinas de estados).
4. Qué función atiende cada paso.

Cómo se unen los dos y cómo viaja un dato de punta a punta está en [`arquitectura/integracion.md`](arquitectura/integracion.md); lo que se **cambió** de ambos proyectos, solo en [`arquitectura/modificaciones-oai-open5gs.md`](arquitectura/modificaciones-oai-open5gs.md).

## Convenciones

- Las marcas **[leído]** indican que algo se comprobó abriendo el código fuente real dentro de las imágenes Docker; **[estándar]** viene de la especificación; **[observación]** es una conclusión a confirmar con hardware; **[sin verificar]** es un supuesto. Más en [`arquitectura/vision-general.md`](arquitectura/vision-general.md#convenciones-y-cómo-comprobar-el-código-que-se-cita).
- El estado de verificación vive en un único lugar: [`proyecto/estado.md`](proyecto/estado.md).
- Los comandos son de Linux y se ejecutan desde la raíz del repositorio.
