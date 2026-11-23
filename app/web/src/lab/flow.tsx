// Paquetes animados sobre enlaces SVG: cápsulas de datos con estela, etiqueta de protocolo y ondas en los saltos de radio.
import { useCallback, useEffect, useRef } from "react";
import { labEngine, Hop, LBL } from "./engine";

const NS = "http://www.w3.org/2000/svg";
export const KINDCOL: Record<string, string> = { radio: "var(--radio)", ctrl: "var(--ctrl)", user: "var(--user)" };
export interface LinkDef { a: string; b: string; kind: string; d: string; label?: string; lx?: number; ly?: number }
export const lkey = (a: string, b: string) => [a, b].sort().join("|");

/** Devuelve `layer` (poner en un <g>), `register(a,b)` para guardar el <path> de cada enlace y `run(hops, ev)` que anima el recorrido. */
export function useFlow(links: LinkDef[]) {
  const layer = useRef<SVGGElement>(null);
  const paths = useRef<Record<string, SVGPathElement | null>>({});
  const L = useRef(links); L.current = links;

  const fly = useCallback((a: string, b: string, o: { bad?: boolean; inf?: boolean; text?: string; ms: number }) => {
    const def = L.current.find((l) => lkey(l.a, l.b) === lkey(a, b)), p = def && paths.current[lkey(a, b)];
    if (!def || !p || !layer.current) return Promise.resolve();
    const len = p.getTotalLength(), fwd = def.a === a, col = o.bad ? "var(--bad)" : KINDCOL[def.kind] || "var(--accent)";
    p.classList.add("hot"); setTimeout(() => p.classList.remove("hot"), o.ms + 500);
    const g = document.createElementNS(NS, "g"); g.setAttribute("class", "pkt-lab");
    const mk = (tag: string, at: Record<string, string>) => { const e = document.createElementNS(NS, tag); Object.entries(at).forEach(([k, v]) => e.setAttribute(k, v)); g.append(e); return e; };
    const trail = [0.045, 0.09, 0.135].map((_, i) => mk("circle", { r: String(6.5 - i * 1.6), fill: col, opacity: String(0.32 - i * 0.09) }));
    mk("circle", { r: "11", fill: col, opacity: "0.22", filter: "url(#f-glow)" });
    mk("rect", { x: "-7", y: "-4.5", width: "14", height: "9", rx: "2.6", fill: col, stroke: "var(--card)", "stroke-width": "1.4", ...(o.inf ? { opacity: "0.78", "stroke-dasharray": "2 2" } : {}) });
    mk("path", { d: "M-3.5 0 h7", stroke: "#fff", "stroke-width": "1.3", "stroke-linecap": "round", opacity: ".85" });
    if (o.text) { const t = mk("text", { class: "pkt-t", y: "-13" }); t.textContent = o.text; }
    layer.current.append(g);
    const at = (k: number) => { const kk = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; return p.getPointAtLength((fwd ? kk : 1 - kk) * len); };
    const t0 = performance.now();
    return new Promise<void>((res) => {
      const tick = (now: number) => {
        const k = Math.min(1, (now - t0) / o.ms), pt = at(k);
        g.setAttribute("transform", `translate(${pt.x},${pt.y})`);
        trail.forEach((c, i) => { const q = at(Math.max(0, k - 0.045 * (i + 1))); c.setAttribute("cx", String(q.x - pt.x)); c.setAttribute("cy", String(q.y - pt.y)); });
        g.style.opacity = String(k > 0.94 ? (1 - k) / 0.06 : 1);
        if (k < 1) requestAnimationFrame(tick); else { g.remove(); res(); }
      };
      requestAnimationFrame(tick);
    });
  }, []);

  /** Anima los saltos de un evento sobre este conjunto de enlaces y marca los nodos que toca. */
  const run = useCallback(async (hops: Hop[], ev: any, ms: (b: number) => number, mark = true) => {
    for (let i = 0; i < hops.length; i++) {
      const [a, b, opt = {}] = hops[i];
      if (mark) labEngine.mark([a, b], ms(900));
      await fly(a, b, { bad: !!opt.bad || ev.ok === false, inf: !!opt.inf, text: i === 0 ? LBL[ev.stage] || "" : "", ms: ms(opt.inf ? 360 : ev.stage === "mqtt_pub" ? 380 : 520) });
    }
  }, [fly]);

  const register = (a: string, b: string) => (e: SVGPathElement | null) => { paths.current[lkey(a, b)] = e; };
  return { layer, register, run };
}

/** Conecta una vista al motor mientras está montada. */
export function useScene(play: (ev: any, ms: (b: number) => number, fast: boolean) => Promise<void>) {
  const f = useRef(play); f.current = play;
  useEffect(() => { labEngine.scene = { play: (ev, ms, fast) => f.current(ev, ms, fast) }; return () => { labEngine.scene = null; }; }, []);
}
