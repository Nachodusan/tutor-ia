"use client";

/**
 * BLOQUES & AURORA — el sistema visual compartido.
 *
 * Dos mundos con reglas distintas y deliberadas:
 *  - **Bloques** (el panel): borde de tinta de 2px, sombra dura desplazada, cobalto.
 *    Es estructura: lo que el alumno recorre y marca.
 *  - **Aurora** (la conversación): borde suave, sombra difusa, lavanda y el orbe.
 *    Es diálogo: lo que fluye.
 *
 * Vivía duplicado en `page.tsx` y `login/page.tsx`. Con la tercera pantalla
 * (`/docente`) la duplicación deja de ser barata: tres copias divergen, y el
 * primer síntoma es que el panel del docente se ve "parecido pero no igual".
 *
 * Todo es fuente de sistema y SVG inline: la app corre offline en la red del
 * colegio, así que no hay CDN de fuentes ni de iconos que pueda faltar.
 */

// ── Tokens ──────────────────────────────────────────────────────────────────
export const C = {
  bg: "#FFFFFF", panel: "#FFFFFF", panel2: "#F4F2EC", ink: "#191621", border: "#EAE4D8",
  text: "#201C2B", dim: "#5E5769",
  accent: "#2B44FF",        // COBALTO — marca / estructura (mundo Panel)
  accentSoft: "#6C5CE7",    // LAVANDA — conversación (mundo Aurora)
  coral: "#FF5C3A", sun: "#FFC63D", peach: "#FF9E7B",
  ok: "#1F9D57", okBg: "#E7F6EE", okTx: "#0A6B52",
  warn: "#B87400", warnBg: "#FBF0D3", warnTx: "#8A5A00",
  bad: "#D42419", badBg: "#FCE6E4", badTx: "#B01A12",
  userBubble: "#EDE9FF",
};
export const AURORA = "radial-gradient(circle at 38% 30%, #9DA8FF, #B6A8F5 32%, #FF9E7B 82%, #FFC7A6)";
export const CTA = `linear-gradient(135deg, ${C.accentSoft}, #8A78F0)`; // lavanda (Aurora)
export const FONT = {
  round: "'ui-rounded', 'SF Pro Rounded', -apple-system, system-ui, sans-serif",
  sans: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', system-ui, sans-serif",
  mono: "ui-monospace, 'SF Mono', Menlo, Monaco, monospace",
};
/** Sombra dura (Bloques): el bloque parece recortado y pegado sobre la hoja. */
export const HARD = (c: string) => `4px 4px 0 0 ${c}`;
/** Sombra difusa (Aurora): la burbuja flota. */
export const SOFT = "0 6px 20px -8px rgba(40,30,60,.20)";

// ── Etiquetas ───────────────────────────────────────────────────────────────
export const gradeLabel = (g: string) => `${g.slice(0, -1)}° ${g.endsWith("M") ? "Medio" : "Básico"}`;
export const gradeSort = (g: string) => (g.endsWith("M") ? 100 : 0) + Number(g.slice(0, -1) || 0);

/**
 * Firma ESTRUCTURAL a propósito: cada pantalla trae su propia forma de materia
 * (el panel del alumno cuenta chunks, el del docente cuenta lecciones). Pedir un
 * tipo `Subject` concreto obligaría a que el modelo de datos viva acá.
 */
export interface SubjectLike { name: string; subject_area?: string | null }
export const subjectLabel = (s: SubjectLike) => s.name.replace(/\s+\d+º.*$/, "").trim();

// Familia de materias (bloques): color estable por materia
const SUBJECT_FAMILY = ["#FF5C3A", "#2B44FF", "#10A37F", "#7A3CF0", "#F5389B", "#FFC63D"];
export function subjectColor(s: SubjectLike): string {
  const n = `${s.subject_area ?? ""} ${s.name ?? ""}`.toLowerCase();
  if (/lengua|lenguaje|comunic|literat/.test(n)) return "#FF5C3A";
  if (/matem|c[aá]lculo/.test(n)) return "#2B44FF";
  // Las sociales van ANTES que las naturales: la materia se llama "Historia,
  // Geografía y Ciencias Sociales", así que con el orden inverso el "cien" de
  // "ciencias" la pintaba de verde y quedaba idéntica a Biología y Física — el
  // color dejaba de distinguir nada. "Ciencias Naturales" sigue cayendo abajo.
  if (/histor|geograf|social|filosof|c[ií]vic/.test(n)) return "#7A3CF0";
  if (/cien|biolog|f[ií]sic|qu[ií]mic|natur/.test(n)) return "#10A37F";
  if (/ingl|idiom|extranjer/.test(n)) return "#F5389B";
  if (/art|m[uú]sic|tecno|educaci[oó]n f/.test(n)) return "#FFC63D";
  let h = 0; for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) >>> 0;
  return SUBJECT_FAMILY[h % SUBJECT_FAMILY.length]!;
}
export function isLight(hex: string): boolean {
  const c = hex.replace("#", "");
  const r = parseInt(c.slice(0, 2), 16), g = parseInt(c.slice(2, 4), 16), b = parseInt(c.slice(4, 6), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b > 150;
}

/** Color del chip de una nota. El 0/6 en verde leía como logro. */
export function scoreTone(ratio: number): { bg: string; tx: string } {
  if (ratio >= 0.6) return { bg: C.okBg, tx: C.okTx };
  if (ratio >= 0.4) return { bg: C.warnBg, tx: C.warnTx };
  return { bg: C.badBg, tx: C.badTx };
}

// ── Iconos (SVG inline, estilo línea; sin dependencias) ─────────────────────
export type IconProps = { size?: number; color?: string; stroke?: number };
const svg = (size = 22, color = "currentColor", stroke = 1.8) => ({
  width: size, height: size, viewBox: "0 0 24 24", fill: "none",
  stroke: color, strokeWidth: stroke, strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
});
export const IconWave = ({ size, color, stroke }: IconProps) => (<svg {...svg(size, color, stroke)}><path d="M2 12h2" /><path d="M6 8v8" /><path d="M10 5v14" /><path d="M14 8v8" /><path d="M18 10v4" /><path d="M22 12h0" /></svg>);
export const IconVolume = ({ size, color, stroke }: IconProps) => (<svg {...svg(size, color, stroke)}><path d="M11 5 6 9H2v6h4l5 4V5Z" /><path d="M15.5 8.5a5 5 0 0 1 0 7" /><path d="M18.5 5.5a9 9 0 0 1 0 13" /></svg>);
export const IconVolumeOff = ({ size, color, stroke }: IconProps) => (<svg {...svg(size, color, stroke)}><path d="M11 5 6 9H2v6h4l5 4V5Z" /><path d="m22 9-6 6" /><path d="m16 9 6 6" /></svg>);
export const IconMic = ({ size, color, stroke }: IconProps) => (<svg {...svg(size, color, stroke)}><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10a7 7 0 0 0 14 0" /><path d="M12 17v5" /></svg>);
export const IconStop = ({ size, color, stroke }: IconProps) => (<svg {...svg(size, color, stroke)}><rect x="6" y="6" width="12" height="12" rx="2.5" /></svg>);
export const IconSend = ({ size, color, stroke }: IconProps) => (<svg {...svg(size, color, stroke)}><path d="M4 12h15" /><path d="m13 6 6 6-6 6" /></svg>);
export const IconBack = ({ size, color, stroke }: IconProps) => (<svg {...svg(size, color, stroke)}><path d="M19 12H5" /><path d="m12 19-7-7 7-7" /></svg>);
export const IconSwap = ({ size, color, stroke }: IconProps) => (<svg {...svg(size, color, stroke)}><path d="m17 2 4 4-4 4" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><path d="m7 22-4-4 4-4" /><path d="M21 13v2a4 4 0 0 1-4 4H3" /></svg>);
export const IconX = ({ size, color, stroke }: IconProps) => (<svg {...svg(size, color, stroke)}><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>);
export const IconCheck = ({ size, color, stroke }: IconProps) => (<svg {...svg(size, color, stroke)}><path d="M20 6 9 17l-5-5" /></svg>);
export const IconAlert = ({ size, color, stroke }: IconProps) => (<svg {...svg(size, color, stroke)}><path d="M12 9v4" /><path d="M12 17h0" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /></svg>);
export const IconUser = ({ size, color, stroke }: IconProps) => (<svg {...svg(size, color, stroke)}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>);
export const IconUsers = ({ size, color, stroke }: IconProps) => (<svg {...svg(size, color, stroke)}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>);
export const IconSettings = ({ size, color, stroke }: IconProps) => (<svg {...svg(size, color, stroke)}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" /></svg>);
export const IconBook = ({ size, color, stroke }: IconProps) => (<svg {...svg(size, color, stroke)}><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" /></svg>);
export const IconStar = ({ size, color, stroke }: IconProps) => (<svg {...svg(size, color, stroke)}><path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2Z" /></svg>);
export const IconArrow = ({ size, color, stroke }: IconProps) => (<svg {...svg(size, color, stroke)}><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></svg>);
export const IconList = ({ size, color, stroke }: IconProps) => (<svg {...svg(size, color, stroke)}><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></svg>);
export const IconSpark = ({ size, color, stroke }: IconProps) => (<svg {...svg(size, color, stroke)}><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8" /></svg>);
export const IconClipboard = ({ size, color, stroke }: IconProps) => (<svg {...svg(size, color, stroke)}><rect x="8" y="3" width="8" height="4" rx="1" /><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" /><path d="m9 14 2 2 4-4" /></svg>);
export const IconChevron = ({ size, color, stroke }: IconProps) => (<svg {...svg(size, color, stroke)}><path d="m9 18 6-6-6-6" /></svg>);
export const IconLock = ({ size, color, stroke }: IconProps) => (<svg {...svg(size, color, stroke)}><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>);
export const IconClock = ({ size, color, stroke }: IconProps) => (<svg {...svg(size, color, stroke)}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>);

// ── Piezas compartidas ──────────────────────────────────────────────────────

/** Orbe aurora en miniatura (marca / avatar-puente). */
export function AuroraDot({ size = 22, square = false, ink = false }: { size?: number; square?: boolean; ink?: boolean }) {
  return <span style={{ width: size, height: size, borderRadius: square ? size * 0.28 : "50%", background: AURORA, flexShrink: 0, display: "inline-block", border: ink ? `2px solid ${C.ink}` : undefined }} />;
}

/** Botón de icono: soft (Aurora) o bloque (Panel). */
export function IconBtn({ children, onClick, active, title, soft }: { children: React.ReactNode; onClick: () => void; active?: boolean; title?: string; soft?: boolean }) {
  const bd = soft ? C.border : C.ink;
  return (
    <button onClick={onClick} title={title}
      style={{
        display: "flex", alignItems: "center", justifyContent: "center", width: soft ? 40 : 40, height: 40,
        background: active ? (soft ? "rgba(108,92,231,.12)" : "rgba(43,68,255,.10)") : (soft ? C.panel2 : C.panel),
        color: active ? (soft ? C.accentSoft : C.accent) : C.text,
        border: `${soft ? 1 : 2}px solid ${active ? (soft ? C.accentSoft : C.accent) : bd}`,
        borderRadius: soft ? 12 : 11, cursor: "pointer", flexShrink: 0,
      }}>
      {children}
    </button>
  );
}

export function Dots() {
  return (<span style={{ display: "inline-flex", gap: 3 }}>
    {[0, 1].map((i) => <span key={i} style={{ width: 5, height: 5, borderRadius: "50%", background: "currentColor", animation: `tdot 1s ${i * 0.15}s infinite ease-in-out` }} />)}
    <style>{`@keyframes tdot { 0%,80%,100% { opacity:.3; transform:translateY(0) } 40% { opacity:1; transform:translateY(-3px) } }`}</style>
  </span>);
}

/** Pill estilo bloque (borde de tinta); activo = cobalto. */
export function Pill({ children, onClick, active }: { children: React.ReactNode; onClick: () => void; active?: boolean }) {
  return <button onClick={onClick} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: active ? "rgba(43,68,255,.10)" : C.panel, color: active ? C.accent : C.text, border: `1.5px solid ${active ? C.accent : C.ink}`, borderRadius: 999, padding: "9px 16px", cursor: "pointer", fontFamily: FONT.round, fontWeight: 600, fontSize: 14.5, transition: "background .15s, box-shadow .15s" }}
    onMouseEnter={(e) => { if (!active) e.currentTarget.style.boxShadow = HARD(C.accent); }} onMouseLeave={(e) => (e.currentTarget.style.boxShadow = "none")}>{children}</button>;
}

/** CTA cobalto (bloque con sombra dura) — mundo Panel. */
export function BigBtn({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled}
      style={{ display: "inline-flex", alignItems: "center", gap: 8, background: disabled ? C.panel2 : C.accent, color: disabled ? C.dim : "#fff", border: `2px solid ${disabled ? C.border : C.ink}`, borderRadius: 14, padding: "13px 24px", cursor: disabled ? "default" : "pointer", fontFamily: FONT.round, fontSize: 15.5, fontWeight: 700, boxShadow: disabled ? "none" : HARD(C.coral), transition: "transform .12s, box-shadow .12s" }}
      onMouseEnter={(e) => { if (!disabled) { e.currentTarget.style.transform = "translate(-2px,-2px)"; e.currentTarget.style.boxShadow = `6px 6px 0 0 ${C.coral}`; } }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = disabled ? "none" : HARD(C.coral); }}>
      {children}
    </button>
  );
}

export function SectionTitle({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return <div style={{ display: "flex", alignItems: "center", gap: 8, color: C.dim, fontFamily: FONT.round, fontWeight: 700, fontSize: 12.5, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 14 }}><span style={{ width: 18, height: 3, borderRadius: 2, background: C.coral }} />{icon} {children}</div>;
}

/** Estilo del "← volver": link discreto, no botón. */
export const backLink: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 6, background: "none", border: "none", color: C.dim, cursor: "pointer", fontFamily: FONT.round, fontWeight: 600, fontSize: 14, marginBottom: 16 };
