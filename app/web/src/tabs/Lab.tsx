import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Pill } from "../components/ui";
import { api } from "../lib";
import { runScenario } from "../lab/actions";
import { labEngine, PATHS, TRACE_HIDDEN } from "../lab/engine";
import CoreView from "../lab/views/CoreView";
import Overview, { Part } from "../lab/views/Overview";
import RANView from "../lab/views/RANView";
import UEView from "../lab/views/UEView";

const SCEN: [string, string, string, string][] = [
  ["prep", "Preparar", "Da de alta en el HSS (MongoDB) la SIM legítima del nodo. Hazlo una vez.", ""],
  ["registrar", "Registrar nodo", "Reinicia OAI (conecta un UE por arranque) y registra el nodo con su SIM legítima: acceso aleatorio, RRC, Attach, autenticación Milenage, seguridad NAS, portador de datos y MQTT real por el túnel. Tarda ~45 s.", ""],
  ["clon", "SIM clonada", "IMSI correcto pero clave K distinta: la SIM no reconoce a la red (MAC failure) y el núcleo la rechaza.", "bad"],
  ["intruso", "Intruso", "Un dispositivo cuyo IMSI no está en el HSS intenta registrarse: el MME debe rechazarlo (Attach Reject).", "bad"],
  ["baja", "Dar de baja", "El módulo pide darse de baja (Detach) y el núcleo libera su sesión.", ""],
  ["oai_off", "Apagar OAI", "Detiene el eNB de OAI del laboratorio.", ""],
];
// Avance aproximado de cada operación según el último mensaje real que se ha visto
const RANK: Record<string, number> = { job_start: 4, scenario_note: 10, oai_boot: 12, attach_req: 34, oai_rrc: 40, auth_req: 48, auth_resp: 55, auth_fail_sent: 100, auth_reject: 100, attach_reject: 100, smc: 62, smc_complete: 66,
  oai_ics: 72, oai_ue_cap: 78, oai_reconf: 82, oai_ics_resp: 88, attach_complete: 93, tunnel_up: 96, mqtt_connect: 100, detach_req: 60 };
const JOB_ES: Record<string, string> = { registrar: "Registrando el nodo con su SIM legítima", clon: "Probando la SIM clonada", intruso: "Probando al intruso", baja: "Dando de baja el nodo" };

function JobBanner({ snap }: { snap: ReturnType<typeof labEngine.getSnapshot> }) {
  const s = snap.st, job = s?.job || snap.pending?.name;
  if (!job) return null;
  const start = [...snap.rows].map((r) => r.stage).lastIndexOf("job_start"), since = start >= 0 ? snap.rows.slice(start) : [];
  let pct = Math.max(2, ...since.map((r) => RANK[r.stage] || 0));
  const booting = since.some((r) => r.stage === "oai_boot") && pct <= 20 && s;
  if (booting) pct = 8 + 24 * Math.min(1, s!.oai.age / s!.oai.settle_s);
  else if (!since.length && s) pct = 3 + 4 * Math.min(1, s.oai.age / s.oai.settle_s);
  const last = [...since].reverse().find((r) => r.label && !["emm_state", "world", "at", "fw"].includes(r.stage));
  const left = s && s.oai.age < s.oai.settle_s ? Math.round(s.oai.settle_s - s.oai.age) : 0;
  return (
    <div className="job-banner" role="status" aria-live="polite">
      <div className="job-top"><span className="spin" /><b>{JOB_ES[job] || job}…</b><span className="muted">No pulses otra acción hasta que termine: reiniciar OAI varias veces seguidas puede dejarlo sin responder.</span></div>
      <div className="job-bar"><i style={{ width: `${Math.min(100, pct)}%` }} /></div>
      <div className="job-info">{left > 0 && booting ? `OAI está arrancando: faltan ~${left} s antes de poder usarlo. ` : ""}{last ? `Último paso: ${last.label.slice(0, 140)}` : "Iniciando…"}</div>
    </div>
  );
}

const NAMES: Record<string, string> = { ue: "módulo", enb: "OAI", mme: "MME", hss: "HSS", sgw: "SGW", pgw: "PGW", mosq: "broker", panel: "celular" };
const DATA_STAGES = ["mqtt_connect", "mqtt_pub", "mqtt_rx", "ping_tx", "ping_rx"];
/** Recorrido completo de un mensaje de datos: así se ve que pasa por OAI y por el núcleo, no solo «módulo → broker». */
const route = (e: any) => {
  const mk = PATHS[e.stage];
  if (!mk || !DATA_STAGES.includes(e.stage)) return `${NAMES[e.src] || e.src} → ${NAMES[e.dst] || e.dst}`;
  const chain: string[] = [];
  mk(e).forEach(([a, b]) => { if (!chain.length) chain.push(a); chain.push(b); });
  return chain.filter((x, i) => x !== chain[i - 1]).map((x) => UP_NAMES[x] || NAMES[x] || x).join(" → ");
};
/** En los datos solo trabaja el plano de usuario: SGW-U y PGW-U (UPF), no SGW-C/PGW-C. */
const UP_NAMES: Record<string, string> = { sgw: "SGW-U", pgw: "PGW-U (UPF)" };
const DIR_UP = ["mqtt_connect", "mqtt_pub", "ping_tx"];
const fmtB = (n: number) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`);

type UpStat = { up_pkts: number; up_bytes: number; down_pkts: number; down_bytes: number };
type UpLine = { seq: number; t: number; dir: "up" | "down"; title: string; trip: string; delta?: string };

/** Registro del plano de usuario: describe cada viaje de datos (también la telemetría de cada 10 s) y lo respalda con los contadores reales del UPF. */
function UserPlaneLog({ rows }: { rows: any[] }) {
  const [lines, setLines] = useState<UpLine[]>([]);
  const [tot, setTot] = useState<UpStat | null>(null);
  const last = useRef<UpStat | null>(null), mounted = useRef(Date.now() / 1000), seen = useRef(0), timer = useRef<any>(null), pend = useRef<number[]>([]);
  const read = () => api("/api/lab/upstats").then((r: UpStat) => r).catch(() => null);
  useEffect(() => { read().then((r) => { if (r) { last.current = r; setTot(r); } }); }, []);
  useEffect(() => {
    const fresh = rows.filter((e) => e.seq > seen.current && e.t >= mounted.current - 1 && DATA_STAGES.includes(e.stage) && e.stage !== "mqtt_connect");
    if (!rows.length) return;
    seen.current = rows[rows.length - 1].seq;
    if (!fresh.length) return;
    const add: UpLine[] = fresh.map((e) => {
      const up = DIR_UP.includes(e.stage);
      const what = e.stage === "mqtt_pub" ? "Telemetría MQTT" : e.stage === "mqtt_rx" ? "Orden MQTT del celular" : e.stage === "ping_tx" ? "Ping (ICMP) hacia la red" : "Respuesta ICMP";
      return { seq: e.seq, t: e.t, dir: up ? "up" : "down", title: `${what}${e.dev ? " · " + e.dev : ""}`, trip: route(e) };
    });
    setLines((l) => [...l, ...add].slice(-60));
    pend.current.push(...add.map((a) => a.seq));
    clearTimeout(timer.current);
    // se espera un instante a que el paquete llegue al UPF y se lee el contador
    timer.current = setTimeout(async () => {
      const now = await read(); const prev = last.current;
      const ids = pend.current; pend.current = [];
      if (!now) return;
      last.current = now; setTot(now);
      if (!prev) return;
      const d = { up_p: now.up_pkts - prev.up_pkts, up_b: now.up_bytes - prev.up_bytes, dn_p: now.down_pkts - prev.down_pkts, dn_b: now.down_bytes - prev.down_bytes };
      const txt = `UPF (ogstun): ↑ ${d.up_p} paq / ${fmtB(d.up_b)} · ↓ ${d.dn_p} paq / ${fmtB(d.dn_b)}`;
      setLines((l) => l.map((x) => (ids.includes(x.seq) ? { ...x, delta: txt } : x)));
    }, 900);
  }, [rows]);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="card-h"><h2>Registro del plano de usuario (datos)</h2></div>
      <p className="muted" style={{ marginTop: 0 }}>Los datos (MQTT, ping) viajan por GTP-U: <b>el plano de control (MME, HSS, SGW-C, PGW-C, PCRF) no interviene y por eso su registro queda vacío</b>. La prueba de que el paquete cruzó OAI y el núcleo son los contadores de la interfaz <code>ogstun</code> del PGW-U (UPF), que se leen tras cada mensaje.
        {tot && <> Acumulado del UPF: <b>↑ {tot.up_pkts} paq / {fmtB(tot.up_bytes)}</b> · <b>↓ {tot.down_pkts} paq / {fmtB(tot.down_bytes)}</b>.</>}</p>
      <div className="uplog">
        {!lines.length && <div className="muted">Esperando el próximo mensaje de datos (la telemetría llega cada 10 s con el nodo registrado). Solo se registran los mensajes en vivo, no el historial.</div>}
        {[...lines].reverse().map((l) => (
          <div key={l.seq} className="upl">
            <span className="muted">{fmtT(l.t)}</span> <i className="chip user">{l.dir === "up" ? "↑ subida" : "↓ bajada"}</i> <b>{l.title}</b>
            <div className="muted">Plano de usuario (GTP-U): {l.trip}</div>
            <div className="muted">{l.delta ?? "leyendo contadores…"}</div>
          </div>))}
      </div>
    </div>
  );
}
const fmtT = (t: number) => { const d = new Date(t * 1000); return d.toLocaleTimeString([], { hour12: false }) + "." + String(d.getMilliseconds()).padStart(3, "0"); };

function Detail({ ev }: { ev: any | null }) {
  const [cl, setCl] = useState<string | null>(null);
  const imsi = labEngine.snap.st?.node.imsi;
  useEffect(() => {
    setCl(null);
    if (!ev || !imsi || !ev.dev) return;
    let alive = true;
    api(`/api/lab/corelog?since=${ev.t - 2}&until=${ev.t + 4}&imsi=${imsi}`)
      .then((r) => alive && setCl(r.lines.length ? r.lines.map((l: any) => `${l.c} ${l.text.replace(/\(\.\.\/[^)]*\)/, "")}`).join("\n") : DATA_STAGES.includes(ev.stage) ? "(vacío a propósito: este mensaje viaja por el plano de usuario (GTP-U) y el plano de control no interviene. Mira el «Registro del plano de usuario» de abajo: ahí están los contadores del UPF.)" : "(el núcleo no escribió nada sobre este IMSI en esa ventana)"))
      .catch((e) => alive && setCl("No se pudo leer el registro: " + e.message));
    return () => { alive = false; };
  }, [ev, imsi]);
  if (!ev) return <div className="lab-detail muted">Haz clic en un mensaje de la traza para ver su contenido y lo que registró el núcleo en esos segundos.</div>;
  return (
    <div className="lab-detail">
      <div><span className="chip">{ev.proto}</span> <b>{ev.stage}</b> · {fmtT(ev.t)}</div><p>{ev.label}</p>
      <pre>{JSON.stringify(ev.detail, null, 2)}</pre>
      {imsi && ev.dev && <><div className="muted">Lo que registró el núcleo (MME, HSS, SGW-C, PGW-C, PCRF) sobre el IMSI {imsi} en ese momento:</div><div className={`cl${cl === null ? " muted" : ""}`}>{cl ?? "consultando…"}</div></>}
    </div>
  );
}

export default function Lab() {
  const snap = useSyncExternalStore(labEngine.subscribe, labEngine.getSnapshot);
  const [part, setPart] = useState<Part | null>(() => (["ue", "ran", "core"].includes(location.hash.split("/")[1]) ? (location.hash.split("/")[1] as Part) : null));
  const [hint, setHint] = useState("Pasa el cursor sobre una acción para ver qué prueba.");
  const [hideTel, setHideTel] = useState(false);

  useEffect(() => {
    labEngine.active = true;
    labEngine.loadHistory(); labEngine.refresh();
    const t = setInterval(() => labEngine.refresh(), 1000);
    return () => { labEngine.active = false; clearInterval(t); };
  }, []);
  const open = (p: Part | null) => { setPart(p); history.replaceState(null, "", p ? `#lab/${p}` : "#lab"); };

  const s = snap.st, node = s?.node, busy = !!s?.job || !!snap.pending, oai = !!s?.oai.running;
  const rows = snap.rows.filter((e) => !TRACE_HIDDEN.includes(e.stage) && e.stage !== "at" && !(hideTel && e.stage === "mqtt_pub")).slice(-120);
  useEffect(() => { const w = document.querySelector(".lab-trace-wrap"); if (w) w.scrollTop = w.scrollHeight; }, [rows.length]);
  const cap = snap.caption, selEv = snap.sel !== null ? snap.rows.find((r) => r.seq === snap.sel) || null : null;

  return (
    <section id="lab">
      <div className="card lab-head">
        <div>
          <h2>Laboratorio · nodo de riego NB-IoT sobre una red real</h2>
          <p className="muted">Un nodo de riego (ESP32 + módulo SIM7080G + sensores y bomba) se registra en el <b>núcleo Open5GS real</b> a través del <b>eNB real de OpenAirInterface</b>: NAS auténtico (Milenage, EIA2), RRC y S1AP de OAI y <b>datos MQTT reales por el túnel GTP-U de OAI</b>. Lo único simulado es la <b>radio</b> (Uu): no se prueba la capa física. Abre cada parte de la red para ver su interior.</p>
        </div>
        <div className="lab-pills">
          <Pill kind={snap.link ? "on" : "off"}>{snap.link ? "Simulador conectado" : "Simulador sin conexión"}</Pill>
          <Pill kind={oai ? "on" : "off"}>{oai ? (s!.oai.age < s!.oai.settle_s ? `OAI arrancando (${Math.max(0, Math.round(s!.oai.settle_s - s!.oai.age))} s)` : "OAI encendido") : "OAI apagado"}</Pill>
          <Pill kind={node?.state === "REGISTERED" ? "on" : node?.state === "REJECTED" ? "hot" : "off"}>{node?.state === "REGISTERED" ? `Nodo registrado · ${node.ip}` : node?.state === "REJECTED" ? "Registro rechazado" : "Nodo sin sesión"}</Pill>
          <Pill kind={s?.userplane.ok ? "on" : "off"}>{s?.userplane.ok ? `Datos ${s.userplane.tx}↑ ${s.userplane.rx}↓ paq.` : "Túnel no disponible"}</Pill>
        </div>
      </div>
      <JobBanner snap={snap} />
      <div className="card lab-bar">
        <div className="lab-acts">
          {SCEN.map(([id, t, h, c], i) => <span key={id} style={{ display: "contents" }}>{i === 2 || i === 4 ? <span className="sep" /> : null}
            <button className={`btn secondary sm ${c}`} disabled={busy} onClick={() => runScenario(id)} onMouseEnter={() => setHint(h)} onFocus={() => setHint(h)}>{t}</button></span>)}
          
        </div>
        <div className="lab-ctl">
          <label>Velocidad <input type="range" min={0.25} max={3} step={0.25} value={snap.speed} onChange={(e) => labEngine.setSpeed(+e.target.value)} /><b>{snap.speed}×</b></label>
          <button className="btn secondary sm" onClick={() => labEngine.togglePause()}>{snap.paused ? "Reanudar" : "Pausar"}</button>
          {snap.paused && <button className="btn secondary sm" onClick={() => labEngine.stepOnce()}>Siguiente paso</button>}
          <button className="btn secondary sm" onClick={() => labEngine.clear()}>Limpiar traza</button>
        </div>
        <p className="muted lab-hint">{hint}</p>
      </div>

      {node && (
        <div className="lab-stage card">
          <AnimatePresence mode="wait" initial={false}>
            {part === null ? (
              <motion.div key="ov" initial={{ opacity: 0, scale: 1.02 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.98 }} transition={{ duration: 0.2 }}>
                <div className="legend lab-legend"><span><i className="lg radio" />radio (simulada)</span><span><i className="lg ctrl" />señalización</span><span><i className="lg user" />datos de usuario</span><span><i className="lg bad" />fallo o rechazo</span><span><i className="lg inf" />salto interno inferido</span><span className="muted">Haz clic en un bloque para ver su interior</span></div>
                <Overview node={node} snap={snap} onOpen={open} />
              </motion.div>
            ) : (
              <motion.div key={part} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
                {part === "ue" && <UEView node={node} busy={busy} radio={s?.radio} onBack={() => open(null)} onOpen={open} />}
                {part === "ran" && <RANView node={node} snap={snap} onBack={() => open(null)} onOpen={open} />}
                {part === "core" && <CoreView node={node} snap={snap} onBack={() => open(null)} onOpen={open} />}
              </motion.div>
            )}
          </AnimatePresence>
          <div className="lab-caption">
            {!cap ? <span className="muted">Prepara el laboratorio y registra el nodo: cada mensaje se animará aquí.</span> : <>
              <span className={`chip ${cap.ev.ok === true ? "ok" : cap.ev.ok === false ? "bad" : ""}`}>{cap.ev.proto || "paso"}</span>{cap.ev.label}
              {cap.inf && <small>Los saltos punteados son internos del núcleo (MME↔HSS, MME↔SGW↔PGW): el simulador no los ve, se muestran porque el procedimiento 3GPP obliga a que ocurran. Compruébalo en el registro del núcleo al pulsar el mensaje.</small>}</>}
          </div>
        </div>
      )}

      <div className="lab-bottom">
        <div className="card"><div className="card-h"><h2>Traza del flujo</h2>
          <label className="muted lab-opt"><input type="checkbox" checked={hideTel} onChange={(e) => setHideTel(e.target.checked)} /> ocultar la telemetría periódica (cada 10 s)</label></div>
          <div className="lab-trace-wrap"><div id="lab-trace" className="lab-trace">
            <div className="tr h"><span>hora</span><span>origen</span><span>proto</span><span>ruta</span><span>mensaje</span></div>
            {rows.map((e) => (
              <div key={e.seq} className={`tr row ${e.ok === false ? "fail" : ""} ${snap.sel === e.seq ? "sel" : ""}`} onClick={() => labEngine.select(e.seq)}>
                <span>{fmtT(e.t)}</span><span>{e.dev || "—"}</span>
                <span><i className={`chip ${["MQTT", "GTP-U", "ICMP"].includes(e.proto) ? "user" : ""}`}>{e.proto || "·"}</i></span>
                <span>{route(e)}</span><span className="msg">{e.label}</span>
              </div>))}
          </div></div></div>
        <div className="card"><div className="card-h"><h2>Detalle y registros del núcleo</h2></div><Detail ev={selEv} /></div>
      </div>
      <UserPlaneLog rows={snap.rows} />
    </section>
  );
}
