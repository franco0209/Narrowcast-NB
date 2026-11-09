// ESP32 + SIM7080G (NB-IoT) + DHT22 + LED, por MQTT. SIN PROBAR en hardware real.
// Librerías: TinyGSM, PubSubClient, DHT sensor library (Adafruit).
#define TINY_GSM_MODEM_SIM7080
#include <TinyGsmClient.h>
#include <PubSubClient.h>
#include <DHT.h>
#include "secrets.h"

#define MODEM_RX 16
#define MODEM_TX 17
#define DHT_PIN 4
#define LED_PIN 2

HardwareSerial SerialAT(2);
TinyGsm modem(SerialAT);
TinyGsmClient net(modem);
PubSubClient mqtt(net);
DHT dht(DHT_PIN, DHT22);

String tTelemetry = String("nb/") + DEVICE_ID + "/telemetry";
String tCmd = String("nb/") + DEVICE_ID + "/cmd";
String tStatus = String("nb/") + DEVICE_ID + "/status";
uint32_t intervalMs = 60000, lastSend = 0;
bool ledOn = false;

void onMessage(char* topic, byte* payload, unsigned int len) {
  String s;
  for (unsigned int i = 0; i < len; i++) s += (char)payload[i];
  // JSON mínimo: {"led":true} y/o {"interval_s":60}
  if (s.indexOf("\"led\":true") >= 0) ledOn = true;
  if (s.indexOf("\"led\":false") >= 0) ledOn = false;
  int k = s.indexOf("\"interval_s\":");
  if (k >= 0) {
    long v = s.substring(k + 13).toInt();
    if (v >= 5 && v <= 86400) intervalMs = v * 1000UL;
  }
  digitalWrite(LED_PIN, ledOn);
  lastSend = 0;  // confirmar el cambio enviando telemetría ya
}

// CSQ 0..31 -> dBm (99 = desconocido)
int csqToDbm(int csq) { return (csq == 99 || csq < 0) ? 0 : -113 + 2 * csq; }

bool attach() {
  modem.sendAT("+CMNB=2");  // NB-IoT
  modem.waitResponse();
  modem.sendAT(String("+CBANDCFG=\"NB-IOT\",") + NB_BAND);
  modem.waitResponse();
  modem.sendAT(String("+COPS=1,2,\"") + NB_PLMN + "\"");  // red manual 001/01
  modem.waitResponse(60000L);
  return modem.waitForNetwork(120000L) && modem.gprsConnect(NB_APN);
}

bool connectMqtt() {
  if (!mqtt.connect(DEVICE_ID, MQTT_USER, MQTT_PASS, tStatus.c_str(), 1, true, "offline")) return false;
  mqtt.publish(tStatus.c_str(), "online", true);
  mqtt.subscribe(tCmd.c_str(), 1);
  return true;
}

void setup() {
  pinMode(LED_PIN, OUTPUT);
  Serial.begin(115200);
  SerialAT.begin(115200, SERIAL_8N1, MODEM_RX, MODEM_TX);
  dht.begin();
  modem.restart();
  Serial.println(modem.getModemInfo());
  mqtt.setServer(MQTT_BROKER, MQTT_PORT);
  mqtt.setCallback(onMessage);
}

void loop() {
  if (!modem.isNetworkConnected() || !modem.isGprsConnected()) {
    Serial.println(attach() ? "attach OK" : "attach FALLÓ");
    return;
  }
  if (!mqtt.connected() && !connectMqtt()) { delay(5000); return; }
  mqtt.loop();
  if (millis() - lastSend >= intervalMs || lastSend == 0) {
    lastSend = millis();
    char buf[128];
    snprintf(buf, sizeof(buf), "{\"temp\":%.1f,\"hum\":%.1f,\"rssi\":%d,\"led\":%s}",
             dht.readTemperature(), dht.readHumidity(), csqToDbm(modem.getSignalQuality()), ledOn ? "true" : "false");
    mqtt.publish(tTelemetry.c_str(), buf);
  }
}
