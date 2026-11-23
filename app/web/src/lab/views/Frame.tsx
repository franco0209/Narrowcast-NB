// Marco común de las vistas de detalle: título, botón de volver e interfaces (puertos) hacia las otras partes de la red.
import { motion } from "framer-motion";
import type { ReactNode } from "react";
import type { Part } from "./Overview";

export interface PortDef { label: string; sub: string; kind: "radio" | "ctrl" | "user"; to: Part }
export const PART_NAME: Record<Part, string> = { ue: "UE · nodo de riego", ran: "RAN · OAI", core: "Núcleo · Open5GS" };

export function Frame({ title, sub, left = [], right = [], onBack, onOpen, children }: { title: string; sub: string; left?: PortDef[]; right?: PortDef[]; onBack: () => void; onOpen: (p: Part) => void; children: ReactNode }) {
  const port = (p: PortDef, side: "l" | "r") => (
    <button key={p.label} className={`port-chip ${p.kind} ${side}`} onClick={() => onOpen(p.to)} title={`Ir a ${PART_NAME[p.to]}`}>
      {side === "l" && <i className="arr">◂</i>}
      <span><b>{p.label}</b><small>{p.sub} · {PART_NAME[p.to]}</small></span>
      {side === "r" && <i className="arr">▸</i>}
    </button>
  );
  return (
    <motion.div className="dframe" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.97 }} transition={{ duration: 0.25 }}>
      <div className="dframe-ports l">{left.map((p) => port(p, "l"))}</div>
      <div className="dframe-body">
        <div className="dframe-h">
          <button className="btn secondary sm" onClick={onBack}>‹ Mapa de la red</button>
          <div><h2>{title}</h2><span className="muted small">{sub}</span></div>
          <div className="dframe-nav">{(["ue", "ran", "core"] as Part[]).map((k) => <button key={k} className={`btn secondary sm${title.startsWith(PART_NAME[k].split(" ")[0]) ? " cur" : ""}`} onClick={() => onOpen(k)}>{PART_NAME[k].split(" · ")[0]}</button>)}</div>
        </div>
        {children}
      </div>
      <div className="dframe-ports r">{right.map((p) => port(p, "r"))}</div>
    </motion.div>
  );
}
