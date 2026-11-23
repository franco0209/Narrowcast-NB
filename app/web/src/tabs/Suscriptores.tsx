import { useCallback, useEffect, useRef, useState } from "react";
import { Card } from "../components/ui";
import { api, bus, hexRand } from "../lib";
import { fail, refreshCore, toast } from "../store";

const blank = { imsi: "", k: "", opc: "", amf: "8000", sqn: "000000000000", msisdn: "", apn: "internet" };

export default function Suscriptores() {
  const [subs, setSubs] = useState<any[]>([]);
  const [err, setErr] = useState("");
  const [form, setForm] = useState<typeof blank | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const formRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try { setSubs(await api("/api/subscribers")); setErr(""); } catch (e: any) { setErr(e.message); }
  }, []);
  useEffect(() => { load(); return bus.on("subs", load); }, [load]);

  const open = (imsi?: string) => {
    const s = imsi ? subs.find((x) => x.imsi === imsi) : null;
    setEditing(imsi || null);
    setForm({ ...blank, imsi: imsi || "", amf: s?.amf || "8000", msisdn: s?.msisdn || "", apn: s?.apn[0] || "internet" });
    setTimeout(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
  };
  const set = (k: string, v: string) => setForm((f) => (f ? { ...f, [k]: v } : f));
  const save = async () => {
    if (!form) return;
    const body = { imsi: form.imsi.trim(), k: form.k.trim(), opc: form.opc.trim(), amf: form.amf.trim() || "8000", sqn: form.sqn.trim() || "000000000000", msisdn: form.msisdn.trim(), apn: form.apn.trim() || "internet" };
    try {
      if (editing) await api("/api/subscribers/" + editing, { method: "PUT", body: JSON.stringify(body) });
      else await api("/api/subscribers", { method: "POST", body: JSON.stringify(body) });
      toast(editing ? "Suscriptor actualizado" : "Suscriptor creado", "ok"); setForm(null); setEditing(null); load(); refreshCore();
    } catch (e) { fail(e); }
  };
  const del = async (imsi: string) => {
    if (!confirm(`¿Borrar el suscriptor ${imsi}?\nLa SIM dejará de poder registrarse en esta red.`)) return;
    try { await api("/api/subscribers/" + imsi, { method: "DELETE" }); toast("Suscriptor borrado", "ok"); load(); refreshCore(); } catch (e) { fail(e); }
  };
  const importCsv = async (ev: React.ChangeEvent<HTMLInputElement>) => {
    const f = ev.target.files?.[0]; if (!f) return;
    const rows = (await f.text()).split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/^imsi/i.test(l) && !l.startsWith("#"));
    let ok = 0; const errs: string[] = [];
    for (const r of rows) {
      const [imsi, k, opc, msisdn = "", apn = "internet"] = r.split(/[,;\t]/).map((x) => x.trim());
      try { await api("/api/subscribers", { method: "POST", body: JSON.stringify({ imsi, k, opc, msisdn, apn }) }); ok++; } catch (e: any) { errs.push(`${imsi}: ${e.message}`); }
    }
    ev.target.value = ""; toast(`Importados ${ok} de ${rows.length}` + (errs.length ? ` · ${errs[0]}` : ""), errs.length ? "bad" : "ok"); load(); refreshCore();
  };

  return (
    <section id="suscriptores">
      <Card title="Suscriptores (SIM)" sub={subs.length + (subs.length === 1 ? " suscriptor" : " suscriptores")}
        right={<div className="row"><label className="btn secondary" htmlFor="sub-csv">Importar CSV</label><input type="file" id="sub-csv" accept=".csv,.txt" hidden onChange={importCsv} /><button className="btn" onClick={() => open()}>Nuevo suscriptor</button></div>}>
        <div className="tw"><table id="sub-table"><tbody>
          {err ? <tr><td className="muted">{err}</td></tr> : <>
            <tr><th>IMSI</th><th>MSISDN</th><th>APN</th><th>AMF</th><th>Alta (UTC)</th><th /></tr>
            {subs.map((s) => <tr key={s.imsi}><td><b>{s.imsi}</b></td><td>{s.msisdn || "—"}</td><td>{s.apn.join(", ")}</td><td>{s.amf}</td><td>{s.created.replace("T", " ") || "—"}</td>
              <td className="acts"><button className="btn secondary sm" onClick={() => open(s.imsi)}>Editar</button><button className="btn secondary sm danger" onClick={() => del(s.imsi)}>Borrar</button></td></tr>)}
            {!subs.length && <tr><td colSpan={6} className="muted">Aún no hay suscriptores. Crea el primero con «Nuevo suscriptor».</td></tr>}</>}
        </tbody></table></div>
        <p className="muted small">Ki y OPc nunca se muestran. El CSV lleva una línea por SIM: <code>imsi,k,opc[,msisdn,apn]</code>.</p>
      </Card>
      {form && (
        <div className="card" ref={formRef}>
          <div className="card-h"><h2>{editing ? `Editar ${editing}` : "Nuevo suscriptor"}</h2>
            <button className="btn secondary" onClick={() => { set("k", hexRand(16)); set("opc", hexRand(16)); toast("K y OPc aleatorios generados: grábalos en la SIM"); }}>Generar K y OPc aleatorios</button></div>
          <div className="two">
            <div><label className="lbl">IMSI (15 dígitos: PLMN 001/01 + número)</label><input inputMode="numeric" placeholder="001010000000001" autoComplete="off" value={form.imsi} disabled={!!editing} onChange={(e) => set("imsi", e.target.value)} /></div>
            <div><label className="lbl">MSISDN (opcional)</label><input inputMode="numeric" autoComplete="off" value={form.msisdn} onChange={(e) => set("msisdn", e.target.value)} /></div>
          </div>
          <div className="two">
            <div><label className="lbl">K / Ki (32 hex)</label><input autoComplete="off" spellCheck={false} placeholder={editing ? "vacío = no cambiar" : "32 caracteres hexadecimales"} value={form.k} onChange={(e) => set("k", e.target.value)} /></div>
            <div><label className="lbl">OPc (32 hex)</label><input autoComplete="off" spellCheck={false} placeholder={editing ? "vacío = no cambiar" : "32 caracteres hexadecimales"} value={form.opc} onChange={(e) => set("opc", e.target.value)} /></div>
          </div>
          <div className="three">
            <div><label className="lbl">AMF (4 hex)</label><input autoComplete="off" value={form.amf} onChange={(e) => set("amf", e.target.value)} /></div>
            {editing && <div><label className="lbl">SQN (12 hex)</label><input autoComplete="off" value={form.sqn} onChange={(e) => set("sqn", e.target.value)} /></div>}
            <div><label className="lbl">APN</label><input autoComplete="off" value={form.apn} onChange={(e) => set("apn", e.target.value)} /></div>
          </div>
          <div className="row" style={{ marginTop: 14 }}><button className="btn" onClick={save}>Guardar</button><button className="btn secondary" onClick={() => { setForm(null); setEditing(null); }}>Cancelar</button></div>
        </div>
      )}
      <Card title="Cómo se usa cada dato">
        <div className="grid2 inner">
          <div><b>IMSI</b><p className="muted small">Identidad de la SIM. Debe empezar por el PLMN de la red (001 01). El MME lo recibe en el Attach y lo envía al HSS.</p></div>
          <div><b>K y OPc</b><p className="muted small">Claves secretas compartidas entre la SIM y el HSS. Con ellas se calcula la autenticación mutua; deben ser idénticas a las programadas en la SIM.</p></div>
          <div><b>AMF y SQN</b><p className="muted small">AMF forma parte del token de autenticación (8000 es el valor habitual). SQN es un contador anti-repetición que el HSS avanza solo; solo se edita para resincronizar.</p></div>
          <div><b>APN</b><p className="muted small">Nombre de la red de datos. El APN «internet» da una IP de 10.58.0.0/16 que sale por el PGW-U. Debe coincidir con el configurado en el módulo.</p></div>
        </div>
        <p className="muted small">Los cambios se escriben directamente en la base de datos del HSS: valen desde el siguiente intento de conexión, sin reiniciar nada. La WebUI de Open5GS (puerto 9999) sigue disponible como respaldo y usa los mismos datos.</p>
      </Card>
    </section>
  );
}
