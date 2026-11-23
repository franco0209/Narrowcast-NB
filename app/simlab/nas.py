"""Motor NAS del terminal (UE): lo que hace el módulo NB-IoT frente a los mensajes del MME.

Implementa el lado del terminal de los procedimientos EMM reales: autenticación mutua con Milenage (RES, MAC-A, resincronización
con AUTS), Security Mode (claves NAS y MAC EIA2) y el Attach Accept protegido. Los mensajes NAS entran y salen por el eNB de
OpenAirInterface (ver oai.py): aquí solo está la lógica del terminal, sin S1AP ni radio.
"""
import socket

from .crypto import auts, eia2, kasme, milenage, nas_key

PLMN, TAC = b"\x00\xf1\x10", b"\x00\x01"      # 001/01 y TAC 1 (los de OAI y el MME)
ATTACH_REJECT = {2: "IMSI desconocido en el HSS", 3: "UE ilegal", 6: "ME ilegal", 7: "servicios EPS no permitidos",
                 8: "servicios EPS y no-EPS no permitidos", 11: "PLMN no permitida (Open5GS la usa, entre otros casos, cuando el HSS no conoce el IMSI)", 12: "área (TA) no permitida",
                 13: "itinerancia no permitida", 15: "sin celdas adecuadas", 19: "fallo ESM", 22: "congestión"}
CAUSE_NAS = {20: "MAC failure", 21: "Synch failure"}


def imsi_id(imsi):
    d = [int(c) for c in imsi]
    odd = len(d) % 2
    b = bytes([(d[0] << 4) | (0x08 if odd else 0) | 1])
    rest = d[1:] + ([] if odd else [0xF])
    for i in range(0, len(rest), 2):
        b += bytes([(rest[i + 1] << 4) | rest[i]])
    return b


class NasUE:
    """Terminal con su SIM (IMSI, K, OPc). Su estado de registro es el del NAS real."""

    def __init__(self, dev_id, imsi, k, opc, bus):
        self.dev, self.imsi, self.bus = dev_id, imsi, bus
        self.k, self.opc = bytes.fromhex(k), bytes.fromhex(opc)
        self.state = "DEREGISTERED"
        self.reason = ""
        self.ip = self.sgw_ip = self.guti = None
        self.ul_teid = 0
        self.keys, self.ul, self.dl, self.ksi = {}, 0, 0, 0
        self.send_imeisv = True      # False: el Security Mode Complete no incluye IMEISV (el MME no manda Masked-IMEISV)
        self.sqn_ms_boost = 0       # >0: la SIM «recuerda» un SQN mayor que el de la red (provoca resincronización)
        self.attach_info = {}

    def ev(self, stage, label, proto="NAS", src="ue", dst="mme", ok=None, **detail):
        self.bus.emit(dev=self.dev, stage=stage, proto=proto, src=src, dst=dst, ok=ok, label=label, detail=detail)

    def set_state(self, st, reason=""):
        self.state, self.reason = st, reason
        self.bus.emit(dev=self.dev, stage="emm_state", proto="NAS", src="ue", dst="ue", ok=None,
                      label=f"Estado de registro: {st}", detail={"estado": st, "motivo": reason})

    def _protect(self, plain, sechdr):
        body = bytes([self.ul & 0xFF]) + plain
        mac = eia2(self.keys["int"], self.ul, 0, body)
        self.ul += 1
        return bytes([(sechdr << 4) | 7]) + mac + body

    def _check_dl(self, raw):
        """Verifica el MAC de un NAS protegido que baja y devuelve el mensaje en claro (EEA0: sin cifrado)."""
        mac, body = raw[1:5], raw[5:]
        ok = eia2(self.keys["int"], self.dl, 1, body) == mac
        self.dl += 1
        return ok, body[1:]

    def _dl_nas(self, raw):
        sec = raw[0] >> 4
        if sec == 0:
            plain = raw
        else:
            if "int" not in self.keys and sec == 3:       # Security Mode Command: calcula claves primero
                return self._smc(raw)
            ok, plain = self._check_dl(raw)
            if not ok:
                self.ev("mac_bad", "Un mensaje NAS protegido llegó con MAC incorrecto", ok=False)
        t = plain[1]
        if t == 0x52:
            return self._auth_req(plain)
        if t == 0x54:
            self.ev("auth_reject", "El núcleo RECHAZA la autenticación (Authentication Reject)", src="mme", dst="ue", ok=False)
            self.set_state("REJECTED", "Authentication Reject")
            return None            # sigue el UEContextRelease del MME
        if t == 0x44:
            cause = plain[2]
            txt = ATTACH_REJECT.get(cause, f"causa {cause}")
            self.ev("attach_reject", f"El núcleo RECHAZA el registro (Attach Reject): {txt}", src="mme", dst="ue", ok=False, causa=cause, motivo=txt)
            self.set_state("REJECTED", txt)
            return None
        if t == 0x5D and sec == 3:
            return self._smc(raw)
        if t == 0x61:
            self.ev("emm_info", "El MME envía el nombre de la red al terminal (EMM Information: «Narrowcast»)", src="mme", dst="ue", ok=True)
            return None
        self.ev("nas_other", f"Mensaje NAS 0x{t:02X} recibido", src="mme", dst="ue", ok=None, hex=plain.hex()[:60])
        return None

    def _auth_req(self, plain):
        self.ksi = plain[2] & 0x0F
        rand, autn = plain[3:19], plain[20:36]
        ml = milenage(self.k, self.opc, rand)
        sqn_net = bytes(a ^ b for a, b in zip(autn[:6], ml["ak"]))
        self.ev("auth_req", "El MME entrega el desafío del HSS (RAND, AUTN): el terminal debe verificar que la red conoce su clave",
                src="mme", dst="ue", RAND=rand.hex(), AUTN=autn.hex(), SQN_red=sqn_net.hex())
        self.set_state("AUTH")
        mac_ok = milenage(self.k, self.opc, rand, sqn=sqn_net, amf=autn[6:8])["mac_a"] == autn[8:16]
        if not mac_ok:
            self.ev("auth_fail_sent", "La SIM NO reconoce a la red (MAC-A no coincide: clave K u OPc distinta): envía Authentication Failure «MAC failure»",
                    src="ue", dst="mme", ok=False, causa="MAC failure")
            self._uplink(bytes([0x07, 0x5C, 0x14]))
            return None
        sqn_int = int.from_bytes(sqn_net, "big")
        if self.sqn_ms_boost and sqn_int <= int.from_bytes(sqn_net, "big") + self.sqn_ms_boost:
            sqn_ms = (sqn_int + self.sqn_ms_boost).to_bytes(6, "big")
            self.sqn_ms_boost = 0
            a = auts(self.k, self.opc, rand, sqn_ms)
            self.ev("auth_sync", "El SQN de la red está atrasado respecto al de la SIM: envía «Synch failure» con AUTS para que el HSS se resincronice",
                    src="ue", dst="mme", ok=False, SQN_SIM=sqn_ms.hex(), SQN_red=sqn_net.hex(), AUTS=a.hex())
            self._uplink(bytes([0x07, 0x5C, 0x15, 0x30, 0x0E]) + a)
            return None
        self.ev("auth_resp", "La red se autenticó correctamente (MAC-A verificado): el terminal devuelve su respuesta RES",
                src="ue", dst="mme", ok=True, RES=ml["res"].hex(), SQN=sqn_net.hex())
        self.keys["kasme"] = kasme(ml["ck"], ml["ik"], PLMN, autn[:6])
        self._uplink(bytes([0x07, 0x53, 0x08]) + ml["res"])
        return None

    def _smc(self, raw):
        body = raw[5:]
        plain = body[1:]
        alg = plain[2]
        self.keys["int"] = nas_key(self.keys["kasme"], 2, alg & 0xF)
        ok = eia2(self.keys["int"], 0, 1, body) == raw[1:5]
        self.dl = 1
        self.set_state("SECURITY")
        self.ev("smc", "El MME fija los algoritmos de seguridad (Security Mode Command) y el terminal verifica su integridad",
                src="mme", dst="ue", ok=ok, cifrado=f"EEA{alg >> 4}", integridad=f"EIA{alg & 0xF}", MAC_verificado=ok)
        imeisv = bytes([0x33, 0x45, 0x78, 0x50, 0x00, 0x10, 0x10, 0x10, 0x00])
        smc_ok = bytes([0x07, 0x5E]) + (bytes([0x23, len(imeisv)]) + imeisv if self.send_imeisv else b"")
        self._uplink(self._protect(smc_ok, 4))
        self.ev("smc_complete", "El terminal confirma (Security Mode Complete)", src="ue", dst="mme", ok=True)
        return None

    def _accept_nas(self, nas):
        """Procesa el Attach Accept protegido que llega dentro del Initial Context Setup Request."""
        ok, plain = self._check_dl(nas)
        e = plain[2:]
        # Attach Accept: resultado, T3412, lista TAI (LV), contenedor ESM (LV-E), IE opcionales
        p = 2
        p += 1 + e[p]
        n = int.from_bytes(e[p:p + 2], "big")
        esm = e[p + 2:p + 2 + n]
        p += 2 + n
        self.guti = None
        while p + 2 <= len(e):
            if e[p] == 0x50:
                self.guti = e[p + 2:p + 2 + e[p + 1]]
                break
            p += 2 + e[p + 1] if e[p] >= 0x20 else 1
        i = 3
        i += 1 + esm[i]
        apn = esm[i + 1:i + 1 + esm[i]]
        i += 1 + esm[i]
        pdn = esm[i + 1:i + 1 + esm[i]]
        self.ip = socket.inet_ntoa(pdn[1:5])
        qci = esm[4]
        self.attach_info = {"ip": self.ip, "apn": apn[1:].decode(errors="replace")}
        self.ev("ics_req", f"El núcleo acepta el registro (Attach Accept) y entrega la IP {self.ip} en el APN «{self.attach_info['apn']}»",
                src="mme", dst="ue", ok=ok, IP=self.ip, APN=self.attach_info["apn"], QCI=qci,
                MAC_verificado=ok)
        return self._finish_attach()
