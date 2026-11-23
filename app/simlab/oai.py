"""Registro del nodo a través del eNB REAL de OpenAirInterface (con radio falsa, sin USRP) contra el núcleo Open5GS.

Aquí el «eNB» es el contenedor nb-oai-lab: su MAC, RRC, S1AP y GTP-U son los de OAI. Este módulo hace de módulo NB-IoT por
encima de él: inyecta por UDP (puerto 9100 de OAI, ver lab/oai-fakerf/inject.c) los mensajes RRC de subida con el NAS dentro y
lee del registro de OAI los NAS que baja el MME (líneas [NAS-DL] y [ICS-NAS]). La lógica NAS (Milenage, EIA2) está en nas.py.
Tras el Attach Accept se completa el contexto como lo haría un terminal real (UECapabilityInformation y
RRCConnectionReconfigurationComplete); OAI contesta al MME con la Initial Context Setup Response y se abre el túnel S1-U.
El plano de datos pasa por OAI (GTP-U real); solo el salto de radio (Uu) es simulado: la capa física NB-IoT no se prueba.
"""
import os
import socket
import time
from pathlib import Path

from .nas import NasUE, imsi_id

OAI_HOST = os.environ.get("LAB_OAI_IP", "10.44.0.43")
OAI_LOG = Path(os.environ.get("DATA_DIR", "/data")) / "oai-lab" / "oai.log"
RNTI = "101"
SETTLE_S = 40      # OAI necesita ~40 s tras arrancar antes de aceptar mensajes inyectados: antes, el RRC/PDCP aún se inicializa y se cae (SIGSEGV)
_usados: set = set()      # arranques de OAI que ya atendieron un registro (el acceso aleatorio simulado de OAI conecta un solo UE por arranque)


def _arranque() -> str:
    try:
        with open(OAI_LOG, "rb") as f:
            for _ in range(5):
                ln = f.readline().decode(errors="replace")
                if "eNB arrancando id=" in ln:
                    return ln.split("id=")[1].strip()
    except OSError:
        pass
    return ""


def oai_age() -> float:
    """Segundos desde que arrancó el eNB (0 si no se sabe)."""
    a = _arranque()
    return max(0.0, time.time() - int(a)) if a.isdigit() else 0.0


def oai_running(max_age=15.0) -> bool:
    """OAI vivo = su registro existe y se escribió hace poco (con la radio falsa escribe sin parar)."""
    try:
        return time.time() - OAI_LOG.stat().st_mtime < max_age
    except OSError:
        return False


class OaiUE(NasUE):
    def __init__(self, dev_id, imsi, k, opc, bus, userplane=None):
        super().__init__(dev_id, imsi, k, opc, bus)
        self.up = userplane
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)

    def inject(self, kind, nas):
        self.sock.sendto(f"{kind} {RNTI} {nas.hex()}".encode(), (OAI_HOST, 9100))

    def _uplink(self, nas):
        self.inject("UT", nas)

    def ev(self, stage, label, proto="NAS", src="ue", dst="mme", ok=None, **detail):
        self.bus.emit(dev=self.dev, stage=stage, proto=proto, src=src, dst=dst, ok=ok, label=label, detail=detail)

    def _finish_attach(self):         # la Initial Context Setup Response la envía OAI cuando recibe el RRCConnectionReconfigurationComplete
        return "pending"

    def _complete_attach(self):
        self._uplink(self._protect(bytes([0x07, 0x43, 0x00, 0x03, 0x52, 0x00, 0xC2]), 2))
        self.ev("attach_complete", "El módulo confirma el registro (Attach Complete) y activa la portadora de datos", src="ue", dst="mme", ok=True)
        self.set_state("REGISTERED")
        self.setup_plane()

    def setup_plane(self):
        if self.up and self.ip:
            self.up.add(self.ip)
            self.ev("tunnel_up", f"Portador de datos listo: el módulo ya tiene la IP {self.ip}; sus paquetes salen por OAI (GTP-U hacia el SGW-U)",
                    proto="GTP-U", src="ue", dst="pgw", ok=True, IP=self.ip)

    def teardown_plane(self):
        if self.up and self.ip:
            self.up.remove(self.ip)

    def detach(self):
        """Baja con apagado (Detach Request «switch off»): el MME libera la sesión y no contesta."""
        if self.state != "REGISTERED" or not self.guti:
            return False
        self.ev("detach_req", "El módulo pide darse de baja (Detach Request, apagado): el núcleo libera su sesión de datos", ok=True)
        plain = bytes([0x07, 0x45, 0x09 | (self.ksi << 4), len(self.guti)]) + self.guti
        self._uplink(self._protect(plain, 2))
        time.sleep(0.6)
        self.teardown_plane()
        self.ip = None
        self.set_state("DEREGISTERED", "baja pedida por el módulo")
        return True


def run(bus, dev, k, opc, userplane=None, wait_s=90, _retry=0):
    """Registra al módulo (SIM `dev` con claves k/opc) por OAI. Devuelve el UE (con su estado) para reflejarlo en el panel."""
    def note(stage, label, ok=None, **d):
        bus.emit(dev=dev["id"], stage=stage, proto=d.pop("proto", "OAI"), src=d.pop("src", "enb"), dst=d.pop("dst", "mme"), ok=ok, label=label, detail=d)

    ue = OaiUE(dev["id"], dev["imsi"], k, opc, bus, userplane)
    if not oai_running():
        note("oai_off", "El eNB de OAI no está encendido", ok=False)
        ue.set_state("REJECTED", "OAI apagado")
        return ue
    t0 = time.time()
    while (_arranque() in _usados or not _arranque()) and time.time() - t0 < 25:     # tras un reinicio, esperar el arranque nuevo
        time.sleep(0.5)
    arr = _arranque()
    if arr in _usados:
        note("oai_off", "Este arranque de OAI ya atendió un registro (solo conecta un UE por arranque): hay que reiniciarlo", ok=False)
        ue.set_state("REJECTED", "OAI usado")
        return ue
    _usados.add(arr)
    espera = SETTLE_S - oai_age()
    if espera > 0:
        note("oai_boot", f"OAI está arrancando (inicializa MAC, RRC, PDCP y S1AP): se espera {int(espera)} s antes de usarlo", ok=None, proto="OAI")
        time.sleep(espera)
    bus.emit(dev=dev["id"], stage="scenario_note", proto="OAI", src="ue", dst="ue", ok=None, detail={},
             label="El registro pasa por el eNB REAL de OpenAirInterface (MAC, RRC, S1AP y GTP-U de OAI) con radio falsa: la capa física NB-IoT no se prueba")
    pos = 0                  # el acceso aleatorio simulado ocurre al arrancar OAI: se lee el registro desde el principio
    esm = bytes([0x02, 0x01, 0xD0, 0x11])
    idb = imsi_id(dev["imsi"])
    attach = bytes([0x07, 0x41, 0x71, len(idb)]) + idb + bytes([2, 0xE0, 0x60]) + len(esm).to_bytes(2, "big") + esm
    ue.set_state("ATTACHING")
    ue.ev("attach_req", f"El módulo pide registrarse con su IMSI {dev['imsi']} (Attach Request) a través del eNB de OAI",
          IMSI=dev["imsi"], eNB="OAI (radio falsa)")
    t0, sent, buf, ics_seen, phase = time.time(), False, b"", False, "attach"
    while time.time() - t0 < wait_s:
        with open(OAI_LOG, "rb") as f:
            f.seek(pos)
            buf += f.read()
            pos = f.tell()
        *lines, buf = buf.split(b"\n")
        reiniciado = _arranque() not in ("", arr)          # otro arranque en el registro: OAI se cayó y el panel lo volvió a levantar
        if reiniciado or not lines:
            if reiniciado or not oai_running(12):          # o dejó de escribir el registro: lte-softmodem terminó (a veces se cae)
                note("oai_crash", "OAI se detuvo (lte-softmodem terminó solo) y se reinicia: se reintenta el registro desde cero", ok=False)
                t1 = time.time()
                while time.time() - t1 < 60 and not (oai_running(12) and _arranque() and _arranque() not in _usados):
                    time.sleep(1)
                if _retry < 2 and oai_running(12):
                    ue.set_state("DEREGISTERED")
                    return run(bus, dev, k, opc, userplane, wait_s, _retry + 1)
                ue.set_state("REJECTED", "OAI se detuvo")
                return ue
        if not lines:
            time.sleep(0.4)
            continue
        for raw in lines:
            ln = raw.decode(errors="replace").strip()
            if "Accept new connection" in ln and not sent:
                note("oai_rrc", "OAI completó el acceso aleatorio y el RRC Connection Setup; el módulo entrega el Attach Request dentro del "
                                "RRCConnectionSetupComplete, y OAI lo reenvía al MME por S1AP (InitialUEMessage)", ok=True, proto="RRC", src="ue", dst="enb")
                time.sleep(0.8)
                ue.inject("SC", attach)
                sent = True
            elif ln.startswith("[NAS-DL]"):
                try:
                    ue._dl_nas(bytes.fromhex(ln.split()[-1]))
                except Exception as e:
                    note("oai_error", f"Error al procesar el NAS de bajada: {e}", ok=False)
                if ue.state == "REJECTED":
                    return ue
            elif ln.startswith("[ICS-NAS]") and not ics_seen:
                ics_seen = True
                note("oai_ics", "OAI decodificó el Initial Context Setup Request del MME (incluye el IE Masked-IMEISV que antes hacía fallar al "
                                "decodificador S1AP; corregido en la imagen) y creó el túnel GTP-U hacia el SGW-U", ok=True, proto="S1AP", src="mme", dst="enb")
                ue._accept_nas(bytes.fromhex(ln.split()[-1]))
                ue.inject("UC", b"\x00")
                note("oai_ue_cap", "El módulo entrega sus capacidades (UECapabilityInformation) y OAI responde con RRCConnectionReconfiguration "
                                   "para crear el portador de datos", ok=True, proto="RRC", src="ue", dst="enb")
                phase = "reconf"
            elif phase == "reconf" and "Generate RRCConnectionReconfiguration" in ln:
                time.sleep(0.4)
                ue.inject("RC", b"\x00")
                note("oai_reconf", "El módulo acepta el portador (RRCConnectionReconfigurationComplete)", ok=True, proto="RRC", src="ue", dst="enb")
                phase = "resp"
            elif phase == "resp" and "initial_ctxt_resp" in ln:
                note("oai_ics_resp", "OAI contesta al MME con la Initial Context Setup Response (TEID y dirección del túnel de bajada): "
                                     "el MME ordena al SGW-U abrir el sentido de bajada (Modify Bearer)", ok=True, proto="S1AP", src="enb", dst="mme")
                time.sleep(0.8)
                ue._complete_attach()
                return ue
            elif "Failed to decode PDU" in ln:
                note("oai_decode_fail", f"OAI no pudo decodificar un mensaje S1AP del MME: {ln[:120]}", ok=False, proto="S1AP", src="mme", dst="enb")
    ue.ev("timeout", "El núcleo (vía OAI) no completó el registro a tiempo", ok=False)
    ue.set_state("REJECTED", "sin respuesta")
    return ue
