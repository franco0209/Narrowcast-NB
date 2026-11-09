"""Narrowcast-NB: panel de control (guía, radio, dispositivo, núcleo)."""
import asyncio
import csv
import json
import os
import re
import subprocess
import threading
import time
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import docker
import markdown
import paho.mqtt.client as mqtt
import yaml
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from pymongo import MongoClient

os.umask(0)  # los archivos de data/ quedan editables desde el host

DATA_DIR = Path(os.environ.get("DATA_DIR", "/data"))
GUIDE_DIR = Path(os.environ.get("GUIDE_DIR", "/guide"))
CHECK_SCRIPT = os.environ.get("RF_CHECK_SCRIPT", "/project/scripts/rf-check.sh")
RADIO_CONTAINER = os.environ.get("RADIO_CONTAINER", "nb-enb-nbiot")
MQTT_HOST = os.environ.get("MQTT_HOST", "mosquitto")
MQTT_USER = os.environ.get("MQTT_USER", "")
MQTT_PASS = os.environ.get("MQTT_PASS", "")
MONGO_URI = os.environ.get("MONGO_URI", "mongodb://mongo:27017/open5gs")
PLAN_FILE = DATA_DIR / "rf-plan.yaml"
SESSIONS_CSV = DATA_DIR / "logs" / "rf-sessions.csv"
PLAN_KEYS = ["band", "earfcn", "dl_freq_hz", "ul_freq_hz", "tx_gain", "modo", "atenuacion_db",
             "duracion_max_s", "portadora_libre", "antena_autorizada", "autorizado_por"]

app = FastAPI(title="Narrowcast-NB")
loop: asyncio.AbstractEventLoop
listeners: set = set()


@app.on_event("startup")
async def startup():
    global loop
    loop = asyncio.get_running_loop()
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    # RF apagada por defecto: si el eNB quedó encendido de una sesión anterior, se apaga.
    try:
        c = docker.from_env().containers.get(RADIO_CONTAINER)
        if c.status == "running":
            c.stop(timeout=10)
            log_session("reinicio del panel", 0, "apagado al iniciar el panel")
    except Exception:
        pass
    start_mqtt()


def broadcast(event: dict):
    for q in list(listeners):
        loop.call_soon_threadsafe(q.put_nowait, event)


@app.get("/api/stream")
async def stream():
    q: asyncio.Queue = asyncio.Queue()
    listeners.add(q)

    async def gen():
        try:
            yield f"data: {json.dumps({'type': 'hello', 'radio': radio_state(), 'devices': devices_view()})}\n\n"
            while True:
                try:
                    ev = await asyncio.wait_for(q.get(), timeout=15)
                    yield f"data: {json.dumps(ev)}\n\n"
                except asyncio.TimeoutError:
                    yield ": ping\n\n"
        finally:
            listeners.discard(q)

    return StreamingResponse(gen(), media_type="text/event-stream")


# ----------------------------------------------------------------- Guía
def guide_files():
    return sorted(GUIDE_DIR.glob("*.md")) if GUIDE_DIR.exists() else []


@app.get("/api/guide")
def guide_list():
    out = []
    for f in guide_files():
        m = re.search(r"^#\s+(.+)$", f.read_text(encoding="utf-8"), re.M)
        out.append({"id": f.stem, "title": m.group(1) if m else f.stem})
    return out


@app.get("/api/guide/{gid}")
def guide_get(gid: str):
    for f in guide_files():
        if f.stem == gid:
            return {"id": gid, "html": markdown.markdown(f.read_text(encoding="utf-8"),
                                                          extensions=["fenced_code", "tables"])}
    raise HTTPException(404, "guía no encontrada")


# ---------------------------------------------------------------- Radio
radio = {"running": False, "started": None, "deadline": None, "timer": None}
radio_lock = threading.Lock()


def radio_state():
    return {"running": radio["running"], "started": radio["started"], "deadline": radio["deadline"]}


def read_plan() -> dict:
    if not PLAN_FILE.exists():
        return {k: "" for k in PLAN_KEYS}
    raw = yaml.safe_load(PLAN_FILE.read_text(encoding="utf-8")) or {}
    return {k: ("" if raw.get(k) is None else str(raw.get(k))) for k in PLAN_KEYS}


def run_checks() -> dict:
    env = {**os.environ, "RF_PLAN": str(PLAN_FILE)}
    p = subprocess.run(["bash", CHECK_SCRIPT], capture_output=True, text=True, env=env)
    checks = []
    for line in p.stdout.splitlines():
        m = re.match(r"^(PASS|FAIL)\s+(.*)$", line)
        if m:
            checks.append({"ok": m.group(1) == "PASS", "text": m.group(2)})
    return {"ok": p.returncode == 0, "checks": checks}


def log_session(result: str, real_s: float, note: str = ""):
    SESSIONS_CSV.parent.mkdir(parents=True, exist_ok=True)
    plan = read_plan()
    new = not SESSIONS_CSV.exists()
    with SESSIONS_CSV.open("a", newline="") as f:
        w = csv.writer(f)
        if new:
            w.writerow(["inicio_utc", "banda", "earfcn", "modo", "tx_gain", "duracion_max_s",
                        "duracion_real_s", "codigo", "resultado"])
        start = radio["started"] or time.time()
        w.writerow([datetime.fromtimestamp(start, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                    plan["band"], plan["earfcn"], plan["modo"], plan["tx_gain"], plan["duracion_max_s"],
                    round(real_s), "panel", f"{result} {note}".strip()])


def stop_radio(reason: str):
    with radio_lock:
        was_running = radio["running"]
        if radio["timer"]:
            radio["timer"].cancel()
        try:
            docker.from_env().containers.get(RADIO_CONTAINER).stop(timeout=10)
        except Exception:
            pass
        if was_running:
            log_session(reason, time.time() - (radio["started"] or time.time()))
        radio.update(running=False, started=None, deadline=None, timer=None)
    broadcast({"type": "radio", "radio": radio_state(), "reason": reason})


@app.get("/api/radio")
def radio_get():
    return {"plan": read_plan(), "check": run_checks(), "radio": radio_state(), "container": RADIO_CONTAINER}


@app.put("/api/radio/plan")
def radio_plan_put(plan: dict):
    if radio["running"]:
        raise HTTPException(409, "No se puede editar el plan mientras se transmite")
    lines = []
    for k in PLAN_KEYS:
        v = str(plan.get(k, "")).strip().replace("\n", " ")
        if v and re.search(r"[:#]", v):
            v = '"' + v.replace('"', "'") + '"'
        lines.append(f"{k}: {v}")
    PLAN_FILE.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return radio_get()


class StartReq(BaseModel):
    confirm: str


@app.post("/api/radio/start")
def radio_start(req: StartReq):
    if req.confirm.strip().upper() != "EMITIR":
        raise HTTPException(400, 'Escribe EMITIR para confirmar')
    if radio["running"]:
        raise HTTPException(409, "Ya se está transmitiendo")
    chk = run_checks()
    if not chk["ok"]:
        raise HTTPException(409, {"msg": "El plan RF no cumple las reglas", "check": chk})
    try:
        c = docker.from_env().containers.get(RADIO_CONTAINER)
    except docker.errors.NotFound:
        raise HTTPException(404, f"El contenedor del eNB ({RADIO_CONTAINER}) no existe todavía: "
                                 "falta configurar el eNB de la Fase 3")
    dur = int(read_plan()["duracion_max_s"])
    with radio_lock:
        c.start()
        now = time.time()
        radio.update(running=True, started=now, deadline=now + dur)
        t = threading.Timer(dur, stop_radio, args=("cortado por límite de tiempo",))
        t.daemon = True
        t.start()
        radio["timer"] = t
    broadcast({"type": "radio", "radio": radio_state()})
    return radio_state()


@app.post("/api/radio/stop")
def radio_stop():
    stop_radio("detenido a mano")
    return radio_state()


@app.get("/api/radio/sessions")
def radio_sessions():
    if not SESSIONS_CSV.exists():
        return []
    with SESSIONS_CSV.open() as f:
        return list(csv.DictReader(f))[-50:][::-1]


# ---------------------------------------------------------- Dispositivo
devices: dict = {}
mqttc: Optional[mqtt.Client] = None


def dev(did: str) -> dict:
    return devices.setdefault(did, {"online": False, "seen": None, "last": {}, "history": deque(maxlen=120)})


def devices_view():
    return {k: {"online": v["online"], "seen": v["seen"], "last": v["last"], "history": list(v["history"])}
            for k, v in devices.items()}


def on_connect(client, userdata, flags, rc, props=None):
    client.subscribe("nb/+/telemetry")
    client.subscribe("nb/+/status")


def on_message(client, userdata, msg):
    parts = msg.topic.split("/")
    if len(parts) != 3:
        return
    _, did, kind = parts
    d = dev(did)
    now = time.time()
    try:
        payload = msg.payload.decode()
        if kind == "status":
            d["online"] = payload.strip().lower() == "online"
            d["seen"] = now
            broadcast({"type": "status", "device": did, "online": d["online"], "seen": now})
        elif kind == "telemetry":
            data = json.loads(payload)
            data["ts"] = now
            d["online"], d["seen"], d["last"] = True, now, data
            d["history"].append(data)
            broadcast({"type": "telemetry", "device": did, "data": data})
    except Exception:
        pass


def start_mqtt():
    global mqttc
    c = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="nb-panel")
    if MQTT_USER:
        c.username_pw_set(MQTT_USER, MQTT_PASS)
    c.on_connect, c.on_message = on_connect, on_message
    c.reconnect_delay_set(1, 10)
    c.connect_async(MQTT_HOST, 1883)
    c.loop_start()
    mqttc = c


@app.get("/api/devices")
def devices_get():
    return devices_view()


class Cmd(BaseModel):
    led: Optional[bool] = None
    interval_s: Optional[int] = None


@app.post("/api/devices/{did}/cmd")
def device_cmd(did: str, cmd: Cmd):
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,32}", did):
        raise HTTPException(400, "id de dispositivo inválido")
    payload = {k: v for k, v in cmd.model_dump().items() if v is not None}
    if not payload:
        raise HTTPException(400, "comando vacío")
    if "interval_s" in payload and not 5 <= payload["interval_s"] <= 86400:
        raise HTTPException(400, "interval_s debe estar entre 5 y 86400")
    info = mqttc.publish(f"nb/{did}/cmd", json.dumps(payload), qos=1)
    broadcast({"type": "cmd", "device": did, "cmd": payload, "ts": time.time()})
    return {"sent": payload, "mid": info.mid}


# ---------------------------------------------------------------- Núcleo
@app.get("/api/core")
def core():
    out = {"containers": [], "subscribers": [], "error": None}
    try:
        for c in docker.from_env().containers.list(all=True, filters={"name": "nb-"}):
            out["containers"].append({"name": c.name, "status": c.status})
        out["containers"].sort(key=lambda x: x["name"])
    except Exception as e:
        out["error"] = f"docker: {e}"
    try:
        db = MongoClient(MONGO_URI, serverSelectionTimeoutMS=1500).get_default_database()
        for s in db.subscribers.find({}, {"imsi": 1, "msisdn": 1, "slice.session.name": 1}):
            apns = [x["name"] for sl in s.get("slice", []) for x in sl.get("session", [])]
            out["subscribers"].append({"imsi": s["imsi"], "msisdn": s.get("msisdn", []), "apn": apns})
    except Exception as e:
        out["error"] = (out["error"] or "") + f" mongo: {e}"
    return out


app.mount("/", StaticFiles(directory=Path(__file__).parent / "static", html=True), name="static")
