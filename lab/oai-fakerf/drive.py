"""Conductor: hace de módulo NB-IoT por encima de OAI. Envía NAS al inyector de OAI (UDP 9100) y reacciona a los NAS que
OAI baja desde el MME de Open5GS (los lee del registro de OAI). Reutiliza la lógica NAS del laboratorio (Milenage, EIA2)."""
import json, socket, subprocess, sys, time
sys.path.insert(0, "/home/franco/Documents/Proyectos/Narrowcast-NB/app")
from simlab.bus import Bus
from simlab.s1 import UE, imsi_id

OAI, RNTI, DEV = "10.44.0.43", "101", sys.argv[1] if len(sys.argv) > 1 else "foco-01"
keys = json.load(open("/home/franco/Documents/Proyectos/Narrowcast-NB/data/lab-devices.json"))[DEV]
IMSI = {"foco-01": "001010000010001", "clima-01": "001010000010002", "tanque-01": "001010000010003"}[DEV]
bus = Bus()
u = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
def inject(kind, nas): u.sendto(f"{kind} {RNTI} {nas.hex()}".encode(), (OAI, 9100)); print(f"  >> inyecto {kind} ({len(nas)} B de NAS)", flush=True)

class Enb:   # el «eNB» es OAI; aquí solo hace falta lo que la lógica NAS consulta
    plmn, tac, s1_ok, ues = b"\x00\xf1\x10", b"\x00\x01", True, {}
    def send(self, pdu): print("  (S1AP directo ignorado)")
class Ue(UE):
    def _uplink(self, nas): inject("UT", nas)
ue = Ue(Enb(), DEV, IMSI, keys["k"], keys["opc"], bus)
ue.enb_ue_id = ue.mme_ue_id = 1
ue.send_imeisv = (len(sys.argv) > 3 and sys.argv[3] == 'imeisv')   # por defecto SIN IMEISV; 'imeisv' lo incluye
def show():
    for e in bus.since(show.n): print(f"  [{e['stage']}] {'OK' if e['ok'] else 'FALLA' if e['ok'] is False else ''} {e['label'][:110]}", flush=True); show.n = e["seq"]
show.n = 0

idb = imsi_id(IMSI); esm = bytes([0x02, 0x01, 0xD0, 0x11])
attach = bytes([0x07, 0x41, 0x71, len(idb)]) + idb + bytes([2, 0xE0, 0x60]) + len(esm).to_bytes(2, "big") + esm
tail = subprocess.Popen(["docker", "exec", "oai-dev", "tail", "-n", "0", "-F", "/tmp/oai.log"], stdout=subprocess.PIPE, text=True)
t0 = time.time(); sent = False; wait_s = float(sys.argv[2]) if len(sys.argv) > 2 else 70
ue.set_state("ATTACHING")
while time.time() - t0 < wait_s:
    import select
    r, _, _ = select.select([tail.stdout], [], [], 1.0)
    if not r: continue
    ln = tail.stdout.readline().strip()
    if "Accept new connection" in ln and not sent:
        print("OAI aceptó la conexión RRC; el «módulo» envía RRCConnectionSetupComplete con el Attach Request", flush=True)
        time.sleep(1.0); inject("SC", attach); sent = True
    elif ln.startswith("[NAS-DL]"):
        raw = bytes.fromhex(ln.split()[-1]); print(f"<< OAI baja NAS del MME: {raw.hex()[:60]}…", flush=True)
        try: ue._dl_nas(raw)
        except Exception as e: print("   error al procesar:", e)
        show()
    elif ln.startswith("[ICS-"):
        print("<<", ln[:200], flush=True)
        if ln.startswith("[ICS-NAS]"):
            raw = bytes.fromhex(ln.split()[-1])
            ok, plain = ue._check_dl(raw); print("   Attach Accept protegido, MAC", "OK" if ok else "FALLA", plain.hex()[:40], flush=True)
            inject("UT", ue._protect(bytes([0x07, 0x43, 0x00, 0x03, 0x52, 0x00, 0xC2]), 2))
    elif any(k in ln for k in ("[INJECT]", "InitialUE", "S1AP", "Failed", "error", "ERROR", "unknown", "Attach", "Security", "UECap")):
        print("   OAI:", ln[:170], flush=True)
show()
tail.terminate()
