// Interfaz radio (Uu) de la RAN: parámetros NB-IoT de la celda de OAI (editables, se aplican reiniciando el eNB) y el modelo de sus consecuencias.
import { useRef, useState } from "react";
import { api } from "../../lib";
import { fail, toast } from "../../store";
import { labEngine, RadioCfg, RadioSnap } from "../engine";

const NAMES: Record<string, string> = { band: "Banda", n_rb_dl: "Portadora LTE anfitriona", tx_gain: "Ganancia de TX", nprach_period: "Periodicidad NPRACH", npdcch_rep: "Repeticiones NPDCCH (acceso)", paging: "Ciclo de paging" };
const fmt = (k: string, v: number) => k === "band" ? `B${v}` : k === "n_rb_dl" ? `${v} PRB` : k === "tx_gain" ? `${v} dB` : k === "paging" ? `${v} tramas · ${(v * 10 / 1000).toFixed(2)} s` : k === "nprach_period" ? `${v} ms` : `×${v}`;
const DIST_MIN = 10, DIST_MAX = 5000;
const toPos = (d: number) => Math.round(100 * Math.log(d / DIST_MIN) / Math.log(DIST_MAX / DIST_MIN));
const toDist = (p: number) => Math.round(DIST_MIN * Math.pow(DIST_MAX / DIST_MIN, p / 100));

export function ceName(ce: number | null) { return ce === null ? "sin cobertura" : `CE${ce}`; }

export default function RadioCard({ radio, running, busy }: { radio: RadioSnap; running: boolean; busy: boolean }) {
  const { saved, applied, link: lk } = radio;
  const [dist, setDist] = useState<number | null>(null), timer = useRef<any>(null);
  const set = (k: keyof RadioCfg, v: number) => api(`/api/lab/radio/config?${k}=${v}`, { method: "POST" }).then(() => labEngine.refresh()).catch(fail);
  const sendDist = (p: number) => {
    const d = toDist(p); setDist(d); clearTimeout(timer.current);
    timer.current = setTimeout(() => api(`/api/lab/radio/config?distance_m=${d}`, { method: "POST" }).then(() => labEngine.refresh()).catch(fail).finally(() => setDist(null)), 150);
  };
  const apply = async () => {
    if (busy) return toast("Hay una operación en curso: espera a que termine", "bad");
    try { await api("/api/lab/radio/apply", { method: "POST" }); toast("Reiniciando OAI con la radio nueva (~45 s). Después registra el nodo otra vez.", ""); labEngine.refresh(); } catch (e) { fail(e); }
  };
  const d = dist ?? saved.distance_m, pend = radio.pending, cs = radio.cell_saved;
  const avgUp = Math.round(applied.nprach_period / 2 + 2 * applied.npdcch_rep + lk.air_ms), avgDown = Math.round(applied.paging * 10 / 2 + 2 * applied.npdcch_rep + lk.air_ms);
  const sel = (k: "band" | "n_rb_dl" | "nprach_period" | "npdcch_rep" | "paging") => (
    <select value={saved[k]} onChange={(e) => set(k, +e.target.value)}>
      {radio.choices[k].map((v) => <option key={v} value={v}>{k === "band" ? `B${v} · DL ${radio.bands[v].dl} MHz${radio.bands[v].module ? "" : " · el módulo NO la soporta"}` : k === "n_rb_dl" ? `${v} PRB · ${radio.host_mhz[v]} MHz` : fmt(k, v)}</option>)}
    </select>
  );
  return (
    <div className="card radio-card">
      <div className="card-h"><div><h2>Interfaz radio (Uu)</h2><span className="muted small">Parámetros NB-IoT de la celda de OAI · se escriben en su .conf y OAI solo los lee al arrancar</span></div>
        <span className={`pill ${running ? "on" : "off"}`}><span className="dot" />{running ? "cargado en OAI" : "OAI apagado"}</span></div>

      <table className="kv"><tbody>
        <tr><th>Banda / duplexado</th><td>B{applied.band} · FDD · EARFCN {radio.cell.earfcn}</td></tr>
        <tr><th>Bajada (DL) / subida (UL)</th><td>{radio.cell.dl_mhz} MHz / {radio.cell.ul_mhz} MHz</td></tr>
        <tr><th>Portadora NB-IoT</th><td>180 kHz (1 PRB) dentro de una portadora LTE de {radio.cell.host_mhz} MHz ({applied.n_rb_dl} PRB)</td></tr>
        <tr><th>Modo de operación</th><td>in-band, deducido de <code>N_RB_DL</code> (OAI no lo muestra)</td></tr>
        <tr><th>Acceso y paging</th><td>NPRACH cada {applied.nprach_period} ms · NPDCCH ×{applied.npdcch_rep} · paging {applied.paging} tramas</td></tr>
      </tbody></table>

      <h3 className="radio-h">Cambiar la radio de la celda</h3>
      <div className="radio-form">
        <div><label className="lbl">{NAMES.band}</label>{sel("band")}</div>
        <div><label className="lbl">{NAMES.n_rb_dl}</label>{sel("n_rb_dl")}</div>
        <div><label className="lbl">{NAMES.tx_gain}: <b>{saved.tx_gain} dB</b></label><input type="range" min={0} max={20} step={1} value={saved.tx_gain} onChange={(e) => set("tx_gain", +e.target.value)} /></div>
        <div><label className="lbl">{NAMES.nprach_period}</label>{sel("nprach_period")}</div>
        <div><label className="lbl">{NAMES.npdcch_rep}</label>{sel("npdcch_rep")}</div>
        <div><label className="lbl">{NAMES.paging}</label>{sel("paging")}</div>
      </div>
      {pend.length > 0 ? (
        <div className="radio-pend">
          <b>Cambios sin aplicar</b> (OAI sigue con lo anterior):
          <ul>{pend.map((p) => <li key={p.key}>{NAMES[p.key]}: {fmt(p.key, p.before)} → <b>{fmt(p.key, p.after)}</b>{p.key === "band" ? ` (DL ${cs.dl_mhz} MHz, UL ${cs.ul_mhz} MHz, EARFCN ${cs.earfcn})` : ""}</li>)}</ul>
          <button className="btn" disabled={busy} onClick={apply}>Aplicar a OAI y reiniciar el eNB</button>
          <p className="muted small">El eNB tarda ~45 s en arrancar y el nodo pierde su sesión: hay que registrarlo de nuevo.</p>
        </div>
      ) : <p className="muted small">La radio guardada coincide con la que OAI tiene cargada.</p>}

      <h3 className="radio-h">Qué provoca (modelo)</h3>
      <label className="lbl">Distancia del nodo al eNB: <b>{d >= 1000 ? (d / 1000).toFixed(1) + " km" : d + " m"}</b> <span className="muted small">(se aplica al instante, no reinicia OAI)</span></label>
      <input type="range" min={0} max={100} value={toPos(d)} onChange={(e) => sendDist(+e.target.value)} />
      <table className="kv"><tbody>
        <tr><th>Pérdida de propagación</th><td>{lk.path_loss_db} dB a {lk.freq_mhz} MHz (B{lk.band})</td></tr>
        <tr><th>Señal recibida (RSRP)</th><td className={lk.coverage ? "" : "bad-t"}>{lk.rsrp_dbm} dBm · AT+CSQ {lk.csq === 99 ? "99 (sin señal)" : lk.csq}</td></tr>
        <tr><th>Nivel de cobertura</th><td className={lk.coverage ? "" : "bad-t"}>{ceName(lk.ce)}{lk.coverage ? ` · cada mensaje se repite ×${lk.reps}` : ""}</td></tr>
        <tr><th>Subida (nodo → red)</th><td>≈ {lk.coverage ? `${avgUp} ms de media` : "no transmite"} · ~{lk.energy_mj} mJ por mensaje</td></tr>
        <tr><th>Bajada (orden → nodo)</th><td>≈ {lk.coverage ? `${avgDown} ms de media` : "no la recibe"} <span className="muted small">(espera de paging {(applied.paging * 10 / 2).toFixed(0)} ms de media)</span></td></tr>
        {radio.last.up_ms != null && <tr><th>Última espera medida</th><td>subida {radio.last.up_ms} ms{radio.last.down_ms != null ? ` · bajada ${radio.last.down_ms} ms` : ""}</td></tr>}
        <tr><th>Módulo SIM7080G</th><td className={lk.module_supports ? "" : "bad-t"}>{lk.module_supports ? `soporta B${lk.band} en NB-IoT` : `NO soporta B${lk.band} en NB-IoT: no encontraría la celda`}</td></tr>
      </tbody></table>
      <p className="muted small">Lo real: los parámetros del .conf que carga OAI. Lo modelado (no medido): pérdida en espacio libre con exponente 3, 20 dBm + ganancia de potencia, niveles de cobertura por RSRP (CE0 ≥ −105, CE1 ≥ −115, CE2 ≥ −128 dBm) y consumo de 0,8 W transmitiendo. Con radio falsa no hay señal que degradar: estos efectos se calculan aquí y se aplican al nodo simulado. Las bandas NB-IoT del módulo salen de listados de terceros, pendientes de confirmar con la hoja de datos de SIMCom.</p>
    </div>
  );
}
