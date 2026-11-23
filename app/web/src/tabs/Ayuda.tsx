import { useEffect, useState } from "react";
import { api } from "../lib";

export default function Ayuda() {
  const [list, setList] = useState<{ id: string; title: string }[]>([]);
  const [sel, setSel] = useState("");
  const [html, setHtml] = useState("");
  useEffect(() => { api("/api/guide").then((l) => { setList(l); if (l[0]) setSel(l[0].id); }).catch(() => {}); }, []);
  useEffect(() => { if (sel) api("/api/guide/" + sel).then((g) => setHtml(g.html)).catch(() => {}); }, [sel]);
  return (
    <section id="guia">
      <div className="split">
        <ul className="list">{list.map((g) => <li key={g.id} className={g.id === sel ? "active" : ""} onClick={() => setSel(g.id)}>{g.title}</li>)}</ul>
        <article className="md" dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </section>
  );
}
