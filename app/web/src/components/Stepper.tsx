// Procedimiento paso a paso con reproducción sobre un diagrama.
import { useEffect, useRef, useState } from "react";
import type { DiagramHandle, Focus } from "./Diagram";
import { reduced } from "../lib";

export interface Step { title: string; hops: string[][]; proto?: string; msg?: string; desc: string; tech?: string; color?: string }

export function Stepper({ dg, steps, onFocus, autoMs = 600 }: { dg: React.RefObject<DiagramHandle>; steps: Step[]; onFocus: (f: Focus | null) => void; autoMs?: number }) {
  const [cur, setCur] = useState(0);
  const [playing, setPlaying] = useState(false);
  const token = useRef(0), playingRef = useRef(false), curRef = useRef(0);
  const listRef = useRef<HTMLOListElement>(null);

  const show = (i: number) => {
    curRef.current = i; setCur(i);
    onFocus({ nodes: [...new Set(steps[i].hops.flat())], hops: steps[i].hops });
    listRef.current?.children[i]?.scrollIntoView({ block: "nearest", behavior: reduced() ? "auto" : "smooth" });
  };
  const run = async (i: number) => {
    const my = ++token.current; show(i);
    await dg.current?.path(steps[i].hops, steps[i].color, autoMs + 150);
    return my === token.current;
  };
  const stop = () => { playingRef.current = false; setPlaying(false); };
  const play = async () => {
    playingRef.current = true; setPlaying(true);
    for (let i = curRef.current >= steps.length - 1 ? 0 : curRef.current + 1; i < steps.length && playingRef.current; i++) {
      if (!(await run(i))) return;
      if (!playingRef.current) break;
      await new Promise((r) => setTimeout(r, 650));
    }
    stop();
  };
  useEffect(() => { show(0); return () => { token.current++; playingRef.current = false; onFocus(null); }; }, [steps]);

  const s = steps[cur];
  const go = (i: number) => { stop(); token.current++; run(i); };
  return (
    <div className="stepper">
      <div className="stp-bar">
        <button className="btn secondary" aria-label="Paso anterior" onClick={() => go(Math.max(0, cur - 1))}>◀</button>
        <button className="btn" onClick={() => { if (playing) { stop(); token.current++; } else play(); }}>{playing ? "❚❚ Pausar" : "▶ Reproducir"}</button>
        <button className="btn secondary" aria-label="Paso siguiente" onClick={() => go(Math.min(steps.length - 1, cur + 1))}>▶|</button>
        <span className="muted small">paso {cur + 1} de {steps.length}</span>
      </div>
      <ol className="stp-list" ref={listRef}>
        {steps.map((st, i) => (
          <li key={i} className={i === cur ? "act" : i < cur ? "done" : ""} onClick={() => go(i)}><span className="n">{i + 1}</span><span dangerouslySetInnerHTML={{ __html: st.title }} /></li>
        ))}
      </ol>
      <div className="stp-detail">
        <h3 dangerouslySetInnerHTML={{ __html: s.title }} />
        <div className="chips-ro">{s.proto && <span className="tag">{s.proto}</span>}{s.msg && <span className="tag msg">{s.msg}</span>}</div>
        <p dangerouslySetInnerHTML={{ __html: s.desc }} />
        {s.tech && <p className="tech"><b>Detalle técnico:</b> <span dangerouslySetInnerHTML={{ __html: s.tech }} /></p>}
      </div>
    </div>
  );
}
