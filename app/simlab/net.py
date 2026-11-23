"""Plano de usuario del nodo: interfaz TUN <-> relevo de datos del eNB de OAI.

El módulo NB-IoT del nodo recibe una IP del núcleo (10.58.x.x) en el Attach Accept. Esa IP se asigna a la interfaz `simue0` y
una regla de enrutamiento por origen (`ip rule from <ip> lookup 100`) fuerza a que todo lo que salga de esa IP vaya por la TUN.
Con radio real, esos paquetes viajarían por el portador de datos de la interfaz Uu; con la radio falsa de OAI no hay portador,
así que ocupa su lugar un relevo UDP (ver lab/oai-fakerf/inject.c):
  subida  TUN -> UDP OAI:9101 -> GTP-U de OAI -> S1-U -> SGW-U -> PGW-U
  bajada  PGW-U -> SGW-U -> S1-U -> GTP-U de OAI -> UDP :9102 (aquí) -> TUN
Lo que cruza OAI y el núcleo es GTP-U real; lo único simulado es el salto de radio.
"""
import errno
import fcntl
import os
import socket
import struct
import subprocess
import threading
import time

TUNSETIFF, IFF_TUN, IFF_NO_PI = 0x400454CA, 0x0001, 0x1000
IFNAME, TABLE = "simue0", "100"
OAI_HOST = os.environ.get("LAB_OAI_IP", "10.44.0.43")


def sh(*a):
    return subprocess.run(a, capture_output=True, text=True)


class UserPlane:
    def __init__(self, bus, bind_ip="0.0.0.0"):
        self.bus = bus
        self.ips = set()
        self.fd = None
        self.udp = None
        self.ok = False
        self.error = ""
        self.stats = {"tx": 0, "rx": 0}
        self.bind_ip = bind_ip
        self.up_enabled = False       # solo se reenvía mientras hay un dispositivo registrado por OAI

    def start(self):
        try:
            self.fd = os.open("/dev/net/tun", os.O_RDWR)
            fcntl.ioctl(self.fd, TUNSETIFF, struct.pack("16sH", IFNAME.encode(), IFF_TUN | IFF_NO_PI))
            sh("ip", "link", "set", IFNAME, "up")
            sh("ip", "route", "replace", "default", "dev", IFNAME, "table", TABLE)
            self.udp = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            self.udp.bind((self.bind_ip, 9102))
        except Exception as e:
            self.error = f"{type(e).__name__}: {e}"
            return False
        self.ok = True
        threading.Thread(target=self._from_tun, name="tun-rx", daemon=True).start()
        threading.Thread(target=self._from_oai, name="oai-dl", daemon=True).start()
        return True

    def add(self, ip):
        if not self.ok or not ip:
            return
        self.ips.add(ip)
        sh("ip", "addr", "replace", f"{ip}/32", "dev", IFNAME)
        # Linux borra las rutas IPv4 de una interfaz cuando pierde su última dirección: tras liberar al nodo anterior la ruta
        # por defecto de la tabla 100 ya no existe, así que se repone con cada IP nueva.
        sh("ip", "route", "replace", "default", "dev", IFNAME, "table", TABLE)
        sh("ip", "rule", "del", "from", ip, "lookup", TABLE)
        sh("ip", "rule", "add", "from", ip, "lookup", TABLE, "pref", "100")

    def remove(self, ip):
        if not self.ok or not ip:
            return
        self.ips.discard(ip)
        sh("ip", "rule", "del", "from", ip, "lookup", TABLE)
        sh("ip", "addr", "del", f"{ip}/32", "dev", IFNAME)

    # Los dos hilos nunca deben morir: OAI se reinicia entre escenarios y mientras tanto el envío UDP falla («sin ruta», «conexión rechazada»);
    # un error de red solo descarta ese paquete (el protocolo de arriba, TCP, lo retransmite).
    def _from_tun(self):
        while True:
            try:
                pkt = os.read(self.fd, 2048)
            except OSError as e:
                if e.errno in (errno.EBADF, errno.EINVAL):
                    return
                time.sleep(0.05)
                continue
            if len(pkt) < 20 or pkt[0] >> 4 != 4 or socket.inet_ntoa(pkt[12:16]) not in self.ips:
                continue
            try:
                self.udp.sendto(pkt, (OAI_HOST, 9101))
                self.stats["tx"] += 1
            except OSError:
                self.stats["drop"] = self.stats.get("drop", 0) + 1

    def _from_oai(self):
        while True:
            try:
                ip, _ = self.udp.recvfrom(4096)
            except OSError as e:
                if e.errno in (errno.EBADF, errno.ENOTSOCK):
                    return
                time.sleep(0.05)
                continue
            if len(ip) >= 20 and socket.inet_ntoa(ip[16:20]) in self.ips:
                self.stats["rx"] += 1
                try:
                    os.write(self.fd, ip)
                except OSError:
                    pass
