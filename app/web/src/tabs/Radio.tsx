import { useCallback, useEffect, useRef, useState } from "react";
import { Card } from "../components/ui";
import { api, bus, yes } from "../lib";
import { fail, setState, toast, useStore } from "../store";

const PRESETS: Record<number, { earfcn: number; dl: number; ul: number }> = { // DL de ejemplo por banda; la definitiva sale del barrido
  3: { earfcn: 1550, dl: 1840000000, ul: 1745000000 }, 8: { earfcn: 3600, dl: 940000000, ul: 895000000 },
  20: { earfcn: 6240, dl: 800000000, ul: 841000000 }, 28: { earfcn: 9430, dl: 780000000, ul: 725000000 },
};
const defaultPlan = (b = 3): Record<string, string> => ({ band: String(b), earfcn: String(PRESETS[b].earfcn), dl_freq_hz: String(PRESETS[b].dl), ul_freq_hz: String(PRESETS[b].ul),
  tx_gain: "0", modo: "cable", atenuacion_db: "60", duracion_max_s: "120", portadora_libre: "no", antena_autorizada: "no", autorizado_por: "" });
const HOLD_MS = 1500;

export default function Radio() {
  const radio = useStore((s) => s.radio);
  const [plan, setPlan] = useState<Record<string, string>>(defaultPlan());
  const [saved, setSaved] = useState("");
  const [checks, setChecks] = useState<{ ok: boolean; text: string }[]>([]);
  const [ready, setReady] = useState(false);
  const [msg, setMsg] = useState("");
  const [sessions, setSessions] = useState<any[]>([]);
  const [progress, setProgress] = useState(0);        // 0..1 mientras se mantiene pulsado
  const [left, setLeft] = useState<{ s: number; frac: number } | null>(null);
  const raf = useRef<number | null>(null);
  const planRef = useRef(plan); planRef.current = plan;
  const saveTimer = useRef<any>(null);
  const lock = !!radio.running;

  const applyCheck = (d: any) => {
    setChecks(d.check.checks); setReady(d.check.ok);
    setMsg(d.check.ok ? `Todo en regla. Se encenderá el contenedor ${d.container}.` : "Bloqueado: completa lo marcado con ✕ (portadora libre y autorización).");
    setState({ radio: d.radio });
  };
  const load = useCallback(async (withForm: boolean) => {
    const d = await api("/api/radio");
    if (!d.plan.band) { const p = defaultPlan(); setPlan(p); await api("/api/radio/plan", { method: "PUT", body: JSON.stringify(p) }).then(applyCheck); return; }
    if (withForm) {
      const p = { ...defaultPlan(), ...Object.fromEntries(Object.entries(d.plan).filter(([, v]) => v !== "")) } as Record<string, string>;
      p.band = String(p.band).replace(/^[Bb]/, ""); setPlan(p);
    }
    applyCheck(d);
    setSessions(await api("/api/radio/sessions"));
  }, []);
  useEffect(() => { load(true).catch(fail); return bus.on("radio", () => load(false).catch(() => {})); }, [load]);

  const queueSave = () => {
    setSaved("guardando…"); clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try { applyCheck(await api("/api/radio/plan", { method: "PUT", body: JSON.stringify(planRef.current) })); setSaved("✓ guardado"); }
      catch (e) { setSaved(""); fail(e); }
    }, 500);
  };
  const edit = (patch: Record<string, string>) => { setPlan((p) => ({ ...p, ...patch })); setTimeout(queueSave); };
  const pickBand = (b: string) => { const p = PRESETS[+b]; edit({ band: b, earfcn: String(p.earfcn), dl_freq_hz: String(p.dl), ul_freq_hz: String(p.ul) }); };

  // cuenta atrás mientras emite
  useEffect(() => {
    if (!radio.running) { setLeft(null); return; }
    const t = setInterval(() => {
      const l = Math.max(0, radio.deadline - Date.now() / 1000), tot = Math.max(1, radio.deadline - radio.started);
      setLeft({ s: Math.ceil(l), frac: l / tot });
    }, 250);
    return () => clearInterval(t);
  }, [radio]);

  const startRadio = async () => {
    try { setState({ radio: await api("/api/radio/start", { method: "POST", body: JSON.stringify({ confirm: "EMITIR" }) }) }); toast("Transmisión activada", "ok"); }
    catch (e) { fail(e); load(false); }
  };
  const holdBegin = () => {
    if (radio.running || !ready || raf.current) return;
    const t0 = performance.now();
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / HOLD_MS); setProgress(p);
      if (p >= 1) { raf.current = null; setProgress(0); startRadio(); } else raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
  };
  const holdCancel = () => { if (raf.current) { cancelAnimationFrame(raf.current); raf.current = null; setProgress(0); } };
  const stopRadio = async () => {
    try { setState({ radio: await api("/api/radio/stop", { method: "POST" }) }); toast("Transmisión detenida", "ok"); load(false); } catch (e) { fail(e); }
  };

  const offset = radio.running && left ? 100 - left.frac * 100 : 100 - progress * 100;
  const gain = plan.tx_gain, dur = plan.duracion_max_s;
  return (
    <section id="radio">
      <div className="grid2">
        <Card title="Plan RF" right={<span className="muted">{saved}</span>}>
          <fieldset disabled={lock} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
            <p className="muted small">Valores seguros ya cargados: cable con atenuador, ganancia mínima y sesión corta. Solo faltan las dos confirmaciones humanas.</p>
            <label className="lbl">Banda</label>
            <div className="chips">{Object.keys(PRESETS).map((b) => <button key={b} className={b === String(plan.band).replace(/^[Bb]/, "") ? "sel" : ""} onClick={() => pickBand(b)}>B{b}</button>)}</div>
            <div className="two">
              <div><label className="lbl">Ganancia TX <b>{gain} dB</b> <span className="muted">(máx. 30)</span></label><input type="range" min={0} max={30} step={1} value={gain} onChange={(e) => edit({ tx_gain: e.target.value })} /></div>
              <div><label className="lbl">Duración máx. <b>{dur}</b> s</label><input type="range" min={30} max={600} step={30} value={dur} onChange={(e) => edit({ duracion_max_s: e.target.value })} /></div>
            </div>
            <label className="lbl">Modo</label>
            <div className="seg">{[["cable", "Cable + atenuador"], ["antena", "Antena"]].map(([v, t]) => <button key={v} className={plan.modo === v ? "sel" : ""} onClick={() => edit({ modo: v })}>{t}</button>)}</div>
            <div className="two" style={{ gridTemplateColumns: plan.modo === "antena" ? "1fr 1fr" : "1fr" }}>
              <div><label className="lbl">Atenuación (dB, ≥ 60 en cable)</label><input type="number" min={0} max={120} value={plan.atenuacion_db} onChange={(e) => edit({ atenuacion_db: e.target.value })} /></div>
              {plan.modo === "antena" && <div><label className="lbl">Antena autorizada por escrito</label><label className="sw"><input type="checkbox" checked={yes(plan.antena_autorizada)} onChange={(e) => edit({ antena_autorizada: e.target.checked ? "sí" : "no" })} /><span /></label></div>}
            </div>
            <details className="adv"><summary>Frecuencias (calculadas por banda, editables)</summary>
              <div className="three">
                <div><label className="lbl">EARFCN</label><input value={plan.earfcn} onChange={(e) => edit({ earfcn: e.target.value })} /></div>
                <div><label className="lbl">Bajada (Hz)</label><input value={plan.dl_freq_hz} onChange={(e) => edit({ dl_freq_hz: e.target.value })} /></div>
                <div><label className="lbl">Subida (Hz)</label><input value={plan.ul_freq_hz} onChange={(e) => edit({ ul_freq_hz: e.target.value })} /></div>
              </div>
              <p className="muted small">Son valores de ejemplo para la banda. La portadora definitiva sale del barrido de espectro.</p>
            </details>
            <div className="gates">
              <div className="gate"><div><b>Portadora libre</b><span className="muted small">Hice el barrido y no hay señales reales ahí.</span></div>
                <label className="sw"><input type="checkbox" checked={yes(plan.portadora_libre)} onChange={(e) => edit({ portadora_libre: e.target.checked ? "sí" : "no" })} /><span /></label></div>
              <div className="gate col"><div><b>Autorizado por</b><span className="muted small">Docente y fecha (ej.: «Ing. Pérez, 2026-11-10»).</span></div>
                <input placeholder="Nombre y fecha" autoComplete="off" value={plan.autorizado_por} onChange={(e) => edit({ autorizado_por: e.target.value })} /></div>
            </div>
          </fieldset>
        </Card>

        <Card title="Transmisión" className="center">
          <ul className="checks">{checks.map((c, i) => <li key={i} className={c.ok ? "ok" : "bad"} style={{ animationDelay: `${i * 40}ms` }}>{c.text}</li>)}</ul>
          <div className={`ring-wrap${radio.running ? " live" : ""}`}>
            <svg id="ring" viewBox="0 0 220 220" aria-hidden="true">
              <circle className="ring-bg" cx="110" cy="110" r="96" />
              <circle className="ring-fg" cx="110" cy="110" r="96" pathLength={100} style={{ strokeDashoffset: offset }} />
              <g className="waves"><circle cx="110" cy="110" r="30" /><circle cx="110" cy="110" r="30" /><circle cx="110" cy="110" r="30" /></g>
            </svg>
            <button className={`tx${radio.running ? " live" : ""}`} disabled={!radio.running && !ready}
              onPointerDown={(e) => { if (!radio.running) { e.preventDefault(); holdBegin(); } }}
              onPointerUp={holdCancel} onPointerLeave={holdCancel} onPointerCancel={holdCancel}
              onClick={() => { if (radio.running) stopRadio(); }}
              onKeyDown={(e) => { if ((e.key === " " || e.key === "Enter") && !e.repeat && !radio.running) { e.preventDefault(); holdBegin(); } }} onKeyUp={holdCancel}>
              <span>{radio.running ? "Detener ahora" : ready ? "Mantén para activar" : "Bloqueado"}</span>
              <small>{radio.running ? (left ? `corte en ${left.s} s` : "") : ready ? "1,5 segundos" : "completa el plan"}</small>
            </button>
          </div>
          <p className="muted small">{msg}</p>
          <p className="muted small">Seguridad: se exige plan válido y mantener pulsado 1,5 s; corta solo al cumplirse la duración.</p>
        </Card>
      </div>
      <Card title="Sesiones">
        <div className="tw"><table><tbody>
          <tr><th>Inicio (UTC)</th><th>Banda</th><th>Modo</th><th>Gan.</th><th>Dur. (s)</th><th>Resultado</th></tr>
          {sessions.map((x, i) => <tr key={i}><td>{x.inicio_utc}</td><td>B{x.banda}</td><td>{x.modo}</td><td>{x.tx_gain}</td><td>{x.duracion_real_s}</td><td>{x.resultado}</td></tr>)}
          {!sessions.length && <tr><td colSpan={6} className="muted">Sin sesiones todavía</td></tr>}
        </tbody></table></div>
      </Card>
    </section>
  );
}
