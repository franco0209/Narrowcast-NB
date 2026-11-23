import type { ReactNode } from "react";
import { useStore } from "../store";

export const Pill = ({ kind = "off", children, title }: { kind?: string; children: ReactNode; title?: string }) => (
  <span className={`pill ${kind}`} title={title}><span className="dot" />{children}</span>
);

export const Card = ({ title, sub, right, className = "", children }: { title?: ReactNode; sub?: ReactNode; right?: ReactNode; className?: string; children: ReactNode }) => (
  <div className={`card ${className}`}>
    {(title || right) && (
      <div className="card-h">
        <div>{title && <h2>{title}</h2>}{sub && <span className="muted small">{sub}</span>}</div>
        {right}
      </div>
    )}
    {children}
  </div>
);

export const Legend = ({ items }: { items: [string, string][] }) => (
  <div className="legend">{items.map(([k, t]) => <span key={t}><i className={`lg ${k}`} />{t}</span>)}</div>
);
export const LEG_ALL: [string, string][] = [["ctrl", "señalización"], ["user", "datos de usuario"], ["radio", "radio"]];

export const Seg = ({ value, options, onChange }: { value: string; options: [string, string][]; onChange: (v: string) => void }) => (
  <div className="seg">{options.map(([v, t]) => <button key={v} className={v === value ? "sel" : ""} onClick={() => onChange(v)}>{t}</button>)}</div>
);

export const KV = ({ rows }: { rows: [string, string][] }) => (
  <table className="kv"><tbody>{rows.map(([k, v]) => <tr key={k}><th>{k}</th><td>{v}</td></tr>)}</tbody></table>
);

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return <div id="toasts" aria-live="polite">{toasts.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.msg}</div>)}</div>;
}
