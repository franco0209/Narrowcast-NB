// Ilustraciones SVG detalladas del nodo y de la red (cada una se dibuja en su propio origen 0,0).
import { motion } from "framer-motion";

/** Degradados y filtros compartidos: se incluye una vez por cada <svg> que use estas ilustraciones. */
export const ArtDefs = () => (
  <defs>
    <linearGradient id="g-pcb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#1f7a4d" /><stop offset="1" stopColor="#14583a" /></linearGradient>
    <linearGradient id="g-pcb-blue" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#2563eb" /><stop offset="1" stopColor="#1e3a8a" /></linearGradient>
    <linearGradient id="g-metal" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#e5e7eb" /><stop offset=".5" stopColor="#9ca3af" /><stop offset="1" stopColor="#d1d5db" /></linearGradient>
    <linearGradient id="g-dark" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#374151" /><stop offset="1" stopColor="#111827" /></linearGradient>
    <linearGradient id="g-water" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#38bdf8" /><stop offset="1" stopColor="#0369a1" /></linearGradient>
    <linearGradient id="g-glass" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#fff" stopOpacity=".5" /><stop offset=".3" stopColor="#fff" stopOpacity=".08" /><stop offset="1" stopColor="#fff" stopOpacity=".25" /></linearGradient>
    <linearGradient id="g-soil" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#92400e" /><stop offset="1" stopColor="#451a03" /></linearGradient>
    <linearGradient id="g-pump" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#3b82f6" /><stop offset="1" stopColor="#1d4ed8" /></linearGradient>
    <radialGradient id="g-red"><stop offset="0" stopColor="#fecaca" /><stop offset=".5" stopColor="#ef4444" /><stop offset="1" stopColor="#7f1d1d" /></radialGradient>
    <radialGradient id="g-glow-red"><stop offset="0" stopColor="#ef4444" stopOpacity=".8" /><stop offset="1" stopColor="#ef4444" stopOpacity="0" /></radialGradient>
    <radialGradient id="g-glow-green"><stop offset="0" stopColor="#4ade80" stopOpacity=".8" /><stop offset="1" stopColor="#4ade80" stopOpacity="0" /></radialGradient>
    <filter id="f-shadow" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="3" stdDeviation="3" floodColor="#000" floodOpacity=".28" /></filter>
    <filter id="f-glow" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="3" /></filter>
    <pattern id="p-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="#ffffff22" strokeWidth="2" /></pattern>
  </defs>
);

const Pin = ({ x, y, n = 8, dx = 7 }: { x: number; y: number; n?: number; dx?: number }) => (
  <g>{Array.from({ length: n }).map((_, i) => <rect key={i} x={x + i * dx} y={y} width="3.2" height="6" rx=".8" fill="url(#g-metal)" />)}</g>
);

/** Placa ESP32 DevKit: módulo con antena impresa, USB, regulador y LEDs. */
export function Esp32Board({ busy = false }: { busy?: boolean }) {
  return (
    <g filter="url(#f-shadow)">
      <rect width="150" height="86" rx="6" fill="url(#g-pcb)" stroke="#0b3d27" />
      <Pin x={10} y={-5} n={19} dx={7} /><Pin x={10} y={85} n={19} dx={7} />
      <rect x="-9" y="26" width="22" height="34" rx="3" fill="url(#g-metal)" /><rect x="-5" y="31" width="14" height="24" rx="1.5" fill="#111827" />{/* USB */}
      <rect x="52" y="9" width="84" height="46" rx="3" fill="url(#g-metal)" stroke="#6b7280" />
      <rect x="52" y="9" width="84" height="46" rx="3" fill="url(#p-hatch)" />
      <text x="94" y="30" textAnchor="middle" fontSize="8.5" fontWeight="700" fill="#374151">ESP32-WROOM-32</text>
      <text x="94" y="41" textAnchor="middle" fontSize="6" fill="#4b5563">Xtensa dual-core · 240 MHz</text>
      <path d="M52 58 h5 v8 h5 v-8 h5 v8 h5 v-8 h5 v8 h5 v-8 h5 v8 h5 v-8 h5 v8 h5 v-8" fill="none" stroke="#d4a017" strokeWidth="1.6" />{/* antena impresa */}
      <rect x="20" y="22" width="20" height="14" rx="1.5" fill="url(#g-dark)" /><text x="30" y="31" textAnchor="middle" fontSize="4.5" fill="#9ca3af">CP2102</text>
      <circle cx="26" cy="62" r="3" fill="#ef4444" /><circle cx="36" cy="62" r="3" fill={busy ? "#22c55e" : "#14532d"}>{busy && <animate attributeName="opacity" values="1;.25;1" dur=".6s" repeatCount="indefinite" />}</circle>
      <rect x="6" y="40" width="9" height="9" rx="1.5" fill="#d1d5db" /><rect x="6" y="52" width="9" height="9" rx="1.5" fill="#d1d5db" />
    </g>
  );
}

/** Módulo SIM7080G (NB-IoT / LTE-M) con su bandeja de SIM y conector de antena. */
export function Sim7080({ state = "off" }: { state?: string }) {
  const led = state === "REGISTERED" ? "#22c55e" : state === "REJECTED" ? "#ef4444" : state === "off" || state === "DEREGISTERED" ? "#374151" : "#f59e0b";
  return (
    <g filter="url(#f-shadow)">
      <rect width="120" height="78" rx="5" fill="url(#g-pcb-blue)" stroke="#172554" />
      <rect x="14" y="10" width="62" height="50" rx="2" fill="url(#g-metal)" stroke="#6b7280" />
      <rect x="14" y="10" width="62" height="50" rx="2" fill="url(#p-hatch)" />
      <text x="45" y="30" textAnchor="middle" fontSize="9" fontWeight="800" fill="#1f2937">SIMCom</text>
      <text x="45" y="42" textAnchor="middle" fontSize="8" fontWeight="700" fill="#374151">SIM7080G</text>
      <text x="45" y="53" textAnchor="middle" fontSize="5.5" fill="#4b5563">LTE Cat-M1 · NB-IoT</text>
      <rect x="84" y="12" width="28" height="22" rx="2" fill="#0f172a" stroke="#475569" />{/* bandeja SIM */}
      <rect x="90" y="16" width="16" height="14" rx="1" fill="#d4a017" /><rect x="94" y="20" width="8" height="6" fill="#f5d36b" />
      <circle cx="104" cy="50" r="5" fill="url(#g-metal)" stroke="#6b7280" /><circle cx="104" cy="50" r="2" fill="#111827" />{/* u.FL */}
      <path d="M104 45 v-6" stroke="#9ca3af" strokeWidth="1" />
      <circle cx="94" cy="66" r="3.5" fill={led}>{(state === "ATTACHING" || state === "AUTH" || state === "SECURITY") && <animate attributeName="opacity" values="1;.2;1" dur=".7s" repeatCount="indefinite" />}</circle>
      <text x="100" y="69" fontSize="5" fill="#bfdbfe">NET</text>
      <Pin x={6} y={-5} n={9} dx={6} />
    </g>
  );
}

/** Sensor capacitivo de humedad de suelo (V1.2) clavado en tierra. */
export function SoilProbe({ moisture = 50 }: { moisture?: number }) {
  const wet = Math.max(0, Math.min(100, moisture)) / 100;
  return (
    <g>
      <rect x="-22" y="70" width="64" height="40" rx="4" fill="url(#g-soil)" />
      <rect x="-22" y="70" width="64" height="40" rx="4" fill="#0ea5e9" opacity={wet * 0.45} />
      {[[-12, 88], [4, 96], [22, 84], [-4, 104], [30, 102]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r="2" fill="#d6b48a" opacity=".55" />)}
      <g filter="url(#f-shadow)">
        <path d="M-10 -10 h32 v66 l-16 22 l-16 -22 z" fill="url(#g-pcb)" stroke="#0b3d27" />
        <rect x="-4" y="-4" width="20" height="14" rx="2" fill="url(#g-dark)" /><text x="6" y="6" textAnchor="middle" fontSize="4.5" fill="#9ca3af">555</text>
        <path d="M2 14 v44 M10 14 v44" stroke="#d4a017" strokeWidth="1.2" opacity=".8" />
        <circle cx="6" cy="-14" r="3.5" fill="#d1d5db" /><rect x="-5" y="-26" width="22" height="12" rx="2" fill="#f3f4f6" stroke="#9ca3af" />
        <path d="M-1 -20 h2 M3 -20 h2 M7 -20 h2 M11 -20 h2" stroke="#6b7280" />
      </g>
    </g>
  );
}

/** DHT22 (AM2302): carcasa blanca perforada con tres patas. */
export function Dht22() {
  return (
    <g filter="url(#f-shadow)">
      <rect width="38" height="54" rx="4" fill="#f9fafb" stroke="#9ca3af" />
      {Array.from({ length: 5 }).map((_, r) => Array.from({ length: 4 }).map((__, c) => <circle key={`${r}${c}`} cx={9 + c * 7} cy={9 + r * 7} r="1.8" fill="#1f2937" opacity=".75" />))}
      <text x="19" y="48" textAnchor="middle" fontSize="6" fontWeight="700" fill="#374151">DHT22</text>
      <path d="M8 54 v12 M19 54 v12 M30 54 v12" stroke="url(#g-metal)" strokeWidth="2.4" />
    </g>
  );
}

/** HC-SR04: dos transductores ultrasónicos; emite ondas animadas hacia abajo. */
export function Hcsr04({ pinging = true }: { pinging?: boolean }) {
  return (
    <g>
      <g filter="url(#f-shadow)">
        <rect width="86" height="40" rx="4" fill="url(#g-pcb-blue)" stroke="#172554" />
        {[22, 64].map((x) => <g key={x}><circle cx={x} cy="20" r="14" fill="url(#g-metal)" stroke="#6b7280" /><circle cx={x} cy="20" r="10" fill="#0f172a" /><circle cx={x} cy="20" r="6" fill="#1e293b" stroke="#475569" /></g>)}
        <rect x="36" y="14" width="14" height="6" rx="1" fill="url(#g-metal)" /><text x="43" y="33" textAnchor="middle" fontSize="5" fill="#bfdbfe">HC-SR04</text>
        <Pin x={30} y={39} n={4} dx={7} />
      </g>
      {pinging && [0, 1, 2].map((i) => (
        <motion.path key={i} d="M10 48 q33 16 66 0" fill="none" stroke="#38bdf8" strokeWidth="1.6" strokeLinecap="round"
          initial={{ opacity: 0, y: 0 }} animate={{ opacity: [0, 0.8, 0], y: [0, 26, 52] }} transition={{ duration: 1.8, repeat: Infinity, delay: i * 0.6, ease: "easeOut" }} />
      ))}
    </g>
  );
}

/** Módulo relé + bomba de agua sumergible; con la bomba encendida gira la turbina y salen gotas. */
export function PumpAssembly({ on = false }: { on?: boolean }) {
  return (
    <g>
      <g filter="url(#f-shadow)">
        <rect x="0" y="0" width="64" height="48" rx="4" fill="url(#g-pcb-blue)" stroke="#172554" />
        <rect x="12" y="8" width="26" height="26" rx="2" fill="url(#g-dark)" stroke="#6b7280" /><text x="25" y="24" textAnchor="middle" fontSize="6" fontWeight="700" fill="#9ca3af">SRD-05VDC</text>
        <circle cx="50" cy="12" r="3.5" fill={on ? "#22c55e" : "#14532d"} />{on && <circle cx="50" cy="12" r="9" fill="url(#g-glow-green)" />}
        {[48, 52, 56].map((x) => <rect key={x} x={x - 1} y="30" width="5" height="12" rx="1" fill="#16a34a" />)}
        <text x="32" y="45" textAnchor="middle" fontSize="5" fill="#bfdbfe">RELÉ 5 V</text>
      </g>
      <g transform="translate(86,2)" filter="url(#f-shadow)">
        <rect width="62" height="44" rx="9" fill="url(#g-pump)" stroke="#1e3a8a" />
        <circle cx="26" cy="22" r="14" fill="#0b2a6b" stroke="#60a5fa" />
        <motion.g animate={{ rotate: on ? 360 : 0 }} transition={{ duration: 0.7, repeat: on ? Infinity : 0, ease: "linear" }} style={{ transformOrigin: "26px 22px" }}>
          {[0, 60, 120, 180, 240, 300].map((a) => <path key={a} d="M26 22 l0 -12" stroke="#bfdbfe" strokeWidth="3" strokeLinecap="round" transform={`rotate(${a} 26 22)`} />)}
        </motion.g>
        <circle cx="26" cy="22" r="3" fill="#e5e7eb" />
        <rect x="52" y="14" width="14" height="10" rx="2" fill="url(#g-pump)" stroke="#1e3a8a" />
        <text x="26" y="42" textAnchor="middle" fontSize="5" fill="#dbeafe">12 V · 3 L/min</text>
      </g>
      {on && [0, 1, 2, 3].map((i) => (
        <motion.circle key={i} cx={150} cy={16} r="2.6" fill="#38bdf8" initial={{ opacity: 0 }}
          animate={{ cx: [150, 176, 190], cy: [16, 6, 40], opacity: [0, 1, 0] }} transition={{ duration: 1.1, repeat: Infinity, delay: i * 0.28 }} />
      ))}
    </g>
  );
}

/** LED rojo de alarma con halo cuando está activo. */
export function AlarmLed({ on = false }: { on?: boolean }) {
  return (
    <g>
      {on && <circle cx="0" cy="-2" r="22" fill="url(#g-glow-red)"><animate attributeName="opacity" values="1;.35;1" dur=".8s" repeatCount="indefinite" /></circle>}
      <rect x="-8" y="6" width="16" height="9" rx="1.5" fill="#fecaca" opacity=".35" />
      <path d="M-7 6 v-9 a7 7 0 0 1 14 0 v9 z" fill={on ? "url(#g-red)" : "#7f1d1d"} stroke="#450a0a" />
      <path d="M-4 -6 a4 4 0 0 1 3 -3" stroke="#fff" strokeWidth="1.4" opacity=".55" fill="none" strokeLinecap="round" />
      <path d="M-3 15 v8 M3 15 v10" stroke="url(#g-metal)" strokeWidth="1.8" />
    </g>
  );
}

/** Tanque de agua con superficie ondulada animada; `level` en %. */
export function WaterTank({ level = 70, w = 110, h = 130 }: { level?: number; w?: number; h?: number }) {
  const y = h - (Math.max(0, Math.min(100, level)) / 100) * (h - 12);
  return (
    <g filter="url(#f-shadow)">
      <clipPath id="tank-clip"><rect x="2" y="0" width={w - 4} height={h} rx="10" /></clipPath>
      <rect x="2" y="0" width={w - 4} height={h} rx="10" fill="#0c4a6e" opacity=".12" />
      <g clipPath="url(#tank-clip)">
        <motion.g animate={{ y }} initial={false} transition={{ type: "spring", stiffness: 60, damping: 16 }}>
          <rect x="0" y="0" width={w} height={h} fill="url(#g-water)" opacity=".9" />
          <motion.path d={`M0 0 q${w / 8} -7 ${w / 4} 0 t${w / 4} 0 t${w / 4} 0 t${w / 4} 0 v6 h-${w} z`} fill="#7dd3fc" animate={{ x: [0, -w / 2, 0] }} transition={{ duration: 6, repeat: Infinity, ease: "linear" }} />
        </motion.g>
        {[0.25, 0.5, 0.75].map((f) => <line key={f} x1="2" x2={w - 2} y1={h * f} y2={h * f} stroke="#0c4a6e" strokeOpacity=".18" strokeDasharray="4 5" />)}
      </g>
      <rect x="2" y="0" width={w - 4} height={h} rx="10" fill="url(#g-glass)" stroke="#0369a1" strokeWidth="2" />
      <rect x="-3" y="-6" width={w + 6} height="9" rx="3" fill="url(#g-metal)" />
      {[25, 50, 75].map((p) => <text key={p} x={w - 8} y={h - (p / 100) * (h - 12) + 3} fontSize="6" textAnchor="end" fill="#075985">{p}%</text>)}
    </g>
  );
}

/** Maceta con planta: la hoja se marchita si el suelo está seco. */
export function PottedPlant({ moisture = 50 }: { moisture?: number }) {
  const droop = moisture < 30 ? 1 : moisture < 45 ? 0.5 : 0;
  const leaf = moisture < 30 ? "#a3a33a" : "#22a559";
  return (
    <g>
      <path d="M-30 40 h60 l-8 46 h-44 z" fill="#c2410c" stroke="#7c2d12" /><rect x="-34" y="34" width="68" height="10" rx="3" fill="#ea580c" stroke="#7c2d12" />
      <rect x="-28" y="40" width="56" height="8" fill="url(#g-soil)" />
      <path d="M0 40 C 0 20 0 8 2 -14" stroke="#15803d" strokeWidth="4" fill="none" strokeLinecap="round" />
      {[[-1, 1], [1, 1]].map(([s], i) => (
        <g key={i}><path d={`M1 ${18 - i * 14} q${s * 26} ${-14 + droop * 26} ${s * 40} ${droop * 30}`} stroke={leaf} strokeWidth="14" strokeLinecap="round" fill="none" opacity=".92" />
          <path d={`M1 ${18 - i * 14} q${s * 22} ${-12 + droop * 24} ${s * 34} ${droop * 28}`} stroke="#4ade80" strokeWidth="2" strokeLinecap="round" fill="none" opacity=".5" /></g>
      ))}
      <path d="M2 -14 q-10 -14 2 -26 q12 12 -2 26z" fill={leaf} />
    </g>
  );
}

/** Torre de telefonía con antenas sectoriales y ondas de radio animadas (cuando `on`). */
export function Tower({ on = false, label = "" }: { on?: boolean; label?: string }) {
  return (
    <g>
      {on && [0, 1, 2].map((i) => [-1, 1].map((s) => (
        <motion.path key={`${i}${s}`} d={`M${s * 14} -112 a${26 + i * 10} ${26 + i * 10} 0 0 ${s > 0 ? 1 : 0} 0 ${40 + i * 14}`} fill="none" stroke="var(--radio)" strokeWidth="2.4" strokeLinecap="round"
          initial={{ opacity: 0 }} animate={{ opacity: [0, 0.9, 0], x: [0, s * 10, s * 22] }} transition={{ duration: 2.2, repeat: Infinity, delay: i * 0.5, ease: "easeOut" }} />
      )))}
      <g filter="url(#f-shadow)">
        <path d="M-30 0 L-6 -120 H6 L30 0" fill="none" stroke="#6b7280" strokeWidth="3.5" strokeLinejoin="round" />
        {[-16, -40, -64, -88].map((y, i) => <g key={y}><path d={`M${-30 + (i + 1) * 4.5} ${y + 4} L${30 - (i + 1) * 4.5} ${y - 20}`} stroke="#9ca3af" strokeWidth="2" /><path d={`M${30 - (i + 1) * 4.5} ${y + 4} L${-30 + (i + 1) * 4.5} ${y - 20}`} stroke="#9ca3af" strokeWidth="2" /></g>)}
        <rect x="-26" y="-132" width="10" height="34" rx="2" fill="url(#g-metal)" stroke="#6b7280" /><rect x="16" y="-132" width="10" height="34" rx="2" fill="url(#g-metal)" stroke="#6b7280" /><rect x="-5" y="-142" width="10" height="26" rx="2" fill="url(#g-metal)" stroke="#6b7280" />
        <circle cx="0" cy="-146" r="3" fill="#ef4444"><animate attributeName="opacity" values="1;.2;1" dur="1.4s" repeatCount="indefinite" /></circle>
        <rect x="-38" y="0" width="76" height="22" rx="3" fill="url(#g-dark)" stroke="#6b7280" />
        {[0, 1, 2, 3].map((i) => <circle key={i} cx={-26 + i * 10} cy="11" r="2.4" fill={on ? "#22c55e" : "#374151"} />)}
        <text x="22" y="14" textAnchor="middle" fontSize="6.5" fill="#9ca3af">{label}</text>
      </g>
    </g>
  );
}

/** Unidad de rack con LEDs que parpadean cuando está activa. */
export function ServerUnit({ w = 120, h = 40, active = false, tint = "var(--accent)" }: { w?: number; h?: number; active?: boolean; tint?: string }) {
  return (
    <g filter="url(#f-shadow)">
      <rect width={w} height={h} rx="5" fill="url(#g-dark)" stroke="#4b5563" />
      {[0, 1, 2].map((i) => <rect key={i} x="8" y={8 + i * 9} width={w * 0.5} height="5" rx="1" fill="#0b1220" stroke="#1f2937" />)}
      {[0, 1, 2, 3].map((i) => <circle key={i} cx={w - 14 - i * 9} cy={h / 2} r="2.6" fill={active ? tint : "#374151"}>{active && <animate attributeName="opacity" values="1;.2;1" dur={`${0.8 + i * 0.25}s`} repeatCount="indefinite" />}</circle>)}
    </g>
  );
}

/** Celular simple (para el mapa); la interfaz real del suscriptor MQTT está en el cuadro del Núcleo. */
export function PhoneIcon({ on = false }: { on?: boolean }) {
  return (
    <g filter="url(#f-shadow)">
      <rect width="46" height="80" rx="8" fill="#111827" stroke="#6b7280" strokeWidth="1.5" />
      <rect x="4" y="9" width="38" height="62" rx="3" fill={on ? "#0ea5e9" : "#1f2937"} opacity={on ? 0.9 : 1} />
      <rect x="15" y="3" width="16" height="3" rx="1.5" fill="#374151" />
      {on && <><rect x="8" y="14" width="30" height="8" rx="2" fill="#e0f2fe" opacity=".9" /><rect x="8" y="26" width="14" height="14" rx="3" fill="#fff" opacity=".85" /><rect x="24" y="26" width="14" height="14" rx="3" fill="#fff" opacity=".6" /><rect x="8" y="44" width="30" height="20" rx="3" fill="#fff" opacity=".35" /></>}
      <circle cx="23" cy="76" r="1.8" fill="#4b5563" />
    </g>
  );
}

/** Mano frente al sensor ultrasónico. */
export function Hand() {
  return (
    <g filter="url(#f-shadow)">
      <path d="M-26 22 q-4 -22 4 -34 q4 -6 8 0 l2 14 l2 -30 q2 -8 7 -1 l1 28 l4 -30 q2 -8 7 -1 l-1 32 l6 -22 q3 -7 7 -1 q-2 22 -8 40 q-6 14 -16 14 q-14 0 -16 -8z" fill="#fcd2b0" stroke="#c98a5e" strokeWidth="1.4" />
    </g>
  );
}
