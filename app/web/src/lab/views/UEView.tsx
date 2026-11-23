// Detalle del UE: código C del firmware del ESP32 (con la función en ejecución resaltada), el nodo con sus sensores y actuadores
// (interactivos: la mano frente al ultrasónico, el suelo seco, el tanque…) y el módulo NB-IoT con su SIM y la consola de comandos AT.
import { useEffect, useMemo, useRef, useState } from "react";
import { AlarmLed, ArtDefs, Dht22, Esp32Board, Hand, Hcsr04, PottedPlant, PumpAssembly, Sim7080, SoilProbe, WaterTank } from "../art";
import { api } from "../../lib";
import { fail } from "../../store";
import { NodeSnap, RadioSnap } from "../engine";
import { ceName } from "./RadioCard";
import { Frame } from "./Frame";
import type { Part } from "./Overview";
import { runScenario } from "../actions";

// ---------------------------------------------------------------- código C con colores
const KW = /\b(void|int|float|bool|char|const|struct|static|long|uint32_t|if|else|return|true|false|for|while)\b/;
const TOK = new RegExp(`(\\/\\/.*$)|(#\\w+)|("(?:[^"\\\\]|\\\\.)*")|(\\b\\d+(?:\\.\\d+)?\\b)|${KW.source}|(\\b[A-Z_][A-Z0-9_]{2,}\\b)`, "g");
function hl(line: string) {
  const out: React.ReactNode[] = []; let last = 0, m: RegExpExecArray | null; TOK.lastIndex = 0;
  while ((m = TOK.exec(line))) {
    if (m.index > last) out.push(line.slice(last, m.index));
    const cls = m[1] ? "c-cm" : m[2] ? "c-pp" : m[3] ? "c-st" : m[4] ? "c-nu" : m[5] ? "c-kw" : "c-mc";
    out.push(<span key={m.index} className={cls}>{m[0]}</span>); last = m.index + m[0].length;
  }
  out.push(line.slice(last));
  return out;
}
/** Rango de líneas de cada función (por nombre) y líneas que la llaman, para resaltar lo que se está ejecutando. */
function fnRanges(lines: string[]) {
  const r: Record<string, [number, number]> = {};
  lines.forEach((ln, i) => {
    const m = /^(?:void|float|int|bool|struct \w+)\s+(\w+)\s*\(.*\)\s*\{/.exec(ln);
    if (m) { let j = i; while (j < lines.length && lines[j] !== "}") j++; r[m[1]] = [i, j]; }
  });
  return r;
}

function Firmware({ node }: { node: NodeSnap }) {
  const [code, setCode] = useState<string[]>([]);
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => { fetch("/api/lab/node/firmware").then((r) => r.text()).then((t) => setCode(t.split("\n"))).catch(() => {}); }, []);
  const ranges = useMemo(() => fnRanges(code), [code]);
  const last = node.fw[node.fw.length - 1];
  const fresh = last && Date.now() / 1000 - last.t < 3.2;
  const act = fresh ? last.fn : "";
  const [a, b] = ranges[act] || [-1, -1];
  const callLines = new Set<number>(); if (act && a < 0) code.forEach((l, i) => { if (l.includes(act + "(") && !/^(void|float|int|bool)/.test(l)) callLines.add(i); });
  useEffect(() => { const box = boxRef.current, el = box?.querySelector(".ln.on") as HTMLElement | null; if (box && el) box.scrollTo({ top: Math.max(0, el.offsetTop - 60), behavior: "smooth" }); }, [act, a]);
  return (
    <div className="card fw-card">
      <div className="card-h"><div><h2>Firmware del ESP32</h2><span className="muted small">riego-nbiot.ino · C++ (Arduino). Se muestra para entender la lógica; aquí lo imita un programa Python con las mismas funciones.</span></div></div>
      <div className="fw-now">{fresh ? <><i className="dot-live" /> ejecutando <b>{act}()</b> — {last.text}</> : <span className="muted">en espera (el firmware corre cada segundo: lee sensores, decide y reporta)</span>}</div>
      <div className="code" ref={boxRef}>
        {code.map((l, i) => {
          const on = (i >= a && i <= b && a >= 0) || callLines.has(i);
          return <div key={i} className={`ln${on ? " on" : ""}`}><span className="no">{i + 1}</span><code>{hl(l) || " "}</code></div>;
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- entorno del nodo (controles) y cableado
function Slider({ label, unit, min, max, step = 1, value, onChange, hint }: { label: string; unit: string; min: number; max: number; step?: number; value: number; onChange: (v: number) => void; hint?: string }) {
  return (
    <label className="env-s"><span>{label} <b>{value.toFixed(step < 1 ? 1 : 0)} {unit}</b></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} />{hint && <small className="muted">{hint}</small>}</label>
  );
}

function Hardware({ node }: { node: NodeSnap }) {
  const hw = node.hw, [loc, setLoc] = useState<Record<string, number>>({}), timer = useRef<any>(null);
  const val = (k: string, v: number) => (k in loc ? loc[k] : v);
  const send = (k: string, v: number) => {
    setLoc((l) => ({ ...l, [k]: v })); clearTimeout(timer.current);
    timer.current = setTimeout(() => api(`/api/lab/node/env?${k}=${v}`, { method: "POST" }).catch(fail).finally(() => setLoc((l) => { const n = { ...l }; delete n[k]; return n; })), 120);
  };
  const reg = node.state === "REGISTERED";
  const handY = hw.hand == null ? -60 : 72 + (hw.hand / 30) * 90;
  return (
    <div className="card hw-card">
      <div className="card-h"><div><h2>El nodo y su entorno</h2><span className="muted small">Mueve el entorno y mira cómo reacciona el firmware (y el celular del núcleo).</span></div>
        <span className={`pill ${hw.alarm ? "hot" : "on"}`}><span className="dot" />{hw.alarm ? "ALARMA" : "normal"}</span></div>
      <svg viewBox="0 0 620 420" className="dg ue-hw" role="img" aria-label="Nodo de riego con sensores y actuadores">
        <ArtDefs />
        <rect x="0" y="0" width="620" height="420" rx="14" fill="var(--card2)" />
        {/* cables */}
        {[["M215,128 C 215,170 90,150 80,232", "#22c55e", "soil", "GPIO34 (ADC)"], ["M240,128 C 250,190 170,190 172,238", "#f59e0b", "dht", "GPIO4"], ["M285,128 C 290,170 380,150 392,32", "#38bdf8", "echo", "GPIO5/18"], ["M312,100 C 420,100 430,260 500,262", "#a78bfa", "relay", "GPIO26"], ["M262,126 C 262,340 540,360 586,366", "#ef4444", "led", "GPIO27"]].map(([d, c, k, p]) => (
          <g key={k}><path d={d} fill="none" stroke={c} strokeWidth="2.4" strokeLinecap="round" opacity=".85" strokeDasharray="1 0" /><path d={d} fill="none" stroke="#fff" strokeWidth="1" strokeDasharray="3 9" opacity=".6"><animate attributeName="stroke-dashoffset" from="24" to="0" dur="1.2s" repeatCount="indefinite" /></path></g>
        ))}
        <g transform="translate(168,40)"><Esp32Board busy={reg} /></g>
        <text x="243" y="146" textAnchor="middle" className="cap s">ESP32 · 3,3 V</text>
        {/* módulo y UART */}
        <g transform="translate(468,40)"><Sim7080 state={node.state} /></g>
        <path d="M318,76 L468,76" className="wire uart" /><text x="394" y="92" textAnchor="middle" className="cap s">UART2 · comandos AT</text>
        <text x="528" y="128" textAnchor="middle" className="cap">{node.ip ? `IP ${node.ip}` : "sin IP"}</text>
        <text x="528" y="141" textAnchor="middle" className="cap s">única IP del nodo</text>
        {/* antena hacia Uu */}
        <path d="M588,50 v-18 M578,38 h20" stroke="var(--radio)" strokeWidth="2" /><text x="588" y="24" textAnchor="middle" className="cap s">antena → Uu</text>
        {/* sensores */}
        <g transform="translate(40,232) scale(.9)"><SoilProbe moisture={hw.soil} /></g><text x="70" y="404" textAnchor="middle" className="cap">humedad de suelo · {hw.soil.toFixed(0)} %</text>
        <g transform="translate(150,236)"><Dht22 /></g><text x="170" y="326" textAnchor="middle" className="cap">DHT22 · {hw.temp.toFixed(1)} °C / {hw.hum.toFixed(0)} %</text>
        <g transform="translate(240,300) scale(.7)"><PottedPlant moisture={hw.soil} /></g>
        <g transform="translate(346,4) scale(.85)"><Hcsr04 pinging /></g>
        <g transform="translate(364,100)"><WaterTank level={hw.tank} w={80} h={170} /></g>
        <text x="404" y="292" textAnchor="middle" className="cap">tanque {hw.tank.toFixed(0)} % · {hw.dist.toFixed(1)} cm</text>
        {hw.hand != null && <g transform={`translate(404,${handY - 36})`}><Hand /></g>}
        {hw.hand != null && <text x="456" y={handY} className="cap hand-t">mano a {hw.hand.toFixed(1)} cm</text>}
        <g transform="translate(470,224) scale(.82)"><PumpAssembly on={hw.pump} /></g><text x="540" y="298" textAnchor="middle" className="cap">relé + bomba · {hw.pump ? "ON" : "apagada"}</text>
        <g transform="translate(590,372)"><AlarmLed on={hw.alarm} /></g><text x="590" y="408" textAnchor="middle" className="cap">LED alarma</text>
        {hw.alarm && <text x="300" y="410" textAnchor="middle" className="cap bad-t">⚠ {hw.alarm_why}</text>}
      </svg>
      <div className="env-grid">
        <Slider label="Humedad del suelo" unit="%" min={0} max={100} value={val("soil", hw.soil)} onChange={(v) => send("soil", v)} hint="Clava la sonda en tierra seca o húmeda" />
        <Slider label="Temperatura del aire" unit="°C" min={5} max={45} step={0.5} value={val("temp", hw.temp)} onChange={(v) => send("temp", v)} hint="Más calor = el suelo se seca más rápido" />
        <Slider label="Agua en el tanque" unit="%" min={0} max={100} value={val("tank", hw.tank)} onChange={(v) => send("tank", v)} hint="Llena o vacía el tanque" />
        <Slider label="Mano frente al ultrasónico" unit="cm" min={0} max={30} step={0.5} value={val("hand", hw.hand ?? 0)} onChange={(v) => send("hand", v)} hint="0 = sin mano · < 3 cm tapa el sensor y salta la alarma" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- módulo NB-IoT, SIM y consola AT
const SIMS: [string, string, string][] = [["registrar", "legitima", "SIM legítima"], ["clon", "clonada", "SIM clonada"], ["intruso", "intruso", "Intruso (IMSI sin alta)"]];
function Module({ node, busy, radio }: { node: NodeSnap; busy: boolean; radio?: RadioSnap }) {
  const con = useRef<HTMLDivElement>(null);
  useEffect(() => { if (con.current) con.current.scrollTop = con.current.scrollHeight; }, [node.at.length]);
  const ST: Record<string, string> = { DEREGISTERED: "sin conexión", ATTACHING: "registrándose…", AUTH: "autenticando…", SECURITY: "seguridad NAS…", REGISTERED: "registrado", REJECTED: "RECHAZADO" };
  const cls = node.state === "REGISTERED" ? "on" : node.state === "REJECTED" ? "hot" : "off";
  return (
    <div className="ue-side">
      <div className="card">
        <div className="card-h"><h2>Módulo SIM7080G y SIM</h2><span className={`pill ${cls}`}><span className="dot" />{ST[node.state] || node.state}</span></div>
        <table className="kv"><tbody>
          <tr><th>IMSI</th><td>{node.imsi}</td></tr><tr><th>IP (APN internet)</th><td>{node.ip || "—"}</td></tr>
          <tr><th>MQTT</th><td>{node.mqtt ? "conectado al broker" : "sin sesión"}</td></tr>
          {radio && <tr><th>Señal (RSRP)</th><td className={radio.link.coverage ? "" : "bad-t"}>{radio.link.rsrp_dbm} dBm · {ceName(radio.link.ce)} · a {radio.link.dist_m >= 1000 ? (radio.link.dist_m / 1000).toFixed(1) + " km" : radio.link.dist_m + " m"} en B{radio.link.band}</td></tr>}
          {node.reason && <tr><th>Motivo</th><td className="bad-t">{node.reason}</td></tr>}
        </tbody></table>
        <label className="lbl">SIM insertada (cada prueba reinicia OAI y tarda ~45 s)</label>
        <div className="sim-sel">{SIMS.map(([sc, k, t]) => <button key={sc} disabled={busy} className={`btn secondary sm${node.sim === k ? " sel" : ""}`} onClick={() => runScenario(sc)}>{t}</button>)}</div>
        <p className="muted small">{node.sim === "legitima" ? "IMSI y clave K de la SIM coinciden con el HSS: el registro debe completarse." : node.sim === "clonada" ? "Copió el IMSI pero no conoce la clave K: la autenticación debe fallar (MAC failure) y la red la rechaza." : "Su IMSI no está en el HSS: el MME rechaza el Attach."}</p>
      </div>
      <div className="card">
        <div className="card-h"><h2>Consola AT</h2><span className="muted small">ESP32 ⇄ módulo por UART</span></div>
        <div className="at-con" ref={con}>
          {node.at.length === 0 && <span className="muted">Sin actividad: registra el nodo para ver cómo el ESP32 configura el módulo.</span>}
          {node.at.map((a, i) => <div key={i} className={a.ok ? "" : "bad-t"}><span className="at-c">&gt; {a.cmd}</span>{a.resp && <span className="at-r">{a.resp}</span>}</div>)}
        </div>
      </div>
      <div className="card">
        <div className="card-h"><h2>Configuración del firmware</h2></div>
        <table className="kv"><tbody>
          <tr><th>Modo de riego</th><td>{node.cfg.auto ? "automático" : "manual (manda el celular)"}</td></tr>
          <tr><th>Enciende bomba bajo</th><td>{node.cfg.soil_low} % de suelo</td></tr><tr><th>La apaga sobre</th><td>{node.cfg.soil_high} %</td></tr>
          <tr><th>Bloqueo por tanque</th><td>bajo {node.cfg.tank_min} %</td></tr><tr><th>Reporta cada</th><td>{node.cfg.interval_s} s</td></tr>
        </tbody></table>
        <p className="muted small">Estos valores los cambia el celular del núcleo por MQTT.</p>
      </div>
    </div>
  );
}

export default function UEView({ node, busy, radio, onBack, onOpen }: { node: NodeSnap; busy: boolean; radio?: RadioSnap; onBack: () => void; onOpen: (p: Part) => void }) {
  return (
    <Frame title="UE · nodo de riego inteligente" sub="ESP32 + módulo NB-IoT SIM7080G con sensores y bomba" onBack={onBack} onOpen={onOpen}
      right={[{ label: "Uu", sub: "radio NB-IoT", kind: "radio", to: "ran" }]}>
      <div className="ue-grid"><div className="ue-main"><Hardware node={node} /><Firmware node={node} /></div><Module node={node} busy={busy} radio={radio} /></div>
    </Frame>
  );
}
