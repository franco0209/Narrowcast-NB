"""Radio del laboratorio: parámetros de la celda NB-IoT de OAI y un MODELO sencillo de sus consecuencias.

Qué es real y qué es modelo:
- REAL: los parámetros de la celda (banda, DL/UL, ancho de banda, NPRACH, NPDCCH, paging, ganancia) se escriben en el .conf de
  OAI al arrancar el eNB (scripts/oai-lab-start.sh). OAI solo los lee al arrancar: cambiarlos exige reiniciarlo.
- MODELO (este archivo): como la radio es falsa no hay señal que degradar, así que aquí se calcula, con fórmulas simples,
  lo que ocurriría en el aire: pérdida de propagación, nivel de señal (RSRP), nivel de cobertura (CE), repeticiones, tiempo
  en el aire, espera de acceso aleatorio y de paging, y energía. Son aproximaciones didácticas, no mediciones.
La distancia al eNB no es un parámetro de OAI: se aplica al instante y no reinicia nada.
"""
import json
import math
import os
import random
import threading
import time
from pathlib import Path

DATA = Path(os.environ.get("DATA_DIR", "/data"))
CFG_FILE = DATA / "lab-radio.json"             # lo que se quiere (lo escribe el panel)
APPLIED_FILE = DATA / "lab-radio.applied.json"  # lo que OAI cargó al arrancar (lo escribe oai-lab-start.sh)

# Bandas elegibles. dl_ex: portadora de bajada de ejemplo (MHz); ul_off: UL - DL (MHz); earfcn: N_offs-DL + 10·(dl_ex - F_DL_low).
BANDS = {
    3:  {"dl_ex": 1840, "ul_off": -95,  "earfcn": 1550, "dl": "1805-1880"},
    7:  {"dl_ex": 2655, "ul_off": -120, "earfcn": 3100, "dl": "2620-2690"},
    8:  {"dl_ex": 940,  "ul_off": -45,  "earfcn": 3600, "dl": "925-960"},
    20: {"dl_ex": 800,  "ul_off": 41,   "earfcn": 6240, "dl": "791-821"},
    28: {"dl_ex": 780,  "ul_off": -55,  "earfcn": 9430, "dl": "758-803"},
}
# Bandas NB-IoT del SIM7080G según listados de terceros (Waveshare, M5Stack, everythingrf); falta confirmarlas con la hoja de datos de SIMCom.
MODULE_NB_BANDS = {1, 2, 3, 4, 5, 8, 12, 13, 18, 19, 20, 25, 26, 28, 66, 71, 85}
HOST_MHZ = {6: 1.4, 15: 3, 25: 5, 50: 10, 75: 15, 100: 20}          # N_RB_DL → ancho de la portadora LTE anfitriona
CHOICES = {"n_rb_dl": list(HOST_MHZ), "nprach_period": [40, 80, 160, 240, 320, 640, 1280, 2560],
           "npdcch_rep": [1, 2, 4, 8, 16, 32, 64, 128], "paging": [128, 256, 512, 1024]}
OAI_KEYS = ("band", "n_rb_dl", "tx_gain", "nprach_period", "npdcch_rep", "paging")   # los que viven en el .conf de OAI
DEFAULTS = {"band": 3, "n_rb_dl": 50, "tx_gain": 0, "nprach_period": 320, "npdcch_rep": 16, "paging": 256, "distance_m": 100}

# --- constantes del modelo (valores típicos de ejemplo)
PTX_BASE_DBM = 20          # potencia de partida del eNB del laboratorio (clase USRP); la ganancia se suma
PATH_EXP = 3.0             # exponente de pérdida (entorno suburbano)
CE_LIMITS = [(-105.0, 0, 1), (-115.0, 1, 8), (-128.0, 2, 64)]      # (RSRP mínimo dBm, nivel de cobertura, repeticiones)
AIR_MS_PER_REP = 120       # tiempo en el aire de un mensaje corto de subida por cada repetición
TX_POWER_W = 0.8           # consumo del módulo transmitiendo a 23 dBm (~220 mA a 3,6 V): estimación


_lock = threading.Lock()
LAST = {"up_ms": None, "down_ms": None, "up_air_ms": None}      # últimas esperas calculadas (para mostrarlas)


def _read(path):
    try:
        return json.loads(path.read_text())
    except Exception:
        return {}


def clean(d: dict) -> dict:
    """Valida y completa una configuración: solo valores admitidos, el resto vuelve al valor por defecto."""
    out = dict(DEFAULTS)
    for k, v in (d or {}).items():
        if k not in DEFAULTS:
            continue
        try:
            v = float(v) if k in ("tx_gain", "distance_m") else int(v)
        except (TypeError, ValueError):
            continue
        if k == "band" and v in BANDS:
            out[k] = v
        elif k in CHOICES and v in CHOICES[k]:
            out[k] = v
        elif k == "tx_gain":
            out[k] = int(max(0, min(20, v)))
        elif k == "distance_m":
            out[k] = round(max(5.0, min(10000.0, v)), 1)
    return out


def saved() -> dict:
    return clean(_read(CFG_FILE))


def applied() -> dict:
    """Lo que OAI tiene cargado de verdad. Si nunca arrancó con esta función, se asume lo de fábrica."""
    return clean(_read(APPLIED_FILE))


def cell(cfg: dict) -> dict:
    """Valores derivados de la banda: frecuencias y EARFCN, listos para el .conf de OAI."""
    b = BANDS[cfg["band"]]
    return {"dl_mhz": b["dl_ex"], "ul_mhz": b["dl_ex"] + b["ul_off"], "ul_off_hz": b["ul_off"] * 1_000_000, "dl_hz": b["dl_ex"] * 1_000_000,
            "earfcn": b["earfcn"], "dl_range": b["dl"], "host_mhz": HOST_MHZ[cfg["n_rb_dl"]]}


def save(changes: dict) -> dict:
    """Guarda la configuración deseada. Escribe también las frecuencias derivadas para que el arranque de OAI no repita las tablas."""
    with _lock:
        cfg = clean({**saved(), **changes})
        DATA.mkdir(parents=True, exist_ok=True)
        CFG_FILE.write_text(json.dumps({**cfg, **{k: v for k, v in cell(cfg).items() if k in ("dl_hz", "ul_off_hz")}}))
        try:
            os.chmod(CFG_FILE, 0o666)
        except OSError:
            pass
    return cfg


def pending() -> list:
    """Cambios guardados que OAI aún no cargó: [{key, before, after}]."""
    s, a = saved(), applied()
    return [{"key": k, "before": a[k], "after": s[k]} for k in OAI_KEYS if s[k] != a[k]]


# ------------------------------------------------------------------ el modelo
def link(cfg: dict = None, dist: float = None) -> dict:
    """Balance del enlace con lo que OAI TIENE CARGADO y la distancia actual."""
    cfg = cfg or applied()
    dist = dist if dist is not None else saved()["distance_m"]
    f_mhz = BANDS[cfg["band"]]["dl_ex"]
    lam = 299.792458 / f_mhz
    fspl_1m = 20 * math.log10(4 * math.pi / lam)
    pl = fspl_1m + 10 * PATH_EXP * math.log10(max(dist, 1.0))
    ptx = PTX_BASE_DBM + cfg["tx_gain"]
    rsrp = ptx - 10 * math.log10(12) - pl            # potencia por subportadora (la portadora NB-IoT tiene 12)
    rssi = rsrp + 10 * math.log10(12)
    ce, reps = None, 0
    for lim, lvl, r in CE_LIMITS:
        if rsrp >= lim:
            ce, reps = lvl, r
            break
    supported = cfg["band"] in MODULE_NB_BANDS
    csq = 99 if ce is None else int(max(0, min(31, round((rssi + 113) / 2))))
    air_ms = AIR_MS_PER_REP * reps
    return {"band": cfg["band"], "dist_m": round(dist, 1), "freq_mhz": f_mhz, "path_loss_db": round(pl, 1), "ptx_dbm": ptx, "rsrp_dbm": round(rsrp, 1),
            "rssi_dbm": int(round(rssi)), "csq": csq, "ce": ce, "reps": reps, "air_ms": air_ms, "energy_mj": round(air_ms / 1000 * TX_POWER_W * 1000),
            "module_supports": supported, "coverage": ce is not None,
            "ok": supported and ce is not None,
            "why": "" if supported and ce is not None else
                   (f"El módulo SIM7080G no soporta la banda B{cfg['band']} en NB-IoT: no encuentra la celda" if not supported else
                    f"Sin cobertura: RSRP {rsrp:.0f} dBm, por debajo del mínimo ({CE_LIMITS[-1][0]:.0f} dBm) a {dist:.0f} m en B{cfg['band']}")}


def uplink_wait(lk: dict, cfg: dict = None) -> dict:
    """Lo que tarda un mensaje de subida desde que el nodo lo tiene hasta que sale: espera del acceso aleatorio (NPRACH) + repeticiones."""
    cfg = cfg or applied()
    rach = random.uniform(0, cfg["nprach_period"])                 # ms hasta la siguiente oportunidad de preámbulo
    ra_sig = 2 * cfg["npdcch_rep"]                                 # ms de NPDCCH repetido en Msg2 y Msg4
    total = rach + ra_sig + lk["air_ms"]
    LAST.update(up_ms=round(total), up_air_ms=lk["air_ms"])
    return {"rach_ms": round(rach), "ra_sig_ms": ra_sig, "air_ms": lk["air_ms"], "total_ms": round(total)}


def downlink_wait(lk: dict, cfg: dict = None) -> dict:
    """Lo que tarda una orden en llegar al nodo: espera hasta su siguiente ocasión de paging (ciclo de 10 ms × tramas) + repeticiones."""
    cfg = cfg or applied()
    cycle = cfg["paging"] * 10.0
    wait = random.uniform(0, cycle)
    total = wait + lk["air_ms"] + 2 * cfg["npdcch_rep"]
    LAST["down_ms"] = round(total)
    return {"paging_ms": round(wait), "cycle_ms": round(cycle), "air_ms": lk["air_ms"], "total_ms": round(total)}


def snapshot() -> dict:
    s, a = saved(), applied()
    lk = link(a, s["distance_m"])
    return {"saved": s, "applied": a, "pending": pending(), "cell": cell(a), "cell_saved": cell(s), "link": lk, "last": dict(LAST), "choices": {**CHOICES, "band": list(BANDS)},
            "bands": {str(b): {**v, "module": b in MODULE_NB_BANDS} for b, v in BANDS.items()}, "host_mhz": HOST_MHZ, "ce_limits": CE_LIMITS,
            "model": {"ptx_base_dbm": PTX_BASE_DBM, "path_exp": PATH_EXP, "air_ms_per_rep": AIR_MS_PER_REP, "tx_power_w": TX_POWER_W}}
