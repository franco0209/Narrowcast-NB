// Motor de diagramas SVG animados: nodos con icono, enlaces con flechas, paquetes que viajan y estado en vivo.
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import { ICONS } from "../data/icons";
import { reduced } from "../lib";

const NS = "http://www.w3.org/2000/svg";
export const KIND_COLOR: Record<string, string> = { ctrl: "var(--ctrl)", user: "var(--user)", radio: "var(--radio)" };

export interface DNode { id: string; label: string; sub?: string; x: number; y: number; w: number; h: number; icon?: string; ext?: boolean }
export interface DEdge { a: string; b: string; kind: string; label?: string; dir?: string }
export interface DiagramHandle {
  packet(from: string, to: string, color?: string | null, ms?: number): Promise<void>;
  path(hops: string[][], color?: string | null, ms?: number): Promise<void>;
}
export interface Focus { nodes: string[]; hops: string[][] }

/** Recorta el segmento centro–centro al borde de los rectángulos. */
function clip(a: DNode, b: DNode): [number[], number[]] {
  const cx1 = a.x + a.w / 2, cy1 = a.y + a.h / 2, cx2 = b.x + b.w / 2, cy2 = b.y + b.h / 2;
  const dx = cx2 - cx1, dy = cy2 - cy1;
  const edge = (n: DNode, sx: number, sy: number, dir: number) => {
    const tx = dx === 0 ? Infinity : (n.w / 2 + 3) / Math.abs(dx), ty = dy === 0 ? Infinity : (n.h / 2 + 3) / Math.abs(dy);
    const t = Math.min(tx, ty);
    return [sx + dx * t * dir, sy + dy * t * dir];
  };
  return [edge(a, cx1, cy1, 1), edge(b, cx2, cy2, -1)];
}

interface Props {
  id: string; nodes: DNode[]; edges: DEdge[]; w: number; h: number;
  className?: string;
  up?: Record<string, boolean>;          // nodo activo / apagado
  live?: boolean[];                      // enlace activo (una entrada por enlace)
  selected?: string | null;
  focus?: Focus | null;
  layer?: string | null;                 // solo un tipo de enlace
  ambient?: boolean;                     // paquetes ambientales en enlaces activos
  onSelect?: (id: string) => void;
}

export const Diagram = forwardRef<DiagramHandle, Props>(function Diagram(p, ref) {
  const { id, nodes, edges, w, h, up = {}, live = [], selected, focus, layer, ambient, onSelect } = p;
  const pkts = useRef<SVGGElement>(null);
  const lineRefs = useRef<(SVGLineElement | null)[]>([]);
  const N = useMemo(() => Object.fromEntries(nodes.map((n) => [n.id, n])), [nodes]);
  const geo = useMemo(() => edges.map((e) => clip(N[e.a], N[e.b])), [edges, N]);
  const find = (a: string, b: string) => edges.findIndex((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a));

  const packet = (from: string, to: string, color?: string | null, ms = 900) => {
    const i = find(from, to);
    if (i < 0 || reduced() || !pkts.current) return Promise.resolve();
    const e = edges[i], fwd = e.a === from;
    const [s, t] = fwd ? [geo[i][0], geo[i][1]] : [geo[i][1], geo[i][0]];
    const col = color || KIND_COLOR[e.kind];
    const g = document.createElementNS(NS, "g");
    const mk = (tag: string, attrs: Record<string, any>) => { const el = document.createElementNS(NS, tag); Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, String(v))); g.append(el); };
    mk("circle", { r: 9, fill: col, opacity: 0.18 });
    mk("circle", { r: 4.6, fill: col, stroke: "var(--card)", "stroke-width": 1.5 });
    pkts.current.append(g);
    const anim = g.animate([
      { transform: `translate(${s[0]}px,${s[1]}px)`, opacity: 0.2 },
      { transform: `translate(${s[0] + (t[0] - s[0]) * 0.12}px,${s[1] + (t[1] - s[1]) * 0.12}px)`, opacity: 1, offset: 0.12 },
      { transform: `translate(${t[0]}px,${t[1]}px)`, opacity: 1, offset: 0.92 },
      { transform: `translate(${t[0]}px,${t[1]}px)`, opacity: 0 }], { duration: ms, easing: "ease-in-out" });
    return new Promise<void>((res) => { anim.onfinish = () => { g.remove(); res(); }; anim.oncancel = () => { g.remove(); res(); }; });
  };
  const pulse = (a: string, b: string) => {
    const l = lineRefs.current[find(a, b)];
    if (!l) return;
    l.classList.add("hot"); setTimeout(() => l.classList.remove("hot"), 1300);
  };
  const api = {
    packet,
    async path(hops: string[][], color?: string | null, ms = 700) { for (const [a, b] of hops) { pulse(a, b); await packet(a, b, color, ms); } },
  };
  useImperativeHandle(ref, () => api);

  // Paquetes ambientales: cada 1,4 s sale uno por cada enlace activo, alternando sentido.
  const latest = useRef({ edges, live, layer });
  latest.current = { edges, live, layer };
  const svgRef = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (!ambient) return;
    const t = setInterval(() => {
      const s = svgRef.current;
      if (document.hidden || !s || s.getBoundingClientRect().width === 0) return;
      const { edges, live, layer } = latest.current;
      edges.forEach((e, k) => {
        if (!live[k] || (layer && e.kind !== layer && e.kind !== "radio")) return;
        const upDir = (Math.floor(Date.now() / 1400) + k) % 2 === 0;
        packet(upDir ? e.a : e.b, upDir ? e.b : e.a, null, 1100);
      });
    }, 1400);
    return () => clearInterval(t);
  });

  const focusing = !!focus;
  const edgeLit = (e: DEdge) => focusing && focus!.hops.some(([a, b]) => (e.a === a && e.b === b) || (e.a === b && e.b === a));
  return (
    <svg ref={svgRef} id={id} className={`dg ${p.className || ""} ${focusing ? "focusing" : ""}`} viewBox={`0 0 ${w} ${h}`} role="img">
      <defs>
        {Object.entries(KIND_COLOR).map(([k, c]) => (
          <marker key={k} id={`ah-${id}-${k}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M1 1.5L9 5L1 8.5z" fill={c} /></marker>
        ))}
      </defs>
      <g>
        {edges.map((e, i) => {
          const [p1, p2] = geo[i], both = (e.dir || "both") === "both";
          const off = layer && e.kind !== layer && e.kind !== "radio";
          return <line key={i} ref={(el) => { lineRefs.current[i] = el; }} x1={p1[0]} y1={p1[1]} x2={p2[0]} y2={p2[1]}
            className={`edge ${e.kind}${live[i] ? " live" : ""}${edgeLit(e) ? " lit" : ""}${off ? " off" : ""}`}
            markerEnd={`url(#ah-${id}-${e.kind})`} markerStart={both ? `url(#ah-${id}-${e.kind})` : undefined} />;
        })}
      </g>
      <g ref={pkts} />
      <g>
        {nodes.map((n) => {
          const lit = focusing && focus!.nodes.includes(n.id), tx = 36 + (n.w - 36 - 8) / 2;
          const pick = () => onSelect?.(n.id);
          return (
            <g key={n.id} className={`node ${up[n.id] ? "up" : "down"}${n.ext ? " ext" : ""}${selected === n.id ? " sel" : ""}${lit ? " lit" : ""}`}
              transform={`translate(${n.x},${n.y})`} tabIndex={0} role="button" aria-label={n.label}
              onClick={pick} onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); pick(); } }}>
              <rect width={n.w} height={n.h} rx="11" />
              <circle cx={n.w - 12} cy="12" r="3.6" className="led" />
              <g transform={`translate(10,${(n.h - 20) / 2})`} className="icn">
                <path d={ICONS[n.icon || "chip"] || ICONS.chip} fill="none" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </g>
              <text x={tx} y={n.sub ? n.h / 2 - 2 : n.h / 2 + 4}>{n.label}</text>
              {n.sub && <text x={tx} y={n.h / 2 + 12} className="sub">{n.sub}</text>}
            </g>
          );
        })}
      </g>
      <g>
        {edges.map((e, i) => {
          if (!e.label) return null;
          const [p1, p2] = geo[i], off = layer && e.kind !== layer && e.kind !== "radio";
          return <text key={i} x={(p1[0] + p2[0]) / 2} y={(p1[1] + p2[1]) / 2 - 6} className={`elabel${edgeLit(e) ? " lit" : ""}${off ? " off" : ""}`}>{e.label}</text>;
        })}
      </g>
    </svg>
  );
});
