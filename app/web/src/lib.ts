// Utilidades compartidas: llamadas a la API, formatos y un bus de eventos mínimo.
export const api = async (path: string, opt: RequestInit = {}) => {
  const r = await fetch(path, { headers: { "Content-Type": "application/json" }, ...opt });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(typeof data.detail === "string" ? data.detail : data.detail?.msg || r.statusText);
  return data;
};

export const fmtDur = (s: number) =>
  s >= 3600 ? `${(s / 3600).toFixed(s % 3600 ? 1 : 0)} h` : s >= 60 ? `${Math.floor(s / 60)} min${s % 60 ? " " + (s % 60) + " s" : ""}` : `${s} s`;
export const yes = (v: any) => /^s[ií]/i.test(String(v || ""));
export const hexRand = (bytes: number) =>
  [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
export const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches || location.search.includes("still");

type Fn = (d?: any) => void;
const handlers: Record<string, Set<Fn>> = {};
/** Bus de eventos de la aplicación: «subs», «radio», «lab», «lab_link»… */
export const bus = {
  on(name: string, fn: Fn) { (handlers[name] ||= new Set()).add(fn); return () => { handlers[name].delete(fn); }; },
  emit(name: string, d?: any) { handlers[name]?.forEach((f) => f(d)); },
};
