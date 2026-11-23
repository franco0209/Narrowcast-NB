# Preguntas frecuentes

Respuestas breves a las preguntas que más se repiten sobre el proyecto, agrupadas por tema. Cada respuesta remite al documento donde está el detalle. Las preguntas que antes estaban repartidas en la guía de fundamentos, en la integración con OAI/Open5GS, en el código por dentro y en las modificaciones se reunieron aquí; si una pregunta aparecía en varios sitios se unificó en una sola respuesta.

Índice: [1. Alcance y qué es propio](#1-alcance-y-qué-es-propio) · [2. Núcleo, OAI y señalización](#2-núcleo-oai-y-señalización) · [3. Radio y seguridad de emisión](#3-radio-y-seguridad-de-emisión) · [4. Datos y panel](#4-datos-y-panel) · [5. Código: lenguajes, hilos y comunicación](#5-código-lenguajes-hilos-y-comunicación) · [6. Qué se modificó](#6-qué-se-modificó-de-open5gs-y-oai) · [7. Laboratorio](#7-laboratorio) · [8. Estado y trabajo futuro](#8-estado-y-trabajo-futuro)

---

## 1. Alcance y qué es propio

**¿Qué es el proyecto, en una frase?**
Una red celular NB-IoT privada y completa, hecha con software libre, que conecta un sensor real con su SIM a un panel web y controla con seguridad la emisión de radio.

**¿Se implementó el protocolo NB-IoT o el núcleo?**
No. La capa física y el MAC de NB-IoT en la estación base son de OAI (rama `develop-nb-iot`, archivos `*_NB_IoT.c`) y el núcleo es Open5GS (se usan 7 de sus binarios, el EPC). Lo propio es integrarlos: compilación reproducible, configuración desde un plan RF validado, aprovisionamiento (los YAML, el `entrypoint.sh` con TUN, NAT y reescritura de freeDiameter), reglas de radio, panel y firmware. Detalle: [`modificaciones-oai-open5gs.md`](../arquitectura/modificaciones-oai-open5gs.md).

**¿Qué es Open5GS?**
Una implementación libre en C del núcleo 4G y 5G. Aquí se usa solo el 4G (EPC): MME, HSS, SGW-C/U, PGW-C/U y PCRF, con MongoDB como base de suscriptores.

**¿Qué es OAI?**
OpenAirInterface: una pila celular completa en software para SDR. Se usa solo su eNB, en la rama `develop-nb-iot`, que le agrega NB-IoT.

**¿Por qué 4G y no 5G?**
Porque NB-IoT es parte de LTE (Release 13) y la rama NB-IoT de OAI se apoya en S1AP/EPC. El 5GC de Open5GS (AMF, SMF/UPF con SBI) existe pero no se usa.

**¿Qué es NB-IoT y por qué sirve para sensores?**
LTE reducido a 180 kHz, con repeticiones para cobertura profunda y modos PSM/eDRX para batería de años. Sacrifica velocidad y movilidad.

**¿Por qué los contenedores tienen IP fija?**
Porque las configuraciones de Open5GS y OAI usan direcciones literales (MME, SGW, PGW, eNB).

**¿Por qué OAI corre en Ubuntu 16.04?**
La rama de 2020 solo compila en 14.04/16.04. Docker lo aísla.

---

## 2. Núcleo, OAI y señalización

**¿Qué hace el MME? ¿Y el HSS?**
El MME gestiona la señalización: acepta el eNB, autentica, negocia seguridad y crea la sesión. El HSS guarda a los suscriptores y genera los vectores de autenticación.

**¿Cómo sabe el MME que el eNB es válido (y el eNB que el núcleo es el correcto)?**
Por S1AP: en el S1 Setup el eNB envía PLMN y TAC; el MME acepta solo si coinciden con `mme.tai` y `mme.gummei` (`s1ap_handle_s1_setup_request`). Por eso `001/01` y TAC `1` deben ser iguales en OAI y en `mme.yaml`.

**¿Cómo se autentica el módulo?**
Con EPS-AKA/Milenage: el HSS toma K y OPc de MongoDB y calcula RAND, AUTN, XRES y K_ASME (`hss_ogs_diam_s6a_air_cb`); la SIM calcula lo mismo con sus claves. Si coinciden, se autentican mutuamente sin que K viaje por el aire.

**¿Qué pasa si K u OPc no coinciden?**
La autenticación falla y el módulo no se registra. Por eso existe el módulo Suscriptores y por eso se comprueba la SIM física.

**¿Dónde se separan la señalización y los datos?**
Señalización: S1AP/SCTP (36412), GTPv2-C (2123), Diameter, PFCP (8805). Datos: GTP-U (2152) hasta la interfaz TUN `ogstun` del PGW-U.

**¿Qué es `ogstun` y por qué se necesita NAT?**
Es una interfaz TUN: el PGW-U escribe ahí los paquetes IP del UE para que el sistema los enrute. El NAT hace que salgan con la IP del contenedor y las respuestas vuelvan.

**¿Cómo se comunica Open5GS con el HSS?**
Por Diameter (S6a) con la biblioteca freeDiameter: el MME envía con `fd_msg_send` y recibe la respuesta en un callback (`mme_s6a_aia_cb`) que corre en un hilo de freeDiameter y reentra a la cola de eventos con `ogs_queue_push` + `ogs_pollset_notify`.

**¿Qué APIs expone el núcleo?**
Ninguna API REST: usa protocolos de telecomunicaciones (S1AP, GTP, PFCP, Diameter). La parte HTTP/2 (SBI) pertenece solo al núcleo 5G y no se usa.

---

## 3. Radio y seguridad de emisión

**¿Qué es un USRP y qué hace UHD?**
El USRP es la radio SDR que convierte entre señal digital y RF. UHD es su controlador, usado por OAI para fijar frecuencia, ganancia y tasa.

**¿Cómo se evita emitir sin permiso?**
Radio apagada por defecto, plan validado (banda, ganancia, atenuación, duración, portadora libre, autorizado por), confirmación humana, corte automático y registro. No mide potencia: eso requiere un analizador de espectro.

**¿Qué hallazgo importante hubo con la ganancia?**
El script suponía que `tx_gain` era atenuación y en realidad OAI lo pasa como ganancia a UHD. Se corrigió leyendo el código ([`oai.md`](../arquitectura/oai.md), «Un hallazgo sobre `tx_gain`»); falta medir la potencia real.

**¿Qué pasa si el procesamiento de OAI no llega a tiempo?**
Si el hilo `rxtx` sigue ocupado cuando llega la siguiente subtrama (tras ~5 ms), llama a `exit_fun("TX thread busy")` y el eNB termina. Por eso necesita CPU dedicada y prioridad de tiempo real.

---

## 4. Datos y panel

**¿Cómo viaja un dato de temperatura?**
ESP32 → módulo → radio → eNB → GTP-U → SGW-U → PGW-U → `ogstun` → Mosquitto → panel → navegador por SSE.

**¿Para qué sirve MQTT y por qué un broker?**
Mensajería liviana publicar/suscribir. El broker desacopla a quien publica de quien consume, y el *last will* permite detectar desconexiones.

**¿Cómo sabe el panel que el eNB está conectado?**
Lee los registros del MME y busca `eNB-S1 accepted`.

**¿Qué hace el panel que no hacen los otros componentes?**
Valida y limita la emisión de radio, registra sesiones, administra suscriptores y muestra en vivo el estado del núcleo leyendo sus registros y el estado de Docker; además recibe y envía la telemetría de aplicación por MQTT.

**¿Cómo se comunica el panel con Docker?**
Por el socket Unix `/var/run/docker.sock` con el SDK `docker` de Python; por eso solo escucha en `127.0.0.1`.

**¿Cómo llega un dato de telemetría al navegador sin recargar?**
`paho-mqtt` (hilo propio) → `on_message` → `broadcast()` → `loop.call_soon_threadsafe(q.put_nowait, …)` → `asyncio.Queue` de cada cliente → `StreamingResponse` (SSE) → `EventSource` del navegador.

**¿Qué prueba y qué no prueba la simulación?**
Con srsRAN prueba el núcleo; con `fake_device.py`, el broker y el panel; con el Laboratorio, además, el registro y los datos a través del eNB real de OAI con radio falsa. Ninguna prueba la radio real de OAI ni el registro de una SIM física.

---

## 5. Código: lenguajes, hilos y comunicación

Detalle en [`open5gs.md`](../arquitectura/open5gs.md) y [`oai.md`](../arquitectura/oai.md).

**¿En qué lenguaje están hechos?**
Open5GS y OAI en **C** (OAI usa **C++** solo para el controlador del USRP). El panel en **Python**, su interfaz en **TypeScript/React**, el firmware en **C++ de Arduino**, la orquestación en **YAML** y **Bash**.

**¿Tienen clases?**
En C no. Usan `struct` + funciones con prefijo + punteros a función. Ejemplos: `mme_ue_t` con `mme_ue_add()`/`mme_ue_remove()`; la «interfaz» `openair0_device` y `IF_Module_NB_IoT_t` son estructuras de punteros a función (como una interfaz o clase virtual). Las clases reales de nuestro código están en Python (`BaseModel`, `FastAPI`) y en el firmware (`TinyGsm`, `PubSubClient`).

**¿Cuántos procesos e hilos tiene Open5GS?**
Un proceso por función (7 en este proyecto). Cada uno: un hilo principal (señales), un hilo de trabajo con bucle de eventos y los hilos de freeDiameter donde aplica.

**¿Cómo evita Open5GS las condiciones de carrera?**
Con un **único hilo de lógica** por proceso: todos los mensajes se convierten en eventos que entran por una cola con mutex y se procesan en orden. Los hilos de freeDiameter solo decodifican y empujan eventos.

**¿Usan semáforos?**
Open5GS no (mutex + variables de condición + `eventfd`). OAI usa, en ITTI, un **`eventfd` en modo semáforo (`EFD_SEMAPHORE`)** por tarea; en la capa física usa **mutex + variable de condición con un contador de instancias** (`wait_on_condition`/`release_thread`).

**¿Cómo se comunican las partes de OAI?**
Capas altas por **mensajes ITTI** (cola lock-free + eventfd + epoll). La capa física con el MAC por **llamadas de función a través de punteros** (`UL_indication` / `schedule_response`), dentro del mismo hilo de tiempo real.

**¿Dónde corre el planificador MAC de NB-IoT?**
Dentro del hilo de tiempo real de la capa física: `UL_indication_NB_IoT()` lo llama una vez por subtrama.

**¿Cómo cambia OAI de LTE a NB-IoT?**
Sustituyendo punteros a función en la estructura `PHY_VARS_eNB` (`proc_uespec_rx = phy_procedures_eNB_uespec_RX_NB_IoT`, `if_inst = IF_Module_init_NB_IoT`, `prach_procedures_NB_IoT`) y duplicando estructuras con sufijo `_NB_IoT`.

**¿Cuál es el punto débil del código de OAI NB-IoT?**
Es una rama de investigación de 2020 cuyo MAC tiene estado global (`UE_state_machine`), RNTI temporal fijo `0x0101` y espera una secuencia de mensajes concreta; no está pensado para varios dispositivos. Que un módulo comercial real complete el *attach* es lo que falta probar.

---

## 6. Qué se modificó de Open5GS y OAI

Detalle, tabla de cambios y cómo comprobarlos: [`modificaciones-oai-open5gs.md`](../arquitectura/modificaciones-oai-open5gs.md).

> De Open5GS no se modificó código: se compiló la versión 2.7.5 tal cual y se **configuró** (siete archivos YAML y las direcciones de freeDiameter, adaptados a contenedores con IP fija, con PLMN 001/01 y con el SMF y el UPF de 5G configurados como PGW-C y PGW-U de 4G). Además se preparó el entorno del PGW-U: interfaz TUN y NAT. De OAI se modificó una sola cosa de código: se usa la rama `develop-nb-iot` en Ubuntu 16.04, se fija la versión de una dependencia (`protobuf-c`) en su script de instalación y se parte de su archivo de configuración de ejemplo, cambiando PLMN, banda, frecuencia, ganancia y direcciones. Al probarlo contra Open5GS apareció un fallo real: el decodificador S1AP de OAI rechaza un campo opcional (`Masked-IMEISV`) que Open5GS envía, lo que impediría completar el registro de un módulo real. La corrección es de una línea (`return -1` → `break`, omitir el campo ignorable como manda el estándar), está aplicada a la imagen mediante un script que falla si el código esperado no está, y se comprueba en el Laboratorio del panel.

---

## 7. Laboratorio

Detalle: [`implementacion.md`](../laboratorio/implementacion.md) y [`radio-nbiot.md`](../laboratorio/radio-nbiot.md).

**¿Qué es real y qué es simulado en el Laboratorio?**
Real: Open5GS completo, el RRC/S1AP/GTP-U/MAC de OAI, el NAS (Milenage, EIA2) y los datos MQTT por el túnel GTP-U. Simulado: la radio (Uu), el acceso aleatorio (uno por arranque de OAI) y la electrónica del ESP32.

**¿Por qué el registro del núcleo no muestra nada cuando el nodo publica?**
Porque los datos viajan por el plano de usuario (GTP-U) y el plano de control no interviene. La prueba de que el paquete cruzó OAI y el núcleo son los contadores de `ogstun` del PGW-U, que muestra la tarjeta «Registro del plano de usuario».

**¿Qué cambia si cambio la banda, el ancho de banda o la distancia del nodo en el Laboratorio?**
Los parámetros de la celda (banda, PRB, ganancia, NPRACH, NPDCCH, paging) se escriben de verdad en el `.conf` de OAI, que solo los lee al arrancar: «Aplicar» reinicia el eNB y el nodo debe registrarse de nuevo. Como la radio es falsa, sus **consecuencias** (nivel de señal, nivel de cobertura, repeticiones, latencia, energía, banda que el módulo no soporta) las calcula un modelo, no un equipo de medida. Detalle: [`radio-nbiot.md`](../laboratorio/radio-nbiot.md).

**¿Por qué cada registro tarda ~45 s?**
OAI simula un único acceso aleatorio por arranque, por lo que el panel reinicia el eNB antes de cada escenario y el simulador espera 40 s para evitar un fallo de OAI si se inyecta antes.

---

## 8. Estado y trabajo futuro

**¿Qué tan lejos está de funcionar con una SIM real?**
Todo el software de la ruta S1/EPC funciona; falta (1) un USRP, (2) la autorización de RF y (3) probar que el módulo NB-IoT se registre, que es el punto con más incertidumbre por la antigüedad de la rama de OAI. Tabla completa en [`estado.md`](../proyecto/estado.md).

**¿Qué mejoraría el proyecto?**
Medir la potencia con analizador de espectro, probar con módulo real, verificar PSM/eDRX y las optimizaciones CIoT, y evaluar la rama `nb-iot-ubuntu24` de OAI como alternativa.
