if (location.search.includes("still")) document.documentElement.classList.add("still");
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const api = async (path, opt = {}) => {
  const r = await fetch(path, { headers: { "Content-Type": "application/json" }, ...opt });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(typeof data.detail === "string" ? data.detail : (data.detail?.msg || r.statusText));
  return data;
};
function toast(msg, kind = "") {
  const t = document.createElement("div"); t.className = "toast " + kind; t.textContent = msg;
  $("#toasts").append(t); setTimeout(() => t.remove(), 4500);
}
const fail = (e) => toast(e.message || String(e), "bad");
const SVGNS = "http://www.w3.org/2000/svg";
const svgEl = (tag, attrs = {}, parent) => {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  parent?.append(e); return e;
};
const fmtDur = (s) => s >= 3600 ? `${(s / 3600).toFixed(s % 3600 ? 1 : 0)} h` : s >= 60 ? `${Math.floor(s / 60)} min${s % 60 ? " " + (s % 60) + " s" : ""}` : `${s} s`;
const yes = (v) => /^s[ií]/i.test(String(v || ""));

// ------------------------------------------------------------ reloj y pestañas
setInterval(() => { $("#clock").textContent = new Date().toLocaleTimeString(); }, 1000);
function openTab(name) {
  if (!$("#" + name)) name = "resumen";
  $$("#tabs button,.tab").forEach((e) => e.classList.remove("active"));
  $(`#tabs [data-tab=${name}]`).classList.add("active"); $("#" + name).classList.add("active");
  history.replaceState(null, "", "#" + name);
  if (name === "nucleo" || name === "resumen") refreshCore();
  if (name === "radio") loadRadio(true);
  if (name === "dispositivo") renderDevice();
}
$$("#tabs button").forEach((b) => b.onclick = () => openTab(b.dataset.tab));
const activeTab = () => $("#tabs .active").dataset.tab;

// ------------------------------------------------------------------- Guía
async function loadGuide() {
  const list = await api("/api/guide");
  $("#guide-list").innerHTML = list.map((g) => `<li data-id="${esc(g.id)}">${esc(g.title)}</li>`).join("");
  $$("#guide-list li").forEach((li) => li.onclick = async () => {
    $$("#guide-list li").forEach((x) => x.classList.remove("active")); li.classList.add("active");
    $("#guide-body").innerHTML = (await api("/api/guide/" + li.dataset.id)).html;
  });
  $("#guide-list li")?.click();
}

// ------------------------------------------------------- Resumen: mapa de red
const NODES = [
  { id: "dev", label: "ESP32 + módulo", sub: "UE NB-IoT", x: 10, y: 177, ct: null, info: "El dispositivo: un ESP32 que controla el módulo NB-IoT (SIM7080G/BG96) por comandos AT. Lee un sensor, envía los datos por radio y obedece órdenes (LED, intervalo).", links: ["Uu (radio) con el eNB", "MQTT hasta el broker, a través de la red"] },
  { id: "enb", label: "eNB NB-IoT", sub: "OAI + USRP", x: 190, y: 177, ct: ["nb-enb-nbiot", "nb-enb"], ip: "10.44.0.40", info: "La estación base. En modo real es OpenAirInterface con un USRP que emite la portadora NB-IoT; en el modo simulado es srsRAN con radio virtual. Convierte la radio en tráfico IP hacia el núcleo.", links: ["S1-MME (SCTP 36412) hacia el MME", "S1-U (GTP-U 2152) hacia el SGW-U"] },
  { id: "mme", label: "MME", sub: "registro y paging", x: 390, y: 40, ct: ["nb-mme"], ip: "10.44.0.10", info: "Recepcionista de la red: acepta al eNB (S1 Setup), autentica al módulo, aplica PLMN/TAC y gestiona el attach.", links: ["S1-MME con el eNB", "S6a (Diameter) con el HSS", "S11 (GTP-C) con el SGW-C"] },
  { id: "hss", label: "HSS", sub: "IMSI, Ki, OPc", x: 580, y: 40, ct: ["nb-hss"], ip: "10.44.0.11", info: "Libreta de suscriptores: guarda IMSI y claves y entrega los vectores de autenticación al MME.", links: ["S6a con el MME", "Lee suscriptores de MongoDB"] },
  { id: "mongo", label: "MongoDB", sub: "suscriptores", x: 770, y: 40, ct: ["nb-mongo"], ip: "10.44.0.2", info: "Base de datos donde viven los suscriptores. La WebUI y el provisionador escriben aquí; el HSS lee.", links: ["HSS (lectura)", "WebUI (alta de SIM)"] },
  { id: "sgwc", label: "SGW-C", sub: "plano de control", x: 390, y: 130, ct: ["nb-sgwc"], ip: "10.44.0.12", info: "Control del túnel de datos: crea la sesión pedida por el MME y ordena al SGW-U.", links: ["S11 con el MME", "S5-C con el PGW-C", "PFCP con el SGW-U"] },
  { id: "pgwc", label: "PGW-C / SMF", sub: "sesión e IP", x: 580, y: 130, ct: ["nb-pgwc"], ip: "10.44.0.14", info: "Crea la sesión de datos (APN internet), asigna la IP al módulo (10.58.0.0/16) y consulta al PCRF.", links: ["S5-C con el SGW-C", "Gx con el PCRF", "PFCP con el PGW-U"] },
  { id: "pcrf", label: "PCRF", sub: "políticas", x: 770, y: 130, ct: ["nb-pcrf"], ip: "10.44.0.16", info: "Reglas de calidad y cobro por sesión. Aquí solo da políticas por defecto.", links: ["Gx con el PGW-C"] },
  { id: "sgwu", label: "SGW-U", sub: "datos (túnel S1-U)", x: 390, y: 224, ct: ["nb-sgwu"], ip: "10.44.0.13", info: "Reenvía los paquetes de usuario entre el eNB (GTP-U) y el PGW-U.", links: ["S1-U con el eNB", "S5-U con el PGW-U"] },
  { id: "pgwu", label: "PGW-U / UPF", sub: "salida SGi", x: 580, y: 224, ct: ["nb-pgwu"], ip: "10.44.0.15", info: "Saca el tráfico del túnel hacia la red de datos: aquí nacen las IP 10.58.x.x y se enruta hacia el broker MQTT.", links: ["S5-U con el SGW-U", "SGi hacia la red de datos"] },
  { id: "mosq", label: "Mosquitto", sub: "broker MQTT", x: 770, y: 224, ct: ["nb-mosquitto"], ip: "10.44.0.5", info: "Broker MQTT. El ESP32 publica en nb/<id>/telemetry y escucha en nb/<id>/cmd.", links: ["SGi desde el PGW-U", "Panel (suscriptor/publicador)"] },
  { id: "app", label: "Panel", sub: "esta interfaz", x: 770, y: 318, ct: ["nb-app"], ip: "10.44.0.6", info: "Este panel: lee MQTT, ordena al eNB encenderse (con las reglas RF) y consulta MongoDB y Docker.", links: ["MQTT con Mosquitto", "Docker (arranca/para el eNB)", "MongoDB (solo lectura de IMSI/APN)"] },
  { id: "webui", label: "WebUI Open5GS", sub: "alta de SIM", x: 390, y: 318, ct: ["nb-webui"], ip: "10.44.0.4", info: "Interfaz oficial de Open5GS para registrar suscriptores (IMSI, Ki, OPc). Escribe en MongoDB.", links: ["MongoDB"] },
];
const EDGES = [
  ["dev", "enb", "radio", "Uu (radio)"], ["enb", "mme", "ctrl", "S1-MME"], ["enb", "sgwu", "user", "S1-U"],
  ["mme", "hss", "ctrl", "S6a"], ["hss", "mongo", "ctrl", "datos"], ["mme", "sgwc", "ctrl", "S11"],
  ["sgwc", "pgwc", "ctrl", "S5-C"], ["pgwc", "pcrf", "ctrl", "Gx"], ["sgwc", "sgwu", "ctrl", "PFCP"],
  ["pgwc", "pgwu", "ctrl", "PFCP"], ["sgwu", "pgwu", "user", "S5-U"], ["pgwu", "mosq", "user", "SGi"],
  ["mosq", "app", "user", "MQTT"],
];
const NW = 130, NH = 46;
const nodeBy = Object.fromEntries(NODES.map((n) => [n.id, n]));
let selNode = null;
function buildTopo() {
  const svg = $("#topo"); svg.innerHTML = "";
  const eg = svgEl("g", {}, svg), ng = svgEl("g", {}, svg);
  EDGES.forEach(([a, b, kind, label], i) => {
    const A = nodeBy[a], B = nodeBy[b];
    const x1 = A.x + NW / 2, y1 = A.y + NH / 2, x2 = B.x + NW / 2, y2 = B.y + NH / 2;
    svgEl("line", { x1, y1, x2, y2, class: "edge " + kind, "data-e": i }, eg);
    const t = svgEl("text", { x: (x1 + x2) / 2, y: (y1 + y2) / 2 - 6, class: "elabel" }, eg); t.textContent = label;
  });
  NODES.forEach((n) => {
    const g = svgEl("g", { class: "node down", "data-n": n.id, transform: `translate(${n.x},${n.y})`, tabindex: 0, role: "button" }, ng);
    svgEl("rect", { width: NW, height: NH, rx: 11 }, g);
    svgEl("circle", { cx: 14, cy: 14, r: 4, class: "led" }, g);
    svgEl("text", { x: NW / 2 + 6, y: 20 }, g).textContent = n.label;
    svgEl("text", { x: NW / 2, y: 35, class: "sub" }, g).textContent = n.sub;
    const pick = () => selectNode(n.id);
    g.onclick = pick; g.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") pick(); };
  });
}
let coreData = { containers: [], subscribers: [], error: null };
const cmap = () => Object.fromEntries(coreData.containers.map((c) => [c.name, c.status]));
const anyOnline = () => Object.values(devices).some((d) => d.online);
function nodeUp(n) {
  if (n.id === "dev") return anyOnline();
  const m = cmap(); return (n.ct || []).some((c) => m[c] === "running");
}
function updateTopo() {
  const up = {};
  NODES.forEach((n) => { up[n.id] = nodeUp(n); const g = $(`[data-n=${n.id}]`); g.classList.toggle("up", up[n.id]); g.classList.toggle("down", !up[n.id]); });
  const online = anyOnline();
  EDGES.forEach(([a, b, kind], i) => {
    let live = up[a] && up[b];
    if (kind === "user") live = live && online; if (kind === "radio") live = online && up.enb;
    $(`[data-e="${i}"]`).classList.toggle("live", live);
  });
}
async function selectNode(id) {
  selNode = id; $$(".node").forEach((g) => g.classList.toggle("sel", g.dataset.n === id));
  const n = nodeBy[id], up = nodeUp(n), box = $("#node-info");
  box.innerHTML = `<h3>${esc(n.label)} <span class="pill ${up ? "on" : "off"}"><span class="dot"></span>${up ? "activo" : "apagado"}</span></h3>
    <p>${esc(n.info)}</p><div>${(n.links || []).map((l) => `<span class="tag">${esc(l)}</span>`).join("")}${n.ip ? `<span class="tag">IP ${n.ip}</span>` : ""}</div>`;
  const real = (n.ct || []).find((c) => cmap()[c]);
  if (real) {
    try {
      const l = await api(`/api/logs/${real}?tail=14`);
      if (selNode === id) box.insertAdjacentHTML("beforeend", `<pre class="log">${esc(l.lines.join("\n")) || "(sin registro)"}</pre>`);
    } catch (e) { /* sin log */ }
  }
}

function renderKpis() {
  const total = coreData.containers.length, run = coreData.containers.filter((c) => c.status === "running").length;
  const online = Object.entries(devices).filter(([, d]) => d.online);
  const last = online.map(([, d]) => d.seen).sort().pop();
  const k = [
    [`${run}/${total || "-"}`, "contenedores activos", total && run === total ? "ok" : "warn"],
    [coreData.subscribers.length, "suscriptores (SIM)", ""],
    [radioState.running ? "EMITIENDO" : "apagada", "radiofrecuencia", radioState.running ? "bad" : "ok"],
    [online.length ? online.map(([i]) => i).join(", ") : "ninguno", "dispositivo en línea", online.length ? "ok" : ""],
    [last ? `hace ${Math.round(Date.now() / 1000 - last)} s` : "-", "último dato", ""],
  ];
  $("#kpis").innerHTML = k.map(([b, s, c]) => `<div class="kpi ${c}"><b>${esc(b)}</b><span>${s}</span></div>`).join("");
}

// ---------------------------------------------------------------- Núcleo
async function refreshCore() {
  try { coreData = await api("/api/core"); } catch (e) { return; }
  updateTopo(); renderKpis();
  if (activeTab() === "nucleo") renderCore();
}
function renderCore() {
  $("#containers").innerHTML = coreData.containers.map((c) =>
    `<div class="cbox ${c.status === "running" ? "up" : (c.status === "exited" || c.status === "created") ? "idle" : ""}" data-c="${esc(c.name)}"><span class="d"></span><div><b>${esc(c.name.replace("nb-", ""))}</b><small>${esc(c.status)}</small></div></div>`).join("") || "<p class='muted'>sin datos</p>";
  $$(".cbox").forEach((b) => b.onclick = () => { $("#log-select").value = b.dataset.c; loadLog(); });
  const sel = $("#log-select"), names = coreData.containers.map((c) => c.name);
  if ([...sel.options].map((o) => o.value).join() !== names.join()) { const cur = sel.value; sel.innerHTML = names.map((n) => `<option>${esc(n)}</option>`).join(""); if (names.includes(cur)) sel.value = cur; else if (names.includes("nb-mme")) sel.value = "nb-mme"; loadLog(); }
  $("#subs").innerHTML = "<tr><th>IMSI</th><th>APN</th></tr>" + coreData.subscribers.map((s) => `<tr><td>${esc(s.imsi)}</td><td>${esc(s.apn.join(", "))}</td></tr>`).join("");
  $("#core-err").textContent = coreData.error || "";
}
async function loadLog() {
  const n = $("#log-select").value; if (!n) return;
  try {
    const l = await api(`/api/logs/${n}?tail=120`), v = $("#log-view");
    const bottom = v.scrollHeight - v.scrollTop - v.clientHeight < 30;
    v.textContent = l.lines.join("\n") || "(sin registro)"; if (bottom) v.scrollTop = v.scrollHeight;
  } catch (e) { $("#log-view").textContent = e.message; }
}
$("#log-select").onchange = loadLog;
setInterval(() => { if (activeTab() === "nucleo") loadLog(); }, 4000);
setInterval(refreshCore, 5000);

// ----------------------------------------------------------------- Radio
const PRESETS = { // DL de ejemplo por banda (EARFCN = N_offs + 0,1·(F − F_low)); la definitiva sale del barrido
  3: { earfcn: 1550, dl: 1840000000, ul: 1745000000 }, 8: { earfcn: 3600, dl: 940000000, ul: 895000000 },
  20: { earfcn: 6240, dl: 800000000, ul: 841000000 }, 28: { earfcn: 9430, dl: 780000000, ul: 725000000 },
};
const defaultPlan = (b = 3) => ({ band: String(b), earfcn: String(PRESETS[b].earfcn), dl_freq_hz: String(PRESETS[b].dl), ul_freq_hz: String(PRESETS[b].ul),
  tx_gain: "0", modo: "cable", atenuacion_db: "60", duracion_max_s: "120", portadora_libre: "no", antena_autorizada: "no", autorizado_por: "" });
let radioState = { running: false }, plan = defaultPlan(), saveTimer = null;
$("#band-chips").innerHTML = Object.keys(PRESETS).map((b) => `<button data-b="${b}">B${b}</button>`).join("");
$$("#band-chips button").forEach((b) => b.onclick = () => {
  const p = PRESETS[b.dataset.b]; plan.band = b.dataset.b; plan.earfcn = String(p.earfcn); plan.dl_freq_hz = String(p.dl); plan.ul_freq_hz = String(p.ul);
  fillForm(); queueSave();
});
$$("#mode-seg button").forEach((b) => b.onclick = () => { plan.modo = b.dataset.v; fillForm(); queueSave(); });
const F = (k) => $("#f-" + k);
function fillForm() {
  $$("#band-chips button").forEach((b) => b.classList.toggle("sel", b.dataset.b === String(plan.band).replace(/^[Bb]/, "")));
  $$("#mode-seg button").forEach((b) => b.classList.toggle("sel", b.dataset.v === plan.modo));
  ["tx_gain", "duracion_max_s", "atenuacion_db", "earfcn", "dl_freq_hz", "ul_freq_hz", "autorizado_por"].forEach((k) => { F(k).value = plan[k] ?? ""; });
  F("portadora_libre").checked = yes(plan.portadora_libre); F("antena_autorizada").checked = yes(plan.antena_autorizada);
  $("#v-gain").textContent = plan.tx_gain + " dB"; $("#v-dur").textContent = plan.duracion_max_s;
  $("#ant-wrap").hidden = plan.modo !== "antena";
  $("#att-row").style.gridTemplateColumns = plan.modo === "antena" ? "1fr 1fr" : "1fr";
  const lock = !!radioState.running;
  $$("#radio .card:first-child input,#radio .card:first-child button").forEach((e) => { e.disabled = lock; });
}
["tx_gain", "duracion_max_s", "atenuacion_db", "earfcn", "dl_freq_hz", "ul_freq_hz", "autorizado_por", "portadora_libre", "antena_autorizada"].forEach((k) => {
  F(k).addEventListener("input", () => {
    plan[k] = F(k).type === "checkbox" ? (F(k).checked ? "sí" : "no") : F(k).value;
    $("#v-gain").textContent = plan.tx_gain + " dB"; $("#v-dur").textContent = plan.duracion_max_s; queueSave();
  });
});
function queueSave() { $("#plan-saved").textContent = "guardando…"; clearTimeout(saveTimer); saveTimer = setTimeout(savePlan, 500); }
async function savePlan() {
  try { const d = await api("/api/radio/plan", { method: "PUT", body: JSON.stringify(plan) }); $("#plan-saved").textContent = "✓ guardado"; renderChecks(d); }
  catch (e) { $("#plan-saved").textContent = ""; fail(e); }
}
function renderChecks(d) {
  $("#checks").innerHTML = d.check.checks.map((c, i) => `<li class="${c.ok ? "ok" : "bad"}" style="animation-delay:${i * 40}ms">${esc(c.text)}</li>`).join("");
  txReady = d.check.ok;
  $("#radio-msg").textContent = d.check.ok ? `Todo en regla. Se encenderá el contenedor ${d.container}.` : "Bloqueado: completa lo marcado con ✕ (portadora libre y autorización).";
  setRadio(d.radio);
}
async function loadRadio(withForm) {
  const d = await api("/api/radio");
  if (!d.plan.band) { plan = defaultPlan(); fillForm(); await savePlan(); return loadRadio(false); } // sin plan: cargar valores seguros
  if (withForm) { plan = { ...defaultPlan(), ...Object.fromEntries(Object.entries(d.plan).filter(([, v]) => v !== "")) }; plan.band = String(plan.band).replace(/^[Bb]/, ""); fillForm(); }
  renderChecks(d);
  const s = await api("/api/radio/sessions");
  $("#sessions").innerHTML = "<tr><th>Inicio (UTC)</th><th>Banda</th><th>Modo</th><th>Gan.</th><th>Dur. (s)</th><th>Resultado</th></tr>" +
    (s.map((x) => `<tr><td>${esc(x.inicio_utc)}</td><td>B${esc(x.banda)}</td><td>${esc(x.modo)}</td><td>${esc(x.tx_gain)}</td><td>${esc(x.duracion_real_s)}</td><td>${esc(x.resultado)}</td></tr>`).join("") || "<tr><td colspan=6 class='muted'>Sin sesiones todavía</td></tr>");
}
// Botón de mantener pulsado
let txReady = false, holdRaf = null, holdStart = 0;
const HOLD_MS = 1500, ring = () => $("#ring-fg");
function setRadio(r) {
  radioState = r;
  const pill = $("#rf-pill"); pill.className = "pill " + (r.running ? "hot" : "off"); $("#rf-text").textContent = r.running ? "RF EMITIENDO" : "RF apagada";
  $(".ring-wrap").classList.toggle("live", !!r.running);
  const b = $("#tx-btn"); b.classList.toggle("live", !!r.running);
  if (r.running) { b.disabled = false; $("#tx-main").textContent = "Detener ahora"; }
  else { b.disabled = !txReady; $("#tx-main").textContent = txReady ? "Mantén para activar" : "Bloqueado"; $("#tx-sub").textContent = txReady ? "1,5 segundos" : "completa el plan"; if (!holdRaf) ring().style.strokeDashoffset = 100; }
  if ($("#f-tx_gain")) fillFormLock();
  renderKpis();
}
function fillFormLock() { const lock = !!radioState.running; $$("#radio .card:first-child input,#radio .card:first-child button").forEach((e) => { e.disabled = lock; }); }
setInterval(() => {
  if (!radioState.running) return;
  const left = Math.max(0, radioState.deadline - Date.now() / 1000), tot = Math.max(1, radioState.deadline - radioState.started);
  $("#tx-sub").textContent = `corte en ${Math.ceil(left)} s`; ring().style.strokeDashoffset = 100 - (left / tot) * 100;
}, 250);
function holdBegin() {
  if (radioState.running || $("#tx-btn").disabled || holdRaf) return;
  holdStart = performance.now();
  const step = (t) => {
    const p = Math.min(1, (t - holdStart) / HOLD_MS); ring().style.strokeDashoffset = 100 - p * 100;
    if (p >= 1) { holdRaf = null; startRadio(); } else holdRaf = requestAnimationFrame(step);
  };
  holdRaf = requestAnimationFrame(step);
}
function holdCancel() { if (holdRaf) { cancelAnimationFrame(holdRaf); holdRaf = null; ring().style.strokeDashoffset = 100; } }
async function startRadio() {
  try { setRadio(await api("/api/radio/start", { method: "POST", body: JSON.stringify({ confirm: "EMITIR" }) })); toast("Transmisión activada", "ok"); }
  catch (e) { fail(e); loadRadio(false); }
}
const txb = $("#tx-btn");
txb.addEventListener("pointerdown", (e) => { if (radioState.running) return; e.preventDefault(); holdBegin(); });
["pointerup", "pointerleave", "pointercancel"].forEach((ev) => txb.addEventListener(ev, holdCancel));
txb.addEventListener("click", async () => { if (radioState.running) { try { setRadio(await api("/api/radio/stop", { method: "POST" })); toast("Transmisión detenida", "ok"); loadRadio(false); } catch (e) { fail(e); } } });
txb.addEventListener("keydown", (e) => { if ((e.key === " " || e.key === "Enter") && !e.repeat && !radioState.running) { e.preventDefault(); holdBegin(); } });
txb.addEventListener("keyup", holdCancel);

// ----------------------------------------------------------- Dispositivo
let devices = {}, current = null;
const gaugeColor = (f) => (f < .6 ? "var(--ok)" : f < .85 ? "var(--warn)" : "var(--bad)");
function gauge(val, min, max, unit, name, color) {
  const f = typeof val === "number" ? Math.max(0, Math.min(1, (val - min) / (max - min))) : 0;
  return `<div class="gauge"><svg viewBox="0 0 96 62"><path class="gb" d="M8 54A40 40 0 0 1 88 54" pathLength="100"/><path class="gf" d="M8 54A40 40 0 0 1 88 54" pathLength="100" stroke="${color || gaugeColor(f)}" stroke-dasharray="100" stroke-dashoffset="${100 - f * 100}"/></svg><b>${val ?? "-"}${val !== undefined && val !== null ? unit : ""}</b><span>${name}</span></div>`;
}
function renderDevice() {
  const ids = Object.keys(devices), sel = $("#dev-select");
  if ([...sel.options].map((o) => o.value).join() !== ids.join()) { sel.innerHTML = ids.map((i) => `<option>${esc(i)}</option>`).join(""); if (current && ids.includes(current)) sel.value = current; }
  current = sel.value || ids[0] || null;
  const d = devices[current], badge = $("#dev-badge");
  if (!d) { badge.className = "pill off"; badge.lastElementChild.textContent = "sin dispositivos"; $("#gauges").innerHTML = "<p class='muted'>Aún no ha llegado telemetría. Prueba el simulador: <code>docker compose exec app python fake_device.py esp32-sim</code></p>"; $("#chart").innerHTML = ""; return; }
  badge.className = "pill " + (d.online ? "on" : "off"); badge.lastElementChild.textContent = d.online ? "en línea" : "fuera de línea";
  const l = d.last || {}, rssi = l.rssi, nb = typeof rssi === "number" ? Math.max(0, Math.min(5, Math.round((rssi + 113) / 12))) : 0;
  const ago = d.seen ? Math.round(Date.now() / 1000 - d.seen) : null;
  $("#gauges").innerHTML = gauge(l.temp, -10, 50, " °C", "Temperatura", "var(--accent)") + gauge(l.hum, 0, 100, " %", "Humedad", "var(--accent2)") +
    `<div class="gauge"><div class="bars">${[14, 22, 30, 38, 46].map((h, i) => `<i style="height:${h}px" class="${i < nb ? "on" : ""}"></i>`).join("")}</div><b>${rssi ?? "-"}${rssi !== undefined ? " dBm" : ""}</b><span>Señal</span></div>` +
    `<div class="gauge"><b style="margin-top:14px">${ago === null ? "-" : fmtDur(ago)}</b><span>último dato hace</span></div>`;
  $("#bulb").classList.toggle("on", !!l.led); $("#bulb-state").textContent = l.led === undefined ? "LED: sin dato" : l.led ? "LED encendido" : "LED apagado";
  drawChart(d.history || []);
}
function drawChart(hist) {
  const svg = $("#chart"), W = 640, H = 220, L = 36, R = 36, T = 14, B = 24; svg.innerHTML = "";
  const T_ = hist.map((h) => h.temp), H_ = hist.map((h) => h.hum), n = hist.length;
  if (n < 2) { svgEl("text", { x: W / 2, y: H / 2, "text-anchor": "middle", fill: "var(--muted)", "font-size": 13 }, svg).textContent = "Esperando más lecturas…"; $("#chart-label").textContent = ""; return; }
  const defs = svgEl("defs", {}, svg), gr = svgEl("linearGradient", { id: "ga", x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
  svgEl("stop", { offset: "0", "stop-color": "var(--accent)", "stop-opacity": ".35" }, gr); svgEl("stop", { offset: "1", "stop-color": "var(--accent)", "stop-opacity": "0" }, gr);
  const rng = (a) => { const v = a.filter((x) => typeof x === "number"); let mn = Math.min(...v), mx = Math.max(...v); if (mx - mn < 1) { mn -= .5; mx += .5; } const p = (mx - mn) * .15; return [mn - p, mx + p]; };
  const [t0, t1] = rng(T_), [h0, h1] = rng(H_), X = (i) => L + (i / (n - 1)) * (W - L - R);
  const Yt = (v) => T + (1 - (v - t0) / (t1 - t0)) * (H - T - B), Yh = (v) => T + (1 - (v - h0) / (h1 - h0)) * (H - T - B);
  for (let i = 0; i <= 4; i++) {
    const y = T + (i / 4) * (H - T - B);
    svgEl("line", { x1: L, x2: W - R, y1: y, y2: y, stroke: "var(--line)", "stroke-dasharray": "3 4" }, svg);
    svgEl("text", { x: L - 6, y: y + 4, "text-anchor": "end", fill: "var(--accent)", "font-size": 10 }, svg).textContent = (t1 - (i / 4) * (t1 - t0)).toFixed(1);
    svgEl("text", { x: W - R + 6, y: y + 4, fill: "var(--accent2)", "font-size": 10 }, svg).textContent = (h1 - (i / 4) * (h1 - h0)).toFixed(0);
  }
  const pts = (A, Y) => A.map((v, i) => `${X(i)},${Y(v)}`).join(" ");
  svgEl("polygon", { points: `${X(0)},${H - B} ${pts(T_, Yt)} ${X(n - 1)},${H - B}`, fill: "url(#ga)" }, svg);
  svgEl("polyline", { points: pts(H_, Yh), fill: "none", stroke: "var(--accent2)", "stroke-width": 2, "stroke-linejoin": "round" }, svg);
  svgEl("polyline", { points: pts(T_, Yt), fill: "none", stroke: "var(--accent)", "stroke-width": 2.4, "stroke-linejoin": "round" }, svg);
  svgEl("circle", { cx: X(n - 1), cy: Yt(T_[n - 1]), r: 4.5, fill: "var(--accent)" }, svg);
  const cross = svgEl("line", { y1: T, y2: H - B, stroke: "var(--muted)", "stroke-dasharray": "2 3", opacity: 0 }, svg);
  const tip = $("#chart-tip");
  const hit = svgEl("rect", { x: L, y: T, width: W - L - R, height: H - T - B, fill: "transparent" }, svg);
  hit.onmousemove = (e) => {
    const r = svg.getBoundingClientRect(), px = ((e.clientX - r.left) / r.width) * W, i = Math.max(0, Math.min(n - 1, Math.round(((px - L) / (W - L - R)) * (n - 1))));
    cross.setAttribute("x1", X(i)); cross.setAttribute("x2", X(i)); cross.setAttribute("opacity", 1);
    tip.hidden = false; tip.style.left = (X(i) / W) * r.width + "px"; tip.style.top = (Yt(T_[i]) / H) * r.height + "px";
    tip.textContent = `${new Date(hist[i].ts * 1000).toLocaleTimeString()} · ${T_[i]} °C · ${H_[i]} %`;
  };
  hit.onmouseleave = () => { cross.setAttribute("opacity", 0); tip.hidden = true; };
  $("#chart-label").textContent = `últimas ${n} lecturas`;
}
$("#dev-select").onchange = () => { current = $("#dev-select").value; renderDevice(); };
const send = async (body) => { try { await api(`/api/devices/${current}/cmd`, { method: "POST", body: JSON.stringify(body) }); } catch (e) { fail(e); } };
$("#bulb").onclick = () => { if (!current) return toast("No hay dispositivo seleccionado", "bad"); const on = !devices[current]?.last?.led; $("#bulb").classList.toggle("on", on); send({ led: on }); toast(`Orden enviada: LED ${on ? "encender" : "apagar"}`); };
$("#interval").oninput = () => { $("#v-int").textContent = fmtDur(+$("#interval").value); };
$("#interval").oninput();
$("#interval-set").onclick = () => { if (!current) return toast("No hay dispositivo seleccionado", "bad"); send({ interval_s: parseInt($("#interval").value, 10) }); toast("Intervalo enviado"); };
function addEvent(t) {
  const li = document.createElement("li"); li.textContent = new Date().toLocaleTimeString() + "  " + t;
  $("#events").prepend(li); while ($("#events").children.length > 60) $("#events").lastChild.remove();
}

// ------------------------------------------------------ Tiempo real (SSE)
function connect() {
  const es = new EventSource("/api/stream");
  es.onmessage = (m) => {
    const e = JSON.parse(m.data);
    if (e.type === "hello") { devices = e.devices; setRadio(e.radio); renderDevice(); updateTopo(); renderKpis(); return; }
    if (e.type === "radio") { setRadio(e.radio); if (e.reason) { addEvent("Radio: " + e.reason); toast("Radio: " + e.reason); } loadRadio(false).catch(() => {}); return; }
    if (e.type === "telemetry") {
      const d = (devices[e.device] ||= { online: true, last: {}, history: [] });
      d.online = true; d.seen = e.data.ts; d.last = e.data; d.history.push(e.data); if (d.history.length > 120) d.history.shift();
      addEvent(`${e.device}: ${e.data.temp} °C, ${e.data.hum} %, ${e.data.rssi} dBm, LED ${e.data.led ? "ON" : "OFF"}`);
    } else if (e.type === "status") {
      const d = (devices[e.device] ||= { online: false, last: {}, history: [] }); d.online = e.online; d.seen = e.seen;
      addEvent(`${e.device}: ${e.online ? "en línea" : "fuera de línea"}`);
    } else if (e.type === "cmd") addEvent(`→ ${e.device}: ${JSON.stringify(e.cmd)}`);
    renderDevice(); updateTopo(); renderKpis();
  };
}

buildTopo(); loadGuide(); connect(); refreshCore(); setInterval(renderDevice, 5000);
openTab(location.hash.slice(1) || "resumen");
window.addEventListener("hashchange", () => openTab(location.hash.slice(1) || "resumen"));
