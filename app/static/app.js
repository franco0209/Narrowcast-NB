const $ = (s) => document.querySelector(s);
const api = async (path, opt = {}) => {
  const r = await fetch(path, { headers: { "Content-Type": "application/json" }, ...opt });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(typeof data.detail === "string" ? data.detail : (data.detail?.msg || r.statusText));
  return data;
};
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// Pestañas
document.querySelectorAll("#tabs button").forEach((b) => b.onclick = () => {
  document.querySelectorAll("#tabs button,.tab").forEach((e) => e.classList.remove("active"));
  b.classList.add("active"); $("#" + b.dataset.tab).classList.add("active");
  if (b.dataset.tab === "nucleo") loadCore();
  if (b.dataset.tab === "radio") loadRadio();
});

// Guía
async function loadGuide() {
  const list = await api("/api/guide");
  $("#guide-list").innerHTML = list.map((g) => `<li data-id="${esc(g.id)}">${esc(g.title)}</li>`).join("");
  document.querySelectorAll("#guide-list li").forEach((li) => li.onclick = async () => {
    document.querySelectorAll("#guide-list li").forEach((x) => x.classList.remove("active"));
    li.classList.add("active");
    $("#guide-body").innerHTML = (await api("/api/guide/" + li.dataset.id)).html;
  });
  document.querySelector("#guide-list li")?.click();
}

// Radio
const PLAN_LABELS = { band: "Banda (B3, B8, B20, B28)", earfcn: "EARFCN", dl_freq_hz: "Frec. bajada (Hz)", ul_freq_hz: "Frec. subida (Hz)",
  tx_gain: "Ganancia TX (≤ 30)", modo: "Modo (cable | antena)", atenuacion_db: "Atenuación (dB, ≥ 60 en cable)",
  duracion_max_s: "Duración máx. (s, ≤ 600)", portadora_libre: "Portadora libre (sí/no)", antena_autorizada: "Antena autorizada (sí/no)",
  autorizado_por: "Autorizado por (docente y fecha)" };
let radioState = { running: false };
function renderRadio(d) {
  $("#plan-form").innerHTML = Object.keys(PLAN_LABELS).map((k) =>
    `<label>${PLAN_LABELS[k]}<input name="${k}" value="${esc(d.plan[k])}"></label>`).join("");
  $("#checks").innerHTML = d.check.checks.map((c) => `<li class="${c.ok ? "ok" : "bad"}">${esc(c.text)}</li>`).join("");
  $("#radio-msg").textContent = d.check.ok ? `Plan válido. Contenedor del eNB: ${d.container}.` : "La transmisión está bloqueada hasta corregir lo marcado.";
  $("#radio-start").disabled = !d.check.ok;
  setRadio(d.radio);
}
function setRadio(r) {
  radioState = r;
  $("#radio-run").hidden = !r.running; $("#radio-idle").hidden = r.running;
  const pill = $("#rf-pill");
  pill.textContent = r.running ? "RF EMITIENDO" : "RF apagada"; pill.className = "pill " + (r.running ? "hot" : "off");
}
setInterval(() => { if (radioState.running) $("#countdown").textContent = Math.max(0, Math.round(radioState.deadline - Date.now() / 1000)); }, 500);
async function loadRadio() {
  renderRadio(await api("/api/radio"));
  const s = await api("/api/radio/sessions");
  $("#sessions").innerHTML = "<tr><th>Inicio (UTC)</th><th>Banda</th><th>Modo</th><th>Gan.</th><th>Dur. (s)</th><th>Resultado</th></tr>" +
    s.map((x) => `<tr><td>${esc(x.inicio_utc)}</td><td>${esc(x.banda)}</td><td>${esc(x.modo)}</td><td>${esc(x.tx_gain)}</td><td>${esc(x.duracion_real_s)}</td><td>${esc(x.resultado)}</td></tr>`).join("");
}
$("#plan-save").onclick = async () => {
  const plan = Object.fromEntries(new FormData($("#plan-form")));
  try { renderRadio(await api("/api/radio/plan", { method: "PUT", body: JSON.stringify(plan) })); } catch (e) { alert(e.message); }
};
$("#radio-start").onclick = async () => {
  try { setRadio(await api("/api/radio/start", { method: "POST", body: JSON.stringify({ confirm: $("#confirm").value }) })); $("#confirm").value = ""; }
  catch (e) { alert(e.message); loadRadio(); }
};
$("#radio-stop").onclick = async () => { setRadio(await api("/api/radio/stop", { method: "POST" })); loadRadio(); };

// Dispositivo
let devices = {}, current = null;
function renderDevice() {
  const ids = Object.keys(devices);
  const sel = $("#dev-select");
  if (sel.options.length !== ids.length) { sel.innerHTML = ids.map((i) => `<option>${esc(i)}</option>`).join(""); if (current) sel.value = current; }
  current = sel.value || ids[0] || null;
  const d = devices[current];
  const badge = $("#dev-badge");
  if (!d) { badge.textContent = "sin dispositivos"; badge.className = "pill off"; $("#metrics").innerHTML = ""; $("#chart").innerHTML = ""; return; }
  badge.textContent = d.online ? "en línea" : "fuera de línea"; badge.className = "pill " + (d.online ? "on" : "off");
  const l = d.last || {};
  const ago = d.seen ? Math.round(Date.now() / 1000 - d.seen) + " s" : "-";
  $("#metrics").innerHTML = [["temp", "Temperatura °C"], ["hum", "Humedad %"], ["rssi", "RSSI dBm"]]
    .map(([k, n]) => `<div class="metric"><b>${l[k] ?? "-"}</b><span>${n}</span></div>`).join("") +
    `<div class="metric"><b>${l.led === undefined ? "-" : (l.led ? "ON" : "OFF")}</b><span>LED</span></div>` +
    `<div class="metric"><b>${ago}</b><span>último dato hace</span></div>`;
  const pts = d.history.map((h) => h.temp).filter((v) => typeof v === "number");
  if (pts.length > 1) {
    const mn = Math.min(...pts), mx = Math.max(...pts), rg = mx - mn || 1;
    $("#chart").innerHTML = `<polyline points="${pts.map((v, i) => `${(i / (pts.length - 1)) * 400},${95 - ((v - mn) / rg) * 90}`).join(" ")}"/>`;
    $("#chart-label").textContent = `Temperatura, últimas ${pts.length} lecturas (${mn} – ${mx} °C)`;
  } else { $("#chart").innerHTML = ""; $("#chart-label").textContent = ""; }
}
$("#dev-select").onchange = () => { current = $("#dev-select").value; renderDevice(); };
const send = async (body) => { try { await api(`/api/devices/${current}/cmd`, { method: "POST", body: JSON.stringify(body) }); } catch (e) { alert(e.message); } };
$("#led-on").onclick = () => send({ led: true });
$("#led-off").onclick = () => send({ led: false });
$("#interval-set").onclick = () => send({ interval_s: parseInt($("#interval").value, 10) });
function addEvent(t) {
  const li = document.createElement("li"); li.textContent = new Date().toLocaleTimeString() + "  " + t;
  $("#events").prepend(li); while ($("#events").children.length > 60) $("#events").lastChild.remove();
}

// Núcleo
async function loadCore() {
  const c = await api("/api/core");
  $("#containers").innerHTML = c.containers.map((x) => `<li class="${x.status === "running" ? "ok" : "bad"}">${esc(x.name)} — ${esc(x.status)}</li>`).join("") || "<li class='muted'>sin datos</li>";
  $("#subs").innerHTML = "<tr><th>IMSI</th><th>APN</th></tr>" + c.subscribers.map((s) => `<tr><td>${esc(s.imsi)}</td><td>${esc(s.apn.join(", "))}</td></tr>`).join("");
  $("#core-err").textContent = c.error || "";
}

// Tiempo real (SSE)
function connect() {
  const es = new EventSource("/api/stream");
  es.onmessage = (m) => {
    const e = JSON.parse(m.data);
    if (e.type === "hello") { devices = e.devices; setRadio(e.radio); renderDevice(); return; }
    if (e.type === "radio") { setRadio(e.radio); if (e.reason) addEvent("Radio: " + e.reason); loadRadio().catch(() => {}); return; }
    if (e.type === "telemetry") {
      const d = (devices[e.device] ||= { online: true, last: {}, history: [] });
      d.online = true; d.seen = e.data.ts; d.last = e.data; d.history.push(e.data); if (d.history.length > 120) d.history.shift();
      addEvent(`${e.device}: ${JSON.stringify(e.data)}`);
    } else if (e.type === "status") {
      const d = (devices[e.device] ||= { online: false, last: {}, history: [] }); d.online = e.online; d.seen = e.seen;
      addEvent(`${e.device}: ${e.online ? "en línea" : "fuera de línea"}`);
    } else if (e.type === "cmd") addEvent(`→ ${e.device}: ${JSON.stringify(e.cmd)}`);
    renderDevice();
  };
}
loadGuide(); connect(); setInterval(renderDevice, 5000);
