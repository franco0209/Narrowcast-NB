# Qué modificamos de Open5GS y OAI para integrarlos (y qué no)

Este documento responde a la pregunta «¿qué cambiaron de Open5GS y de OpenAirInterface para que funcionen en el proyecto?». Está hecho comparando **nuestros archivos contra los originales de cada proyecto**, tal como vienen dentro de las imágenes Docker. No incluye nuestra aplicación (panel, simulador), solo lo que toca a Open5GS y OAI.

Versiones: **Open5GS v2.7.5** (commit `7dfd9a39649700c24c22f1978ed7a35541a72cca`) y **OpenAirInterface rama `develop-nb-iot`** (commit `677bbab27b0d1d3ca0ad54e7c32748dc64a0a690`).

---

## 1. La respuesta corta

Hay cuatro tipos de cambio. Conviene separarlos porque cada uno tiene un alcance y un riesgo distintos:

| Tipo | Qué significa | Open5GS | OAI |
|---|---|---|---|
| **A. Código fuente** | Cambiar líneas de C del proyecto | **Ninguno** | **Uno, ya aplicado a la imagen** (§6): el decodificador S1AP omite el IE `Masked-IMEISV`; sin él, un módulo real no se registraría |
| **B. Script de instalación** | Cambiar los scripts con que el proyecto se compila | Ninguno | **Dos**: se fija la versión de una dependencia (`protobuf-c`) y se aplica la corrección de §6 |
| **C. Configuración** | Editar los archivos de configuración que el proyecto ofrece | **Sí**: 7 archivos YAML + freeDiameter | **Sí**: 1 plantilla `.conf` |
| **D. Empaquetado y entorno** | Cómo se compila, en qué sistema, con qué permisos y red corre | Sí | Sí |

Es decir: **no modificamos el código de Open5GS**, lo compilamos tal cual y lo configuramos. **En OAI modificamos una sola cosa de código**, la de §6 (un `return -1` pasa a `break` en el decodificador S1AP generado), más un script de instalación y su configuración.

Lo demás de este documento da el detalle de cada cambio, archivo por archivo.

---

## 2. Tabla maestra de cambios

| # | Proyecto | Tipo | Qué se cambió | Dónde | Motivo |
|---|---|---|---|---|---|
| 1 | Open5GS | C | PLMN `999/70` → `001/01` y nombre de red | `config/open5gs/mme.yaml` | PLMN de pruebas propio; debe coincidir con el eNB |
| 2 | Open5GS | C | Direcciones `127.0.0.x` → `10.44.0.x` en los 7 YAML | `config/open5gs/*.yaml` | Cada función corre en su propio contenedor con IP fija |
| 3 | Open5GS | C | `db_uri: mongodb://localhost` → `mongodb://mongo` | `hss.yaml`, `pcrf.yaml`, `pgwc.yaml` | MongoDB está en otro contenedor |
| 4 | Open5GS | C | SMF/UPF de 5G adaptados a PGW-C/PGW-U de 4G (sin `sbi`, subred `10.58.0.0/16`) | `pgwc.yaml`, `pgwu.yaml` | El proyecto usa solo el núcleo 4G |
| 5 | Open5GS | C | Se agrega el cliente `smf` en el SGW-C | `sgwc.yaml` | El SGW-C necesita conocer al PGW-C (interfaz S5-C) |
| 6 | Open5GS | C | Rutas de log `/var/local/log/…` → `/var/log/open5gs/…`; se quitan `metrics` y `global.max.ue` | todos los YAML | Adaptación al contenedor y simplificación |
| 7 | Open5GS | C | Direcciones de freeDiameter reescritas al arrancar | `docker/open5gs/entrypoint.sh` | Diameter trae `127.0.0.x` y las funciones están en IP distintas |
| 8 | Open5GS | D | Se crea la interfaz TUN `ogstun`, su IP y la regla NAT | `docker/open5gs/entrypoint.sh` | El UPF necesita esa interfaz y no la crea él mismo |
| 9 | Open5GS | D | Permisos `NET_ADMIN` y `/dev/net/tun` en el contenedor del PGW-U | `compose.yaml` | Para crear la TUN y el NAT |
| 10 | OAI | B | `protobuf-c` fijado a la versión `v1.3.3` | `docker/oai-nbiot/Dockerfile` | La versión más reciente exige C++17, que no existe en Ubuntu 16.04 |
| 11 | OAI | D | Sistema base Ubuntu 16.04 | `docker/oai-nbiot/Dockerfile` | La rama solo compila en 14.04/16.04 |
| 12 | OAI | C | Plantilla del eNB: PLMN, nombre, banda, frecuencia, ganancia, IP del MME y del eNB | `config/oai/enb.nbiot.conf.tmpl` | Ver §4.3 |
| 13 | OAI | C | `tx_gain` pasa **sin convertir** (antes se calculaba `90 − tx_gain`) | `scripts/oai-enb-start.sh` | Se comprobó en el código que OAI lo trata como ganancia |
| 14 | OAI | C | Desplazamiento de subida (UL) según la banda | `scripts/oai-enb-start.sh` | Cada banda tiene su par DL/UL |
| 15 | OAI | A | **APLICADO**: el decodificador S1AP omite los IE desconocidos con criticidad *ignore* (`return -1` → `break`) | `s1ap_decoder.c` (generado), vía `docker/oai-nbiot/patch-s1ap.py` | Ver §6 |

---

## 3. Open5GS en detalle

### 3.1 Código fuente: sin cambios

El `Dockerfile` (`docker/open5gs/Dockerfile`) hace exactamente esto:

1. Clona `open5gs/open5gs`, etiqueta `v2.7.5`.
2. Comprueba que el commit es el esperado (`git rev-parse HEAD = 7dfd9a39…`). Si no, la construcción falla.
3. Compila con `meson setup build --prefix=/usr/local` y `ninja`, **sin parches ni opciones especiales**.
4. Borra `.git` y `build/` para ahorrar espacio.

Se compila todo el repositorio (también las funciones 5G), pero **solo se arrancan siete binarios del EPC**. Ningún archivo `.c` fue editado.

### 3.2 Configuración: cambios respecto a los archivos originales

Los originales son los que Open5GS instala en `/usr/local/etc/open5gs/*.yaml`. Los nuestros están en `config/open5gs/`. Los siete se montan dentro de los contenedores.

**Cambios comunes a todos los archivos:**

| Original | Nuestro | Por qué |
|---|---|---|
| `path: /var/local/log/open5gs/X.log` | `path: /var/log/open5gs/X.log` | El contenedor crea `/var/log/open5gs` (Dockerfile) |
| Direcciones `127.0.0.2 … 127.0.0.9` | `10.44.0.10 … 10.44.0.16` | Un contenedor por función, IP fija en la red `narrowcast-nb-core` |
| Bloque `global: max: ue: 1024` | Quitado | Se usa el valor por defecto interno de Open5GS |
| Bloque `metrics: server: … :9090` (donde existía) | Quitado | No se usa el servicio de métricas |

**Por archivo:**

| Archivo | Cambios específicos |
|---|---|
| `mme.yaml` | **PLMN `999/70` → `001/01`** en `gummei` y en `tai` (el **TAC se deja en 1**, igual que el original). Nombre de red: `Open5GS`/`Next` → `Narrowcast`/`NB`. Se quitan `mme_name` y el bloque `time`. Clientes GTP-C: SGW-C `10.44.0.12` y SMF `10.44.0.14`. El orden de seguridad NAS **no cambia** (`EIA2 > EIA1 > EIA0`, `EEA0 > EEA1 > EEA2`) |
| `hss.yaml` | `db_uri` → `mongodb://mongo/open5gs`. Se agrega `address: 10.44.0.11` (ver nota abajo) |
| `sgwc.yaml` | Se agrega el cliente `smf` (`10.44.0.14`) junto al `sgwu` (`10.44.0.13`) |
| `sgwu.yaml` | Solo direcciones y ruta de log |
| `pcrf.yaml` | `db_uri` → `mongodb://mongo/open5gs` |
| `pgwc.yaml` | Parte de `smf.yaml` (de 5G). Se **quita el bloque `sbi`** (servidor y cliente SCP) y el IPv6; `session`: `10.45.0.0/16` + IPv6 → una sola subred **`10.58.0.0/16`**, puerta de enlace `10.58.0.1`, `dnn: internet`; DNS `8.8.8.8/8.8.4.4`+IPv6 → `1.1.1.1`; se agrega `db_uri`; `mtu: 1400` queda igual |
| `pgwu.yaml` | Parte de `upf.yaml` (de 5G). Misma subred `10.58.0.0/16`, `dev: ogstun`, `dnn: internet`; se quita IPv6 |

**Por qué `pgwc.yaml` y `pgwu.yaml` son los cambios clave.** Open5GS no tiene programas «PGW» separados: en modo 4G reutiliza `open5gs-smfd` y `open5gs-upfd`. Lo que decide si actúan como PGW (4G) o como SMF/UPF (5G) es la configuración: con `gtpc` y `freeDiameter` y **sin `sbi`**, se comportan como PGW-C y PGW-U del EPC.

**Nota sobre claves sin efecto.** `hss.yaml` incluye `address: 10.44.0.11` dentro de `hss:`. Open5GS no reconoce esa clave y la ignora: en cada arranque del HSS aparece el aviso `WARNING: unknown key 'address'`. Es inofensivo. Del mismo modo, `mme.yaml` termina con una sección `hss: address: hss` que no corresponde a ninguna opción del MME. Ninguna de las dos hace nada.

### 3.3 freeDiameter (S6a y Gx)

Open5GS usa la biblioteca freeDiameter, que se configura con sus propios archivos en `/usr/local/etc/freeDiameter/`. Los originales (`mme.conf`, `hss.conf`, `smf.conf`, `pcrf.conf`) traen:

```
Identity    = "mme.localdomain";   Realm = "localdomain";
ListenOn    = "127.0.0.2";
ConnectPeer = "hss.localdomain" { ConnectTo = "127.0.0.8"; No_TLS; };
```

Esos archivos **no se editan en el repositorio ni en la imagen**. El `entrypoint.sh` los **reescribe al arrancar cada contenedor**, con `perl`, usando variables de entorno del `compose.yaml`:

| Variable | Reescribe en | Valor |
|---|---|---|
| `FD_LISTEN_ON` | `ListenOn` de todos los `.conf` | IP del propio contenedor |
| `FD_HSS_CONNECT_TO` | `ConnectPeer = "hss.localdomain"` en `mme.conf` | `10.44.0.11` |
| `FD_MME_CONNECT_TO` | `ConnectPeer = "mme.localdomain"` en `hss.conf` | `10.44.0.10` |
| `FD_PCRF_CONNECT_TO` | `ConnectPeer = "pcrf.localdomain"` en `smf.conf` | `10.44.0.16` |
| `FD_SMF_CONNECT_TO` | `ConnectPeer = "smf.localdomain"` en `pcrf.conf` | `10.44.0.14` |

Lo demás de freeDiameter (identidades, realm, extensiones de diccionario, `No_TLS`) queda como viene. Los certificados TLS que Open5GS instala **no se usan** porque la conexión es `No_TLS` dentro de la red privada.

### 3.4 Lo que agrega el contenedor del PGW-U

Cuando el programa a ejecutar es `open5gs-upfd`, `docker/open5gs/entrypoint.sh` prepara el sistema **antes** de lanzarlo:

```
ip tuntap add name ogstun mode tun
ip addr replace 10.58.0.1/16 dev ogstun ; ip link set ogstun up
iptables -t nat -A POSTROUTING -s 10.58.0.0/16 ! -o ogstun -j MASQUERADE
```

Open5GS espera que el administrador cree esa interfaz; no lo hace por sí mismo. La regla `MASQUERADE` hace que los paquetes de los dispositivos salgan con la IP del contenedor. El contenedor necesita `cap_add: [NET_ADMIN]` y `devices: ["/dev/net/tun:/dev/net/tun"]` (en `compose.yaml`).

El entrypoint además admite una segunda subred opcional (`UE_IMS_SUBNET`, interfaz `ogstun2`) que **no se usa** en este proyecto.

### 3.5 Datos: los suscriptores

Open5GS lee los suscriptores de MongoDB (`open5gs.subscribers`). Nosotros no cambiamos el esquema: lo escriben, con el mismo formato que la WebUI de Open5GS, el script `provisioning/subscriber-init.js`, el módulo Suscriptores del panel y el Laboratorio. Los valores de K, OPc, AMF y SQN de la SIM de prueba salen de `.env`.

### 3.6 WebUI

Se construye **sin modificar** desde `open5gs/webui` (`npm ci && npm run build`), versión `v2.7.5`. Solo se le pasa por entorno `DB_URI=mongodb://mongo/open5gs`.

### 3.7 Lo que NO se tocó en Open5GS

- Ningún archivo de código fuente ni binario.
- Los algoritmos de seguridad y su orden de preferencia (idénticos al original).
- El GUMMEI (grupo 2, código 1) y el TAC (1): son los valores originales.
- Las funciones 5G (AMF, NRF, UDM…): se compilan pero **no se arrancan**.
- La política del PCRF (reglas por defecto).

---

## 4. OpenAirInterface en detalle

### 4.1 Código fuente: un solo cambio en la imagen (§6)

`docker/oai-nbiot/Dockerfile` clona `develop-nb-iot` (clon superficial) y verifica que el commit sea `677bbab2…`. Después compila con el propio script de OAI: `./build_oai -I --eNB -x -w USRP --install-system-files`. **No se edita ningún `.c` ni `.h` de OAI salvo el paso posterior de §6**, que corrige un fragmento del decodificador S1AP *generado* durante la compilación.

### 4.2 Único cambio en la instalación: `protobuf-c`

El script de OAI (`cmake_targets/tools/build_helper`) descarga `protobuf-c` **sin fijar versión**, y la versión actual exige C++17, que Ubuntu 16.04 no tiene. El `Dockerfile` hace un `sed` sobre ese script:

```
antes:    git clone https://github.com/protobuf-c/protobuf-c.git
después:  git clone --branch v1.3.3 --depth 1 https://github.com/protobuf-c/protobuf-c.git
```

Si el `sed` no surte efecto, la construcción falla (`grep -q 'branch v1.3.3'`). Es el único cambio que se hace a archivos de OAI. (Commit `d7940f5`.)

### 4.3 Configuración del eNB

La plantilla `config/oai/enb.nbiot.conf.tmpl` parte del archivo de ejemplo que trae OAI: `targets/PROJECTS/GENERIC-LTE-EPC/CONF/enb.nbiot.band7.tm1.50PRB.usrp210.conf`. **Estas son todas las diferencias con el original:**

| Parámetro | Original de OAI | Nuestra plantilla | Motivo |
|---|---|---|---|
| `eNB_name` y `Active_eNBs` | `eNB_Eurecom_LTEBox` | `Narrowcast-NB-eNB` | Nombre propio |
| `mobile_country_code` | `208` | `001` | PLMN de pruebas; **debe coincidir con `mme.yaml`** |
| `mobile_network_code` | `93` | `01` | Ídem |
| `eutra_band` | `7` | `@BAND@` (del plan RF) | Bandas permitidas B3, B8, B20 y B28 |
| `downlink_frequency` | `2685000000` | `@DL_HZ@` (del plan RF) | Depende de la banda y la portadora elegida |
| `uplink_frequency_offset` | `-120000000` | `@UL_OFFSET@` (por banda) | Cada banda tiene su desplazamiento |
| `tx_gain` | `90` | `@TX_GAIN@` (del plan RF) | Ganancia validada por el plan (ver 4.4) |
| `mme_ip_address` | `127.0.0.3` | `@MME_IP@` (`10.44.0.10`) | El MME está en otro contenedor |
| `ENB_INTERFACE_NAME_FOR_S1_MME` / `S1U` | `lo` | `eth0` | Interfaz del contenedor |
| `ENB_IPV4_ADDRESS_FOR_S1_MME` / `S1U` | `127.0.0.2` / `127.0.0.5` | `@ENB_IP@/24` (`10.44.0.40`) | IP propia del eNB |

**Se dejaron iguales** (valores del original): `tracking_area_code = 1` (coincide con el TAC del MME), `N_RB_DL = 50`, una antena de transmisión y de recepción, `rx_gain = 120`, `ENB_PORT_FOR_S1U = 2152` y todos los parámetros NB-IoT (`nprach_*`, `npdcch_*` y temporizadores).

### 4.4 Script de arranque (`scripts/oai-enb-start.sh`)

No es parte de OAI; es nuestro. Toma el plan RF validado, rellena los marcadores de la plantilla con `sed` y ejecuta el eNB. Detalles que tocan a OAI:

- **Desplazamiento UL por banda:** B3 −95 MHz, B8 −45, B20 +41, B28 −55.
- **Corrección de `tx_gain` (commit `1ce6760`).** Se leyó el código de OAI y se comprobó que el valor del `.conf` llega tal cual a `set_tx_gain()` de UHD: es **ganancia**, no atenuación. La primera versión del script calculaba `90 − tx_gain`, lo que con un plan seguro de `tx_gain: 10` habría pedido 80 dB de ganancia (casi la potencia máxima). Ahora se pasa sin convertir. Sigue pendiente medir la potencia real con un analizador de espectro.
- **Modo `S1_ONLY=1` (nuestro):** omite el plan RF para comprobar solo la conexión S1 con el MME sin emitir radio.
- **Opción `-S` de OAI:** el script lanza `lte-softmodem -O <conf> -S`. `-S` es una opción de línea de comandos propia de OAI («Skip exit for missed slots»): evita que el eNB se aborte cuando pierde una subtrama. No modifica el código; es un parámetro de ejecución.

### 4.5 Contenedor del eNB

Servicio `enb-nbiot` de `compose.yaml`: perfil `radio` (**no arranca con `docker compose up`**, solo lo enciende el panel), IP `10.44.0.40`, monta la plantilla, el script y el plan RF (solo lectura). **No** se mapea ningún dispositivo USB (queda un comentario con cómo hacerlo para un USRP B2xx). Tampoco declara `SYS_NICE`: la capa física de OAI pide prioridad de tiempo real (`SCHED_FIFO`) y en las pruebas sin ese permiso falló con `pthread_setschedparam: Operation not permitted`. **Hay que añadirlo al probar con el USRP real.**

### 4.6 Lo que NO se tocó en OAI

- Código fuente de la capa física, MAC, RRC, GTP-U y del resto del S1AP (en la imagen de producción).
- Los parámetros NB-IoT de la plantilla.
- La selección de la rama o del commit.

---

## 5. Cambios hechos solo para pruebas (no están en la imagen)

El Laboratorio del panel (`lab/oai-fakerf/`, `scripts/oai-lab-start.sh`, resultados en [`pruebas-oai.md`](../laboratorio/pruebas-oai.md)) **sí modifica más código de OAI** (radio falsa, inyector, relevo de datos, avisos), pero solo dentro del contenedor de pruebas `nb-oai-lab` y **no entra en la imagen de producción**: lo instala `lab/oai-fakerf/prepare.sh` al arrancar el contenedor (y lo vuelve a instalar solo si cambia algún archivo de `lab/`: la huella md5 queda en `/opt/fake/.ready`). Lo único que la imagen de producción lleva de más es la corrección de §6. **Open5GS no se toca en el laboratorio**: es el mismo núcleo real.

| Archivo de OAI | Modificación | Para qué |
|---|---|---|
| `liboai_device.so` (enlace simbólico) | Apunta a una biblioteca falsa (`fakedev.c`) en vez de a la del USRP | Que el eNB arranque sin hardware |
| `openair2/PHY_INTERFACE/IF_Module_L2_primitives_NB_IoT.c` | El `0` de dos llamadas a `enable_*_simulation` pasa a depender de la variable de entorno `OAI_SIM_RACH` | Activar los ganchos de simulación del propio OAI (un acceso aleatorio simulado por arranque del eNB) |
| `openair2/LAYER2/MAC/eNB_scheduler_ulsch_NB_IoT.c` | Se anexa `inject.c`: **dos hilos UDP**. **UDP 9100** (comandos `SC`, `UT`, `UC`, `RC`) entrega al RRC real mensajes de subida. **UDP 9101** recibe paquetes IP del dispositivo y los entrega a la tarea GTP-U como `GTPV1U_ENB_TUNNEL_DATA_REQ` (rnti `0x101`, RAB 5) | Probar RRC, S1AP y **datos de usuario** con mensajes inyectados |
| `openair3/GTPV1-U/gtpv1u_eNB.c` | Gancho `narrowcast_dl_relay()`: si existe `OAI_RELAY_DL=ip:puerto`, los paquetes IP de bajada que llegan del SGW-U se reenvían por UDP (puerto 9102 del simulador) en vez de ir a PDCP | Cerrar el camino de **bajada** de datos sin radio |
| `openair2/RRC/LITE/rrc_eNB_S1AP.c` | `printf` que muestran los NAS que llegan del MME (`[NAS-DL]`, `[ICS-REQ]`, `[ICS-NAS]`) | Observar el flujo |
| `…/CMakeFiles/R10.5/s1ap_decoder.c` (generado) | La misma corrección de §6 (ya viene en la imagen; el script solo la aplica si falta) | Ver §6 |

**Variables de entorno de `scripts/oai-lab-start.sh`:** `OAI_SIM_RACH=1`, `OAI_INJECT=1` y `OAI_RELAY_DL=<IP del nodo>:9102`.

### 5.1 Lo que el laboratorio descubrió de OAI (hallazgos)

Estos comportamientos de OAI se observaron al hacer funcionar el laboratorio; condicionan cómo se inyecta:

1. **El eNB cae por SIGSEGV si se inyecta muy pronto tras arrancar** (menos de ~40 s). El simulador espera `SETTLE_S = 40` s desde el arranque. Además hay caídas intermitentes (código de salida 139) que el panel detecta y reintenta (§5.2).
2. **Un único acceso aleatorio simulado por arranque:** cada registro necesita reiniciar el eNB (el panel lo hace antes de cada escenario).
3. **La *Initial Context Setup Response* exige dos inyecciones:** primero `UC` (el RRCConnectionReconfigurationComplete que hace avanzar el contexto del E-RAB) y luego `RC`. Con `RC` solo, OAI falla al codificar (`Encoding of S1ap-E-RABSetupListCtxtSURes failed`), porque el estado del E-RAB solo pasa a *DONE* tras generar la reconfiguración RRC.
4. **El túnel de datos usa un RNTI fijo** (`0x101`) y el RAB 5; el TEID de subida lo asigna el SGW-U al completar el *Modify Bearer*.

### 5.2 Lo propio del laboratorio fuera de OAI (resumen)

- **`simlab`** (`app/simlab/`, contenedor `nb-simlab`): hace de módulo NB-IoT y de dispositivo. Habla NAS real (Milenage, EIA2) y entrega los mensajes a OAI por UDP 9100; los paquetes IP del nodo salen por 9101 y vuelven por 9102.
- **Reintentos y vigilancia:** `oai.py` detecta caídas/reinicios del eNB por su identificador de arranque y reintenta hasta 2 veces; el panel (`oai_watchdog`) reinicia `nb-oai-lab` si sale con un código distinto de 0/137/143 mientras hay un trabajo en curso.
- **Contadores del plano de usuario:** el panel lee la interfaz `ogstun` del PGW-U (`/api/lab/upstats`) para demostrar que los datos cruzaron el núcleo (ver [`codigo-por-dentro.md`](codigo-por-dentro.md) §5.6).

---

## 6. Modificación de OAI: el decodificador S1AP (corregida y aplicada)

Esta es la **única modificación de código** de OAI que el proyecto necesita. **Está aplicada a la imagen de producción** `narrowcast-nb/oai-nbiot` (antes figuraba como pendiente).

**Problema.** Cuando el módulo informa su IMEISV durante el registro (lo normal), Open5GS agrega el campo `Masked-IMEISV` (identificador 192, criticidad *ignore*) al mensaje `Initial Context Setup Request`. El decodificador S1AP de OAI, generado de una versión antigua del estándar (R10.5), no conoce ese campo y **descarta el mensaje completo** (`Unknown protocol IE id (192)… Failed to decode PDU`). Sin ese mensaje, el registro no se completa.

**Evidencia.** Se reprodujo con tráfico real contra el MME (ver `pruebas-oai.md`): con IMEISV el mensaje se descartaba; sin IMEISV, o con la corrección, OAI lo procesa y crea el túnel GTP-U.

**Corrección.** En el archivo generado `s1ap_decoder.c`, en la función que decodifica `InitialContextSetupRequestIEs`, el caso `default:` hacía `return -1`. Ahora hace `break`: se omite el campo ignorable, que es lo que manda el estándar para un IE desconocido con criticidad *ignore*.

**Cómo se aplicó** (`docker/oai-nbiot/Dockerfile`, justo después de `build_oai`):

```dockerfile
COPY patch-s1ap.py /tmp/patch-s1ap.py
RUN python3 /tmp/patch-s1ap.py \
    && cd cmake_targets/lte_build_oai/build && make -j2 lte-softmodem ...
```

`docker/oai-nbiot/patch-s1ap.py` busca el fragmento exacto, lo cambia y **falla la compilación si no lo encuentra** (por ejemplo, si cambiara el commit de OAI). Es idempotente. Después `make` regenera solo ese objeto y vuelve a enlazar `lte-softmodem`.

**Nota sobre cómo se construyó la imagen local.** El caché de Docker de la compilación completa de OAI ya no existía y el disco no permitía recompilar todo, así que la imagen local se obtuvo ejecutando **esos mismos pasos como una capa adicional** sobre la imagen anterior (`FROM narrowcast-nb/oai-nbiot:local`). El resultado es idéntico al de una construcción desde cero con el `Dockerfile` actual, que contiene el paso.

**Verificación** (en la imagen resultante):

```bash
docker run --rm --entrypoint grep narrowcast-nb/oai-nbiot:local -c "Narrowcast-NB" \
  /opt/oai/cmake_targets/lte_build_oai/build/CMakeFiles/R10.5/s1ap_decoder.c     # → 1
```

Y de forma funcional: el escenario «Registrar por OAI» del Laboratorio (con `send_imeisv` activo, es decir, con Masked-IMEISV) completa el registro (Attach Accept verificado, *Initial Context Setup Response* y túnel de datos con MQTT real); con el decodificador original se quedaba sin respuesta.

---

## 7. Cómo comprobar todo esto

Cada afirmación se puede verificar comparando con el original, que está dentro de la propia imagen:

```bash
# Open5GS: configuración original vs. la nuestra (ejemplo con el MME)
docker run --rm narrowcast-nb/open5gs:local cat /usr/local/etc/open5gs/mme.yaml > /tmp/mme.orig.yaml
diff /tmp/mme.orig.yaml config/open5gs/mme.yaml

# Open5GS: freeDiameter original (queda con 127.0.0.x; el entrypoint lo reescribe al arrancar)
docker run --rm --entrypoint cat narrowcast-nb/open5gs:local /usr/local/etc/freeDiameter/mme.conf

# OAI: ejemplo original vs. nuestra plantilla
docker run --rm --entrypoint cat narrowcast-nb/oai-nbiot:local \
  /opt/oai/targets/PROJECTS/GENERIC-LTE-EPC/CONF/enb.nbiot.band7.tm1.50PRB.usrp210.conf > /tmp/oai.orig.conf
diff /tmp/oai.orig.conf config/oai/enb.nbiot.conf.tmpl

# Código fuente sin tocar: los Dockerfile fijan el commit y fallan si no coincide
grep -n "OPEN5GS_COMMIT\|OAI_COMMIT\|rev-parse" docker/open5gs/Dockerfile docker/oai-nbiot/Dockerfile
```

Limitación: la imagen borra el directorio `.git` para ahorrar espacio, así que no se puede hacer un `git diff` del código dentro de ella. La garantía de que el código no se editó es que el `Dockerfile` clona el commit exacto y no ejecuta ningún comando que lo modifique (salvo el `sed` de `protobuf-c` y el paso de §6 en OAI, que lleva un marcador `Narrowcast-NB` que se puede buscar).

---

## 8. Resumen

El resumen en una respuesta está en [`preguntas-recurrentes.md`](../referencia/preguntas-recurrentes.md) §6.
