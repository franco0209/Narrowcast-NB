import { useEffect, useMemo, useRef, useState } from "react";
import { Diagram, DiagramHandle, Focus } from "../components/Diagram";
import { Card, KV, LEG_ALL, Legend, Pill, Seg } from "../components/ui";
import { Stepper } from "../components/Stepper";
import { ENB_EDGES, ENB_INFO, ENB_NODES, LAYERS_DL, LAYERS_UL, START } from "../data/enb";
import { api } from "../lib";
import { anyOnline, cmap, useStore } from "../store";

export default function Enb() {
  const core = useStore((s) => s.core), devices = useStore((s) => s.devices);
  const map = cmap({ core } as any), online = anyOnline({ devices } as any);
  const dg = useRef<DiagramHandle>(null);
  const [sel, setSel] = useState("phy");
  const [flow, setFlow] = useState("dl-user");
  const [focus, setFocus] = useState<Focus | null>(null);
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    const load = () => api("/api/enb").then(setData).catch(() => {});
    load(); const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, []);
  const steps = useMemo(() => (flow === "dl-user" ? LAYERS_DL(true) : flow === "dl-sig" ? LAYERS_DL(false) : LAYERS_UL), [flow]);

  const run = data?.container === "running";
  const up = Object.fromEntries(ENB_NODES.map((n) => [n.id, n.id === "mme" ? map["nb-mme"] === "running" : n.id === "sgwu" ? map["nb-sgwu"] === "running" : n.id === "ue" ? online : run]));
  const live = ENB_EDGES.map(() => !!run);
  const info = ENB_INFO[sel], p = data?.plan || {}, s1 = data?.s1_accepted;
  const plan: [string, string][] = [
    ["Banda", p.band ? "B" + String(p.band).replace(/^[Bb]/, "") : "—"], ["Bajada", p.dl_freq_hz ? (p.dl_freq_hz / 1e6).toFixed(1) + " MHz" : "—"],
    ["Subida", p.ul_freq_hz ? (p.ul_freq_hz / 1e6).toFixed(1) + " MHz" : "—"], ["Ganancia del plan", p.tx_gain ? p.tx_gain + " dB" : "—"],
    ["Ganancia en OAI", p.tx_gain !== "" && p.tx_gain !== undefined ? p.tx_gain + " dB (sin conversión)" : "—"], ["Modo", p.modo || "—"],
    ["Duración máx.", p.duracion_max_s ? p.duracion_max_s + " s" : "—"]];
  const logRef = useRef<HTMLPreElement>(null);
  const logTxt = (data?.lines || []).join("\n") || (data?.container === "no creado" ? "El contenedor no existe: docker compose --profile radio create enb-nbiot" : "(sin registro: el eNB no ha arrancado)");
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [logTxt]);

  return (
    <section id="enb">
      <div className="grid2 wide">
        <Card title="eNB NB-IoT (OpenAirInterface)" sub="Por dentro: de los túneles IP del núcleo a la señal de radio."
          right={<Pill kind={run ? "hot" : "off"}>{run ? "eNB EMITIENDO" : data?.container === "no creado" ? "contenedor no creado" : "eNB detenido"}</Pill>}>
          <Diagram ref={dg} id="enb-svg" className="narrow" nodes={ENB_NODES} edges={ENB_EDGES} w={620} h={560} up={up} live={live} selected={sel} focus={focus} ambient onSelect={setSel} />
          <Legend items={LEG_ALL} />
        </Card>
        <div>
          <Card title="Capa">
            <div className="info">
              <h3>{info.t}</h3><p>{info.d}</p><h4>Se conecta con</h4>
              <ul className="ifl">{ENB_EDGES.filter((e) => e.a === sel || e.b === sel).map((e, i) => {
                const o = e.a === sel ? e.b : e.a;
                return <li key={i}><span className={`dot-k ${e.kind}`} />{e.label && <b>{e.label} </b>}<span className="muted">↔ {ENB_NODES.find((x) => x.id === o)!.label}</span></li>;
              })}</ul>
              <h4>En este proyecto</h4>
              <KV rows={info.cfg} />
            </div>
          </Card>
          <Card title="Recorrido" right={<Seg value={flow} onChange={setFlow} options={[["dl-user", "Bajada · datos"], ["dl-sig", "Bajada · señalización"], ["ul", "Subida"]]} />}>
            <Stepper dg={dg} steps={steps} onFocus={setFocus} />
          </Card>
        </div>
      </div>
      <div className="grid2 wide">
        <Card title="Del botón rojo a la señal">
          <ol className="tl">{START.map((s, i) => (
            <li key={s.k}><span className="n">{i + 1}</span><div><b>{s.t}</b><p className="muted small">{s.d}</p>
              {s.live && <span className={`tag${s1 ? " ok" : ""}`}>{s1 === null || s1 === undefined ? "MME no accesible" : s1 ? "✓ el MME aceptó al eNB (visto en su registro)" : "sin S1 Setup aceptado en el registro del MME"}</span>}</div></li>))}</ol>
        </Card>
        <div>
          <Card title="Parámetros que usa el eNB"><KV rows={plan} /><p className="muted small">Salen del plan RF (módulo Radio) y se aplican al arrancar.</p></Card>
          <Card title="Registro del eNB"><pre ref={logRef} className="log">{logTxt}</pre></Card>
        </div>
      </div>
    </section>
  );
}
