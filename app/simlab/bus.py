"""Bus de eventos del simulador: guarda la traza del flujo y la reparte a quien esté suscrito (SSE)."""
import queue
import threading
import time
from collections import deque


class Bus:
    def __init__(self, maxlen=3000):
        self.events = deque(maxlen=maxlen)
        self.subs = set()
        self.seq = 0
        self.lock = threading.Lock()

    def emit(self, stage, label="", proto="", src="", dst="", ok=None, dev=None, detail=None):
        with self.lock:
            self.seq += 1
            ev = {"seq": self.seq, "t": round(time.time(), 3), "dev": dev, "stage": stage, "proto": proto,
                  "src": src, "dst": dst, "ok": ok, "label": label, "detail": detail or {}}
            self.events.append(ev)
            subs = list(self.subs)
        for q in subs:
            q.put(ev)
        return ev

    def since(self, seq=0):
        with self.lock:
            return [e for e in self.events if e["seq"] > seq]

    def subscribe(self):
        q = queue.Queue(maxsize=5000)
        with self.lock:
            self.subs.add(q)
        return q

    def unsubscribe(self, q):
        with self.lock:
            self.subs.discard(q)

    def clear(self):
        with self.lock:
            self.events.clear()
