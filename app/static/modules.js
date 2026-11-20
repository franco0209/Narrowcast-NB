// Módulos: Suscriptores, Núcleo (EPC) y eNB (OAI).
const CT = { enb: ["nb-enb-nbiot", "nb-enb"], mme: ["nb-mme"], hss: ["nb-hss"], mongo: ["nb-mongo"], sgwc: ["nb-sgwc"], pgwc: ["nb-pgwc"],
  pcrf: ["nb-pcrf"], sgwu: ["nb-sgwu"], pgwu: ["nb-pgwu"], data: ["nb-mosquitto"] };
const ctUp = (id) => { if (id === "ue") return anyOnline(); const m = cmap(); return (CT[id] || []).some((c) => m[c] === "running"); };

// ============================================================ SUSCRIPTORES
const hexRand = (bytes) => [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
let subsData = [], subEditing = null;
async function loadSubs() {
  try { subsData = await api("/api/subscribers"); } catch (e) { $("#sub-table").innerHTML = `<tr><td class="muted">${esc(e.message)}</td></tr>`; return; }
  $("#sub-count").textContent = subsData.length + (subsData.length === 1 ? " suscriptor" : " suscriptores");
  $("#sub-table").innerHTML = "<tr><th>IMSI</th><th>MSISDN</th><th>APN</th><th>AMF</th><th>Alta (UTC)</th><th></th></tr>" +
    (subsData.map((s) => `<tr><td><b>${esc(s.imsi)}</b></td><td>${esc(s.msisdn || "—")}</td><td>${esc(s.apn.join(", "))}</td><td>${esc(s.amf)}</td><td>${esc(s.created.replace("T", " ") || "—")}</td>
      <td class="acts"><button class="btn secondary sm" data-edit="${esc(s.imsi)}">Editar</button><button class="btn secondary sm danger" data-del="${esc(s.imsi)}">Borrar</button></td></tr>`).join("")
      || "<tr><td colspan=6 class='muted'>Aún no hay suscriptores. Crea el primero con «Nuevo suscriptor».</td></tr>");
  $$("[data-edit]").forEach((b) => b.onclick = () => openSubForm(b.dataset.edit));
  $$("[data-del]").forEach((b) => b.onclick = () => delSub(b.dataset.del));
}
const SF = (k) => $("#sf-" + k);
function openSubForm(imsi) {
  subEditing = imsi || null;
  const s = imsi ? subsData.find((x) => x.imsi === imsi) : null;
  $("#sub-form").hidden = false; $("#sub-form-title").textContent = imsi ? `Editar ${imsi}` : "Nuevo suscriptor";
  SF("imsi").value = imsi || ""; SF("imsi").disabled = !!imsi;
  SF("k").value = ""; SF("opc").value = ""; SF("amf").value = s?.amf || "8000"; SF("sqn").value = "000000000000";
  SF("msisdn").value = s?.msisdn || ""; SF("apn").value = s?.apn[0] || "internet";
  SF("k").placeholder = SF("opc").placeholder = imsi ? "vacío = no cambiar" : "32 caracteres hexadecimales";
  SF("sqn").closest("div").hidden = !imsi; // el SQN solo se toca al editar (resincronización)
  $("#sub-form").scrollIntoView({ behavior: "smooth", block: "nearest" }); (imsi ? SF("k") : SF("imsi")).focus();
}
function closeSubForm() { $("#sub-form").hidden = true; subEditing = null; }
async function saveSub() {
  const body = { imsi: SF("imsi").value.trim(), k: SF("k").value.trim(), opc: SF("opc").value.trim(), amf: SF("amf").value.trim() || "8000",
    sqn: SF("sqn").value.trim() || "000000000000", msisdn: SF("msisdn").value.trim(), apn: SF("apn").value.trim() || "internet" };
  try {
    if (subEditing) await api("/api/subscribers/" + subEditing, { method: "PUT", body: JSON.stringify(body) });
    else await api("/api/subscribers", { method: "POST", body: JSON.stringify(body) });
    toast(subEditing ? "Suscriptor actualizado" : "Suscriptor creado", "ok"); closeSubForm(); loadSubs(); refreshCore();
  } catch (e) { fail(e); }
}
async function delSub(imsi) {
  if (!confirm(`¿Borrar el suscriptor ${imsi}?\nLa SIM dejará de poder registrarse en esta red.`)) return;
  try { await api("/api/subscribers/" + imsi, { method: "DELETE" }); toast("Suscriptor borrado", "ok"); loadSubs(); refreshCore(); } catch (e) { fail(e); }
}
$("#sub-new").onclick = () => openSubForm();
$("#sub-cancel").onclick = closeSubForm;
$("#sub-save").onclick = saveSub;
$("#sub-gen").onclick = () => { SF("k").value = hexRand(16); SF("opc").value = hexRand(16); toast("K y OPc aleatorios generados: grábalos en la SIM"); };
$("#sub-csv").onchange = async (ev) => {
  const f = ev.target.files[0]; if (!f) return;
  const rows = (await f.text()).split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/^imsi/i.test(l) && !l.startsWith("#"));
  let ok = 0; const errs = [];
  for (const r of rows) {
    const [imsi, k, opc, msisdn = "", apn = "internet"] = r.split(/[,;\t]/).map((x) => x.trim());
    try { await api("/api/subscribers", { method: "POST", body: JSON.stringify({ imsi, k, opc, msisdn, apn }) }); ok++; } catch (e) { errs.push(`${imsi}: ${e.message}`); }
  }
  ev.target.value = ""; toast(`Importados ${ok} de ${rows.length}` + (errs.length ? ` · ${errs[0]}` : ""), errs.length ? "bad" : "ok"); loadSubs(); refreshCore();
};

// ================================================================== NÚCLEO
const CORE_NODES = [
  { id: "ue", label: "Módulo", sub: "UE NB-IoT", x: 0, y: 195, w: 118, h: 50, icon: "ue", ext: true },
  { id: "enb", label: "eNB", sub: "estación base", x: 150, y: 195, w: 128, h: 50, icon: "tower", ext: true },
  { id: "mme", label: "MME", sub: "señalización NAS", x: 345, y: 40, w: 135, h: 50, icon: "ctrl" },
  { id: "hss", label: "HSS", sub: "claves e IMSI", x: 570, y: 40, w: 135, h: 50, icon: "key" },
  { id: "mongo", label: "MongoDB", sub: "suscriptores", x: 795, y: 40, w: 135, h: 50, icon: "db" },
  { id: "sgwc", label: "SGW-C", sub: "control del túnel", x: 345, y: 195, w: 135, h: 50, icon: "route" },
  { id: "pgwc", label: "PGW-C / SMF", sub: "sesión e IP", x: 570, y: 195, w: 135, h: 50, icon: "route" },
  { id: "pcrf", label: "PCRF", sub: "políticas", x: 795, y: 195, w: 135, h: 50, icon: "shield" },
  { id: "sgwu", label: "SGW-U", sub: "datos S1-U/S5-U", x: 345, y: 350, w: 135, h: 50, icon: "layers" },
  { id: "pgwu", label: "PGW-U / UPF", sub: "salida ogstun", x: 570, y: 350, w: 135, h: 50, icon: "layers" },
  { id: "data", label: "Red de datos", sub: "Mosquitto MQTT", x: 795, y: 350, w: 135, h: 50, icon: "cloud" },
];
const CORE_EDGES = [
  { a: "ue", b: "enb", kind: "radio", label: "Uu · radio" },
  { a: "enb", b: "mme", kind: "ctrl", label: "S1-MME · SCTP 36412" },
  { a: "enb", b: "sgwu", kind: "user", label: "S1-U · GTP-U 2152" },
  { a: "mme", b: "hss", kind: "ctrl", label: "S6a · Diameter" },
  { a: "hss", b: "mongo", kind: "ctrl", label: "TCP 27017" },
  { a: "mme", b: "sgwc", kind: "ctrl", label: "S11 · GTPv2-C" },
  { a: "sgwc", b: "pgwc", kind: "ctrl", label: "S5-C · GTPv2-C" },
  { a: "pgwc", b: "pcrf", kind: "ctrl", label: "Gx · Diameter" },
  { a: "sgwc", b: "sgwu", kind: "ctrl", label: "Sxa · PFCP 8805" },
  { a: "pgwc", b: "pgwu", kind: "ctrl", label: "Sxb · PFCP 8805" },
  { a: "sgwu", b: "pgwu", kind: "user", label: "S5-U · GTP-U 2152" },
  { a: "pgwu", b: "data", kind: "user", label: "SGi · IP" },
];
const CORE_INFO = {
  ue: { t: "Módulo NB-IoT (UE)", d: "El dispositivo: ESP32 + módulo SIM7080G/BG96 con su SIM. Es quien pide registrarse en la red; el resto del diagrama responde a sus mensajes.", cfg: [["Identidad", "IMSI de la SIM"], ["Credenciales", "K y OPc (solo en la SIM y en MongoDB)"], ["PLMN", "001/01"]] },
  enb: { t: "eNB (estación base)", d: "Traduce la radio a IP. Se explica en detalle en el módulo «eNB (OAI)». Aquí solo importa su doble conexión con el núcleo: señalización hacia el MME y datos hacia el SGW-U.", cfg: [["S1-MME", "SCTP 36412 → MME 10.44.0.10"], ["S1-U", "GTP-U 2152 → SGW-U 10.44.0.13"], ["IP del eNB", "10.44.0.40"]] },
  mme: { t: "MME · Mobility Management Entity", d: "Cerebro de la señalización: acepta al eNB (S1 Setup), autentica al módulo con ayuda del HSS, negocia la seguridad NAS, pide la creación de la sesión de datos y hace el paging.", cfg: [["Contenedor / IP", "nb-mme · 10.44.0.10"], ["S1AP", "10.44.0.10 (SCTP 36412)"], ["GTP-C", "10.44.0.10 → SGW-C 10.44.0.12 y SMF 10.44.0.14"], ["PLMN / TAC", "001/01 · TAC 1"], ["GUMMEI", "MME group 2, code 1"], ["Seguridad NAS", "integridad EIA2>EIA1>EIA0 · cifrado EEA0>EEA1>EEA2"]] },
  hss: { t: "HSS · Home Subscriber Server", d: "Guarda la identidad y las claves de cada SIM. Cuando el MME pregunta por un IMSI, calcula el vector de autenticación (Milenage con K y OPc) y entrega el perfil: APN permitidos, QoS, AMBR.", cfg: [["Contenedor / IP", "nb-hss · 10.44.0.11"], ["Interfaz", "S6a (Diameter, freeDiameter) con el MME"], ["Base de datos", "mongodb://mongo/open5gs"]] },
  mongo: { t: "MongoDB", d: "Base de datos donde viven los suscriptores. El panel (módulo Suscriptores), la WebUI de Open5GS y el provisionador escriben aquí; HSS, PGW-C/SMF y PCRF leen. Un cambio aplica en el siguiente attach, sin reiniciar nada.", cfg: [["Contenedor / IP", "nb-mongo · 10.44.0.2"], ["Base", "open5gs · colección subscribers"], ["Volumen", "narrowcast-nb-mongo-data"]] },
  sgwc: { t: "SGW-C · plano de control del Serving GW", d: "Recibe del MME la orden de crear la sesión (S11), la reenvía al PGW-C (S5-C) y programa al SGW-U por PFCP para que reenvíe los paquetes del túnel.", cfg: [["Contenedor / IP", "nb-sgwc · 10.44.0.12"], ["GTP-C", "10.44.0.12"], ["PFCP", "10.44.0.12 → SGW-U 10.44.0.13 y SMF 10.44.0.14"]] },
  pgwc: { t: "PGW-C / SMF · control de sesión", d: "Crea la sesión de datos del APN «internet», reserva una IP para el módulo, consulta políticas al PCRF (Gx) y configura al PGW-U por PFCP.", cfg: [["Contenedor / IP", "nb-pgwc · 10.44.0.14"], ["APN / subred", "internet · 10.58.0.0/16 (gateway 10.58.0.1)"], ["DNS / MTU", "1.1.1.1 · 1400"], ["PFCP", "→ UPF 10.44.0.15"]] },
  pcrf: { t: "PCRF · políticas y cobro", d: "Entrega las reglas de calidad (QCI 9, prioridad) para cada sesión. En este proyecto aplica políticas por defecto: no hay cobro ni reglas especiales.", cfg: [["Contenedor / IP", "nb-pcrf · 10.44.0.16"], ["Interfaz", "Gx (Diameter) con el PGW-C"]] },
  sgwu: { t: "SGW-U · plano de usuario del Serving GW", d: "Reenvía los paquetes del módulo entre el túnel GTP-U del eNB (S1-U) y el del PGW-U (S5-U). No decide nada: obedece las reglas PFCP.", cfg: [["Contenedor / IP", "nb-sgwu · 10.44.0.13"], ["GTP-U", "10.44.0.13 (UDP 2152)"]] },
  pgwu: { t: "PGW-U / UPF · salida a la red de datos", d: "Último salto del túnel: desencapsula GTP-U y entrega el paquete IP por la interfaz virtual ogstun, de donde sale hacia la red de datos (el broker MQTT). Aquí viven las IP 10.58.x.x.", cfg: [["Contenedor / IP", "nb-pgwu · 10.44.0.15"], ["Interfaz", "ogstun · 10.58.0.1"], ["Pendiente", "ruta de retorno a 10.58.0.0/16 hacia el broker, aún sin verificar"]] },
  data: { t: "Red de datos · broker MQTT", d: "Destino de los datos del módulo: Mosquitto recibe la telemetría en nb/<id>/telemetry y entrega las órdenes de nb/<id>/cmd. El panel es el otro cliente MQTT.", cfg: [["Contenedor / IP", "nb-mosquitto · 10.44.0.5"], ["Puerto", "1883 (usuario y clave en .env)"]] },
};
const ATTACH = [
  { title: "El módulo pide conexión por radio", hops: [["ue", "enb"]], proto: "Uu · RRC", msg: "NPRACH → RRCConnectionSetup", desc: "El módulo se sincroniza con la portadora del eNB, envía un preámbulo aleatorio y establece la conexión RRC. En el último mensaje RRC lleva dentro el <b>Attach Request</b> (NAS).", tech: "El Attach Request incluye el IMSI (o GUTI) y la solicitud de conexión PDN para el APN «internet». Viaja como carga NAS dentro de RRCConnectionSetupComplete." },
  { title: "El eNB reenvía el Attach al MME", hops: [["enb", "mme"]], proto: "S1AP · SCTP 36412", msg: "Initial UE Message", desc: "El eNB no entiende el contenido NAS: lo encapsula en un <b>Initial UE Message</b> y lo manda al MME junto con la celda y el TAI.", tech: "El eNB ya se había registrado antes con S1 Setup (el MME respondió «eNB-S1 accepted»). Si el TAC/PLMN no coincide con el del MME, este rechaza." },
  { title: "El MME pide credenciales al HSS", hops: [["mme", "hss"]], proto: "S6a · Diameter", msg: "Authentication-Information-Request", desc: "El MME envía el IMSI y la red visitada (PLMN 001/01) al HSS para obtener un vector de autenticación.", tech: "AIR/AIA en S6a. Sin IMSI dado de alta, el HSS responde error y el attach falla aquí: por eso el módulo Suscriptores es el primer paso." },
  { title: "El HSS lee la SIM y genera el vector", hops: [["hss", "mongo"], ["mongo", "hss"], ["hss", "mme"]], proto: "MongoDB → S6a", msg: "Authentication-Information-Answer", desc: "El HSS busca el IMSI en MongoDB, toma K, OPc y SQN, calcula con <b>Milenage</b> el vector (RAND, AUTN, XRES, KASME) y se lo devuelve al MME.", tech: "K y OPc nunca viajan al MME: solo el vector derivado. El SQN avanza en cada autenticación para evitar repeticiones." },
  { title: "Autenticación mutua con el módulo", hops: [["mme", "enb"], ["enb", "ue"], ["ue", "enb"], ["enb", "mme"]], proto: "NAS sobre S1AP/RRC", msg: "Authentication Request / Response", desc: "El MME envía RAND y AUTN. La SIM verifica que AUTN es válido (la red es legítima) y responde con RES. El MME comprueba que RES = XRES (el módulo es legítimo).", tech: "Si la SIM tiene otra K u OPc, AUTN no valida y el módulo responde «MAC failure»." },
  { title: "Se activa la seguridad NAS", hops: [["mme", "enb"], ["enb", "ue"], ["ue", "enb"], ["enb", "mme"]], proto: "NAS", msg: "Security Mode Command / Complete", desc: "El MME elige los algoritmos de integridad y cifrado según su lista de preferencia y ambos derivan las claves a partir de KASME.", tech: "Integridad EIA2 > EIA1 > EIA0 y cifrado EEA0 > EEA1 > EEA2 (config/open5gs/mme.yaml): el primero que el módulo soporte." },
  { title: "El MME descarga el perfil del suscriptor", hops: [["mme", "hss"], ["hss", "mme"]], proto: "S6a · Diameter", msg: "Update-Location-Request / Answer", desc: "El MME registra su identidad como servidor actual del IMSI y recibe el perfil: APN permitido, QoS (QCI 9), AMBR y restricciones de acceso.", tech: "Es la «subscription data» que se grabó al dar de alta la SIM (slice sst 1, sesión «internet», tipo IPv4)." },
  { title: "Se pide crear la sesión de datos", hops: [["mme", "sgwc"], ["sgwc", "pgwc"]], proto: "S11 / S5-C · GTPv2-C", msg: "Create Session Request", desc: "El MME pide al SGW-C una sesión para el APN «internet» y este la reenvía al PGW-C/SMF, que decide la IP del módulo.", tech: "GTPv2-C sobre UDP 2123. Lleva IMSI, APN, tipo de PDN, QoS del bearer por defecto y las direcciones/TEID de control." },
  { title: "El SMF consulta las políticas", hops: [["pgwc", "pcrf"], ["pcrf", "pgwc"]], proto: "Gx · Diameter", msg: "Credit-Control Request / Answer", desc: "El PGW-C pregunta al PCRF qué reglas de calidad aplicar a la sesión. Aquí contesta con las políticas por defecto.", tech: "CCR-Initial / CCA con las reglas PCC; sin reglas dinámicas en este proyecto." },
  { title: "Se programan los planos de usuario", hops: [["sgwc", "sgwu"], ["pgwc", "pgwu"]], proto: "Sxa / Sxb · PFCP 8805", msg: "Session Establishment Request", desc: "Los planos de control ordenan a los de usuario cómo reenviar: crean túneles GTP-U con sus TEID. El PGW-U prepara la interfaz ogstun para la subred 10.58.0.0/16.", tech: "PFCP separa «decidir» (SGW-C/PGW-C) de «reenviar» (SGW-U/PGW-U). Las reglas PDR/FAR son las instrucciones de reenvío." },
  { title: "La red responde con la IP asignada", hops: [["pgwc", "sgwc"], ["sgwc", "mme"]], proto: "S5-C / S11 · GTPv2-C", msg: "Create Session Response", desc: "Sube la respuesta con la <b>IP del módulo</b> (de 10.58.0.0/16) y los TEID del túnel hacia el MME.", tech: "La IP viaja después al módulo dentro del Attach Accept (PDN Address)." },
  { title: "El MME acepta el attach", hops: [["mme", "enb"], ["enb", "ue"]], proto: "S1AP + NAS", msg: "Initial Context Setup Request + Attach Accept", desc: "El MME ordena al eNB preparar el contexto del módulo y le entrega el <b>Attach Accept</b> con la IP y la configuración del bearer por defecto.", tech: "Incluye la dirección y TEID del SGW-U para que el eNB sepa hacia dónde enviar el tráfico de subida (S1-U)." },
  { title: "El módulo confirma y se cierra el túnel", hops: [["ue", "enb"], ["enb", "mme"], ["mme", "sgwc"], ["sgwc", "sgwu"]], proto: "NAS · S1AP · S11 · PFCP", msg: "Attach Complete → Modify Bearer", desc: "El módulo confirma, el eNB informa su TEID de bajada y el MME lo comunica al SGW-C, que actualiza al SGW-U. El túnel queda completo en ambos sentidos.", tech: "Modify Bearer Request lleva la dirección y TEID del eNB; el SGW-U los recibe por PFCP Session Modification." },
  { title: "Fluyen los datos de usuario", hops: [["ue", "enb"], ["enb", "sgwu"], ["sgwu", "pgwu"], ["pgwu", "data"]], proto: "Uu · S1-U · S5-U · SGi", msg: "IP dentro de GTP-U", color: "var(--user)", desc: "Cada paquete del módulo (por ejemplo, MQTT hacia Mosquitto) va dentro de dos túneles GTP-U encadenados, se desencapsula en el PGW-U y sale como IP normal.", tech: "UDP 2152 en S1-U y S5-U. El PGW-U conoce al módulo por su IP 10.58.x.x. Pendiente: la ruta de retorno desde el broker." },
];
let coreDg = null, coreStepper = null;
function initCore() {
  if (coreDg) return;
  coreDg = makeDiagram($("#core-svg"), { nodes: CORE_NODES, edges: CORE_EDGES, w: 960, h: 430, onSelect: selectCoreNode });
  coreStepper = makeStepper($("#attach-stepper"), coreDg, ATTACH);
  $$("#core-layers button").forEach((b) => b.onclick = () => { $$("#core-layers button").forEach((x) => x.classList.toggle("sel", x === b)); coreDg.layer(b.dataset.k || null); });
  coreDg.ambient(true); updateCoreLive(); selectCoreNode("mme");
}
function updateCoreLive() {
  if (!coreDg) return;
  const up = {}; CORE_NODES.forEach((n) => { up[n.id] = ctUp(n.id); coreDg.setNodeUp(n.id, up[n.id]); });
  const online = anyOnline();
  coreDg.edges.forEach((e, i) => { let l = up[e.a] && up[e.b]; if (e.kind === "user") l = l && online; if (e.kind === "radio") l = online && up.enb; coreDg.setLive(i, l); });
  const run = CORE_NODES.filter((n) => !n.ext && up[n.id]).length, tot = CORE_NODES.filter((n) => !n.ext).length;
  $("#core-health").className = "pill " + (run === tot ? "on" : run ? "off" : "off"); $("#core-health").lastElementChild.textContent = `${run}/${tot} componentes activos`;
}
let coreSel = "mme";
async function selectCoreNode(id) {
  coreSel = id; coreDg.select(id); coreStepper?.stop();
  const n = CORE_NODES.find((x) => x.id === id), i = CORE_INFO[id], up = ctUp(id), box = $("#core-info");
  const links = CORE_EDGES.filter((e) => e.a === id || e.b === id).map((e) => { const o = e.a === id ? e.b : e.a; return `<li><span class="dot-k ${e.kind}"></span><b>${esc(e.label)}</b> <span class="muted">↔ ${esc(CORE_NODES.find((x) => x.id === o).label)}</span></li>`; }).join("");
  box.innerHTML = `<h3>${esc(i.t)} <span class="pill ${up ? "on" : "off"}"><span class="dot"></span>${up ? "activo" : n.ext ? "externo / inactivo" : "apagado"}</span></h3><p>${esc(i.d)}</p>
    <h4>Interfaces</h4><ul class="ifl">${links}</ul>
    <h4>Parámetros reales</h4><table class="kv">${i.cfg.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</table>`;
  const c = (CT[id] || []).find((x) => cmap()[x]);
  if (c) {
    box.insertAdjacentHTML("beforeend", `<h4>Registro en vivo · ${esc(c)}</h4><pre class="log" id="core-log">cargando…</pre>`);
    loadCoreLog(c);
  }
}
async function loadCoreLog(c) {
  try { const l = await api(`/api/logs/${c}?tail=40`), v = $("#core-log"); if (v && CT[coreSel]?.includes(c)) { v.textContent = l.lines.join("\n") || "(sin registro)"; v.scrollTop = v.scrollHeight; } } catch (e) { /* sin log */ }
}
setInterval(() => { if (activeTab() === "nucleo") { const c = (CT[coreSel] || []).find((x) => cmap()[x]); if (c && $("#core-log")) loadCoreLog(c); } }, 4000);

// ================================================================ eNB (OAI)
const ENB_NODES = [
  { id: "mme", label: "MME", sub: "10.44.0.10", x: 0, y: 14, w: 110, h: 46, icon: "ctrl", ext: true },
  { id: "s1ap", label: "S1AP / SCTP", sub: "puerto 36412", x: 150, y: 14, w: 150, h: 46, icon: "doc" },
  { id: "gtpu", label: "GTP-U / UDP", sub: "puerto 2152", x: 320, y: 14, w: 150, h: 46, icon: "layers" },
  { id: "sgwu", label: "SGW-U", sub: "10.44.0.13", x: 510, y: 14, w: 110, h: 46, icon: "layers", ext: true },
  { id: "rrc", label: "RRC", sub: "conexión y SIB-NB", x: 150, y: 94, w: 150, h: 46, icon: "ctrl" },
  { id: "pdcp", label: "PDCP", sub: "cabeceras y seguridad", x: 320, y: 94, w: 150, h: 46, icon: "layers" },
  { id: "rlc", label: "RLC", sub: "segmentación y reenvío", x: 150, y: 174, w: 320, h: 46, icon: "layers" },
  { id: "mac", label: "MAC", sub: "planificación de recursos", x: 150, y: 254, w: 320, h: 46, icon: "layers" },
  { id: "phy", label: "PHY NB-IoT", sub: "NPSS·NSSS·NPBCH·NPDCCH·NPDSCH·NPUSCH·NPRACH", x: 150, y: 334, w: 320, h: 50, icon: "pulse" },
  { id: "uhd", label: "UHD → USRP", sub: "muestras IQ", x: 150, y: 414, w: 320, h: 46, icon: "chip" },
  { id: "rf", label: "Cable + atenuador", sub: "o antena autorizada", x: 150, y: 494, w: 150, h: 46, icon: "tower" },
  { id: "ue", label: "Módulo NB-IoT", sub: "UE", x: 320, y: 494, w: 150, h: 46, icon: "ue", ext: true },
];
const ENB_EDGES = [
  { a: "mme", b: "s1ap", kind: "ctrl", label: "S1-MME" }, { a: "sgwu", b: "gtpu", kind: "user", label: "S1-U" },
  { a: "s1ap", b: "rrc", kind: "ctrl" }, { a: "gtpu", b: "pdcp", kind: "user" }, { a: "rrc", b: "pdcp", kind: "ctrl" },
  { a: "rrc", b: "rlc", kind: "ctrl" }, { a: "pdcp", b: "rlc", kind: "user" }, { a: "rlc", b: "mac", kind: "user" },
  { a: "mac", b: "phy", kind: "user" }, { a: "phy", b: "uhd", kind: "user" }, { a: "uhd", b: "rf", kind: "radio" }, { a: "rf", b: "ue", kind: "radio", label: "Uu" },
];
const ENB_INFO = {
  mme: { t: "MME (núcleo)", d: "Con quien el eNB abre el enlace de señalización. Al arrancar, el eNB envía S1 Setup y el MME lo acepta o lo rechaza según PLMN y TAC.", cfg: [["Dirección", "10.44.0.10 (mme_ip_address de la plantilla)"], ["PLMN / TAC", "001/01 · TAC 1 (deben coincidir en ambos)"]] },
  sgwu: { t: "SGW-U (núcleo)", d: "Extremo del túnel de datos. El eNB y el SGW-U intercambian paquetes de usuario encapsulados en GTP-U.", cfg: [["Dirección", "10.44.0.13"]] },
  s1ap: { t: "S1AP sobre SCTP", d: "Protocolo de señalización entre eNB y MME: S1 Setup, Initial UE Message, Initial Context Setup, paging… Es lo primero que se verifica sin radio (S1_ONLY=1).", cfg: [["Transporte", "SCTP, puerto 36412"], ["IP del eNB", "10.44.0.40 (ENB_IPV4_ADDRESS_FOR_S1_MME)"], ["Interfaz", "eth0 del contenedor"]] },
  gtpu: { t: "GTP-U sobre UDP", d: "Túnel de datos de usuario hacia el SGW-U. Cada paquete IP del módulo viaja encapsulado con un identificador de túnel (TEID).", cfg: [["Transporte", "UDP, puerto 2152"], ["IP del eNB", "10.44.0.40 (ENB_IPV4_ADDRESS_FOR_S1U)"]] },
  rrc: { t: "RRC · control de recursos de radio", d: "Gestiona la conexión con el módulo: difunde la información del sistema (SIB-NB), establece y reconfigura la conexión y transporta los mensajes NAS que van al MME.", cfg: [["Origen", "rama develop-nb-iot de OpenAirInterface"], ["PLMN / TAC", "001/01 · tracking_area_code 1"]] },
  pdcp: { t: "PDCP", d: "Comprime/gestiona cabeceras, numera paquetes y aplica cifrado e integridad de la radio entre el módulo y el eNB.", cfg: [["Portadoras", "SRB (señalización) y DRB (datos)"]] },
  rlc: { t: "RLC", d: "Segmenta los paquetes para que quepan en los bloques de radio y, en modo con acuse, retransmite lo que se pierde.", cfg: [["Modos", "AM (con acuse) para señalización y datos"]] },
  mac: { t: "MAC · planificador", d: "Decide quién transmite cuándo: reparte los recursos de bajada (NPDCCH/NPDSCH) y subida (NPUSCH) y atiende el acceso aleatorio del módulo (NPRACH).", cfg: [["Nota", "NB-IoT usa una portadora de 180 kHz y repeticiones para ganar alcance"]] },
  phy: { t: "PHY NB-IoT", d: "Genera la señal de radio. En bajada difunde sincronismo (NPSS/NSSS) y sistema (NPBCH) y envía datos por NPDCCH/NPDSCH; en subida recibe NPRACH y NPUSCH.", cfg: [["Banda y frecuencia", "del plan RF (rf-plan.yaml)"], ["Ganancia", "tx_gain del plan, pasado tal cual a UHD como ganancia (dB); medir la potencia real con analizador"], ["Riesgo conocido", "funciones de subida no conformes con 3GPP en esta rama; probada con Quectel BC95, no con Open5GS"]] },
  uhd: { t: "UHD → USRP", d: "El driver UHD entrega al USRP las muestras IQ de la señal y recibe las del receptor. El USRP las convierte a RF con sus DAC/ADC y su oscilador.", cfg: [["Imagen", "UHD 3.15 compilado en el contenedor"], ["USB", "si el USRP es USB hay que pasar /dev/bus/usb al contenedor (compose.yaml)"], ["Sin USRP", "el eNB termina con «No USRP Device Found»"]] },
  rf: { t: "Camino de RF", d: "De la salida del USRP al módulo: por defecto cable coaxial con atenuador (≥ 60 dB); la antena solo con permiso escrito.", cfg: [["Modo", "cable + atenuación (plan RF)"], ["Regla", "se emite solo con plan válido, duración limitada y botón mantenido"]] },
  ue: { t: "Módulo NB-IoT", d: "Recibe NPSS/NSSS, lee el NPBCH, ejecuta el acceso aleatorio y desde ahí comienza el procedimiento de attach.", cfg: [["Banda", "debe coincidir con la del plan RF"]] },
};
const LAYERS_DL = (core) => [
  { title: core ? "Llega el paquete por el túnel S1-U" : "Llega la señalización del MME", hops: [[core ? "sgwu" : "mme", core ? "gtpu" : "s1ap"]], proto: core ? "GTP-U · UDP 2152" : "S1AP · SCTP 36412", msg: core ? "T-PDU" : "Downlink NAS Transport", desc: core ? "El eNB recibe un paquete IP del módulo destino dentro de un túnel GTP-U y lo desencapsula." : "El MME manda al eNB un mensaje NAS (por ejemplo, Authentication Request) dentro de S1AP.", tech: core ? "El TEID identifica a qué portadora de qué módulo pertenece." : "El eNB no interpreta el NAS: solo lo reenvía al módulo." },
  { title: core ? "Se asigna a su portadora de datos" : "RRC lo encapsula", hops: [[core ? "gtpu" : "s1ap", core ? "pdcp" : "rrc"]], proto: core ? "PDCP · DRB" : "RRC · SRB1", msg: core ? "SDU de datos" : "DLInformationTransfer-NB", desc: core ? "El paquete entra a PDCP, que le añade número de secuencia y lo cifra." : "RRC mete el mensaje NAS dentro de un mensaje RRC para el módulo.", tech: core ? "NB-IoT usa pocas portadoras de datos por módulo." : "Se envía por la portadora de señalización SRB1." },
  ...(core ? [] : [{ title: "PDCP protege el mensaje", hops: [["rrc", "pdcp"]], proto: "PDCP · SRB", msg: "PDU PDCP", desc: "Se numera, se protege su integridad y se cifra.", tech: "Con las claves derivadas en la seguridad de acceso (AS)." }]),
  { title: "RLC lo segmenta", hops: [["pdcp", "rlc"]], proto: "RLC · AM", msg: "PDU RLC", desc: "El paquete se corta en trozos que caben en un bloque de transporte NB-IoT.", tech: "En modo con acuse el módulo confirma lo recibido y el eNB retransmite si falta algo." },
  { title: "MAC lo programa", hops: [["rlc", "mac"]], proto: "MAC", msg: "Transport Block", desc: "El planificador reserva subtramas de bajada y programa la transmisión.", tech: "En NB-IoT se aplican repeticiones para llegar a módulos con mala cobertura." },
  { title: "PHY genera la señal NB-IoT", hops: [["mac", "phy"]], proto: "PHY", msg: "NPDCCH + NPDSCH", desc: "Codificación, modulación y mapeo a la portadora de 180 kHz.", tech: "Se multiplexa con NPSS/NSSS/NPBCH que se difunden siempre." },
  { title: "UHD entrega muestras IQ al USRP", hops: [["phy", "uhd"]], proto: "UHD · USB/Ethernet", msg: "Muestras IQ", desc: "El driver transfiere la señal digital al USRP.", tech: "La ganancia de transmisión del plan se traduce en el parámetro tx_gain de OAI." },
  { title: "El USRP la convierte a RF", hops: [["uhd", "rf"]], proto: "RF", msg: "Portadora de la banda del plan", desc: "El USRP emite en la frecuencia de bajada del plan RF hacia el cable y el atenuador.", tech: "Esta es la parte regulada: solo con plan válido y autorización." },
  { title: "El módulo recibe", hops: [["rf", "ue"]], proto: "Uu", msg: "Señal NB-IoT", desc: "El módulo, con su sensibilidad muy alta, decodifica el mensaje.", tech: "Con el atenuador del plan la señal llega muy debilitada al módulo." },
];
const LAYERS_UL = [
  { title: "El módulo transmite", hops: [["ue", "rf"]], proto: "Uu · NPUSCH / NPRACH", msg: "Datos o preámbulo", desc: "El módulo emite en la frecuencia de subida. Para entrar a la red empieza con NPRACH; luego usa NPUSCH.", tech: "Subida y bajada están separadas en frecuencia (FDD)." },
  { title: "El USRP digitaliza", hops: [["rf", "uhd"]], proto: "RF → IQ", msg: "Muestras IQ", desc: "El receptor del USRP convierte la señal en muestras digitales para el PC.", tech: "rx_gain de la plantilla fija la ganancia de recepción." },
  { title: "PHY decodifica", hops: [["uhd", "phy"]], proto: "PHY", msg: "NPUSCH decodificado", desc: "Sincroniza, demodula y corrige errores para recuperar el bloque de transporte.", tech: "Aquí la rama develop-nb-iot tiene funciones de subida no conformes con 3GPP (riesgo documentado)." },
  { title: "MAC entrega el bloque", hops: [["phy", "mac"]], proto: "MAC", msg: "Transport Block", desc: "Identifica al módulo y pasa los datos a la capa superior.", tech: "También atiende el acceso aleatorio y los avances de temporización." },
  { title: "RLC reensambla", hops: [["mac", "rlc"]], proto: "RLC · AM", msg: "SDU", desc: "Junta los trozos y confirma la recepción al módulo.", tech: "" },
  { title: "PDCP descifra", hops: [["rlc", "pdcp"]], proto: "PDCP", msg: "SDU PDCP", desc: "Verifica integridad, descifra y entrega el paquete.", tech: "" },
  { title: "Sale al núcleo por S1-U", hops: [["pdcp", "gtpu"], ["gtpu", "sgwu"]], proto: "GTP-U · UDP 2152", msg: "T-PDU", desc: "El paquete IP del módulo se encapsula en GTP-U y se envía al SGW-U.", tech: "A partir de aquí lo ve el módulo «Núcleo»." },
];
const START = [
  { k: "plan", t: "El panel valida el plan RF", d: "scripts/rf-check.sh exige banda soportada, autorización, ganancia ≤ 30, ≥ 60 dB en cable, duración 1–600 s y portadora libre." },
  { k: "up", t: "Se enciende el contenedor nb-enb-nbiot", d: "El panel arranca el contenedor ya creado (docker start)." },
  { k: "conf", t: "oai-enb-start.sh genera la configuración", d: "Rellena la plantilla enb.nbiot.conf.tmpl con banda, frecuencia, ganancia TX (tal cual el plan) y la IP del MME." },
  { k: "usrp", t: "lte-softmodem abre el USRP por UHD", d: "Sin USRP termina aquí con «No USRP Device Found»." },
  { k: "s1", t: "S1 Setup con el MME", d: "El eNB se presenta (PLMN, TAC) y el MME responde «eNB-S1 accepted».", live: "s1" },
  { k: "bcast", t: "La PHY difunde NPSS, NSSS y NPBCH", d: "El módulo ya puede sincronizarse y leer la información del sistema (SIB-NB)." },
  { k: "cut", t: "El panel corta la emisión al cumplirse la duración", d: "También se corta al detener a mano o al reiniciar el panel (RF apagada por defecto)." },
];
let enbDg = null, enbStepper = null, enbData = null, enbFlow = "dl-user", enbSel = "phy";
function setEnbFlow(f) {
  enbFlow = f; $$("#enb-flows button").forEach((b) => b.classList.toggle("sel", b.dataset.f === f));
  const steps = f === "dl-user" ? LAYERS_DL(true) : f === "dl-sig" ? LAYERS_DL(false) : LAYERS_UL;
  enbStepper?.stop(); enbDg.focus(null, []); enbStepper = makeStepper($("#enb-stepper"), enbDg, steps);
}
function initEnb() {
  if (enbDg) return;
  enbDg = makeDiagram($("#enb-svg"), { nodes: ENB_NODES, edges: ENB_EDGES, w: 620, h: 560, onSelect: selectEnbNode });
  $$("#enb-flows button").forEach((b) => b.onclick = () => setEnbFlow(b.dataset.f));
  setEnbFlow("dl-user"); enbDg.ambient(true); selectEnbNode("phy");
  $("#enb-start").innerHTML = START.map((s, i) => `<li data-k="${s.k}"><span class="n">${i + 1}</span><div><b>${esc(s.t)}</b><p class="muted small">${esc(s.d)}</p>${s.live ? `<span class="tag" data-live="${s.live}">…</span>` : ""}</div></li>`).join("");
  refreshEnb();
}
function selectEnbNode(id) {
  enbSel = id; enbDg.select(id); enbStepper?.stop(); enbDg.focus(null, []);
  const i = ENB_INFO[id], box = $("#enb-info");
  const links = ENB_EDGES.filter((e) => e.a === id || e.b === id).map((e) => { const o = e.a === id ? e.b : e.a; return `<li><span class="dot-k ${e.kind}"></span>${e.label ? `<b>${esc(e.label)}</b> ` : ""}<span class="muted">↔ ${esc(ENB_NODES.find((x) => x.id === o).label)}</span></li>`; }).join("");
  box.innerHTML = `<h3>${esc(i.t)}</h3><p>${esc(i.d)}</p><h4>Se conecta con</h4><ul class="ifl">${links}</ul><h4>En este proyecto</h4><table class="kv">${i.cfg.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</table>`;
}
async function refreshEnb() {
  if (!enbDg) return;
  try { enbData = await api("/api/enb"); } catch (e) { return; }
  const d = enbData, run = d.container === "running";
  ENB_NODES.forEach((n) => enbDg.setNodeUp(n.id, n.id === "mme" ? ctUp("mme") : n.id === "sgwu" ? ctUp("sgwu") : n.id === "ue" ? anyOnline() : run));
  enbDg.edges.forEach((e, i) => enbDg.setLive(i, run));
  const st = $("#enb-state");
  st.className = "pill " + (run ? "hot" : "off"); st.lastElementChild.textContent = run ? "eNB EMITIENDO" : d.container === "no creado" ? "contenedor no creado" : "eNB detenido";
  const p = d.plan || {};
  $("#enb-plan").innerHTML = [["Banda", p.band ? "B" + String(p.band).replace(/^[Bb]/, "") : "—"], ["Bajada", p.dl_freq_hz ? (p.dl_freq_hz / 1e6).toFixed(1) + " MHz" : "—"], ["Subida", p.ul_freq_hz ? (p.ul_freq_hz / 1e6).toFixed(1) + " MHz" : "—"],
    ["Ganancia del plan", p.tx_gain ? p.tx_gain + " dB" : "—"], ["Ganancia en OAI", p.tx_gain !== "" && p.tx_gain !== undefined ? p.tx_gain + " dB (sin conversión)" : "—"], ["Modo", p.modo || "—"], ["Duración máx.", p.duracion_max_s ? p.duracion_max_s + " s" : "—"]]
    .map(([k, v]) => `<tr><th>${k}</th><td>${esc(v)}</td></tr>`).join("");
  const s1 = d.s1_accepted;
  $$("#enb-start [data-live=s1]").forEach((t) => { t.textContent = s1 === null ? "MME no accesible" : s1 ? "✓ el MME aceptó al eNB (visto en su registro)" : "sin S1 Setup aceptado en el registro del MME"; t.classList.toggle("ok", !!s1); });
  $("#enb-log").textContent = (d.lines || []).join("\n") || (d.container === "no creado" ? "El contenedor no existe: docker compose --profile radio create enb-nbiot" : "(sin registro: el eNB no ha arrancado)");
  $("#enb-log").scrollTop = $("#enb-log").scrollHeight;
}
setInterval(() => { if (activeTab() === "enb") refreshEnb(); }, 4000);

// -------------------------------------------------------------- enganche
window.onTab = (name) => {
  if (name === "suscriptores") loadSubs();
  if (name === "nucleo") { initCore(); updateCoreLive(); }
  if (name === "enb") { initEnb(); refreshEnb(); }
};
window.onCore = () => { updateCoreLive(); if (activeTab() === "enb") refreshEnb(); };
