"""Corrección del decodificador S1AP de OAI (generado de ASN.1 R10.5).

Open5GS agrega el IE Masked-IMEISV (id 192, criticidad *ignore*) al Initial Context Setup Request. El decodificador de OAI
no lo conoce y hace `return -1`, con lo que descarta el mensaje completo. El estándar manda omitir los IE desconocidos con
criticidad *ignore*: se cambia ese `return -1` por `break`. Es idempotente y falla (código 1) si el texto esperado no está.
"""
import sys

P = "/opt/oai/cmake_targets/lte_build_oai/build/CMakeFiles/R10.5/s1ap_decoder.c"
KEY = ('Unknown protocol IE id (%d) for message s1ap_initialcontextsetuprequesties\\n", (int)ie_p->id);\n'
       '                return -1;')
NEW = KEY.replace("return -1;", "break; /* IE desconocido con criticidad ignore: se omite (Narrowcast-NB) */")

s = open(P).read()
if "se omite (Narrowcast-NB)" in s:
    print("decodificador S1AP: ya corregido")
elif s.count(KEY) == 1:
    open(P, "w").write(s.replace(KEY, NEW))
    print("decodificador S1AP: corregido")
else:
    sys.exit("no se encontró el fragmento esperado en s1ap_decoder.c (¿cambió el commit de OAI?)")
