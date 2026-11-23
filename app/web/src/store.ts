// Estado global del panel (núcleo, dispositivos MQTT, radio) y conexión en tiempo real.
import { useSyncExternalStore } from "react";
import { api, bus } from "./lib";

export interface Dev { online: boolean; seen: number | null; last: any; history: any[] }
export interface Toast { id: number; msg: string; kind: string }
interface State {
  core: { containers: any[]; subscribers: any[]; error: any };
  devices: Record<string, Dev>;
  radio: any;
  events: string[];
  toasts: Toast[];
}

let state: State = { core: { containers: [], subscribers: [], error: null }, devices: {}, radio: { running: false }, events: [], toasts: [] };
const subs = new Set<() => void>();
export const getState = () => state;
export const setState = (p: Partial<State>) => { state = { ...state, ...p }; subs.forEach((f) => f()); };
export const useStore = <T,>(sel: (s: State) => T): T =>
  useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => sel(state));

// ---------------------------------------------------------------- avisos
let toastId = 0;
export function toast(msg: string, kind = "") {
  const id = ++toastId;
  setState({ toasts: [...state.toasts, { id, msg, kind }] });
  setTimeout(() => setState({ toasts: state.toasts.filter((t) => t.id !== id) }), 4500);
}
export const fail = (e: any) => toast(e?.message || String(e), "bad");

export const addEvent = (t: string) =>
  setState({ events: [new Date().toLocaleTimeString() + "  " + t, ...state.events].slice(0, 60) });

// ---------------------------------------------------------------- núcleo
export async function refreshCore() {
  try { setState({ core: await api("/api/core") }); } catch { /* sin núcleo */ }
}
export const cmap = (s: State = state): Record<string, string> => Object.fromEntries(s.core.containers.map((c: any) => [c.name, c.status]));
export const anyOnline = (s: State = state) => Object.values(s.devices).some((d) => d.online);
const HIDE = ["nb-subscriber-provisioner", "nb-enb-nbiot", "nb-enb"];
export const coreCounts = (s: State = state) => {
  const list = s.core.containers.filter((c: any) => !HIDE.includes(c.name));
  return { total: list.length, run: list.filter((c: any) => c.status === "running").length };
};

// Equipos físicos: off = no hay, real = hardware conectado, sim = simulación.
export function hwState(s: State = state) {
  const m = cmap(s), up = (n: string) => m[n] === "running";
  const core = s.core.containers.filter((c: any) => ![...HIDE, "nb-ue"].includes(c.name));
  const run = core.filter((c: any) => c.status === "running").length;
  const pc = { s: core.length && run === core.length ? "real" : "off", t: core.length ? `Núcleo ${run}/${core.length} contenedores` : "Núcleo apagado" };
  // nb-enb-nbiot solo se queda en marcha si UHD encontró el USRP (si no, sale con «No USRP Device Found»).
  const usrp = up("nb-enb-nbiot") ? { s: "real", t: "Conectado · eNB OAI en marcha" }
    : up("nb-enb") ? { s: "sim", t: "Simulado · srsRAN con radio virtual" } : { s: "off", t: "No conectado" };
  const on = Object.entries(s.devices).filter(([, d]) => d.online);
  const simOn = on.filter(([, d]) => d.last?.sim), realOn = on.filter(([, d]) => !d.last?.sim);
  const esp = realOn.length ? { s: "real", t: `En línea · ${realOn.map(([i]) => i).join(", ")}` }
    : simOn.length || up("nb-ue") ? { s: "sim", t: `Simulado · ${simOn.map(([i]) => i).join(", ") || "srsUE"}` } : { s: "off", t: "Sin dispositivo" };
  return { pc, usrp, esp };
}

// ---------------------------------------------------------------- tiempo real (SSE)
let started = false;
export function startRealtime() {
  if (started) return;
  started = true;
  refreshCore();
  setInterval(refreshCore, 5000);
  const es = new EventSource("/api/stream");
  es.onmessage = (m) => {
    const e = JSON.parse(m.data);
    if (e.type === "lab" || e.type === "lab_link") return bus.emit(e.type, e);
    if (e.type === "subs") { bus.emit("subs"); refreshCore(); return; }
    if (e.type === "hello") { setState({ devices: e.devices, radio: e.radio }); return; }
    if (e.type === "radio") {
      setState({ radio: e.radio });
      if (e.reason) { addEvent("Radio: " + e.reason); toast("Radio: " + e.reason); }
      bus.emit("radio");
      return;
    }
    const devices = { ...state.devices };
    if (e.type === "telemetry") {
      const d = devices[e.device] || { online: true, last: {}, history: [], seen: null };
      const history = [...d.history, e.data].slice(-120);
      devices[e.device] = { ...d, online: true, seen: e.data.ts, last: e.data, history };
      const x = e.data;
      addEvent(`${e.device}: ` + (x.temp !== undefined ? `${x.temp} °C, ${x.hum} %, ` : x.nivel !== undefined ? `nivel ${x.nivel} %, batería ${x.bateria} %, ` : "") + `${x.rssi} dBm, LED ${x.led ? "ON" : "OFF"}`);
    } else if (e.type === "status") {
      const d = devices[e.device] || { online: false, last: {}, history: [], seen: null };
      devices[e.device] = { ...d, online: e.online, seen: e.seen };
      addEvent(`${e.device}: ${e.online ? "en línea" : "fuera de línea"}`);
    } else if (e.type === "cmd") addEvent(`→ ${e.device}: ${JSON.stringify(e.cmd)}`);
    setState({ devices });
  };
}
