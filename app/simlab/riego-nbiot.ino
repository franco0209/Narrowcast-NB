// Riego inteligente NB-IoT — ESP32 + módulo SIM7080G + sensores y bomba
// Mide humedad de suelo, temperatura/humedad del aire y nivel del tanque; riega solo cuando hace falta
// y reporta por MQTT sobre NB-IoT. Se puede mandar órdenes desde el celular (topic nb/riego-01/cmd).
#include <DHT.h>

// ---------- cableado ----------
#define PIN_SOIL   34   // ADC1: sensor capacitivo de humedad de suelo
#define PIN_DHT     4   // DHT22: temperatura y humedad del aire
#define PIN_TRIG    5   // HC-SR04: disparo
#define PIN_ECHO   18   // HC-SR04: eco
#define PIN_PUMP   26   // relé de la bomba de agua
#define PIN_ALARM  27   // LED rojo de alarma
// el módulo SIM7080G va por UART2 (TX 17, RX 16) con comandos AT; las funciones modem*() y json*() son
// utilidades de la librería del módulo (aquí omitidas)

#define TANK_EMPTY_CM  30.0   // distancia sensor→agua con el tanque vacío
#define TANK_FULL_CM    4.0   // distancia con el tanque lleno
#define SOIL_DRY_ADC  3200    // lectura en aire (0 %)
#define SOIL_WET_ADC  1300    // lectura sumergido (100 %)

struct Config {
  bool     autoMode  = true;  // true: riego automático, false: manual desde el celular
  int      soilLow   = 30;    // % de humedad bajo el cual se enciende la bomba
  int      soilHigh  = 55;    // % al que se apaga
  int      tankMin   = 10;    // % mínimo de agua: por debajo la bomba se bloquea (marcha en seco)
  uint32_t pumpMaxS  = 60;    // tope de funcionamiento seguido de la bomba
  uint32_t intervalS = 10;    // cada cuánto se reporta
} cfg;

DHT dht(PIN_DHT, DHT22);
float soil, temp, hum, distCm, tank;
bool  pump = false, alarm = false;
uint32_t pumpSince = 0, lastReport = 0;

// ---------- sensores ----------
float readDistanceCm() {
  digitalWrite(PIN_TRIG, HIGH); delayMicroseconds(10); digitalWrite(PIN_TRIG, LOW);
  long us = pulseIn(PIN_ECHO, HIGH, 30000);          // eco; el sonido va y vuelve: 58 µs por cm
  return us ? us / 58.0 : TANK_EMPTY_CM;
}

void readSensors() {
  int adc = analogRead(PIN_SOIL);
  soil = constrain(map(adc, SOIL_DRY_ADC, SOIL_WET_ADC, 0, 100), 0, 100);
  temp = dht.readTemperature();
  hum  = dht.readHumidity();
  distCm = readDistanceCm();
  if (distCm < 3.0) {                                // algo tapa el sensor (una mano, una hoja…)
    alarm = true;                                    // se ignora la lectura y se conserva el último nivel
  } else {
    tank = constrain((TANK_EMPTY_CM - distCm) / (TANK_EMPTY_CM - TANK_FULL_CM) * 100.0, 0, 100);
    alarm = false;
  }
}

// ---------- bomba ----------
void pumpSet(bool on, const char *why) {
  if (on == pump) return;
  pump = on;
  digitalWrite(PIN_PUMP, on);
  pumpSince = millis();
  logLine(on ? "bomba ON" : "bomba OFF", why);
  publishTelemetry();                                // un cambio se reporta enseguida, sin esperar el intervalo
}

void controlLogic() {
  if (tank < cfg.tankMin) {                          // protección: nunca en seco
    pumpSet(false, "tanque bajo");
    alarm = true;
    return;
  }
  if (!cfg.autoMode) return;                         // en manual solo manda el celular
  if (!pump && soil < cfg.soilLow)  pumpSet(true,  "suelo seco");
  if (pump && soil >= cfg.soilHigh) pumpSet(false, "suelo húmedo");
  if (pump && (millis() - pumpSince) / 1000 > cfg.pumpMaxS) pumpSet(false, "tiempo máximo");
}

// ---------- red: MQTT sobre NB-IoT ----------
void publishTelemetry() {
  char json[200];
  snprintf(json, sizeof json,
    "{\"soil\":%.0f,\"temp\":%.1f,\"hum\":%.0f,\"tank\":%.0f,\"dist\":%.1f,\"pump\":%d,\"mode\":\"%s\",\"alarm\":%d}",
    soil, temp, hum, tank, distCm, pump, cfg.autoMode ? "auto" : "manual", alarm);
  modemPublish("nb/riego-01/telemetry", json);       // AT+SMPUB
}

void onMqtt(const char *topic, const char *payload) {
  if (jsonHas(payload, "mode"))      cfg.autoMode = jsonStr(payload, "mode") == "auto";
  if (jsonHas(payload, "soil_low"))  cfg.soilLow  = jsonInt(payload, "soil_low");
  if (jsonHas(payload, "soil_high")) cfg.soilHigh = jsonInt(payload, "soil_high");
  if (jsonHas(payload, "interval_s")) cfg.intervalS = jsonInt(payload, "interval_s");
  if (jsonHas(payload, "pump") && !cfg.autoMode && tank >= cfg.tankMin)
    pumpSet(jsonBool(payload, "pump"), "orden del celular");
  publishTelemetry();                                // confirma el nuevo estado
}

// ---------- programa ----------
void setup() {
  pinMode(PIN_TRIG, OUTPUT); pinMode(PIN_ECHO, INPUT);
  pinMode(PIN_PUMP, OUTPUT); pinMode(PIN_ALARM, OUTPUT);
  dht.begin();
  modemInit();                                       // AT, AT+CPIN?, AT+CMNB=2 (NB-IoT), AT+CGDCONT…
  modemAttach();                                     // AT+CEREG? hasta registrarse en la red
  modemPdpUp();                                      // AT+CNACT=0,1: obtiene la IP
  modemMqttConnect("10.44.0.5", 1883, "riego-01");   // AT+SMCONN y AT+SMSUB del topic de órdenes
}

void loop() {
  readSensors();
  controlLogic();
  digitalWrite(PIN_ALARM, alarm);
  if (millis() - lastReport > cfg.intervalS * 1000) { lastReport = millis(); publishTelemetry(); }
  modemPoll(onMqtt);                                 // órdenes entrantes
  delay(1000);
}
