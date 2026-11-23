import { useEffect, useRef, useState } from "react";
import { Diagram, DiagramHandle, Focus } from "../components/Diagram";
import { Card, Legend, LEG_ALL, Pill, Seg } from "../components/ui";
import { Stepper } from "../components/Stepper";
import { ATTACH, CORE_EDGES, CORE_INFO, CORE_NODES, CT } from "../data/core";
import { api } from "../lib";
import { anyOnline, cmap, useStore } from "../store";

export default function Nucleo() {
  const core = useStore((s) => s.core), devices = useStore((s) => s.devices);
  const map = cmap({ core } as any), online = anyOnline({ devices } as any);
  const dg = useRef<DiagramHandle>(null);
  const [sel, setSel] = useState("mme");
  const [layer, setLayer] = useState("");
  const [focus, setFocus] = useState<Focus | null>(null);
  const [log, setLog] = useState("cargando…");

  const ctUp = (id: string) => (id === "ue" ? online : (CT[id] || []).some((c) => map[c] === "running"));
  const up = Object.fromEntries(CORE_NODES.map((n) => [n.id, ctUp(n.id)]));
  const live = CORE_EDGES.map((e) => {
    let l = up[e.a] && up[e.b];
    if (e.kind === "user") l = l && online;
    if (e.kind === "radio") l = online && up.enb;
    return !!l;
  });
  const run = CORE_NODES.filter((n) => !n.ext && up[n.id]).length, tot = CORE_NODES.filter((n) => !n.ext).length;

  const n = CORE_NODES.find((x) => x.id === sel)!, info = CORE_INFO[sel];
  const ct = (CT[sel] || []).find((x) => map[x]);
  useEffect(() => {
    if (!ct) return;
    const load = () => api(`/api/logs/${ct}?tail=40`).then((l) => setLog(l.lines.join("\n") || "(sin registro)")).catch(() => {});
    setLog("cargando…"); load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [ct]);

  return (
    <section id="nucleo">
      <Card title="Núcleo de red (EPC · Open5GS)" sub="Haz clic en un componente. Los paquetes animados muestran qué enlaces están activos."
        right={<div className="row"><Seg value={layer} onChange={setLayer} options={[["", "Todo"], ["ctrl", "Señalización"], ["user", "Datos de usuario"]]} />
          <Pill kind={run === tot ? "on" : "off"}>{run}/{tot} componentes activos</Pill></div>}>
        <Diagram ref={dg} id="core-svg" nodes={CORE_NODES} edges={CORE_EDGES} w={960} h={430} up={up} live={live} selected={sel} focus={focus}
          layer={layer || null} ambient onSelect={setSel} />
        <div className="legend"><span><i className="lg ctrl" />señalización</span><span><i className="lg user" />datos de usuario</span><span><i className="lg radio" />radio</span><span className="muted">Líneas continuas = componente activo · atenuado = apagado</span></div>
      </Card>
      <div className="grid2 wide">
        <Card title="Componente">
          <div className="info">
            <h3>{info.t} <Pill kind={ctUp(sel) ? "on" : "off"}>{ctUp(sel) ? "activo" : n.ext ? "externo / inactivo" : "apagado"}</Pill></h3>
            <p>{info.d}</p>
            <h4>Interfaces</h4>
            <ul className="ifl">{CORE_EDGES.filter((e) => e.a === sel || e.b === sel).map((e, i) => {
              const o = e.a === sel ? e.b : e.a;
              return <li key={i}><span className={`dot-k ${e.kind}`} /><b>{e.label}</b> <span className="muted">↔ {CORE_NODES.find((x) => x.id === o)!.label}</span></li>;
            })}</ul>
            <h4>Parámetros reales</h4>
            <table className="kv"><tbody>{info.cfg.map(([k, v]: string[]) => <tr key={k}><th>{k}</th><td>{v}</td></tr>)}</tbody></table>
            {ct && <><h4>Registro en vivo · {ct}</h4><pre className="log">{log}</pre></>}
          </div>
        </Card>
        <Card title="¿Qué pasa cuando el módulo se conecta?">
          <p className="muted small">Procedimiento de registro (attach) y creación de la sesión de datos. Reprodúcelo o avanza paso a paso.</p>
          <Stepper dg={dg} steps={ATTACH} onFocus={setFocus} />
        </Card>
      </div>
    </section>
  );
}
