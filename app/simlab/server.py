"""Laboratorio de simulación: un nodo de riego NB-IoT que se registra en el núcleo Open5GS REAL a través del eNB de OpenAirInterface.

Corre en su propio contenedor (misma imagen que el panel, otro comando y permisos de red). El panel le habla por HTTP y reenvía
sus eventos al navegador. Qué es real y qué simulado: el núcleo, OAI (RRC, S1AP, GTP-U), el NAS (Milenage, EIA2) y el MQTT son
reales; la radio (Uu) es falsa y el ESP32 con sus sensores es un programa que imita el firmware `riego-nbiot.ino`.
"""
import json
import os
import queue
import secrets
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import PlainTextResponse, StreamingResponse
from pymongo import MongoClient

from . import oai, radio
from .bus import Bus
from .net import UserPlane
from .node import IrrigationNode

DATA = Path(os.environ.get("DATA_DIR", "/data"))
KEYS_FILE = DATA / "lab-devices.json"
MONGO_URI = os.environ.get("MONGO_URI", "mongodb://mongo:27017/open5gs")
NODE = {"id": "riego-01", "name": "Nodo de riego inteligente", "imsi": "001010000010001"}
INTRUSO_IMSI = "001010000019999"                       # sin alta en el HSS a propósito
LEGACY_IMSI = ["001010000010002", "001010000010003"]   # SIM de versiones anteriores del laboratorio (se limpian al retirar)

app = FastAPI(title="Narrowcast-NB · simlab")
bus = Bus()
up = UserPlane(bus)
node = IrrigationNode(NODE["id"], NODE["name"], bus, os.environ.get("MQTT_HOST", "mosquitto"), os.environ.get("MQTT_USER", ""), os.environ.get("MQTT_PASS", ""))
S = {"sim": "legitima", "ue": None}                    # SIM que lleva el módulo y su último intento de registro
jobs_lock = threading.Lock()
running_job = {"name": None, "since": None}


# ------------------------------------------------------------------ SIM y alta en el HSS
def load_keys() -> dict:
    try:
        return json.loads(KEYS_FILE.read_text())
    except Exception:
        return {}


def ensure_keys() -> dict:
    keys = load_keys()
    if NODE["id"] not in keys:
        keys[NODE["id"]] = {"k": secrets.token_hex(16).upper(), "opc": secrets.token_hex(16).upper()}
        DATA.mkdir(parents=True, exist_ok=True)
        KEYS_FILE.write_text(json.dumps(keys))
        os.chmod(KEYS_FILE, 0o666)
    return keys


def mongo():
    return MongoClient(MONGO_URI, serverSelectionTimeoutMS=2500).get_default_database()


def hss_has(imsi) -> bool:
    try:
        return mongo().subscribers.find_one({"imsi": imsi}) is not None
    except Exception:
        return False


def provision():
    """Da de alta en el HSS (MongoDB) la SIM legítima del nodo."""
    k = ensure_keys()[NODE["id"]]
    now = datetime.now(timezone.utc)
    amb = {"uplink": {"value": 1, "unit": 3}, "downlink": {"value": 1, "unit": 3}}
    mongo().subscribers.update_one({"imsi": NODE["imsi"]}, {"$set": {
        "imsi": NODE["imsi"], "msisdn": [], "schema_version": 1, "subscribed_rau_tau_timer": 12, "network_access_mode": 0,
        "subscriber_status": 0, "access_restriction_data": 32,
        "security": {"k": k["k"], "amf": "8000", "op": None, "opc": k["opc"], "sqn": "000000000000"},
        "ambr": amb, "slice": [{"sst": 1, "default_indicator": True, "session": [{
            "name": "internet", "type": 3,
            "qos": {"index": 9, "arp": {"priority_level": 8, "pre_emption_capability": 1, "pre_emption_vulnerability": 1}},
            "ambr": amb, "pcc_rule": []}]}], "updatedAt": now}, "$setOnInsert": {"createdAt": now}}, upsert=True)
    bus.emit(stage="provision", proto="DB", src="ue", dst="hss", ok=True, detail={"IMSI": NODE["imsi"]},
             label=f"La SIM del nodo (IMSI {NODE['imsi']}) quedó dada de alta en el HSS (MongoDB)")
    return NODE["imsi"]


def unprovision():
    db, n = mongo(), 0
    for imsi in [NODE["imsi"], *LEGACY_IMSI]:
        n += db.subscribers.delete_one({"imsi": imsi}).deleted_count
    bus.emit(stage="provision", proto="DB", src="ue", dst="hss", ok=None, label=f"Se retiró la SIM del laboratorio del HSS ({n})", detail={})
    return n


@app.on_event("startup")
def startup():
    DATA.mkdir(parents=True, exist_ok=True)
    ensure_keys()
    if not up.start():
        bus.emit(stage="userplane_error", proto="TUN", src="ue", dst="ue", ok=False,
                 label="No se pudo crear la interfaz TUN: el plano de datos real no estará disponible", detail={"error": up.error})


class NoCell:
    """El módulo no encontró una celda utilizable (banda que no soporta o sin cobertura): no llegó a intentar el registro."""
    state, ip = "DEREGISTERED", None

    def __init__(self, reason):
        self.reason = reason


# ------------------------------------------------------------------ escenarios (cada uno usa un arranque nuevo de OAI)
def release_node():
    """Deja al nodo sin sesión (antes de un registro nuevo o al dar de baja)."""
    node.stop(clean=True)
    ue = S["ue"]
    if ue and ue.ip:
        up.remove(ue.ip)
    S["ue"] = None


def register(kind):
    keys = ensure_keys()[NODE["id"]]
    if kind == "legitima":
        dev, k, opc = NODE, keys["k"], keys["opc"]
    elif kind == "clonada":     # el IMSI correcto, pero la clave K de otra SIM
        dev, k, opc = NODE, secrets.token_hex(16), keys["opc"]
    else:                       # un dispositivo ajeno: IMSI que el HSS no conoce
        dev, k, opc = {**NODE, "imsi": INTRUSO_IMSI}, secrets.token_hex(16), secrets.token_hex(16)
    if kind != "intruso" and not hss_has(NODE["imsi"]):
        bus.emit(dev=NODE["id"], stage="oai_error", proto="OAI", src="ue", dst="ue", ok=False,
                 label="La SIM del nodo no está dada de alta en el HSS: pulsa «Preparar» primero", detail={})
        return
    release_node()
    S["sim"] = kind
    node.reset_world()
    node.cfg = node.default_cfg()
    bus.emit(dev=NODE["id"], stage="scenario_note", proto="SIM", src="ue", dst="ue", ok=None, detail={},
             label={"legitima": "SIM legítima: IMSI y clave K iguales a las del HSS", "clonada": "SIM clonada: tiene el IMSI correcto pero una clave K distinta a la del HSS",
                    "intruso": "Dispositivo intruso: su IMSI no está dado de alta en el HSS"}[kind])
    node.modem_boot()
    lk = radio.link()
    bus.emit(dev=NODE["id"], stage="radio_scan", proto="RF", src="ue", dst="enb", ok=lk["ok"], detail=lk,
             label=(f"El módulo busca celda en B{lk['band']} ({lk['freq_mhz']} MHz) a {lk['dist_m']:.0f} m: RSRP {lk['rsrp_dbm']} dBm, nivel de cobertura CE{lk['ce']} (×{lk['reps']} repeticiones)"
                    if lk["ok"] else lk["why"]))
    if not lk["ok"]:
        S["ue"] = NoCell(lk["why"])
        node.modem_registered(None, ok=False, why=lk["why"], searching=True)
        return
    ue = oai.run(bus, dev, k, opc, up)
    S["ue"] = ue
    if ue.state == "REGISTERED":
        node.modem_registered(ue.ip)
        node.start()
    else:
        node.modem_registered(None, ok=False, why=ue.reason)


def sc_baja():
    ue = S["ue"]
    if ue and ue.state == "REGISTERED":
        node.stop(clean=True)
        ue.detach()
        S["ue"] = None
    else:
        release_node()
    bus.emit(dev=NODE["id"], stage="scenario_note", proto="", src="ue", dst="ue", ok=True, label="El nodo quedó dado de baja", detail={})


SCENARIOS = {"registrar": lambda: register("legitima"), "clon": lambda: register("clonada"), "intruso": lambda: register("intruso"), "baja": sc_baja}


def run_job(name, fn, *a):
    def go():
        try:
            fn(*a)
        except Exception as e:
            bus.emit(stage="job_error", proto="", src="ue", dst="ue", ok=False, label=f"Error en «{name}»: {type(e).__name__}: {e}", detail={})
        finally:
            with jobs_lock:
                running_job.update(name=None, since=None)
            bus.emit(stage="job_done", proto="", src="ue", dst="ue", ok=None, label=f"Fin de «{name}»", detail={"job": name})
    with jobs_lock:
        if running_job["name"]:
            raise HTTPException(409, f"Ya hay una operación en curso: {running_job['name']}")
        running_job.update(name=name, since=time.time())
    bus.emit(stage="job_start", proto="", src="ue", dst="ue", ok=None, label=f"Inicio de «{name}»", detail={"job": name})
    threading.Thread(target=go, name=f"job-{name}", daemon=True).start()
    return {"started": name}


# ------------------------------------------------------------------ API
@app.get("/state")
def state():
    ue = S["ue"]
    return {"seq": bus.seq, "job": running_job["name"],
            "oai": {"running": oai.oai_running(), "age": round(oai.oai_age(), 1), "settle_s": oai.SETTLE_S},
            "userplane": {"ok": up.ok, "error": up.error, **up.stats},
            "in_hss": hss_has(NODE["imsi"]), "radio": radio.snapshot(),
            "node": {**node.view(), "imsi": NODE["imsi"] if S["sim"] != "intruso" else INTRUSO_IMSI, "sim": S["sim"],
                     "state": ue.state if ue else "DEREGISTERED", "reason": ue.reason if ue else "", "ip": ue.ip if ue and ue.state == "REGISTERED" else None}}


@app.post("/radio/config")
def api_radio_config(band: int = None, n_rb_dl: int = None, tx_gain: float = None, nprach_period: int = None, npdcch_rep: int = None,
                     paging: int = None, distance_m: float = None):
    """Guarda la radio deseada. La distancia se aplica al instante; el resto queda pendiente hasta «aplicar» (OAI solo lee su .conf al arrancar)."""
    ch = {k: v for k, v in dict(band=band, n_rb_dl=n_rb_dl, tx_gain=tx_gain, nprach_period=nprach_period, npdcch_rep=npdcch_rep, paging=paging, distance_m=distance_m).items() if v is not None}
    radio.save(ch)
    if set(ch) == {"distance_m"}:
        lk = radio.link()
        bus.emit(dev=NODE["id"], stage="radio_link", proto="RF", src="ue", dst="enb", ok=lk["ok"], detail=lk,
                 label=f"El nodo está a {lk['dist_m']:.0f} m del eNB: RSRP {lk['rsrp_dbm']} dBm" + (f", cobertura CE{lk['ce']} (×{lk['reps']})" if lk["coverage"] else ", SIN cobertura"))
    return radio.snapshot()


@app.post("/radio/apply")
def api_radio_apply():
    """El panel reinicia OAI para que cargue la radio guardada; aquí el nodo pierde su sesión (el túnel muere con el eNB)."""
    release_node()
    bus.emit(dev=NODE["id"], stage="scenario_note", proto="RF", src="ue", dst="enb", ok=None, detail={"pendiente": radio.pending()},
             label="Se reinicia el eNB de OAI con la radio nueva: el nodo pierde su sesión y debe registrarse otra vez")
    return radio.snapshot()


@app.post("/provision")
def api_provision():
    try:
        return {"imsi": provision()}
    except Exception as e:
        raise HTTPException(500, f"MongoDB: {e}")


@app.delete("/provision")
def api_unprovision():
    release_node()
    try:
        return {"borrados": unprovision()}
    except Exception as e:
        raise HTTPException(500, f"MongoDB: {e}")


@app.post("/scenario/{name}")
def api_scenario(name: str):
    if name not in SCENARIOS:
        raise HTTPException(404, "escenario desconocido")
    return run_job(name, SCENARIOS[name])


@app.post("/node/env")
def api_env(soil: float = None, temp: float = None, tank: float = None, hand: float = None):
    """El «mundo físico» del nodo: humedad del suelo, temperatura, nivel del tanque y una mano frente al sensor ultrasónico (0 = sin mano)."""
    node.set_world(soil, temp, tank, hand)
    return node.hw_view()


@app.post("/node/ping")
def api_ping(dst: str = "10.44.0.5"):
    if dst not in ("10.44.0.5", "10.58.0.1"):
        raise HTTPException(400, "destino no permitido")
    if not node.ip:
        raise HTTPException(409, "el módulo no tiene sesión de datos")
    return run_job(f"Ping → {dst}", node.ping, dst)


@app.get("/node/firmware", response_class=PlainTextResponse)
def api_firmware():
    return (Path(__file__).parent / "riego-nbiot.ino").read_text()


@app.get("/oai/log")
def api_oai_log(n: int = 60):
    """Últimas líneas relevantes del registro de OAI (RRC, S1AP, GTP-U, NAS y avisos de las pruebas)."""
    import re
    keep = re.compile(r"^\[(RRC|S1AP|NAS-DL|ICS|INJECT|DATA|SCTP|GTPU)")
    ansi = re.compile(r"\x1b\[[0-9;]*m")
    try:
        lines = [ansi.sub("", ln)[:170] for ln in oai.OAI_LOG.read_text(errors="replace").splitlines()[-4000:]]
    except OSError:
        lines = []
    out = [ln for ln in lines if keep.match(ln) and "Found data for descriptor" not in ln and "Received notification" not in ln]
    return {"lines": out[-max(5, min(n, 200)):]}


@app.get("/events")
def api_events(since: int = 0):
    return bus.since(since)


@app.post("/reset")
def api_reset():
    bus.clear()
    return {"ok": True}


@app.get("/stream")
def stream():
    q = bus.subscribe()

    def gen():
        try:
            yield ": hola\n\n"
            while True:
                try:
                    ev = q.get(timeout=15)
                    yield f"data: {json.dumps(ev)}\n\n"
                except queue.Empty:
                    yield ": ping\n\n"
        finally:
            bus.unsubscribe(q)
    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})
