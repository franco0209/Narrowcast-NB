"""Narrowcast-NB: panel de control (guía, radio, dispositivo, núcleo)."""
import asyncio
import csv
import json
import os
import re
import subprocess
import threading
import time
import urllib.error
import urllib.request
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import docker
import markdown
import paho.mqtt.client as mqtt
import yaml
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import PlainTextResponse, StreamingResponse
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
    threading.Thread(target=lab_bridge, name="lab-bridge", daemon=True).start()
    threading.Thread(target=oai_watchdog, name="oai-watchdog", daemon=True).start()


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
    pump: Optional[bool] = None            # nodo de riego: bomba (solo en modo manual)
    mode: Optional[str] = None             # «auto» o «manual»
    soil_low: Optional[int] = None         # % de humedad de suelo que enciende la bomba
    soil_high: Optional[int] = None        # % que la apaga


@app.post("/api/devices/{did}/cmd")
def device_cmd(did: str, cmd: Cmd):
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,32}", did):
        raise HTTPException(400, "id de dispositivo inválido")
    payload = {k: v for k, v in cmd.model_dump().items() if v is not None}
    if not payload:
        raise HTTPException(400, "comando vacío")
    if "mode" in payload and payload["mode"] not in ("auto", "manual"):
        raise HTTPException(400, "mode debe ser auto o manual")
    for k in ("soil_low", "soil_high"):
        if k in payload and not 0 <= payload[k] <= 100:
            raise HTTPException(400, f"{k} debe estar entre 0 y 100")
    if "interval_s" in payload and not 3 <= payload["interval_s"] <= 86400:
        raise HTTPException(400, "interval_s debe estar entre 3 y 86400")
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


# ----------------------------------------------------------- Suscriptores
HEX = lambda n: re.compile(rf"[0-9a-fA-F]{{{n}}}")


class SubIn(BaseModel):
    imsi: str
    k: Optional[str] = None      # Ki: obligatorio al crear; vacío al editar = no cambiar
    opc: Optional[str] = None
    amf: str = "8000"
    sqn: str = "000000000000"
    msisdn: str = ""
    apn: str = "internet"


def sub_db():
    return MongoClient(MONGO_URI, serverSelectionTimeoutMS=2000).get_default_database()


def sub_check(b: SubIn, creating: bool):
    if not re.fullmatch(r"\d{5,15}", b.imsi):
        raise HTTPException(400, "El IMSI debe tener de 5 a 15 dígitos")
    for name, val, n, req in (("K (Ki)", b.k, 32, creating), ("OPc", b.opc, 32, creating), ("AMF", b.amf, 4, True), ("SQN", b.sqn, 12, True)):
        if not val and not req:
            continue
        if not val or not HEX(n).fullmatch(val):
            raise HTTPException(400, f"{name} debe tener {n} caracteres hexadecimales")
    if b.msisdn and not re.fullmatch(r"\d{3,15}", b.msisdn):
        raise HTTPException(400, "El MSISDN debe tener de 3 a 15 dígitos")
    if not re.fullmatch(r"[A-Za-z0-9._-]{1,63}", b.apn):
        raise HTTPException(400, "APN inválido (letras, números, punto, guion)")


def sub_view(s: dict) -> dict:
    """Nunca devuelve Ki ni OPc."""
    sess = [x for sl in s.get("slice", []) for x in sl.get("session", [])]
    return {"imsi": s["imsi"], "msisdn": (s.get("msisdn") or [""])[0], "apn": [x["name"] for x in sess],
            "amf": s.get("security", {}).get("amf", ""), "created": str(s.get("createdAt", ""))[:19],
            "updated": str(s.get("updatedAt", ""))[:19]}


@app.get("/api/subscribers")
def subs_list():
    try:
        return [sub_view(s) for s in sub_db().subscribers.find({}).sort("imsi", 1)]
    except Exception as e:
        raise HTTPException(503, f"MongoDB: {e}")


@app.post("/api/subscribers")
def subs_create(b: SubIn):
    sub_check(b, True)
    db = sub_db()
    if db.subscribers.find_one({"imsi": b.imsi}):
        raise HTTPException(409, "Ya existe un suscriptor con ese IMSI")
    amb = {"uplink": {"value": 1, "unit": 3}, "downlink": {"value": 1, "unit": 3}}
    now = datetime.now(timezone.utc)
    db.subscribers.insert_one({
        "imsi": b.imsi, "msisdn": [b.msisdn] if b.msisdn else [], "schema_version": 1,
        "subscribed_rau_tau_timer": 12, "network_access_mode": 0, "subscriber_status": 0, "access_restriction_data": 32,
        "security": {"k": b.k.upper(), "amf": b.amf.upper(), "op": None, "opc": b.opc.upper(), "sqn": b.sqn.upper()},
        "ambr": amb,
        "slice": [{"sst": 1, "default_indicator": True, "session": [{
            "name": b.apn, "type": 3,
            "qos": {"index": 9, "arp": {"priority_level": 8, "pre_emption_capability": 1, "pre_emption_vulnerability": 1}},
            "ambr": amb, "pcc_rule": []}]}],
        "createdAt": now, "updatedAt": now})
    broadcast({"type": "subs"})
    return sub_view(db.subscribers.find_one({"imsi": b.imsi}))


@app.put("/api/subscribers/{imsi}")
def subs_update(imsi: str, b: SubIn):
    b.imsi = imsi
    sub_check(b, False)
    db = sub_db()
    if not db.subscribers.find_one({"imsi": imsi}):
        raise HTTPException(404, "No existe ese suscriptor")
    sets = {"msisdn": [b.msisdn] if b.msisdn else [], "security.amf": b.amf.upper(), "slice.0.session.0.name": b.apn,
            "updatedAt": datetime.now(timezone.utc)}
    if b.k:
        sets["security.k"] = b.k.upper()
    if b.opc:
        sets["security.opc"] = b.opc.upper()
        sets["security.op"] = None
    if b.sqn:
        sets["security.sqn"] = b.sqn.upper()
    db.subscribers.update_one({"imsi": imsi}, {"$set": sets})
    broadcast({"type": "subs"})
    return sub_view(db.subscribers.find_one({"imsi": imsi}))


@app.delete("/api/subscribers/{imsi}")
def subs_delete(imsi: str):
    if not re.fullmatch(r"\d{5,15}", imsi):
        raise HTTPException(400, "IMSI inválido")
    r = sub_db().subscribers.delete_one({"imsi": imsi})
    if not r.deleted_count:
        raise HTTPException(404, "No existe ese suscriptor")
    broadcast({"type": "subs"})
    return {"deleted": imsi}


# ------------------------------------------------------------------- eNB
@app.get("/api/enb")
def enb_status():
    """Estado del eNB NB-IoT: contenedor, plan RF y si el MME lo tiene registrado (S1 Setup)."""
    out = {"container": None, "s1_accepted": None, "plan": read_plan(), "lines": []}
    try:
        cl = docker.from_env()
        try:
            c = cl.containers.get(RADIO_CONTAINER)
            out["container"] = c.status
            raw = c.logs(tail=25).decode("utf-8", "replace")
            out["lines"] = ANSI.sub("", raw).splitlines()[-25:]
        except docker.errors.NotFound:
            out["container"] = "no creado"
        try:
            mme = ANSI.sub("", cl.containers.get("nb-mme").logs(tail=400).decode("utf-8", "replace"))
            out["s1_accepted"] = "eNB-S1 accepted" in mme
        except Exception:
            pass
    except Exception as e:
        out["error"] = f"docker: {e}"
    return out


ANSI = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")


@app.get("/api/logs/{name}")
def logs(name: str, tail: int = 80):
    """Últimas líneas del log de un contenedor del proyecto (solo nb-*, solo lectura)."""
    if not re.fullmatch(r"nb-[a-z0-9-]{1,30}", name):
        raise HTTPException(400, "nombre de contenedor inválido")
    try:
        c = docker.from_env().containers.get(name)
        raw = c.logs(tail=max(1, min(tail, 300))).decode("utf-8", "replace")
    except docker.errors.NotFound:
        raise HTTPException(404, "el contenedor no existe")
    except Exception as e:
        raise HTTPException(500, f"docker: {e}")
    return {"name": name, "status": c.status, "lines": ANSI.sub("", raw).splitlines()}



# ------------------------------------------------------ Laboratorio (simlab)
LAB_URL = os.environ.get("LAB_URL", "http://simlab:8090")
LAB_OK = re.compile(r"^(state|events|reset|provision|scenario/(registrar|clon|intruso|baja)|node/(env|ping|firmware)|oai/log)$")
OAI_SCENARIOS = {"scenario/registrar", "scenario/clon", "scenario/intruso"}     # cada uno necesita un arranque nuevo de OAI


def lab_bridge():
    """Reenvía al navegador (SSE) los eventos del simulador. Reintenta si el simulador no está."""
    while True:
        try:
            with urllib.request.urlopen(LAB_URL + "/stream", timeout=40) as r:
                broadcast({"type": "lab_link", "up": True})
                for line in r:
                    if line.startswith(b"data: "):
                        broadcast({"type": "lab", "ev": json.loads(line[6:])})
        except Exception:
            pass
        try:
            broadcast({"type": "lab_link", "up": False})
        except Exception:
            pass
        time.sleep(3)


OAI_LAB_CONTAINER = "nb-oai-lab"


def oai_watchdog():
    """Si OAI se cae solo (SIGSEGV, código 139) mientras el simulador ejecuta un escenario, lo vuelve a arrancar."""
    while True:
        time.sleep(4)
        try:
            c = docker.from_env().containers.get(OAI_LAB_CONTAINER)
            if c.status == "exited" and c.attrs["State"].get("ExitCode") not in (0, 137, 143):
                with urllib.request.urlopen(LAB_URL + "/state", timeout=4) as r:
                    if json.loads(r.read()).get("job"):
                        c.start()
        except Exception:
            pass


@app.post("/api/oai-lab/{action}")
def oai_lab(action: str):
    """Enciende o apaga el eNB de OAI con radio falsa del Laboratorio (no emite RF; no es el eNB real del perfil «radio»)."""
    if action not in ("start", "stop"):
        raise HTTPException(404, "acción desconocida")
    try:
        c = docker.from_env().containers.get(OAI_LAB_CONTAINER)
    except docker.errors.NotFound:
        raise HTTPException(404, f"El contenedor {OAI_LAB_CONTAINER} no existe: docker compose --profile oailab create oai-lab")
    except Exception as e:
        raise HTTPException(500, f"docker: {e}")
    if action == "stop":
        c.stop(timeout=10)
    elif c.status == "running":
        c.restart(timeout=10)       # reinicio: OAI solo conecta un UE simulado por arranque
    else:
        c.start()
    return {"ok": True, "action": action}


@app.get("/api/lab/upstats")
def lab_upstats():
    """Contadores del plano de usuario en el núcleo: interfaz ogstun del PGW-U (UPF). Subida = lo que escribe el UE en el túnel (rx de la interfaz)."""
    try:
        c = docker.from_env().containers.get("nb-pgwu")
        r = c.exec_run(["sh", "-c", "cd /sys/class/net/ogstun/statistics && cat rx_packets rx_bytes tx_packets tx_bytes"])
        v = [int(x) for x in r.output.decode().split()]
        return {"t": time.time(), "up_pkts": v[0], "up_bytes": v[1], "down_pkts": v[2], "down_bytes": v[3]}
    except Exception as e:
        raise HTTPException(500, f"docker: {e}")


@app.get("/api/lab/corelog")
def lab_corelog(since: float, until: float = 0, imsi: str = ""):
    """Lo que registró el núcleo (MME, HSS, SGW-C, PGW-C, PCRF) en una ventana de tiempo, para contrastarlo con el simulador."""
    if imsi and not re.fullmatch(r"\d{5,15}", imsi):
        raise HTTPException(400, "IMSI inválido")
    out = []
    try:
        cl = docker.from_env()
        for name, short in (("nb-mme", "MME"), ("nb-hss", "HSS"), ("nb-sgwc", "SGW-C"), ("nb-pgwc", "PGW-C"), ("nb-pcrf", "PCRF")):
            try:
                c = cl.containers.get(name)
                raw = c.logs(since=int(since) - 1, until=int(until) + 2 if until else None, timestamps=True).decode("utf-8", "replace")
            except Exception:
                continue
            for ln in ANSI.sub("", raw).splitlines():
                ts, _, txt = ln.partition(" ")
                if "epoll" in txt or not txt.strip():
                    continue
                if imsi and imsi not in txt:
                    continue
                out.append({"ts": ts, "c": short, "text": txt.strip()[:260]})
    except Exception as e:
        raise HTTPException(500, f"docker: {e}")
    out.sort(key=lambda x: x["ts"])
    return {"lines": out[-250:]}


@app.api_route("/api/lab/{path:path}", methods=["GET", "POST", "DELETE"])
def lab_proxy(path: str, request: Request):
    """El navegador solo habla con el panel; el panel reenvía al simulador (rutas permitidas)."""
    if not LAB_OK.match(path):
        raise HTTPException(404, "ruta del laboratorio no permitida")
    if path.startswith("scenario/"):      # una sola operación a la vez: se comprueba ANTES de tocar OAI (un doble clic no debe reiniciarlo dos veces)
        try:
            with urllib.request.urlopen(LAB_URL + "/state", timeout=5) as r:
                job = json.loads(r.read()).get("job")
            if job:
                raise HTTPException(409, f"Ya hay una operación en curso: {job}. Espera a que termine.")
        except HTTPException:
            raise
        except Exception:
            pass
    if path in OAI_SCENARIOS:
        oai_lab("start")          # OAI solo conecta un UE por arranque: se reinicia antes de cada registro
    url = f"{LAB_URL}/{path}" + (f"?{request.url.query}" if request.url.query else "")
    req = urllib.request.Request(url, method=request.method, data=b"" if request.method != "GET" else None)
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            raw = r.read() or b"{}"
            if path == "node/firmware":
                return PlainTextResponse(raw.decode())
            return json.loads(raw)
    except urllib.error.HTTPError as e:
        try:
            detail = json.loads(e.read()).get("detail", e.reason)
        except Exception:
            detail = e.reason
        raise HTTPException(e.code, detail)
    except Exception:
        raise HTTPException(503, "El simulador (nb-simlab) no responde. ¿Está levantado? docker compose up -d simlab")


app.mount("/", StaticFiles(directory=Path(__file__).parent / "static", html=True), name="static")
