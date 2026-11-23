"""Nodo de riego inteligente NB-IoT del laboratorio (ESP32 + módulo SIM7080G + sensores y bomba).

La lógica es la del firmware `riego-nbiot.ino` (que se muestra en el panel): lee sensores cada segundo, decide si riega y reporta
por MQTT. No se simula la electrónica del ESP32: aquí viven el «mundo físico» (suelo, tanque, temperatura, una mano frente al
sensor ultrasónico) y el programa que lo controla. Los comandos AT del módulo se muestran como eventos.
Solo el módulo SIM7080G tiene dirección IP: la del APN de la SIM. Los sensores y la bomba cuelgan de los pines del ESP32.
"""
import json
import random
import socket
import struct
import threading
import time

import paho.mqtt.client as mqtt

TANK_EMPTY_CM, TANK_FULL_CM = 30.0, 4.0
MQTT_HOST_IP = "mosquitto"


def cksum(b):
    if len(b) % 2:
        b += b"\0"
    s = sum(struct.unpack("!%dH" % (len(b) // 2), b))
    s = (s >> 16) + (s & 0xFFFF)
    s += s >> 16
    return ~s & 0xFFFF


class IrrigationNode:
    def __init__(self, node_id, name, bus, mqtt_host, mqtt_user="", mqtt_pass=""):
        self.id, self.name, self.bus = node_id, name, bus
        self.mq_host, self.mq_user, self.mq_pass = mqtt_host, mqtt_user, mqtt_pass
        self.reset_world()
        self.cfg = self.default_cfg()
        self.mq = None
        self.ip = None
        self.at_log = []          # últimos comandos AT (para el panel)
        self.fw_log = []          # últimas acciones del firmware
        self._stop = threading.Event()
        self.thread = None
        self.lock = threading.Lock()

    # ------------------------------------------------------------------ mundo físico y configuración
    def reset_world(self):
        self.soil, self.temp, self.hum = 48.0, 24.0, 55.0     # % suelo, °C, % humedad del aire
        self.tank = 72.0                                       # % de agua en el tanque
        self.hand_cm = None                                    # distancia de una mano frente al sensor ultrasónico (None = sin mano)
        self.pump, self.alarm, self.alarm_why = False, False, ""
        self.dist = self._level_to_dist(self.tank)
        self.read_tank = self.tank                             # lo que el firmware cree que hay (conserva la última lectura válida)
        self.pump_since = 0.0
        self.last_report = 0.0

    @staticmethod
    def default_cfg():
        return {"auto": True, "soil_low": 30, "soil_high": 55, "tank_min": 10, "pump_max_s": 60, "interval_s": 10}

    @staticmethod
    def _level_to_dist(level):
        return round(TANK_EMPTY_CM - (TANK_EMPTY_CM - TANK_FULL_CM) * level / 100.0, 1)

    def set_world(self, soil=None, temp=None, tank=None, hand=None):
        """Entradas del mundo físico (las mueve quien usa el panel): sonda en suelo seco/húmedo, calor, llenar el tanque, acercar la mano."""
        with self.lock:
            if soil is not None:
                self.soil = max(0.0, min(100.0, float(soil)))
            if temp is not None:
                self.temp = max(-10.0, min(55.0, float(temp)))
            if tank is not None:
                self.tank = max(0.0, min(100.0, float(tank)))
            if hand is not None:
                self.hand_cm = None if float(hand) <= 0 else max(0.5, min(60.0, float(hand)))
        self.bus.emit(dev=self.id, stage="world", proto="HW", src="ue", dst="ue", ok=None, detail=self.hw_view(),
                      label="Cambio en el entorno del nodo: " + ", ".join(f"{k} = {v}" for k, v in
                            (("suelo", soil), ("temperatura", temp), ("tanque", tank), ("mano a (cm)", hand)) if v is not None))

    # ------------------------------------------------------------------ vista para el panel
    def hw_view(self):
        return {"soil": round(self.soil, 1), "temp": round(self.temp, 1), "hum": round(self.hum, 1), "tank": round(self.tank, 1), "dist": self.dist,
                "hand": self.hand_cm, "pump": self.pump, "alarm": self.alarm, "alarm_why": self.alarm_why}

    def view(self):
        return {"id": self.id, "name": self.name, "ip": self.ip, "hw": self.hw_view(), "cfg": self.cfg, "mqtt": bool(self.mq and self.mq.is_connected()),
                "at": self.at_log[-14:], "fw": self.fw_log[-10:]}

    def fw(self, fn, text=""):
        """Qué función del firmware se está ejecutando (el panel la resalta en el código C)."""
        ev = {"t": round(time.time(), 2), "fn": fn, "text": text}
        self.fw_log = (self.fw_log + [ev])[-30:]
        self.bus.emit(dev=self.id, stage="fw", proto="FW", src="ue", dst="ue", ok=None, label=text or fn, detail={"fn": fn})

    def at(self, cmd, resp="OK", ok=True):
        """Un intercambio de comandos AT entre el ESP32 y el módulo SIM7080G (por UART)."""
        ev = {"t": round(time.time(), 2), "cmd": cmd, "resp": resp, "ok": ok}
        self.at_log = (self.at_log + [ev])[-40:]
        self.bus.emit(dev=self.id, stage="at", proto="AT", src="ue", dst="ue", ok=ok, label=f"{cmd} → {resp.splitlines()[0] if resp else ''}", detail=ev)

    # ------------------------------------------------------------------ arranque del módulo (antes del registro)
    def modem_boot(self, sim_ok=True):
        self.fw("setup", "El ESP32 arranca y configura el módulo")
        for c, r in (("AT", "OK"), ("ATE0", "OK"), ("AT+CPIN?", "+CPIN: READY" if sim_ok else "+CME ERROR: SIM not inserted"),
                     ("AT+CFUN=1", "OK"), ("AT+CNMP=38", "OK"), ("AT+CMNB=2", "OK"), ('AT+CBANDCFG="NB-IOT",3', "OK"), ('AT+CGDCONT=1,"IP","internet"', "OK")):
            self.at(c, r, ok="ERROR" not in r)
            time.sleep(0.12)

    def modem_registered(self, ip, ok=True, why=""):
        if ok:
            self.ip = ip
            self.fw("modemAttach", "El módulo se registró en la red (+CEREG: 0,1)")
            self.at("AT+CEREG?", "+CEREG: 0,1", True)
            self.at("AT+CNACT=0,1", f"+APP PDP: 0,ACTIVE", True)
            self.at("AT+CNACT?", f'+CNACT: 0,1,"{ip}"', True)
        else:
            self.fw("modemAttach", f"Registro rechazado: {why}")
            self.at("AT+CEREG?", "+CEREG: 0,3", False)

    # ------------------------------------------------------------------ ping real por la IP del módulo
    def ping(self, dst, timeout=3):
        if not self.ip:
            return None
        ident = random.randint(1, 65000)
        ic = struct.pack("!BBHHH", 8, 0, 0, ident, 1) + b"narrowcast-lab"
        ic = ic[:2] + struct.pack("!H", cksum(ic)) + ic[4:]
        s = socket.socket(socket.AF_INET, socket.SOCK_RAW, socket.IPPROTO_ICMP)
        s.bind((self.ip, 0))
        s.settimeout(timeout)
        far = "mosq" if dst == "10.44.0.5" else "pgw"
        self.bus.emit(dev=self.id, stage="ping_tx", proto="ICMP", src="ue", dst=far, ok=None, detail={"dest": dst, "via": "GTP-U"},
                      label=f"Ping a {dst} desde la IP del módulo: sale por OAI, cruza el túnel y el núcleo")
        t0 = time.time()
        s.sendto(ic, (dst, 0))
        try:
            while True:
                d, a = s.recvfrom(2048)
                if a[0] == dst and d[20] == 0 and struct.unpack("!H", d[24:26])[0] == ident:
                    ms = round((time.time() - t0) * 1000, 1)
                    self.bus.emit(dev=self.id, stage="ping_rx", proto="ICMP", src=far, dst="ue", ok=True, detail={"dest": dst, "ms": ms},
                                  label=f"Respuesta de {dst} en {ms} ms: el camino de ida y vuelta por OAI y el núcleo funciona")
                    return ms
        except socket.timeout:
            self.bus.emit(dev=self.id, stage="ping_fail", proto="ICMP", src="ue", dst=far, ok=False, detail={"dest": dst}, label=f"Sin respuesta de {dst}")
            return None
        finally:
            s.close()

    # ------------------------------------------------------------------ aplicación (corre mientras el módulo tiene sesión de datos)
    def start(self):
        if self.thread and self.thread.is_alive():
            return
        self._stop.clear()
        self.thread = threading.Thread(target=self._run, name=f"node-{self.id}", daemon=True)
        self.thread.start()

    def stop(self, clean=True):
        self._stop.set()
        c, self.mq = self.mq, None
        if c:
            try:
                if clean:
                    c.publish(f"nb/{self.id}/status", "offline", qos=1, retain=True).wait_for_publish(1.5)
                c.disconnect()
                c.loop_stop()
            except Exception:
                pass
        self.ip = None
        self.pump = False

    def _connect(self):
        host = socket.gethostbyname(self.mq_host)
        c = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=self.id)
        if self.mq_user:
            c.username_pw_set(self.mq_user, self.mq_pass)
        c.will_set(f"nb/{self.id}/status", "offline", qos=1, retain=True)
        c.on_message = self._on_mqtt
        self.fw("modemMqttConnect", f"El módulo abre MQTT con el broker {host} por el túnel de datos")
        self.at('AT+SMCONF="URL","10.44.0.5",1883', "OK")
        self.at(f'AT+SMCONF="CLIENTID","{self.id}"', "OK")
        c.connect(host, 1883, keepalive=60, bind_address=self.ip)
        c.loop_start()
        self.mq = c
        self.at("AT+SMCONN", "OK")
        self.bus.emit(dev=self.id, stage="mqtt_connect", proto="MQTT", src="ue", dst="mosq", ok=True, detail={"broker": host},
                      label=f"El módulo abre su sesión MQTT con el broker por el túnel (IP {self.ip})")
        c.subscribe(f"nb/{self.id}/cmd", qos=1)
        self.at(f'AT+SMSUB="nb/{self.id}/cmd",1', "OK")
        c.publish(f"nb/{self.id}/status", "online", qos=1, retain=True)

    def _on_mqtt(self, c, ud, msg):
        try:
            cmd = json.loads(msg.payload.decode())
        except Exception:
            return
        self.bus.emit(dev=self.id, stage="mqtt_rx", proto="MQTT", src="mosq", dst="ue", ok=True, detail={"topic": msg.topic, "orden": cmd},
                      label=f"Llega una orden del celular por MQTT: {json.dumps(cmd)}")
        self.at(f'+SMSUB: "{msg.topic}","{json.dumps(cmd)}"', "", True)
        self.fw("onMqtt", f"El ESP32 interpreta la orden {json.dumps(cmd)}")
        with self.lock:
            if "mode" in cmd:
                self.cfg["auto"] = cmd["mode"] == "auto"
            for k in ("soil_low", "soil_high", "interval_s"):
                if k in cmd:
                    try:
                        self.cfg[k] = max(3 if k == "interval_s" else 0, min(int(cmd[k]), 3600 if k == "interval_s" else 100))
                    except Exception:
                        pass
            if "pump" in cmd and not self.cfg["auto"] and self.tank >= self.cfg["tank_min"]:
                self._pump(bool(cmd["pump"]), "orden del celular", notify=False)   # abajo se publica la confirmación
        self._publish()

    # ---- funciones del firmware (mismos nombres que en el .ino)
    def _read_sensors(self):
        with self.lock:
            self.dist = self.hand_cm if self.hand_cm is not None else self._level_to_dist(self.tank)
            if self.dist < 3.0:
                self.alarm, self.alarm_why = True, "algo tapa el sensor ultrasónico: se ignora la lectura"
            else:
                self.read_tank = max(0.0, min(100.0, (TANK_EMPTY_CM - self.dist) / (TANK_EMPTY_CM - TANK_FULL_CM) * 100.0))
                self.alarm, self.alarm_why = False, ""

    def _pump(self, on, why, notify=True):
        if on == self.pump:
            return
        self.pump = on
        self.pump_since = time.time()
        self.fw("pumpSet", f"Bomba {'ENCENDIDA' if on else 'APAGADA'}: {why}")
        self.bus.emit(dev=self.id, stage="device_state", proto="HW", src="ue", dst="ue", ok=True, detail={"pump": on},
                      label=f"La bomba se {'ENCIENDE' if on else 'APAGA'} ({why})")
        if notify:                        # un cambio de la bomba se reporta enseguida (no espera al intervalo): viaja por OAI y el núcleo hasta el celular
            self._publish()

    def _control(self):
        c = self.cfg
        with self.lock:
            if self.read_tank < c["tank_min"]:
                self._pump(False, "tanque bajo: protección contra marcha en seco")
                self.alarm, self.alarm_why = True, "nivel de agua bajo: bomba bloqueada"
                return
            if not c["auto"]:
                return
            if not self.pump and self.soil < c["soil_low"]:
                self._pump(True, f"suelo seco ({self.soil:.0f} % < {c['soil_low']} %)")
            elif self.pump and self.soil >= c["soil_high"]:
                self._pump(False, f"suelo húmedo ({self.soil:.0f} % ≥ {c['soil_high']} %)")
            elif self.pump and time.time() - self.pump_since > c["pump_max_s"]:
                self._pump(False, "tiempo máximo de riego")

    def _physics(self):
        """El mundo cambia solo: el suelo se seca, la bomba lo moja y baja el tanque."""
        with self.lock:
            self.soil = max(0.0, self.soil - (0.12 + 0.004 * max(0.0, self.temp - 15.0)))
            self.hum = max(25.0, min(85.0, self.hum + random.uniform(-0.6, 0.6) + (24.0 - self.temp) * 0.01))
            if self.pump:
                self.soil = min(100.0, self.soil + 1.1)
                self.tank = max(0.0, self.tank - 0.3)

    def _publish(self):
        if not (self.mq and self.mq.is_connected()):
            return
        p = {"soil": round(self.soil), "temp": round(self.temp, 1), "hum": round(self.hum), "tank": round(self.read_tank),
             "dist": self.dist, "pump": int(self.pump), "mode": "auto" if self.cfg["auto"] else "manual", "alarm": int(self.alarm),
             "led": int(self.alarm), "rssi": -93 + random.randint(-3, 3), "sim": True, "lab": True}
        self.fw("publishTelemetry", "El ESP32 publica su telemetría")
        body = json.dumps(p)
        self.at(f'AT+SMPUB="nb/{self.id}/telemetry",{len(body)},1,0', "OK")
        self.mq.publish(f"nb/{self.id}/telemetry", body, qos=1)
        self.bus.emit(dev=self.id, stage="mqtt_pub", proto="MQTT", src="ue", dst="mosq", ok=True, detail={"topic": f"nb/{self.id}/telemetry", "payload": p},
                      label=f"El nodo publica su telemetría: {body}")

    def _run(self):
        try:
            self._connect()
            self._publish()
            self.last_report = time.time()
            while not self._stop.wait(1.0):
                self._physics()
                self._read_sensors()
                self._control()
                if time.time() - self.last_report >= self.cfg["interval_s"]:
                    self.last_report = time.time()
                    self._publish()
        except Exception as e:
            self.bus.emit(dev=self.id, stage="app_error", proto="APP", src="ue", dst="ue", ok=False, detail={"error": str(e)},
                          label=f"El programa del nodo falló: {e}")
