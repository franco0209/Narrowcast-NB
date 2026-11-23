// Detalle de la RAN: el eNB de OpenAirInterface por dentro (S1AP, RRC, PDCP, RLC, MAC, PHY, GTP-U) con el recorrido de cada mensaje real.
import { useEffect, useRef, useState } from "react";
import { Diagram, DiagramHandle } from "../../components/Diagram";
import { api } from "../../lib";
import { labEngine, LabSnap, NodeSnap } from "../engine";
import { useScene } from "../flow";
import { Tower } from "../art";
import { Frame } from "./Frame";
import type { Part } from "./Overview";

const NODES = [
  { id: "s1mme", label: "S1-MME", sub: "SCTP 36412 → MME", x: 190, y: 0, w: 140, h: 46, icon: "ctrl", ext: true },
  { id: "s1u", label: "S1-U", sub: "GTP-U 2152 → SGW-U", x: 350, y: 0, w: 140, h: 46, icon: "layers", ext: true },
  { id: "s1ap", label: "S1AP / SCTP", sub: "con el MME", x: 190, y: 76, w: 140, h: 46, icon: "doc" },
  { id: "gtpu", label: "GTP-U / UDP", sub: "túnel de datos", x: 350, y: 76, w: 140, h: 46, icon: "layers" },
  { id: "rrc", label: "RRC", sub: "conexión y NAS", x: 190, y: 152, w: 140, h: 46, icon: "ctrl" },
  { id: "pdcp", label: "PDCP", sub: "numeración y seguridad", x: 190, y: 228, w: 300, h: 46, icon: "layers" },
  { id: "rlc", label: "RLC", sub: "segmentación y reenvío", x: 190, y: 304, w: 300, h: 46, icon: "layers" },
  { id: "mac", label: "MAC", sub: "acceso aleatorio · planificador", x: 190, y: 380, w: 300, h: 46, icon: "layers" },
  { id: "phy", label: "PHY NB-IoT (radio falsa)", sub: "no emite RF: la señal no existe", x: 190, y: 456, w: 300, h: 50, icon: "pulse" },
  { id: "uu", label: "Uu", sub: "módulo del nodo", x: 0, y: 458, w: 150, h: 46, icon: "ue", ext: true },
];
const EDGES = [
  { a: "s1mme", b: "s1ap", kind: "ctrl", label: "" }, { a: "s1u", b: "gtpu", kind: "user" }, { a: "s1ap", b: "rrc", kind: "ctrl" }, { a: "rrc", b: "pdcp", kind: "ctrl" },
  { a: "gtpu", b: "pdcp", kind: "user" }, { a: "pdcp", b: "rlc", kind: "user" }, { a: "rlc", b: "mac", kind: "user" }, { a: "mac", b: "phy", kind: "user" }, { a: "phy", b: "uu", kind: "radio", label: "Uu" },
];
const UL = [["uu", "phy"], ["phy", "mac"], ["mac", "rlc"], ["rlc", "pdcp"], ["pdcp", "rrc"]], TO_MME = [["rrc", "s1ap"], ["s1ap", "s1mme"]];
const rev = (h: string[][]) => [...h].reverse().map(([a, b]) => [b, a]);
const UL_SIG = [...UL, ...TO_MME], DL_SIG = rev(UL_SIG);
const DATA_UL = [["uu", "phy"], ["phy", "mac"], ["mac", "rlc"], ["rlc", "pdcp"], ["pdcp", "gtpu"], ["gtpu", "s1u"]], DATA_DL = rev(DATA_UL);
const FLOWS: Record<string, string[][]> = {
  attach_req: UL_SIG, auth_resp: UL_SIG, auth_fail_sent: UL_SIG, auth_sync: UL_SIG, smc_complete: UL_SIG, attach_complete: UL_SIG, detach_req: UL_SIG,
  oai_ue_cap: UL, oai_reconf: UL, oai_ics_resp: [["rrc", "s1ap"], ["s1ap", "s1mme"]],
  auth_req: DL_SIG, smc: DL_SIG, ics_req: DL_SIG, attach_reject: DL_SIG, auth_reject: DL_SIG, emm_info: DL_SIG,
  mqtt_pub: DATA_UL, mqtt_connect: DATA_UL, ping_tx: DATA_UL, mqtt_rx: DATA_DL, ping_rx: DATA_DL,
};
const EXPLAIN: Record<string, string> = {
  attach_req: "El Attach Request llega dentro del RRCConnectionSetupComplete. RRC lo toma y S1AP lo envía al MME como Initial UE Message.",
  auth_req: "El MME manda el desafío de autenticación en un Downlink NAS Transport. OAI lo recibe por S1AP y RRC lo reenvía al módulo en un DLInformationTransfer.",
  auth_resp: "La respuesta del módulo sube por RRC (ULInformationTransfer) y S1AP la entrega al MME como Uplink NAS Transport.",
  smc: "Security Mode Command del MME: OAI no interpreta el NAS, solo lo transporta hacia el módulo.",
  smc_complete: "El módulo confirma la seguridad NAS; OAI lo sube al MME.",
  ics_req: "Initial Context Setup Request: OAI decodifica el mensaje (corregido el IE Masked-IMEISV), crea el túnel GTP-U hacia el SGW-U y entrega el Attach Accept al módulo.",
  oai_ue_cap: "El módulo informa sus capacidades (UECapabilityInformation) y RRC responde con una RRCConnectionReconfiguration que crea el portador de datos.",
  oai_reconf: "RRCConnectionReconfigurationComplete: el portador de datos queda activo en OAI.",
  oai_ics_resp: "OAI contesta al MME con la Initial Context Setup Response (TEID y dirección del túnel de bajada). El MME ordena al SGW-U abrir el sentido de bajada.",
  attach_complete: "Attach Complete: el módulo confirma que ya tiene su IP y su portador por defecto.",
  mqtt_pub: "Un paquete IP del módulo (MQTT) entra por el relevo de pruebas hacia PDCP, GTP-U lo encapsula y sale por S1-U al SGW-U. Con radio real vendría de PHY/MAC/RLC.",
  mqtt_rx: "Un paquete de bajada llega por S1-U, GTP-U lo desencapsula y OAI lo reenvía al módulo (con radio real pasaría por PDCP/RLC/MAC/PHY).",
};

export default function RANView({ node, snap, onBack, onOpen }: { node: NodeSnap; snap: LabSnap; onBack: () => void; onOpen: (p: Part) => void }) {
  const dg = useRef<DiagramHandle>(null);
  const [expl, setExpl] = useState("Registra el nodo y cada mensaje recorrerá las capas de OAI aquí.");
  const [log, setLog] = useState<string[]>([]);
  useScene(async (ev, ms, fast) => {
    const hops = FLOWS[ev.stage];
    if (!hops) return;
    if (EXPLAIN[ev.stage]) setExpl(EXPLAIN[ev.stage]);
    if (!fast) await dg.current?.path(hops, ev.ok === false ? "var(--bad)" : null, ms(520) * 0.85);
  });
  useEffect(() => {
    const load = () => api("/api/lab/oai/log?n=70").then((r) => setLog(r.lines)).catch(() => {});
    load(); const t = setInterval(load, 2500); return () => clearInterval(t);
  }, []);
  const logRef = useRef<HTMLPreElement>(null);
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [log]);
  const st = snap.st, on = node.state === "REGISTERED", up = Object.fromEntries(NODES.map((n) => [n.id, !!st?.oai.running]));
  const live = EDGES.map(() => !!st?.oai.running);
  return (
    <Frame title="RAN · eNB de OpenAirInterface" sub="Así procesa OAI cada mensaje: de la radio (Uu) al núcleo (S1)" onBack={onBack} onOpen={onOpen}
      left={[{ label: "Uu", sub: "radio NB-IoT", kind: "radio", to: "ue" }]}
      right={[{ label: "S1-MME", sub: "señalización SCTP", kind: "ctrl", to: "core" }, { label: "S1-U", sub: "datos GTP-U", kind: "user", to: "core" }]}>
      <div className="ran-grid">
        <div className="card">
          <div className="card-h"><div><h2>Pila del eNB</h2><span className="muted small">10.44.0.43 · imagen con la corrección del decodificador S1AP</span></div>
            <span className={`pill ${st?.oai.running ? "on" : "off"}`}><span className="dot" />{st?.oai.running ? "OAI encendido" : "OAI apagado"}</span></div>
          <div className="ran-diag"><Diagram ref={dg} id="ran-svg" className="narrow" nodes={NODES} edges={EDGES} w={500} h={510} up={up} live={live} />
            <svg className="ran-tower" viewBox="-60 -170 120 200" aria-hidden="true"><Tower on={on} label="" /></svg></div>
          <div className="legend"><span><i className="lg ctrl" />señalización</span><span><i className="lg user" />datos de usuario</span><span><i className="lg radio" />radio (simulada)</span></div>
        </div>
        <div className="ran-side">
          <div className="card">
            <div className="card-h"><h2>¿Qué hace OAI ahora?</h2></div>
            <p className="ran-expl">{expl}</p>
            <div className="chips-ro"><span className="tag">RRC: {on ? "CONNECTED" : node.state === "DEREGISTERED" ? "IDLE" : "CONNECTING"}</span>
              <span className="tag">S1: {st?.oai.running ? "asociado al MME" : "cerrado"}</span><span className="tag">UE conectados: {node.state === "DEREGISTERED" || node.state === "REJECTED" ? 0 : 1}</span></div>
            <table className="kv"><tbody>
              <tr><th>Paquetes de subida</th><td>{st?.userplane.tx ?? 0} (módulo → GTP-U → SGW-U)</td></tr>
              <tr><th>Paquetes de bajada</th><td>{st?.userplane.rx ?? 0} (SGW-U → GTP-U → módulo)</td></tr>
              <tr><th>Tramo Uu de datos</th><td>relevo UDP de pruebas (no hay radio)</td></tr>
            </tbody></table>
          </div>
          <div className="card"><div className="card-h"><h2>Registro de OAI</h2><span className="muted small">RRC · S1AP · GTP-U en vivo</span></div>
            <pre ref={logRef} className="log">{log.join("\n") || "(sin registro: enciende OAI registrando el nodo)"}</pre></div>
        </div>
      </div>
    </Frame>
  );
}
