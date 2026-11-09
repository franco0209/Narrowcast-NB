# 3. Datos con MQTT y el ESP32

## Cómo se maneja el LED
El ESP32 no recibe "órdenes por cable": se **suscribe a un tópico MQTT**. El panel publica un comando y el ESP32, al recibirlo, pone un pin en alto o bajo (el LED va en un GPIO; el integrado de la placa suele ser el GPIO 2).

| Tópico | Sentido | Contenido |
|---|---|---|
| `nb/<id>/telemetry` | ESP32 → panel | `{"temp":22.5,"hum":55,"rssi":-95,"led":false}` |
| `nb/<id>/cmd` | panel → ESP32 | `{"led":true}` y/o `{"interval_s":60}` |
| `nb/<id>/status` | ESP32 → panel | `online` / `offline` (último deseo, retenido) |

Broker: usuario y clave en `.env` (`MQTT_USER`, `MQTT_PASS`). Dentro de la red del núcleo está en `10.44.0.5:1883`; el módulo lo alcanza a través de la red privada (UPF).

## Firmware
Código en `firmware/esp32-nbiot/`. Se abre con Arduino IDE (o PlatformIO) e instala las librerías `TinyGSM`, `PubSubClient` y `DHT sensor library`. Copia `secrets.example.h` a `secrets.h` y completa los datos.

Conexiones: módulo RX/TX ↔ GPIO 16/17 del ESP32, DHT22 en el GPIO 4, LED en el GPIO 2.

## Probar sin hardware
```
docker compose exec app python fake_device.py esp32-sim
```
Simula un ESP32: aparece en la pestaña **Dispositivo** y obedece al LED.

## Con PSM / eDRX
Con PSM el módulo duerme y recibe órdenes solo al despertar; por eso el LED puede tardar. Los comandos se publican con QoS 1.
