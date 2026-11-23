import { useEffect, useState } from "react";
import { Diagram } from "../components/Diagram";
import { Card, Legend, LEG_ALL, Pill } from "../components/ui";
import { EDGES, EDGE_OBJS, ICON_OF, NODES, nodeBy } from "../data/topo";
import { api } from "../lib";
import { anyOnline, cmap, useStore } from "../store";

const DNODES = NODES.map((n) => ({ id: n.id, label: n.label, sub: n.sub, x: n.x, y: n.y, w: 140, h: 48, icon: ICON_OF[n.id], ext: n.id === "dev" }));

export default function Resumen() {
  const core = useStore((s) => s.core), devices = useStore((s) => s.devices), radio = useStore((s) => s.radio);
  const [sel, setSel] = useState<string | null>(null);
  const [log, setLog] = useState<string | null>(null);
  const map = cmap({ core } as any), online = anyOnline({ devices } as any);

  const nodeUp = (n: any) => (n.id === "dev" ? online : (n.ct || []).some((c: string) => map[c] === "running"));
  const up = Object.fromEntries(NODES.map((n) => [n.id, nodeUp(n)]));
  const live = EDGES.map(([a, b, kind]) => {
    let l = up[a] && up[b];
    if (kind === "user") l = l && online;
    if (kind === "radio") l = online && up.enb;
    return !!l;
  });

  const total = core.containers.length, run = core.containers.filter((c: any) => c.status === "running").length;
  const onl = Object.entries(devices).filter(([, d]) => d.online);
  const last = onl.map(([, d]) => d.seen as number).sort().pop();
  const kpis: [any, string, string][] = [
    [`${run}/${total || "-"}`, "contenedores activos", total && run === total ? "ok" : "warn"],
    [core.subscribers.length, "suscriptores (SIM)", ""],
    [radio.running ? "EMITIENDO" : "apagada", "radiofrecuencia", radio.running ? "bad" : "ok"],
    [onl.length ? onl.map(([i]) => i).join(", ") : "ninguno", "dispositivo en línea", onl.length ? "ok" : ""],
    [last ? `hace ${Math.round(Date.now() / 1000 - last)} s` : "-", "último dato", ""],
  ];

  const n = sel ? nodeBy[sel] : null;
  const realCt = n && (n.ct || []).find((c: string) => map[c]);
  useEffect(() => {
    setLog(null);
    if (!realCt) return;
    let alive = true;
    api(`/api/logs/${realCt}?tail=14`).then((l) => alive && setLog(l.lines.join("\n") || "(sin registro)")).catch(() => {});
    return () => { alive = false; };
  }, [sel, realCt]);

  return (
    <>
      <div className="kpis">{kpis.map(([b, s, c]) => <div key={s} className={`kpi ${c}`}><b>{b}</b><span>{s}</span></div>)}</div>
      <Card title="Mapa de la red" right={<Legend items={LEG_ALL} />} className="topo-card">
        <Diagram id="topo" nodes={DNODES} edges={EDGE_OBJS} w={960} h={400} up={up} live={live} selected={sel} onSelect={setSel} ambient />
        <div className="node-info">
          {!n ? <p className="muted">Haz clic en un elemento del mapa para ver qué hace, con qué se conecta y su registro.</p> : (
            <>
              <h3>{n.label} <Pill kind={up[n.id] ? "on" : "off"}>{up[n.id] ? "activo" : "apagado"}</Pill></h3>
              <p>{n.info}</p>
              <div>{(n.links || []).map((l: string) => <span key={l} className="tag">{l}</span>)}{n.ip && <span className="tag">IP {n.ip}</span>}</div>
              {realCt && log !== null && <pre className="log">{log}</pre>}
            </>
          )}
        </div>
      </Card>
    </>
  );
}
