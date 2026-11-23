"""Criptografía del UE simulado: Milenage (3GPP TS 35.206), derivación de claves LTE (TS 33.401) y EIA2 (AES-CMAC)."""
import hmac, hashlib
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives.cmac import CMAC

def _aes(k, b):
    e = Cipher(algorithms.AES(k), modes.ECB()).encryptor()
    return e.update(b) + e.finalize()

def _x(a, b): return bytes(i ^ j for i, j in zip(a, b))
def _rot(b, r): r //= 8; return b[r:] + b[:r]
_C = [bytes(15) + bytes([v]) for v in (0, 1, 2, 4, 8)]

def milenage(k, opc, rand, sqn=bytes(6), amf=b"\x80\x00"):
    temp = _aes(k, _x(rand, opc))
    in1 = sqn + amf + sqn + amf
    out1 = _x(_aes(k, _x(_x(temp, _rot(_x(in1, opc), 64)), _C[0])), opc)
    def f(r, c): return _x(_aes(k, _x(_rot(_x(temp, opc), r), c)), opc)
    out2 = f(0, _C[1]); out3 = f(32, _C[2]); out4 = f(64, _C[3]); out5 = f(96, _C[4])
    return dict(mac_a=out1[:8], mac_s=out1[8:], res=out2[8:], ak=out2[:6], ck=out3, ik=out4, akstar=out5[:6])

def kdf(key, fc, params):
    s = bytes([fc])
    for p in params: s += p + len(p).to_bytes(2, "big")
    return hmac.new(key, s, hashlib.sha256).digest()

def kasme(ck, ik, plmn3, sqn_xor_ak): return kdf(ck + ik, 0x10, [plmn3, sqn_xor_ak])
def nas_key(kas, dist, alg): return kdf(kas, 0x15, [bytes([dist]), bytes([alg])])[16:]

def eia2(key, count, direction, msg):
    m = count.to_bytes(4, "big") + bytes([(0 << 3) | (direction << 2), 0, 0, 0]) + msg
    c = CMAC(algorithms.AES(key)); c.update(m); return c.finalize()[:4]


def auts(k, opc, rand, sqn_ms):
    """AUTS para el fallo de sincronización: (SQNms xor AK*) || MAC-S (AMF = 0000 por norma)."""
    m = milenage(k, opc, rand, sqn=sqn_ms, amf=b"\x00\x00")
    return _x(sqn_ms, m["akstar"]) + m["mac_s"]
