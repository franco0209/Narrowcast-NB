import { useEffect, useState } from "react";
import { Pill, Toasts } from "./components/ui";
import { coreCounts, hwState, startRealtime, useStore } from "./store";
import Resumen from "./tabs/Resumen";
import Suscriptores from "./tabs/Suscriptores";
import Nucleo from "./tabs/Nucleo";
import Enb from "./tabs/Enb";
import Radio from "./tabs/Radio";
import Dispositivo from "./tabs/Dispositivo";
import Lab from "./tabs/Lab";
import Ayuda from "./tabs/Ayuda";

const TABS: [string, string, string, () => JSX.Element][] = [
  ["resumen", "◎", "Resumen", Resumen], ["suscriptores", "▣", "Suscriptores", Suscriptores], ["nucleo", "▦", "Núcleo", Nucleo],
  ["enb", "⌁", "eNB (OAI)", Enb], ["radio", "◉", "Radio", Radio], ["dispositivo", "▤", "Dispositivo", Dispositivo],
  ["lab", "⚗", "Laboratorio", Lab], ["guia", "≡", "Ayuda", Ayuda],
];
const fromHash = () => { const h = location.hash.slice(1).split("/")[0]; return TABS.some((t) => t[0] === h) ? h : "resumen"; };

function Clock() {
  const [t, setT] = useState(new Date().toLocaleTimeString());
  useEffect(() => { const i = setInterval(() => setT(new Date().toLocaleTimeString()), 1000); return () => clearInterval(i); }, []);
  return <span className="muted">{t}</span>;
}

export default function App() {
  const [tab, setTab] = useState(fromHash);
  const st = useStore((s) => s);
  useEffect(() => {
    startRealtime();
    if (location.search.includes("still")) document.documentElement.classList.add("still");
    const f = () => setTab(fromHash());
    window.addEventListener("hashchange", f);
    return () => window.removeEventListener("hashchange", f);
  }, []);
  const open = (name: string) => { history.replaceState(null, "", "#" + name); setTab(name); };

  const { total, run } = coreCounts(st);
  const hw = hwState(st), on = Object.values(st.devices).filter((d) => d.online).length;
  const View = TABS.find((t) => t[0] === tab)![3];
  return (
    <>
      <div className="bg-glow" aria-hidden="true" />
      <header className="top">
        <div className="brand">
          <svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true"><circle cx="16" cy="16" r="3" className="b-core" /><circle cx="16" cy="16" r="8" className="b-ring r1" /><circle cx="16" cy="16" r="13" className="b-ring r2" /></svg>
          <div><h1>Narrowcast-NB</h1><small>Red privada NB-IoT · Open5GS</small></div>
        </div>
        <nav>{TABS.map(([id, ic, t]) => <button key={id} className={id === tab ? "active" : ""} onClick={() => open(id)}><i>{ic}</i>{t}</button>)}</nav>
        <div className="status">
          <Pill kind={total && run >= total ? "on" : "off"} title="Contenedores del núcleo">Núcleo {run}/{total || "-"}</Pill>
          <Pill kind={hw.esp.s === "sim" ? "sim" : on ? "on" : "off"} title="Dispositivo">{hw.esp.s === "sim" ? "Dispositivo simulado" : on ? "Dispositivo en línea" : "Sin dispositivo"}</Pill>
          <Pill kind={st.radio.running ? "hot" : "off"}>{st.radio.running ? "RF EMITIENDO" : "RF apagada"}</Pill>
          <Clock />
        </div>
      </header>
      <main className={tab === "lab" ? "wide-main" : ""}><div className="tab active" key={tab}><View /></div></main>
      <Toasts />
    </>
  );
}
