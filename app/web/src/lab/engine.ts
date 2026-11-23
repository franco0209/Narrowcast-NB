// Motor de reproducción del laboratorio: recibe los eventos reales del simulador y los reproduce uno a uno (con la velocidad
// elegida) en la vista que esté abierta (mapa general o el detalle del UE, de OAI o del núcleo).
import { api, bus, reduced } from "../lib";

export interface NodeSnap {
  id: string; name: string; imsi: string; sim: string; state: string; reason: string; ip: string | null; mqtt: boolean;
  hw: { soil: number; temp: number; hum: number; tank: number; dist: number; hand: number | null; pump: boolean; alarm: boolean; alarm_why: string };
  cfg: { auto: boolean; soil_low: number; soil_high: number; tank_min: number; pump_max_s: number; interval_s: number };
  at: { t: number; cmd: string; resp: string; ok: boolean }[];
  fw: { t: number; fn: string; text: string }[];
}
export interface RadioCfg { band: number; n_rb_dl: number; tx_gain: number; nprach_period: number; npdcch_rep: number; paging: number; distance_m: number }
export interface RadioLink {
  band: number; dist_m: number; freq_mhz: number; path_loss_db: number; ptx_dbm: number; rsrp_dbm: number; rssi_dbm: number; csq: number; ce: number | null; reps: number;
  air_ms: number; energy_mj: number; module_supports: boolean; coverage: boolean; ok: boolean; why: string;
}
export interface RadioSnap {
  saved: RadioCfg; applied: RadioCfg; pending: { key: string; before: number; after: number }[];
  cell: { dl_mhz: number; ul_mhz: number; earfcn: number; dl_range: string; host_mhz: number }; cell_saved: { dl_mhz: number; ul_mhz: number; earfcn: number; dl_range: string; host_mhz: number };
  link: RadioLink; last: { up_ms: number | null; down_ms: number | null; up_air_ms: number | null };
  choices: { band: number[]; n_rb_dl: number[]; nprach_period: number[]; npdcch_rep: number[]; paging: number[] };
  bands: Record<string, { module: boolean; dl: string }>; host_mhz: Record<string, number>; ce_limits: [number, number, number][];
}
export interface LabState { job: string | null; oai: { running: boolean; age: number; settle_s: number }; userplane: { ok: boolean; tx: number; rx: number; error: string }; in_hss: boolean; node: NodeSnap; radio: RadioSnap }
export interface LabSnap {
  rows: any[]; caption: any | null; speed: number; paused: boolean; sel: number | null; st: LabState | null; link: boolean; playing: boolean;
  pending: { name: string; since: number } | null;   // acción pulsada que aún no consta como operación en curso
  active: Record<string, number>;     // bloque/enlace activo → instante (para resaltar mientras viaja un paquete)
}

export type Hop = [string, string, { bad?: boolean; inf?: boolean }?];
/** Recorridos del mapa general por tipo de evento. Los saltos con { inf: 1 } son internos del núcleo (no los ve el simulador). */
export const PATHS: Record<string, (ev: any) => Hop[]> = {
  attach_req: () => [["ue", "enb"], ["enb", "mme"]],
  auth_req: () => [["mme", "hss", { inf: true }], ["hss", "mme", { inf: true }], ["mme", "enb"], ["enb", "ue"]],
  auth_resp: () => [["ue", "enb"], ["enb", "mme"]],
  auth_fail_sent: () => [["ue", "enb", { bad: true }], ["enb", "mme", { bad: true }]],
  auth_sync: () => [["ue", "enb", { bad: true }], ["enb", "mme", { bad: true }], ["mme", "hss", { inf: true }], ["hss", "mme", { inf: true }]],
  auth_reject: () => [["mme", "enb", { bad: true }], ["enb", "ue", { bad: true }]],
  attach_reject: () => [["mme", "enb", { bad: true }], ["enb", "ue", { bad: true }]],
  smc: () => [["mme", "enb"], ["enb", "ue"]],
  smc_complete: () => [["ue", "enb"], ["enb", "mme"]],
  ics_req: () => [["mme", "sgw", { inf: true }], ["sgw", "pgw", { inf: true }], ["pgw", "sgw", { inf: true }], ["sgw", "mme", { inf: true }], ["mme", "enb"], ["enb", "ue"]],
  oai_ue_cap: () => [["ue", "enb"]],
  oai_reconf: () => [["ue", "enb"]],
  oai_ics_resp: () => [["enb", "mme"], ["mme", "sgw", { inf: true }], ["sgw", "pgw", { inf: true }]],
  attach_complete: () => [["ue", "enb"], ["enb", "mme"]],
  detach_req: () => [["ue", "enb"], ["enb", "mme"]],
  emm_info: () => [["mme", "enb"], ["enb", "ue"]],
  ping_tx: (ev) => [["ue", "enb"], ["enb", "sgw"], ["sgw", "pgw"], ...(ev.dst === "mosq" ? [["pgw", "mosq"] as Hop] : [])],
  ping_rx: (ev) => [...(ev.src === "mosq" ? [["mosq", "pgw"] as Hop] : []), ["pgw", "sgw"], ["sgw", "enb"], ["enb", "ue"]],
  mqtt_connect: () => [["ue", "enb"], ["enb", "sgw"], ["sgw", "pgw"], ["pgw", "mosq"]],
  mqtt_pub: () => [["ue", "enb"], ["enb", "sgw"], ["sgw", "pgw"], ["pgw", "mosq"], ["mosq", "panel"]],
  mqtt_rx: () => [["panel", "mosq"], ["mosq", "pgw"], ["pgw", "sgw"], ["sgw", "enb"], ["enb", "ue"]],
};
export const LBL: Record<string, string> = { attach_req: "Attach Req", auth_req: "Auth Req", auth_resp: "Auth Resp", smc: "Security Mode", smc_complete: "SM Complete", ics_req: "Attach Accept", oai_ue_cap: "UE Cap", oai_reconf: "Reconf Complete", oai_ics_resp: "ICS Response", attach_complete: "Attach Done", mqtt_pub: "MQTT", mqtt_connect: "MQTT CONNECT", mqtt_rx: "orden", ping_tx: "ICMP", ping_rx: "ICMP", detach_req: "Detach", auth_sync: "Synch fail", auth_fail_sent: "MAC fail" };
const QUIET = ["emm_state", "job_start", "job_done", "world", "fw", "at"];
const SILENT = ["world", "fw"];                 // no entran a la traza
export const TRACE_HIDDEN = ["emm_state", "job_start", "job_done", "world", "fw"];

/** Cada vista abierta se registra aquí: recibe el evento y decide qué animar; devuelve cuando termina la animación. */
export interface SceneApi { play(ev: any, ms: (base: number) => number, fast: boolean): Promise<void> }

class LabEngine {
  snap: LabSnap = { rows: [], caption: null, speed: 1, paused: false, sel: null, st: null, link: false, playing: false, pending: null, active: {} };
  private subs = new Set<() => void>();
  private queue: any[] = [];
  private step = false;
  scene: SceneApi | null = null;
  active = false;                                 // la pestaña está abierta: solo entonces se anima

  subscribe = (f: () => void) => { this.subs.add(f); return () => { this.subs.delete(f); }; };
  getSnapshot = () => this.snap;
  private set(p: Partial<LabSnap>) { this.snap = { ...this.snap, ...p }; this.subs.forEach((f) => f()); }
  ms = (base = 520) => Math.max(120, base / this.snap.speed);
  private fast() { return this.queue.length > 7; }

  private caption(ev: any) {
    if (!ev.label || QUIET.includes(ev.stage)) return;
    const mk = PATHS[ev.stage];
    this.set({ caption: { ev, inf: !!mk && mk(ev).some((h) => h[2]?.inf) } });
  }
  private async play(ev: any) {
    if (!SILENT.includes(ev.stage)) this.set({ rows: [...this.snap.rows, ev].slice(-600) });
    this.caption(ev);
    if (this.scene && !reduced()) await this.scene.play(ev, this.ms, this.fast());
    if (ev.stage === "emm_state" || ev.stage === "tunnel_up" || ev.stage === "device_state") this.refresh();
    const gap = QUIET.includes(ev.stage) || ev.stage === "provision" || ev.stage === "scenario_note" ? 60 : 160;
    if (!this.fast()) await new Promise((r) => setTimeout(r, this.ms(gap)));
  }
  private async pump() {
    if (this.snap.playing) return;
    this.set({ playing: true });
    while (this.queue.length) {
      if (this.snap.paused && !this.step) { await new Promise((r) => setTimeout(r, 120)); continue; }
      this.step = false;
      await this.play(this.queue.shift());
    }
    this.set({ playing: false });
  }

  push(ev: any) {
    if (!this.active || ev.stage === "at" || ev.stage === "world") {
      if (!SILENT.includes(ev.stage)) this.set({ rows: [...this.snap.rows, ev].slice(-600) });
      return;
    }
    this.queue.push(ev);
    if (ev.stage === "job_done") { this.set({ pending: null }); setTimeout(() => this.refresh(), 400); }
    this.pump();
  }
  /** Marca un bloque como activo durante un rato (lo usan las vistas al animar). */
  mark(ids: string[], ms = 900) {
    const now = performance.now(), a = { ...this.snap.active };
    ids.forEach((i) => { a[i] = now + ms; });
    this.set({ active: a });
    setTimeout(() => { const b = { ...this.snap.active }; ids.forEach((i) => { if (b[i] <= performance.now()) delete b[i]; }); this.set({ active: b }); }, ms + 30);
  }
  setPending(name: string | null) { this.set({ pending: name ? { name, since: Date.now() } : null }); }
  setSpeed(speed: number) { this.set({ speed }); }
  setLink(link: boolean) { this.set({ link }); }
  togglePause() { this.set({ paused: !this.snap.paused }); }
  stepOnce() { this.step = true; }
  select(seq: number | null) { this.set({ sel: seq }); }
  async clear() { this.queue = []; this.set({ rows: [], sel: null }); try { await api("/api/lab/reset", { method: "POST" }); } catch { /* nada */ } }
  async loadHistory() {
    try { const evs = await api("/api/lab/events?since=0"); this.set({ rows: evs.filter((e: any) => !SILENT.includes(e.stage)).slice(-300) }); } catch { /* aún sin simulador */ }
  }
  async refresh() {
    try {
      const st = await api("/api/lab/state"), p = this.snap.pending;
      this.set({ st, link: true, ...(p && !st.job && Date.now() - p.since > 4000 ? { pending: null } : {}) });
    } catch { this.set({ link: false }); }
  }
}
export const labEngine = new LabEngine();
bus.on("lab", (e) => labEngine.push(e.ev));
bus.on("lab_link", (e) => labEngine.setLink(!!e.up));
