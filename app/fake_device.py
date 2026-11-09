"""Simula un ESP32: publica telemetría y obedece comandos. Uso (dentro del contenedor app):
   docker compose exec app python fake_device.py [id]"""
import json, os, random, sys, time
import paho.mqtt.client as mqtt

did = sys.argv[1] if len(sys.argv) > 1 else "esp32-sim"
state = {"led": False, "interval": 5}

def on_connect(c, u, f, rc, p=None):
    c.subscribe(f"nb/{did}/cmd", qos=1)
    c.publish(f"nb/{did}/status", "online", qos=1, retain=True)

def on_message(c, u, m):
    cmd = json.loads(m.payload)
    if "led" in cmd:
        state["led"] = bool(cmd["led"])
    if "interval_s" in cmd:
        state["interval"] = int(cmd["interval_s"])
    print("cmd:", cmd, flush=True)

c = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=did)
c.username_pw_set(os.environ["MQTT_USER"], os.environ["MQTT_PASS"])
c.will_set(f"nb/{did}/status", "offline", qos=1, retain=True)
c.on_connect, c.on_message = on_connect, on_message
c.connect(os.environ.get("MQTT_HOST", "mosquitto"), 1883)
c.loop_start()
while True:
    c.publish(f"nb/{did}/telemetry", json.dumps({
        "temp": round(22 + random.uniform(-1.5, 1.5), 1), "hum": round(55 + random.uniform(-5, 5), 1),
        "rssi": random.randint(-110, -80), "led": state["led"]}), qos=1)
    time.sleep(state["interval"])
