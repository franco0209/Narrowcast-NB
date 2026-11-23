// Mapa general: las tres partes de la red (UE · RAN OAI · Núcleo Open5GS) con sus interfaces; cada bloque se abre para ver su interior.
import { motion } from "framer-motion";
import { AlarmLed, ArtDefs, Dht22, Esp32Board, Hcsr04, PottedPlant, PumpAssembly, PhoneIcon, ServerUnit, Sim7080, SoilProbe, Tower, WaterTank } from "../art";
import { LinkDef, lkey, useFlow, useScene } from "../flow";
import { LabSnap, NodeSnap, PATHS } from "../engine";

export type Part = "ue" | "ran" | "core";
const LINKS: LinkDef[] = [
  { a: "ue", b: "enb", kind: "radio", d: "M400,152 L470,152", label: "Uu", lx: 435, ly: 140 },
  { a: "enb", b: "mme", kind: "ctrl", d: "M760,150 C 800,150 810,178 850,184", label: "S1-MME", lx: 800, ly: 144 },
  { a: "enb", b: "sgw", kind: "user", d: "M760,300 C 800,300 810,268 850,264", label: "S1-U", lx: 802, ly: 296 },
  { a: "hss", b: "mme", kind: "ctrl", d: "M935,120 L935,150", label: "S6a", lx: 962, ly: 138 },
  { a: "mme", b: "sgw", kind: "ctrl", d: "M935,200 L935,230", label: "S11", lx: 962, ly: 218 },
  { a: "sgw", b: "pgw", kind: "user", d: "M935,280 L935,310", label: "S5-U", lx: 966, ly: 298 },
  { a: "pgw", b: "mosq", kind: "user", d: "M935,360 L935,390", label: "SGi", lx: 962, ly: 378 },
  { a: "mosq", b: "panel", kind: "user", d: "M1020,415 C 1060,415 1060,440 1085,450", label: "MQTT", lx: 1056, ly: 410 },
];
const CORE_TILES: [string, string, string, number][] = [["hss", "HSS", "suscriptores · MongoDB", 78], ["mme", "MME", "registro · seguridad NAS", 150], ["sgw", "SGW", "túnel S1-U / S11", 230], ["pgw", "PGW", "IP 10.58.0.0/16 · NAT", 310], ["mosq", "Mosquitto", "broker MQTT 1883", 390]];

function Block({ x, y, w, h, title, sub, part, on, onOpen, act }: { x: number; y: number; w: number; h: number; title: string; sub: string; part: Part; on: boolean; onOpen: (p: Part) => void; act: boolean }) {
  return (
    <g className={`blk${act ? " act" : ""}`} onClick={() => onOpen(part)} role="button" tabIndex={0} aria-label={`Abrir ${title}`}
      onKeyDown={(e) => { if (e.key === "Enter") onOpen(part); }} style={{ cursor: "pointer" }}>
      <rect x={x} y={y} width={w} height={h} rx="20" className="blk-bg" />
      <rect x={x} y={y} width={w} height="46" rx="20" className="blk-head" /><rect x={x} y={y + 24} width={w} height="22" className="blk-head" />
      <text x={x + 18} y={y + 20} className="blk-t">{title}</text><text x={x + 18} y={y + 36} className="blk-s">{sub}</text>
      <g transform={`translate(${x + w - 100},${y + 14})`}><rect width="86" height="22" rx="11" className="blk-open" /><text x="43" y="15" textAnchor="middle" className="blk-ot">ver detalle ›</text></g>
      <circle cx={x + w - 112} cy={y + 24} r="4.5" fill={on ? "var(--ok)" : "var(--muted)"}>{on && <animate attributeName="opacity" values="1;.3;1" dur="1.8s" repeatCount="indefinite" />}</circle>
    </g>
  );
}

export default function Overview({ node, snap, onOpen }: { node: NodeSnap; snap: LabSnap; onOpen: (p: Part) => void }) {
  const flow = useFlow(LINKS);
  useScene(async (ev, ms, fast) => { const mk = PATHS[ev.stage]; if (mk && !fast) await flow.run(mk(ev), ev, ms); });
  const on = node.state === "REGISTERED", hw = node.hw, act = (...ids: string[]) => ids.some((i) => (snap.active[i] || 0) > performance.now());
  const busyUe = ["ATTACHING", "AUTH", "SECURITY"].includes(node.state);
  return (
    <svg id="labsvg" className="dg lab-ov" viewBox="0 0 1200 580" role="img" aria-label="Mapa del laboratorio: UE, RAN OAI y núcleo Open5GS">
      <ArtDefs />
      <defs><filter id="f-glow2"><feGaussianBlur stdDeviation="2.2" /></filter></defs>

      {/* ------------------------------ UE */}
      <Block x={20} y={36} w={380} h={520} title="NODO DE RIEGO · UE" sub="ESP32 + módulo SIM7080G + sensores" part="ue" on={on} onOpen={onOpen} act={act("ue")} />
      <g transform="translate(48,112)"><Esp32Board busy={on} /><text x="75" y="106" textAnchor="middle" className="cap">ESP32 · firmware de riego</text></g>
      <g transform="translate(246,108)"><Sim7080 state={node.state} /><text x="60" y="98" textAnchor="middle" className="cap">{node.ip ? `IP ${node.ip}` : "sin IP"}</text></g>
      <path d="M198,142 C 222,142 222,142 246,142" className="wire uart" /><text x="222" y="134" textAnchor="middle" className="cap s">UART · AT</text>
      <g className="wires">
        {[["M70,200 C 70,240 70,260 78,300", "soil"], ["M110,200 C 120,250 150,270 152,320", "dht"], ["M150,200 C 170,240 215,250 232,290", "echo"], ["M185,200 C 230,250 300,270 330,355", "relay"]].map(([d, k]) => <path key={k} d={d} className={`wire w-${k}`} />)}
      </g>
      <g transform="translate(56,300) scale(.8)"><SoilProbe moisture={hw.soil} /></g>
      <g transform="translate(135,322) scale(.8)"><Dht22 /></g>
      <g transform="translate(200,292) scale(.8)"><Hcsr04 pinging={on} /></g>
      <g transform="translate(224,380) scale(.62)"><WaterTank level={hw.tank} w={110} h={130} /></g>
      <g transform="translate(300,376) scale(.62)"><PumpAssembly on={hw.pump} /></g>
      <g transform="translate(46,440) scale(.9)"><AlarmLed on={hw.alarm} /></g>
      <g transform="translate(345,498) scale(.85)"><PottedPlant moisture={hw.soil} /></g>
      <g className="vals">
        <text x="60" y="425" className="val-t">suelo {hw.soil.toFixed(0)} %</text><text x="142" y="425" className="val-t">{hw.temp.toFixed(1)} °C</text>
        <text x="226" y="478" className="val-t">tanque {hw.tank.toFixed(0)} %</text><text x="306" y="428" className="val-t">{hw.pump ? "bomba ON" : "bomba off"}</text>
      </g>
      {busyUe && <motion.circle cx="360" cy="140" r="26" fill="none" stroke="var(--warn)" strokeWidth="2" animate={{ r: [10, 36], opacity: [0.9, 0] }} transition={{ duration: 1.2, repeat: Infinity }} />}

      {/* ------------------------------ RAN */}
      <Block x={470} y={36} w={290} h={520} title="RAN · eNB OAI" sub="OpenAirInterface · radio falsa" part="ran" on={node.state !== "DEREGISTERED" || on} onOpen={onOpen} act={act("enb")} />
      <g transform="translate(615,470) scale(1.55)"><Tower on={on || busyUe} label="OAI" /></g>
      <g className="stack-mini">{["S1AP", "RRC", "PDCP", "RLC", "MAC", "PHY*"].map((l, i) => <g key={l} transform={`translate(${492 + (i % 3) * 88},${100 + Math.floor(i / 3) * 34})`}><rect width="78" height="26" rx="7" className="chip-l" /><text x="39" y="17" textAnchor="middle">{l}</text></g>)}</g>
      <text x="615" y="190" textAnchor="middle" className="cap s">10.44.0.43 · S1 + GTP-U</text>
      <text x="615" y="538" textAnchor="middle" className="cap s">* capa física simulada: no emite RF</text>

      {/* ------------------------------ NÚCLEO */}
      <Block x={820} y={36} w={360} h={520} title="NÚCLEO · Open5GS" sub="EPC real en contenedores" part="core" on={on} onOpen={onOpen} act={act("mme", "hss", "sgw", "pgw", "mosq")} />
      {CORE_TILES.map(([id, label, sub, y]) => (
        <g key={id} transform={`translate(850,${y + 6})`} className={`tile${act(id) ? " act" : ""}`}>
          <ServerUnit w={170} h={46} active={on || act(id)} tint="var(--ctrl)" />
          <text x="14" y="21" className="tile-t">{label}</text><text x="14" y="35" className="tile-s">{sub}</text>
        </g>
      ))}
      <g transform="translate(1086,410)" className={act("panel") ? "tile act" : "tile"}><PhoneIcon on={on} /><text x="23" y="96" textAnchor="middle" className="cap">celular MQTT</text></g>

      {/* ------------------------------ enlaces e interfaces */}
      <g>{LINKS.map((l) => <path key={lkey(l.a, l.b)} ref={flow.register(l.a, l.b)} d={l.d} className={`lk ${l.kind}`} />)}</g>
      <g>{LINKS.map((l) => <text key={`t${l.label}`} className="lk-t" x={l.lx} y={l.ly}>{l.label}</text>)}</g>
      <g className="ports"><circle cx="400" cy="152" r="6" className="port" /><circle cx="470" cy="152" r="6" className="port" /><circle cx="760" cy="150" r="6" className="port" /><circle cx="760" cy="300" r="6" className="port" /><circle cx="850" cy="184" r="6" className="port" /><circle cx="850" cy="264" r="6" className="port" /></g>
      {on && <g><text x="435" y="168" textAnchor="middle" className="cap s">radio simulada</text></g>}
      <g ref={flow.layer} />
    </svg>
  );
}
