// Motor de diagramas SVG animados: nodos con icono, enlaces con flechas, paquetes que viajan y estado en vivo.
const ICONS = {
  ue: "M6.5 2h7a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zM8.5 15.5h3",
  tower: "M10 9v9M6.5 18h7M7 5.2a4 4 0 0 0 0 5.6M13 5.2a4 4 0 0 1 0 5.6M4.4 3a7.4 7.4 0 0 0 0 10M15.6 3a7.4 7.4 0 0 1 0 10",
  ctrl: "M10 7a3 3 0 1 0 .01 0zM10 2v2.2M10 15.8V18M2 10h2.2M15.8 10H18M4.3 4.3l1.5 1.5M14.2 14.2l1.5 1.5M4.3 15.7l1.5-1.5M14.2 5.8l1.5-1.5",
  key: "M12.5 3a4.5 4.5 0 1 0 .01 0zM9.3 8.7L3 15v2.5h2.5V16H7v-1.5h1.5L11 12",
  db: "M4 5c0-1.7 2.7-3 6-3s6 1.3 6 3-2.7 3-6 3-6-1.3-6-3zM4 5v10c0 1.7 2.7 3 6 3s6-1.3 6-3V5M4 10c0 1.7 2.7 3 6 3s6-1.3 6-3",
  route: "M3 6h10M10 3l3 3-3 3M17 14H7M10 11l-3 3 3 3",
  shield: "M10 2l7 3v5c0 4-3 7-7 8-4-1-7-4-7-8V5z",
  cloud: "M6 15a4 4 0 0 1-.5-8 5 5 0 0 1 9.6 1A3.5 3.5 0 0 1 14.5 15z",
  layers: "M10 3l8 4-8 4-8-4zM2 11l8 4 8-4M2 14.5l8 4 8-4",
  chip: "M5 5h10v10H5zM8 2v3M12 2v3M8 15v3M12 15v3M2 8h3M2 12h3M15 8h3M15 12h3",
  panel: "M3 4h14v10H3zM7 17h6M10 14v3",
  doc: "M5 2h7l4 4v12H5zM12 2v4h4M8 10h5M8 13h5",
  pulse: "M2 10h4l2-5 4 10 2-5h4",
};
const NS = "http://www.w3.org/2000/svg";
const mk = (tag, attrs = {}, parent) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  parent?.append(e); return e;
};
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.classList.contains("still");
const KIND_COLOR = { ctrl: "var(--ctrl)", user: "var(--user)", radio: "var(--radio)" };

/** Recorta el segmento centro–centro al borde de los rectángulos. */
function clip(a, b) {
  const cx1 = a.x + a.w / 2, cy1 = a.y + a.h / 2, cx2 = b.x + b.w / 2, cy2 = b.y + b.h / 2;
  const dx = cx2 - cx1, dy = cy2 - cy1;
  const edge = (n, sx, sy) => {
    const tx = dx === 0 ? Infinity : (n.w / 2 + 3) / Math.abs(dx), ty = dy === 0 ? Infinity : (n.h / 2 + 3) / Math.abs(dy);
    const t = Math.min(tx, ty); return [sx + dx * t * sx_dir, sy + dy * t * sx_dir];
  };
  let sx_dir = 1; const p1 = edge(a, cx1, cy1);
  sx_dir = -1; const p2 = edge(b, cx2, cy2);
  return [p1, p2];
}

/**
 * nodes: [{id,label,sub,x,y,w,h,icon,ext}]  edges: [{a,b,kind,label,proto,dir:'both'|'ab'}]
 * Devuelve el control del diagrama.
 */
function makeDiagram(svg, { nodes, edges, w, h, onSelect, labels = true }) {
  svg.innerHTML = ""; svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  const defs = mk("defs", {}, svg);
  for (const [k, c] of Object.entries(KIND_COLOR)) {
    const m = mk("marker", { id: `ah-${svg.id}-${k}`, viewBox: "0 0 10 10", refX: 8, refY: 5, markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse" }, defs);
    mk("path", { d: "M1 1.5L9 5L1 8.5z", fill: c }, m);
  }
  const eg = mk("g", {}, svg), pg = mk("g", {}, svg), ng = mk("g", {}, svg), lg = mk("g", {}, svg);
  const N = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const E = [], timers = [];
  let ambientOn = false, onlyKind = null;

  edges.forEach((e, i) => {
    const [p1, p2] = clip(N[e.a], N[e.b]);
    const dir = e.dir || "both";
    const line = mk("line", { x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1], class: `edge ${e.kind}`,
      "marker-end": `url(#ah-${svg.id}-${e.kind})`, ...(dir === "both" ? { "marker-start": `url(#ah-${svg.id}-${e.kind})` } : {}) }, eg);
    let label = null;
    if (labels && e.label) {
      const mx = (p1[0] + p2[0]) / 2, my = (p1[1] + p2[1]) / 2;
      label = mk("text", { x: mx, y: my - 6, class: "elabel" }, lg); label.textContent = e.label;
    }
    E.push({ ...e, i, line, label, p1, p2, live: false });
  });

  const nodeEls = {};
  nodes.forEach((n) => {
    const g = mk("g", { class: "node down" + (n.ext ? " ext" : ""), "data-n": n.id, transform: `translate(${n.x},${n.y})`, tabindex: 0, role: "button", "aria-label": n.label }, ng);
    mk("rect", { width: n.w, height: n.h, rx: 11 }, g);
    mk("circle", { cx: n.w - 12, cy: 12, r: 3.6, class: "led" }, g);
    const ic = mk("g", { transform: `translate(10,${(n.h - 20) / 2})`, class: "icn" }, g);
    mk("path", { d: ICONS[n.icon] || ICONS.chip, fill: "none", "stroke-width": 1.5, "stroke-linecap": "round", "stroke-linejoin": "round" }, ic);
    const tx = 36 + (n.w - 36 - 8) / 2;
    mk("text", { x: tx, y: n.sub ? n.h / 2 - 2 : n.h / 2 + 4 }, g).textContent = n.label;
    if (n.sub) mk("text", { x: tx, y: n.h / 2 + 12, class: "sub" }, g).textContent = n.sub;
    const pick = () => onSelect?.(n.id);
    g.onclick = pick; g.onkeydown = (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); pick(); } };
    nodeEls[n.id] = g;
  });

  const find = (a, b) => E.find((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a));

  /** Un paquete que viaja de la entidad `from` a `to` por su enlace. */
  function packet(from, to, color, ms = 900, text = "") {
    const e = find(from, to);
    if (!e) return Promise.resolve();
    if (reduced()) return Promise.resolve();
    const fwd = e.a === from;
    const [s, t] = fwd ? [e.p1, e.p2] : [e.p2, e.p1];
    const col = color || KIND_COLOR[e.kind];
    const g = mk("g", { class: "pkt" }, pg);
    mk("circle", { r: 9, fill: col, opacity: 0.18 }, g);
    mk("circle", { r: 4.6, fill: col, stroke: "var(--card)", "stroke-width": 1.5 }, g);
    if (text) { const tt = mk("text", { y: -12, class: "pkt-t" }, g); tt.textContent = text; }
    const anim = g.animate([{ transform: `translate(${s[0]}px,${s[1]}px)`, opacity: 0.2 }, { transform: `translate(${s[0] + (t[0] - s[0]) * 0.12}px,${s[1] + (t[1] - s[1]) * 0.12}px)`, opacity: 1, offset: 0.12 },
      { transform: `translate(${t[0]}px,${t[1]}px)`, opacity: 1, offset: 0.92 }, { transform: `translate(${t[0]}px,${t[1]}px)`, opacity: 0 }], { duration: ms, easing: "ease-in-out" });
    return new Promise((res) => { anim.onfinish = () => { g.remove(); res(); }; anim.oncancel = () => { g.remove(); res(); }; });
  }

  const ctl = {
    nodes: nodeEls, edges: E, find,
    packet,
    /** Recorre una lista de saltos [from,to] uno tras otro. */
    async path(hops, color, ms = 700, text = "") {
      for (const [a, b] of hops) { ctl.pulseEdge(a, b); await packet(a, b, color, ms, text); }
    },
    pulseEdge(a, b) { const e = find(a, b); if (!e) return; e.line.classList.add("hot"); setTimeout(() => e.line.classList.remove("hot"), 1300); },
    setNodeUp(id, up) { const g = nodeEls[id]; if (!g) return; g.classList.toggle("up", !!up); g.classList.toggle("down", !up); },
    setLive(i, live) { const e = E[i]; if (!e) return; e.live = !!live; e.line.classList.toggle("live", !!live); },
    select(id) { Object.entries(nodeEls).forEach(([k, g]) => g.classList.toggle("sel", k === id)); },
    /** Atenúa todo salvo los nodos y enlaces dados (null = quitar el foco). */
    focus(nodeIds, edgePairs) {
      const on = !!nodeIds;
      svg.classList.toggle("focusing", on);
      Object.entries(nodeEls).forEach(([k, g]) => g.classList.toggle("lit", on && nodeIds.includes(k)));
      E.forEach((e) => {
        const lit = on && edgePairs.some(([a, b]) => (e.a === a && e.b === b) || (e.a === b && e.b === a));
        e.line.classList.toggle("lit", lit); e.label?.classList.toggle("lit", lit);
      });
    },
    /** Muestra solo un tipo de enlace (ctrl/user/radio) o todos (null). */
    layer(kind) {
      onlyKind = kind;
      E.forEach((e) => { const off = kind && e.kind !== kind && e.kind !== "radio"; e.line.classList.toggle("off", off); e.label?.classList.toggle("off", off); });
    },
    /** Paquetes ambientales en los enlaces activos. */
    ambient(on) {
      ambientOn = on; timers.splice(0).forEach(clearInterval);
      if (!on) return;
      timers.push(setInterval(() => {
        if (document.hidden || !svg.isConnected || svg.getBoundingClientRect().width === 0) return;
        E.forEach((e, k) => {
          if (!e.live || (onlyKind && e.kind !== onlyKind && e.kind !== "radio")) return;
          const up = (Math.floor(Date.now() / 1400) + k) % 2 === 0;
          packet(up ? e.a : e.b, up ? e.b : e.a, null, 1100);
        });
      }, 1400));
    },
  };
  return ctl;
}

/**
 * Procedimiento paso a paso con reproducción. steps: [{title, hops:[[a,b],...], proto, msg, desc, tech, color}]
 * el: contenedor con la lista de pasos y el detalle. dg: diagrama.
 */
function makeStepper(el, dg, steps, { autoMs = 600 } = {}) {
  let cur = -1, playing = false, token = 0;
  el.innerHTML = `
    <div class="stp-bar"><button class="btn secondary" data-a="prev" aria-label="Paso anterior">◀</button>
      <button class="btn" data-a="play">▶ Reproducir</button>
      <button class="btn secondary" data-a="next" aria-label="Paso siguiente">▶|</button>
      <span class="muted small" data-r="pos"></span></div>
    <ol class="stp-list">${steps.map((s, i) => `<li data-i="${i}"><span class="n">${i + 1}</span><span>${s.title}</span></li>`).join("")}</ol>
    <div class="stp-detail" data-r="detail"></div>`;
  const q = (s) => el.querySelector(s);
  const list = [...el.querySelectorAll(".stp-list li")];
  const esc2 = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  function show(i) {
    cur = i; const s = steps[i];
    list.forEach((li, k) => { li.classList.toggle("act", k === i); li.classList.toggle("done", k < i); });
    list[i]?.scrollIntoView({ block: "nearest", behavior: reduced() ? "auto" : "smooth" });
    q("[data-r=pos]").textContent = `paso ${i + 1} de ${steps.length}`;
    const nodes = [...new Set(s.hops.flat())];
    dg.focus(nodes, s.hops);
    q("[data-r=detail]").innerHTML = `<h3>${esc2(s.title)}</h3>
      <div class="chips-ro">${s.proto ? `<span class="tag">${esc2(s.proto)}</span>` : ""}${s.msg ? `<span class="tag msg">${esc2(s.msg)}</span>` : ""}</div>
      <p>${s.desc}</p>${s.tech ? `<p class="tech"><b>Detalle técnico:</b> ${s.tech}</p>` : ""}`;
  }
  async function run(i) {
    const my = ++token; show(i); const s = steps[i];
    await dg.path(s.hops, s.color, autoMs + 150, "");
    return my === token;
  }
  async function play() {
    playing = true; q("[data-a=play]").textContent = "❚❚ Pausar";
    const my = token + 1;
    for (let i = cur < 0 || cur >= steps.length - 1 ? 0 : cur + 1; i < steps.length && playing; i++) {
      if (!(await run(i))) return;
      if (!playing) break;
      await new Promise((r) => setTimeout(r, 650));
    }
    stop();
  }
  function stop() { playing = false; q("[data-a=play]").textContent = "▶ Reproducir"; }
  q("[data-a=play]").onclick = () => { if (playing) { stop(); token++; } else play(); };
  q("[data-a=next]").onclick = () => { stop(); token++; run(Math.min(steps.length - 1, cur + 1)); };
  q("[data-a=prev]").onclick = () => { stop(); token++; run(Math.max(0, cur - 1)); };
  list.forEach((li) => li.onclick = () => { stop(); token++; run(+li.dataset.i); });
  show(0); cur = 0;
  return { show, stop, play };
}
