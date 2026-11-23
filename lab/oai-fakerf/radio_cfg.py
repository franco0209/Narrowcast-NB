"""Escribe en el .conf de OAI la radio elegida en el panel (/data/lab-radio.json). Lo lanza scripts/oai-lab-start.sh en cada arranque.

OAI solo lee su .conf al arrancar. Lo que queda cargado se copia a /data/lab-radio.applied.json para que el panel distinga lo
«guardado» de lo «aplicado». Sin archivo se usan los valores de fábrica. Imprime las variables de entorno que necesita el eNB.
"""
import json
import re

d = dict(band=3, n_rb_dl=50, tx_gain=0, nprach_period=320, npdcch_rep=16, paging=256, dl_hz=1840000000, ul_off_hz=-95000000)
try:
    d.update(json.load(open("/data/lab-radio.json")))
except Exception:
    pass
conf = open("/tmp/enb.conf").read()


def put(key, val):
    global conf
    conf = re.sub(r"(^\s*%s\s*=\s*)[^;#\n]*" % key, lambda m: m.group(1) + str(val), conf, count=1, flags=re.M)


put("eutra_band", "%d" % d["band"])
put("downlink_frequency", "%dL" % d["dl_hz"])
put("uplink_frequency_offset", "%d" % d["ul_off_hz"])
put("N_RB_DL", "%d" % d["n_rb_dl"])
put("tx_gain", "%d" % d["tx_gain"])
put("nprach_Periodicity", "%d" % d["nprach_period"])
put("npdcch_NumRepetitions_RA", "%d" % d["npdcch_rep"])
put("pcch_defaultPagingCycle_NB", "%d" % d["paging"])
open("/tmp/enb.conf", "w").write(conf)
json.dump(d, open("/data/lab-radio.applied.json", "w"))
print("export OAI_UE_BAND=%d" % d["band"])
