// Detalle del núcleo: los servicios de Open5GS que intervienen, el recorrido de cada mensaje y el «celular» (suscriptor MQTT) que da órdenes al nodo.
import { useEffect, useRef, useState } from "react";
import { Diagram, DiagramHandle } from "../../components/Diagram";
import { api } from "../../lib";
import { fail, toast, useStore } from "../../store";
import { LabSnap, NodeSnap } from "../engine";
import { useScene } from "../flow";
import { CT } from "../../data/core";
import { Frame } from "./Frame";
import type { Part } from "./Overview";

const NODES = [
  { id: "s1mme", label: "S1-MME", sub: "desde OAI", x: 0, y: 56, w: 120, h: 46, icon: "ctrl", ext: true },
  { id: "s1u", label: "S1-U", sub: "desde OAI", x: 0, y: 296, w: 120, h: 46, icon: "layers", ext: true },
  { id: "mme", label: "MME", sub: "NAS · movilidad", x: 180, y: 56, w: 130, h: 46, icon: "ctrl" },
  { id: "hss", label: "HSS", sub: "claves e IMSI", x: 360, y: 56, w: 130, h: 46, icon: "key" },
  { id: "mongo", label: "MongoDB", sub: "suscriptores", x: 540, y: 56, w: 130, h: 46, icon: "db" },
  { id: "sgwc", label: "SGW-C", sub: "control del túnel", x: 180, y: 176, w: 130, h: 46, icon: "route" },
  { id: "pgwc", label: "PGW-C / SMF", sub: "sesión e IP", x: 360, y: 176, w: 130, h: 46, icon: "route" },
  { id: "pcrf", label: "PCRF", sub: "políticas", x: 540, y: 176, w: 130, h: 46, icon: "shield" },
  { id: "sgwu", label: "SGW-U", sub: "datos S1-U", x: 180, y: 296, w: 130, h: 46, icon: "layers" },
  { id: "pgwu", label: "PGW-U / UPF", sub: "salida SGi", x: 360, y: 296, w: 130, h: 46, icon: "layers" },
  { id: "mosq", label: "Mosquitto", sub: "broker MQTT", x: 540, y: 296, w: 130, h: 46, icon: "cloud" },
  { id: "phone", label: "Celular", sub: "suscriptor MQTT", x: 540, y: 416, w: 130, h: 46, icon: "ue", ext: true },
];
const EDGES = [
  { a: "s1mme", b: "mme", kind: "ctrl", label: "S1-MME" }, { a: "s1u", b: "sgwu", kind: "user", label: "S1-U" }, { a: "mme", b: "hss", kind: "ctrl", label: "S6a" }, { a: "hss", b: "mongo", kind: "ctrl" },
  { a: "mme", b: "sgwc", kind: "ctrl", label: "S11" }, { a: "sgwc", b: "pgwc", kind: "ctrl", label: "S5-C" }, { a: "pgwc", b: "pcrf", kind: "ctrl", label: "Gx" }, { a: "sgwc", b: "sgwu", kind: "ctrl", label: "PFCP" },
  { a: "pgwc", b: "pgwu", kind: "ctrl", label: "PFCP" }, { a: "sgwu", b: "pgwu", kind: "user", label: "S5-U" }, { a: "pgwu", b: "mosq", kind: "user", label: "SGi" }, { a: "mosq", b: "phone", kind: "user", label: "MQTT" },
];
const rev = (h: string[][]) => [...h].reverse().map(([a, b]) => [b, a]);
const DATA_UP = [["s1u", "sgwu"], ["sgwu", "pgwu"], ["pgwu", "mosq"]];
const FLOWS: Record<string, string[][]> = {
  attach_req: [["s1mme", "mme"]], auth_resp: [["s1mme", "mme"]], auth_fail_sent: [["s1mme", "mme"]], smc_complete: [["s1mme", "mme"]], attach_complete: [["s1mme", "mme"]], detach_req: [["s1mme", "mme"]],
  auth_req: [["mme", "hss"], ["hss", "mongo"], ["mongo", "hss"], ["hss", "mme"], ["mme", "s1mme"]],
  auth_sync: [["s1mme", "mme"], ["mme", "hss"], ["hss", "mongo"], ["mongo", "hss"], ["hss", "mme"]],
  smc: [["mme", "s1mme"]], emm_info: [["mme", "s1mme"]], auth_reject: [["mme", "s1mme"]], attach_reject: [["mme", "s1mme"]],
  ics_req: [["mme", "sgwc"], ["sgwc", "pgwc"], ["pgwc", "pcrf"], ["pcrf", "pgwc"], ["pgwc", "pgwu"], ["pgwc", "sgwc"], ["sgwc", "mme"], ["mme", "s1mme"]],
  oai_ics_resp: [["s1mme", "mme"], ["mme", "sgwc"], ["sgwc", "sgwu"]],
  mqtt_connect: DATA_UP, ping_tx: DATA_UP, mqtt_pub: [...DATA_UP, ["mosq", "phone"]], mqtt_rx: [["phone", "mosq"], ...rev(DATA_UP)], ping_rx: rev(DATA_UP),
};
const EXPLAIN: Record<string, string> = {
  attach_req: "El MME recibe el Attach Request (S1AP) y toma el IMSI. Si el HSS no lo conoce, lo rechazará aquí.",
  auth_req: "El MME pide al HSS un vector de autenticación (S6a). El HSS lee K, OPc y SQN de MongoDB y calcula RAND/AUTN/XRES con Milenage.",
  auth_resp: "El MME compara la respuesta (RES) con la esperada (XRES): si coinciden, el módulo es quien dice ser.",
  auth_fail_sent: "La SIM no reconoció a la red (MAC failure). El MME cancelará el registro.",
  smc: "El MME elige integridad EIA2 y cifrado EEA0 y deriva las claves NAS a partir de KASME.",
  ics_req: "El MME crea la sesión: SGW-C → PGW-C/SMF (IP del módulo, políticas del PCRF) y PFCP programa SGW-U y PGW-U. Luego manda el Initial Context Setup Request a OAI.",
  oai_ics_resp: "Con la respuesta de OAI, el MME pide al SGW-C el Modify Bearer: el SGW-U aprende el TEID del eNB y abre el sentido de bajada.",
  attach_complete: "El módulo confirmó. El registro está completo: hay IP y túnel.",
  mqtt_pub: "El paquete del módulo entra por S1-U, el SGW-U lo pasa al PGW-U (S5-U), sale por SGi hacia Mosquitto y el celular suscrito recibe la telemetría.",
  mqtt_rx: "La orden del celular entra a Mosquitto y baja por PGW-U → SGW-U → S1-U hasta OAI y el módulo.",
};

function Phone({ node }: { node: NodeSnap }) {
  const t = useStore((s) => s.devices[node.id])?.last || {};
  const [low, setLow] = useState<number | null>(null), [high, setHigh] = useState<number | null>(null);
  const send = (body: any, msg: string) => api(`/api/devices/${node.id}/cmd`, { method: "POST", body: JSON.stringify(body) }).then(() => toast(msg, "ok")).catch(fail);
  const online = node.mqtt && node.state === "REGISTERED", manual = t.mode === "manual";
  const f = (v: any, u = "") => (v === undefined || v === null ? "—" : `${v}${u}`);
  return (
    <div className="phone" aria-label="Celular con la app de riego (suscriptor MQTT)">
      <div className="ph-notch" />
      <div className="ph-screen">
        <div className="ph-top"><b>Mi riego</b><span className={`ph-dot${online ? " on" : ""}`} /></div>
        <div className="ph-sub">{node.id} · {online ? "en línea" : "sin conexión"}</div>
        <div className="ph-tiles">
          <div><small>Suelo</small><b>{f(t.soil, " %")}</b></div><div><small>Tanque</small><b>{f(t.tank, " %")}</b></div>
          <div><small>Temp.</small><b>{f(t.temp, " °C")}</b></div><div><small>Bomba</small><b className={t.pump ? "ok-t" : ""}>{t.pump ? "ENCENDIDA" : "apagada"}</b></div>
        </div>
        {t.alarm ? <div className="ph-alarm">⚠ alarma en el nodo</div> : null}
        <div className="ph-seg"><button disabled={!online} className={!manual ? "sel" : ""} onClick={() => send({ mode: "auto" }, "Modo automático enviado")}>Automático</button>
          <button disabled={!online} className={manual ? "sel" : ""} onClick={() => send({ mode: "manual" }, "Modo manual enviado")}>Manual</button></div>
        <button className="ph-btn" disabled={!online || !manual} onClick={() => send({ pump: !t.pump }, t.pump ? "Orden: apagar bomba" : "Orden: encender bomba")}>{t.pump ? "Apagar bomba" : "Encender bomba"}</button>
        <label className="ph-l">Riega bajo <b>{low ?? node.cfg.soil_low} %</b><input type="range" min={5} max={60} disabled={!online} value={low ?? node.cfg.soil_low} onChange={(e) => setLow(+e.target.value)} onPointerUp={() => { if (low !== null) send({ soil_low: low }, "Umbral enviado"); setLow(null); }} /></label>
        <label className="ph-l">Detiene sobre <b>{high ?? node.cfg.soil_high} %</b><input type="range" min={40} max={95} disabled={!online} value={high ?? node.cfg.soil_high} onChange={(e) => setHigh(+e.target.value)} onPointerUp={() => { if (high !== null) send({ soil_high: high }, "Umbral enviado"); setHigh(null); }} /></label>
        <div className="ph-foot">MQTT · nb/{node.id}/cmd</div>
      </div>
    </div>
  );
}

export default function CoreView({ node, snap, onBack, onOpen }: { node: NodeSnap; snap: LabSnap; onBack: () => void; onOpen: (p: Part) => void }) {
  const dg = useRef<DiagramHandle>(null);
  const core = useStore((s) => s.core);
  const [expl, setExpl] = useState("Registra el nodo y cada mensaje recorrerá los servicios de Open5GS aquí.");
  const [lines, setLines] = useState<string[]>([]);
  useScene(async (ev, ms, fast) => {
    const hops = FLOWS[ev.stage];
    if (!hops) return;
    if (EXPLAIN[ev.stage]) setExpl(EXPLAIN[ev.stage]);
    if (!fast) await dg.current?.path(hops, ev.ok === false ? "var(--bad)" : null, ms(520) * 0.85);
  });
  useEffect(() => {
    const load = () => api(`/api/lab/corelog?since=${Date.now() / 1000 - 120}&imsi=${node.imsi}`).then((r) => setLines(r.lines.slice(-30).map((l: any) => `${l.c.padEnd(6)} ${l.text.replace(/\(\.\.\/[^)]*\)/, "")}`))).catch(() => {});
    load(); const t = setInterval(load, 3500); return () => clearInterval(t);
  }, [node.imsi]);
  const m = Object.fromEntries(core.containers.map((c: any) => [c.name, c.status]));
  const upId = (id: string) => id === "phone" ? node.mqtt : id === "s1mme" || id === "s1u" ? !!snap.st?.oai.running : (CT[id === "mosq" ? "data" : id] || []).some((c) => m[c] === "running");
  const up = Object.fromEntries(NODES.map((n) => [n.id, upId(n.id)]));
  const live = EDGES.map((e) => !!(up[e.a] && up[e.b]));
  const running = ["mme", "hss", "mongo", "sgwc", "pgwc", "pcrf", "sgwu", "pgwu", "mosq"].filter((i) => up[i]).length;
  const logRef = useRef<HTMLPreElement>(null);
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [lines]);
  return (
    <Frame title="Núcleo · Open5GS (EPC)" sub="Los servicios que registran al nodo, le dan IP y llevan sus datos" onBack={onBack} onOpen={onOpen}
      left={[{ label: "S1-MME", sub: "señalización SCTP", kind: "ctrl", to: "ran" }, { label: "S1-U", sub: "datos GTP-U", kind: "user", to: "ran" }]}>
      <div className="core-grid">
        <div className="card">
          <div className="card-h"><div><h2>Servicios que intervienen</h2><span className="muted small">Estado real de los contenedores</span></div><span className={`pill ${running === 9 ? "on" : "off"}`}><span className="dot" />{running}/9 activos</span></div>
          <Diagram ref={dg} id="lab-core-svg" nodes={NODES} edges={EDGES} w={680} h={478} up={up} live={live} />
          <div className="legend"><span><i className="lg ctrl" />señalización</span><span><i className="lg user" />datos de usuario</span></div>
          <p className="ran-expl">{expl}</p>
          <div className="card-h" style={{ marginTop: 6 }}><h2>Registro real del núcleo</h2><span className="muted small">líneas del IMSI {node.imsi} (últimos 2 min)</span></div>
          <pre ref={logRef} className="log">{lines.join("\n") || "(el núcleo no ha escrito nada sobre este IMSI todavía)"}</pre>
        </div>
        <div className="card phone-card"><div className="card-h"><div><h2>Celular · suscriptor MQTT</h2><span className="muted small">Da órdenes al nodo y ve su información, a través del broker</span></div></div><Phone node={node} /></div>
      </div>
    </Frame>
  );
}
