import { useEffect, useState } from "react";
import { Card } from "../components/ui";
import { api, fmtDur } from "../lib";
import { fail, hwState, toast, useStore } from "../store";

const gaugeColor = (f: number) => (f < 0.6 ? "var(--ok)" : f < 0.85 ? "var(--warn)" : "var(--bad)");
function Gauge({ val, min, max, unit, name, color }: { val: any; min: number; max: number; unit: string; name: string; color?: string }) {
  const f = typeof val === "number" ? Math.max(0, Math.min(1, (val - min) / (max - min))) : 0;
  return (
    <div className="gauge">
      <svg viewBox="0 0 96 62"><path className="gb" d="M8 54A40 40 0 0 1 88 54" pathLength={100} />
        <path className="gf" d="M8 54A40 40 0 0 1 88 54" pathLength={100} stroke={color || gaugeColor(f)} strokeDasharray="100" strokeDashoffset={100 - f * 100} /></svg>
      <b>{val ?? "-"}{val !== undefined && val !== null ? unit : ""}</b><span>{name}</span>
    </div>
  );
}

function Chart({ hist }: { hist: any[] }) {
  const W = 640, H = 220, L = 36, R = 36, T = 14, B = 24, n = hist.length;
  const [hover, setHover] = useState<number | null>(null);
  if (n < 2) return <div className="chart-wrap"><svg id="chart" viewBox={`0 0 ${W} ${H}`}><text x={W / 2} y={H / 2} textAnchor="middle" fill="var(--muted)" fontSize={13}>Esperando más lecturas…</text></svg></div>;
  const T_ = hist.map((h) => h.temp), H_ = hist.map((h) => h.hum);
  const rng = (a: any[]): [number, number] => { const v = a.filter((x) => typeof x === "number"); let mn = Math.min(...v), mx = Math.max(...v); if (mx - mn < 1) { mn -= 0.5; mx += 0.5; } const p = (mx - mn) * 0.15; return [mn - p, mx + p]; };
  const [t0, t1] = rng(T_), [h0, h1] = rng(H_), X = (i: number) => L + (i / (n - 1)) * (W - L - R);
  const Yt = (v: number) => T + (1 - (v - t0) / (t1 - t0)) * (H - T - B), Yh = (v: number) => T + (1 - (v - h0) / (h1 - h0)) * (H - T - B);
  const pts = (A: number[], Y: (v: number) => number) => A.map((v, i) => `${X(i)},${Y(v)}`).join(" ");
  const onMove = (e: React.MouseEvent<SVGRectElement>) => {
    const r = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect(), px = ((e.clientX - r.left) / r.width) * W;
    setHover(Math.max(0, Math.min(n - 1, Math.round(((px - L) / (W - L - R)) * (n - 1)))));
  };
  return (
    <div className="chart-wrap">
      <svg id="chart" viewBox={`0 0 ${W} ${H}`}>
        <defs><linearGradient id="ga" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--accent)" stopOpacity=".35" /><stop offset="1" stopColor="var(--accent)" stopOpacity="0" /></linearGradient></defs>
        {[0, 1, 2, 3, 4].map((i) => {
          const y = T + (i / 4) * (H - T - B);
          return <g key={i}><line x1={L} x2={W - R} y1={y} y2={y} stroke="var(--line)" strokeDasharray="3 4" />
            <text x={L - 6} y={y + 4} textAnchor="end" fill="var(--accent)" fontSize={10}>{(t1 - (i / 4) * (t1 - t0)).toFixed(1)}</text>
            <text x={W - R + 6} y={y + 4} fill="var(--accent2)" fontSize={10}>{(h1 - (i / 4) * (h1 - h0)).toFixed(0)}</text></g>;
        })}
        <polygon points={`${X(0)},${H - B} ${pts(T_, Yt)} ${X(n - 1)},${H - B}`} fill="url(#ga)" />
        <polyline points={pts(H_, Yh)} fill="none" stroke="var(--accent2)" strokeWidth={2} strokeLinejoin="round" />
        <polyline points={pts(T_, Yt)} fill="none" stroke="var(--accent)" strokeWidth={2.4} strokeLinejoin="round" />
        <circle cx={X(n - 1)} cy={Yt(T_[n - 1])} r={4.5} fill="var(--accent)" />
        {hover !== null && <line x1={X(hover)} x2={X(hover)} y1={T} y2={H - B} stroke="var(--muted)" strokeDasharray="2 3" />}
        <rect x={L} y={T} width={W - L - R} height={H - T - B} fill="transparent" onMouseMove={onMove} onMouseLeave={() => setHover(null)} />
      </svg>
      {hover !== null && <div className="tip" style={{ left: `${(X(hover) / W) * 100}%`, top: `${(Yt(T_[hover]) / H) * 100}%` }}>
        {new Date(hist[hover].ts * 1000).toLocaleTimeString()} · {T_[hover]} °C · {H_[hover]} %</div>}
    </div>
  );
}

export default function Dispositivo() {
  const devices = useStore((s) => s.devices), events = useStore((s) => s.events), st = useStore((s) => s);
  const ids = Object.keys(devices);
  const [current, setCurrent] = useState<string>("");
  const [interval, setIntervalS] = useState(60);
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 5000); return () => clearInterval(t); }, []);
  const cur = ids.includes(current) ? current : ids[0] || "";
  const d = devices[cur];
  const hw = hwState(st);

  const send = async (body: any) => { try { await api(`/api/devices/${cur}/cmd`, { method: "POST", body: JSON.stringify(body) }); } catch (e) { fail(e); } };
  const l = d?.last || {}, rssi = l.rssi, bars = typeof rssi === "number" ? Math.max(0, Math.min(5, Math.round((rssi + 113) / 12))) : 0;
  const ago = d?.seen ? Math.round(Date.now() / 1000 - d.seen) : null;
  const isSim = !!(d?.last && d.last.sim);
  const HW = [
    { k: "pc", title: "PC · núcleo", v: hw.pc, svg: <><rect x="6" y="7" width="36" height="24" rx="3" /><path d="M17 41h14M24 31v10" /></> },
    { k: "usrp", title: "USRP · radio", v: hw.usrp, svg: <><rect x="5" y="20" width="38" height="18" rx="3" /><path d="M14 20V9M24 20V6M34 20V9M12 29h8M28 29h8" /><circle cx="14" cy="8" r="1.6" /><circle cx="24" cy="5" r="1.6" /><circle cx="34" cy="8" r="1.6" /></> },
    { k: "esp", title: "ESP32 + módulo", v: hw.esp, svg: <><rect x="9" y="12" width="30" height="24" rx="3" /><path d="M15 12V6M21 12V6M27 12V6M33 12V6M15 36v6M21 36v6M27 36v6M33 36v6" /><rect x="17" y="19" width="14" height="10" rx="1.5" /></> },
  ];

  return (
    <section id="dispositivo">
      <Card title="Equipos físicos" sub="Qué parte del sistema es hardware real y cuál se está simulando."
        right={<div className="legend"><span><i className="led-lg off" />apagado / no hay</span><span><i className="led-lg real" />físico conectado</span><span><i className="led-lg sim" />simulación</span></div>}>
        <div className="hw">
          {HW.map((h, i) => (
            <span key={h.k} style={{ display: "contents" }}>
              {i > 0 && <span className="hw-link" aria-hidden="true" />}
              <div className="hw-tile" data-s={h.v.s}><svg viewBox="0 0 48 48" aria-hidden="true">{h.svg}</svg><div><b>{h.title}</b><span>{h.v.t}</span></div><i className="led" /></div>
            </span>
          ))}
        </div>
      </Card>
      <Card title="¿Cómo se simula ahora?">
        <p className="small">No hay USRP ni ESP32 conectados, así que los datos de esta pestaña los genera un programa: <code>fake_device.py</code>, un proceso Python que se ejecutó dentro del contenedor <code>nb-app</code>. Hace lo mismo que el firmware real desde el punto de vista de MQTT, pero se salta toda la parte de radio.</p>
        <div className="flow"><b>Real</b>{["ESP32", "Módulo NB-IoT", "USRP · radio", "eNB", "Núcleo (MME · SGW · PGW)", "Mosquitto", "Panel"].map((t) => <span key={t}>{t}</span>)}</div>
        <div className="flow sim"><b>Simulado</b>{["ESP32", "Módulo NB-IoT", "USRP · radio", "eNB", "Núcleo"].map((t) => <span key={t} className="skip">{t}</span>)}<span>fake_device.py</span><span>Mosquitto</span><span>Panel</span></div>
        <div className="grid2 inner">
          <div><b>Qué hace el simulador</b><ul className="small">
            <li>Se conecta a Mosquitto con las mismas credenciales MQTT y se anuncia en <code>nb/esp32-sim/status</code> («online», retenido; «offline» automático si se corta).</li>
            <li>Publica en <code>nb/esp32-sim/telemetry</code> cada 5 s (o el intervalo que le pongas): temperatura 22 ± 1,5 °C, humedad 55 ± 5 % y RSSI aleatorio entre −110 y −80 dBm. <b>Son valores inventados.</b></li>
            <li>Escucha <code>nb/esp32-sim/cmd</code>: la bombilla y el intervalo funcionan de verdad (ida y vuelta por MQTT) y el estado del LED vuelve en la siguiente lectura.</li></ul></div>
          <div><b>Qué prueba y qué no</b><ul className="small">
            <li><b>Sí:</b> el broker, el panel, las gráficas, los comandos y los eventos.</li>
            <li><b>No:</b> el registro (attach) de la SIM, la autenticación, la radio NB-IoT, el eNB ni el túnel de datos por el núcleo. El simulador entra directo al broker por la red de Docker, sin pasar por el PGW-U.</li>
            <li>Se reconoce porque su telemetría lleva <code>"sim": true</code>: con eso la tarjeta se ve azul. El firmware real no lo envía y aparece en verde.</li>
            <li>Para detenerlo, Ctrl+C en la terminal donde lo lanzaste.</li></ul></div>
        </div>
      </Card>
      <Card title={<span className="row">Telemetría <select aria-label="Dispositivo" value={cur} onChange={(e) => setCurrent(e.target.value)}>{ids.map((i) => <option key={i}>{i}</option>)}</select></span>}
        right={<span className={`pill ${d ? (d.online ? (isSim ? "sim" : "on") : "off") : "off"}`}><span className="dot" /><span>{!d ? "sin datos" : d.online ? (isSim ? "simulado · en línea" : "en línea") : "fuera de línea"}</span></span>}>
        <div className="gauges">
          {!d ? <p className="muted">Aún no ha llegado telemetría. Prueba el simulador: <code>docker compose exec app python fake_device.py esp32-sim</code></p> : <>
            <Gauge val={l.temp} min={-10} max={50} unit=" °C" name="Temperatura" color="var(--accent)" />
            <Gauge val={l.hum} min={0} max={100} unit=" %" name="Humedad" color="var(--accent2)" />
            <div className="gauge"><div className="bars">{[14, 22, 30, 38, 46].map((h, i) => <i key={i} style={{ height: h }} className={i < bars ? "on" : ""} />)}</div><b>{rssi ?? "-"}{rssi !== undefined ? " dBm" : ""}</b><span>Señal</span></div>
            <div className="gauge"><b style={{ marginTop: 14 }}>{ago === null ? "-" : fmtDur(ago)}</b><span>último dato hace</span></div></>}
        </div>
        <Chart hist={d?.history || []} />
        <div className="legend"><span><i className="lg t" />Temperatura °C</span><span><i className="lg h" />Humedad %</span><span className="muted">{d && d.history.length >= 2 ? `últimas ${d.history.length} lecturas` : ""}</span></div>
      </Card>
      <div className="grid2">
        <Card title="Control del módulo">
          <div className="bulb-row">
            <button className={`bulb${l.led ? " on" : ""}`} aria-label="LED" onClick={() => { if (!cur) return toast("No hay dispositivo seleccionado", "bad"); send({ led: !l.led }); toast(`Orden enviada: LED ${!l.led ? "encender" : "apagar"}`); }}>
              <svg viewBox="0 0 64 80"><path className="glass" d="M32 4C18 4 8 14 8 27c0 9 5 14 9 19 3 4 4 7 4 11h22c0-4 1-7 4-11 4-5 9-10 9-19C56 14 46 4 32 4z" /><rect className="base" x="21" y="60" width="22" height="6" rx="2" /><rect className="base" x="25" y="68" width="14" height="6" rx="2" /></svg>
            </button>
            <div><b>{l.led === undefined ? "LED: sin dato" : l.led ? "LED encendido" : "LED apagado"}</b><p className="muted small">Pulsa la bombilla: la orden va por MQTT hasta el ESP32 (GPIO 2).</p></div>
          </div>
          <label className="lbl">Intervalo de envío <b>{fmtDur(interval)}</b></label>
          <input type="range" min={5} max={3600} step={5} value={interval} onChange={(e) => setIntervalS(+e.target.value)} />
          <button className="btn secondary" onClick={() => { if (!cur) return toast("No hay dispositivo seleccionado", "bad"); send({ interval_s: interval }); toast("Intervalo enviado"); }}>Aplicar intervalo</button>
          <p className="muted small">Las órdenes llegan cuando el módulo despierta (con PSM puede tardar).</p>
        </Card>
        <Card title="Eventos"><ul className="events">{events.map((t, i) => <li key={i}>{t}</li>)}</ul></Card>
      </div>
    </section>
  );
}
