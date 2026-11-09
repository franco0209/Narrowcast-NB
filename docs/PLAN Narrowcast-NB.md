# Plan del Proyecto 5.2: Red privada celular IoT (NB-IoT / LTE-M) sobre Open5GS

Plan con USRP y antenas, partiendo de que el laboratorio de la universidad ya probó una red LTE con teléfonos. La Fase 0 fija unas reglas simples de transmisión RF y confirma el permiso antes de transmitir.

## Arquitectura (resumen)

```
ESP32 ──UART (AT)── Módulo NB-IoT ~~ antena ~~ USRP (eNB) ── UTP ── PC (Open5GS) ── servidor MQTT
(controla)           (UE, SIM programable)      (radio)             (núcleo)
```

- **UE:** el módulo (SIM7080G / BG96) controlado por el ESP32.
- **eNB:** el USRP más el software que genera la señal NB-IoT.
- **Núcleo (EPC):** Open5GS en el PC. Autentica, asigna IP y da salida de datos.
- **Interfaces:** Uu (radio), S1-MME (señalización eNB↔MME, S1AP sobre SCTP), S1-U (datos, GTP-U), S6a (MME↔HSS, Diameter), S11 (MME↔SGW-C), SGi (salida a Internet).

## Fase 0: reglas de transmisión RF (1 día, costo 0)

Transmitir en banda celular está regulado, así que se define una vez, de forma corta, cómo se hace. Reglas esenciales: RF apagada por defecto, un plan de canal, potencia baja y duración limitada.

### Conceptos mínimos

- **Banda y EARFCN:** la banda es el rango licenciado y el EARFCN fija la frecuencia exacta. Bajada (eNB→módulo) y subida (módulo→eNB) usan frecuencias distintas.
- **NB-IoT:** una portadora de 200 kHz, en modo standalone.
- **Potencia:** depende de la ganancia TX del USRP, del atenuador y de la antena. Se mide, no se supone.

### Reglas (un solo archivo `rf-plan.yaml`, fuera de Git)

```yaml
band:              # soportada por el módulo Y autorizada
earfcn:            # portadora NB-IoT elegida en el barrido (Fase 3)
dl_freq_hz:
ul_freq_hz:
tx_gain: 0         # empezar en el mínimo y subir de a poco
modo: cable        # cable (por defecto) | antena
atenuacion_db: 60  # mínimo en modo cable
duracion_max_s: 600
autorizado_por:    # nombre del docente y fecha
```

1. **Por defecto, cable y atenuador** (USRP → atenuador ≥ 60 dB → módulo, sin antena). La antena solo con permiso escrito del docente.
2. **Antes de transmitir** se comprueba lo mínimo: la banda está en la lista del módulo, hay autorización anotada, la ganancia es baja y la portadora elegida está libre.
3. **Sesiones cortas:** el eNB se lanza con un tiempo máximo (`timeout`) y se puede detener a mano en cualquier momento (`docker stop` o Ctrl+C).
4. **Registrar** cada sesión: fecha, banda, ganancia y resultado.

### Qué hay que confirmar con el docente (por escrito, un mensaje basta)

- Banda y frecuencia autorizadas, y potencia máxima.
- Lugar y horarios, y si se permite solo cable o también antena.
- Modelo de USRP disponible (el propio o la X310 del laboratorio).

La banda manda sobre lo demás, porque el módulo debe soportarla. Los módulos NB-IoT habituales (SIM7080G, BG96) cubren B3, B8, B20 y B28, pero no B7.

**Listo cuando:** la banda está confirmada por escrito, es soportada por el módulo y `rf-plan.yaml` está completo.

## Fase 1: el núcleo, sin radio (2–3 días, costo 0)

1. Instalar Open5GS en el PC con Ubuntu (apt). Incluye la **WebUI** para registrar suscriptores.
2. Configurar el **PLMN de prueba 001/01** y un **TAC** (por ejemplo 1).
3. Validar el núcleo con una radio **virtual** (srsRAN con ZMQ). Si un UE simulado se registra y obtiene IP, el núcleo está bien.

## Fase 2: validar la cadena de radio con LTE normal (2–3 días)

Comprobar que el USRP, las antenas y la banda funcionan repitiendo lo que se hizo en el laboratorio: un eNB LTE con srsRAN y un teléfono registrado en la red. Los teléfonos no se conectan solos al PLMN 001/01, hay que elegir la red manualmente.

Con antenas:

- Empezar con la **ganancia de transmisión más baja** del USRP y subir de a poco.
- Mantener el módulo a **uno o dos metros** de la antena y medir con un analizador de espectro (o con otro SDR) que no se supera la potencia autorizada.
- Respetar la **banda y los horarios** acordados.
- Seguir las reglas de la Fase 0 (`rf-plan.yaml`, cable primero, sesiones cortas).

## Fase 3: el eNB NB-IoT, el punto crítico (1–2 semanas)

srsRAN no completa un registro NB-IoT. Se usa el eNB de **OpenAirInterface (OAI)**, rama `develop-nb-iot`.

1. Compilarlo en una **máquina virtual o contenedor** con Ubuntu antiguo (16.04 o 18.04) y el **UHD** (driver del USRP) de esa época.
2. Barrido de espectro en la banda (con el USRP o con `cell_search_nbiot` de srsRAN) para elegir una portadora de 200 kHz **libre de señales reales**.
3. Usar el modo **standalone** (portadora NB-IoT sola). Es el más simple: in-band exige una portadora LTE al lado y guard-band exige cuidar el borde de una real.
4. Conectar el eNB a Open5GS por **S1** (cable UTP o mismo equipo).

**Punto de decisión:** si el eNB no emite una portadora NB-IoT visible en el espectro, detenerse y hablar con el docente. Alternativas: acotar el proyecto a señalización, o cambiar el enfoque. Mejor saberlo antes de comprar nada.

## Fase 4: el módulo se registra (1 semana)

1. Cargar **IMSI, Ki y OPc** en la SIM programable y los mismos valores en la WebUI de Open5GS.
2. Con el módulo conectado por USB-serie (o al ESP32), configurar por comandos AT:
   - Modo NB-IoT y banda, según el módulo:
     - SIM7080G: `AT+CMNB=2` (NB-IoT) y `AT+CBANDCFG="NB-IOT",<banda>`.
     - BG96: `AT+QCFG="nwscanmode"` / `AT+QCFG="iotopmode",1` y `AT+QCFG="band"`.
   - Comprobar antes el firmware (`ATI`, `AT+CGMR`) y las bandas soportadas (`AT+CBANDCFG?`).
   - Búsqueda manual de red: `AT+COPS=1,2,"00101"`.
   - APN.
3. Capturar el tráfico **S1** con Wireshark en el PC del núcleo y ver el Attach completo: petición, autenticación y aceptación.
4. Si el attach falla, revisar el log del MME de Open5GS (clave mal cargada, PLMN o TAC distintos, banda no soportada).

## Fase 5: datos reales (2–3 días)

Instalar un broker **MQTT (Mosquitto)** en el PC. El ESP32 lee un sensor (por ejemplo un DHT22) y envía el valor por el módulo hasta el broker, atravesando la red privada completa.

## Fase 6: PSM, eDRX y consumo (1 semana)

1. Pedir **PSM** con `AT+CPSMS` y **eDRX** con `AT+CEDRXS`; leer lo concedido con `AT+CPSMRDP` y `AT+CEDRXRDP`.
2. Revisar en Wireshark el **Attach Accept** y el **TAU Accept**. Si el MME de Open5GS devuelve los temporizadores, la red los aceptó. Si los ignora, el módulo no entra en PSM, y eso también es un resultado válido.
3. Medir la corriente en cada fase: arranque y attach, transmisión, escucha activa, reposo con eDRX y suspensión en PSM. En una placa de desarrollo (GNSS, LEDs, reguladores) la corriente en PSM incluye el consumo de la placa y no refleja los µA reales del módulo; anotarlo como limitación o medir el módulo aislado.
4. Comparar tres configuraciones (sin ahorro, eDRX y PSM) y estimar la duración de una batería con un mensaje cada cierto tiempo.

Aviso: eDRX exige que el eNB soporte el paging extendido. Es incierto que el de OAI lo haga, por lo que PSM es el resultado más realista.

## Fase 7: informe y demostración (1 semana)

Diagramas de arquitectura, capturas de Wireshark del attach, tabla de consumos y conclusiones.

## Qué comprar (lo mínimo)

- **Un módulo** SIM7080G o BG96 en placa de desarrollo, con la banda del laboratorio confirmada primero. Antes de comprar o conectar: pedir al vendedor la hoja de datos, la versión exacta (no regional) y el rango de alimentación real de la placa (algunos anuncios indican datos contradictorios, p. ej. 5–10 V frente a 2.7–4.8 V); al recibirla, comprobar firmware y que acepta modo NB-IoT. Verificar también el tamaño de la ranura SIM (nano o micro).
- **SIM programables** (tipo sysmoISIM u OpenCells) y un lector PC/SC. Consultar antes si el laboratorio ya tiene.
- **Medidor de consumo:** ESP32 con INA226 sirve para mA. PSM (pocos µA) necesita otro rango de medición o un instrumento del laboratorio.
- **Antena** adecuada a la banda, si las del laboratorio no la cubren.

## Riesgos principales

1. El eNB NB-IoT de OAI es código antiguo y puede dar problemas de compilación o compatibilidad con el USRP.
2. La banda del módulo debe coincidir con la autorizada (por ejemplo, B7 probablemente no la soporta).
3. Open5GS podría no conceder PSM o eDRX.
4. El modelo de USRP condiciona las versiones de software utilizables.

## Glosario rápido

| Término | Significado |
|---|---|
| **UE** | Dispositivo del usuario (aquí, el módulo). |
| **eNB** | Estación base 4G: la parte de radio. |
| **EPC** | Núcleo 4G (lo que implementa Open5GS). |
| **MME** | Recepcionista: registro, autenticación y paging. |
| **HSS** | Libreta de suscriptores (IMSI, Ki, OPc). |
| **SGW / PGW (SMF+UPF)** | Rutean los datos de usuario y dan salida a Internet. |
| **PLMN (MCC+MNC)** | Identificador de red. 001/01 es el de pruebas. |
| **TAC** | Código de la zona de ubicación (tracking area). |
| **IMSI, Ki, OPc** | Identidad y claves de la SIM. |
| **NAS** | Mensajes entre dispositivo y MME. |
| **RRC** | Mensajes entre dispositivo y eNB. |
| **S1AP / SCTP / GTP** | Protocolos de señalización, transporte y túnel. |
| **Paging** | Aviso por radio a un dispositivo en reposo. |
| **TAU** | Aviso periódico del dispositivo de que sigue vivo. |
| **PSM** | Apagón profundo entre transmisiones (T3324, T3412 extendido). |
| **eDRX** | Escucha de paging cada varios segundos o minutos. |
| **EARFCN** | Número que identifica la frecuencia de portadora. |
| **AT** | Comandos de texto para controlar un módem. |

## Fuentes

- srsRAN 4G, NB-IoT: <https://docs.srsran.com/projects/4g/en/rfsoc/app_notes/source/nbiot/source/>
- Prototyping of Open Source NB-IoT Network: <https://arxiv.org/abs/2006.02729>
