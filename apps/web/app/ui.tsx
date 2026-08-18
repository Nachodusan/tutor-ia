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
/**
 * Sombra de ELEVACIÓN (Aurora): lo que está por encima del contenido y no
 * pertenece al flujo — el compositor del chat, sus botones. Dos capas a
 * propósito: la difusa da la altura, la corta apoya el borde para que el objeto
 * no parezca despegado del todo. Con una sola, o flota como calcomanía o no se
 * despega nada.
 */
export const FLOAT = "0 16px 36px -16px rgba(40,30,60,.34), 0 3px 10px -5px rgba(40,30,60,.12)";

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

// ── Iconos (Phosphor Regular, inline) ───────────────────────────────────────
/**
 * ANTES ESTABAN ESCRITOS A MANO, copiados de un set outline, y por eso se veían
 * genéricos: eran 26 dibujos sueltos sin sistema. Ahora salen de Phosphor
 * (1512 íconos, 6 pesos, MIT), INLINE y no por import: el paquete queda como
 * dependencia de desarrollo y en el bundle solo viaja el ícono que se usa. Nada
 * de CDN — la red del colegio bloquea externos.
 *
 * ⚠️ SON RUTAS RELLENAS, NO TRAZOS. Los seis pesos de Phosphor traen el grosor
 * METIDO EN LA GEOMETRÍA: si se les fuerza `fill:none` + `stroke`, el dibujo se
 * destruye (el libro sale como un rectángulo pelado — lo probé). De ahí que
 * `svg()` fije `fill` y que la prop `stroke` ya no haga nada.
 *
 * La prop `stroke` SE CONSERVA en el tipo a propósito: la pasan ~50 llamadas y
 * sacarla obligaba a tocarlas todas para no cambiar ni un pixel. Se ignora.
 *
 * Para agregar uno nuevo: buscá el nombre en phosphoricons.com y copiá el
 * contenido de `assets/regular/<nombre>.svg`, con viewBox 256.
 */
export type IconProps = { size?: number; color?: string; stroke?: number };
const svg = (size = 22, color = "currentColor") => ({
  width: size, height: size, viewBox: "0 0 256 256", fill: color,
});
export const IconWave = ({ size, color }: IconProps) => (<svg {...svg(size, color)}><path d='M56,96v64a8,8,0,0,1-16,0V96a8,8,0,0,1,16,0ZM88,24a8,8,0,0,0-8,8V224a8,8,0,0,0,16,0V32A8,8,0,0,0,88,24Zm40,32a8,8,0,0,0-8,8V192a8,8,0,0,0,16,0V64A8,8,0,0,0,128,56Zm40,32a8,8,0,0,0-8,8v64a8,8,0,0,0,16,0V96A8,8,0,0,0,168,88Zm40-16a8,8,0,0,0-8,8v96a8,8,0,0,0,16,0V80A8,8,0,0,0,208,72Z'/></svg>);   // phosphor: waveform
export const IconVolume = ({ size, color }: IconProps) => (<svg {...svg(size, color)}><path d='M155.51,24.81a8,8,0,0,0-8.42.88L77.25,80H32A16,16,0,0,0,16,96v64a16,16,0,0,0,16,16H77.25l69.84,54.31A8,8,0,0,0,160,224V32A8,8,0,0,0,155.51,24.81ZM32,96H72v64H32ZM144,207.64,88,164.09V91.91l56-43.55Zm54-106.08a40,40,0,0,1,0,52.88,8,8,0,0,1-12-10.58,24,24,0,0,0,0-31.72,8,8,0,0,1,12-10.58ZM248,128a79.9,79.9,0,0,1-20.37,53.34,8,8,0,0,1-11.92-10.67,64,64,0,0,0,0-85.33,8,8,0,1,1,11.92-10.67A79.83,79.83,0,0,1,248,128Z'/></svg>);   // phosphor: speaker-high
export const IconVolumeOff = ({ size, color }: IconProps) => (<svg {...svg(size, color)}><path d='M53.92,34.62A8,8,0,1,0,42.08,45.38L73.55,80H32A16,16,0,0,0,16,96v64a16,16,0,0,0,16,16H77.25l69.84,54.31A8,8,0,0,0,160,224V175.09l42.08,46.29a8,8,0,1,0,11.84-10.76ZM32,96H72v64H32ZM144,207.64,88,164.09V95.89l56,61.6Zm42-63.77a24,24,0,0,0,0-31.72,8,8,0,1,1,12-10.57,40,40,0,0,1,0,52.88,8,8,0,0,1-12-10.59Zm-80.16-76a8,8,0,0,1,1.4-11.23l39.85-31A8,8,0,0,1,160,32v74.83a8,8,0,0,1-16,0V48.36l-26.94,21A8,8,0,0,1,105.84,67.91ZM248,128a79.9,79.9,0,0,1-20.37,53.34,8,8,0,0,1-11.92-10.67,64,64,0,0,0,0-85.33,8,8,0,1,1,11.92-10.67A79.83,79.83,0,0,1,248,128Z'/></svg>);   // phosphor: speaker-slash
export const IconMic = ({ size, color }: IconProps) => (<svg {...svg(size, color)}><path d='M128,176a48.05,48.05,0,0,0,48-48V64a48,48,0,0,0-96,0v64A48.05,48.05,0,0,0,128,176ZM96,64a32,32,0,0,1,64,0v64a32,32,0,0,1-64,0Zm40,143.6V240a8,8,0,0,1-16,0V207.6A80.11,80.11,0,0,1,48,128a8,8,0,0,1,16,0,64,64,0,0,0,128,0,8,8,0,0,1,16,0A80.11,80.11,0,0,1,136,207.6Z'/></svg>);   // phosphor: microphone
export const IconStop = ({ size, color }: IconProps) => (<svg {...svg(size, color)}><path d='M200,40H56A16,16,0,0,0,40,56V200a16,16,0,0,0,16,16H200a16,16,0,0,0,16-16V56A16,16,0,0,0,200,40Zm0,160H56V56H200V200Z'/></svg>);   // phosphor: stop
export const IconSend = ({ size, color }: IconProps) => (<svg {...svg(size, color)}><path d='M227.32,28.68a16,16,0,0,0-15.66-4.08l-.15,0L19.57,82.84a16,16,0,0,0-2.49,29.8L102,154l41.3,84.87A15.86,15.86,0,0,0,157.74,248q.69,0,1.38-.06a15.88,15.88,0,0,0,14-11.51l58.2-191.94c0-.05,0-.1,0-.15A16,16,0,0,0,227.32,28.68ZM157.83,231.85l-.05.14,0-.07-40.06-82.3,48-48a8,8,0,0,0-11.31-11.31l-48,48L24.08,98.25l-.07,0,.14,0L216,40Z'/></svg>);   // phosphor: paper-plane-tilt
export const IconBack = ({ size, color }: IconProps) => (<svg {...svg(size, color)}><path d='M224,128a8,8,0,0,1-8,8H59.31l58.35,58.34a8,8,0,0,1-11.32,11.32l-72-72a8,8,0,0,1,0-11.32l72-72a8,8,0,0,1,11.32,11.32L59.31,120H216A8,8,0,0,1,224,128Z'/></svg>);   // phosphor: arrow-left
export const IconSwap = ({ size, color }: IconProps) => (<svg {...svg(size, color)}><path d='M213.66,181.66l-32,32a8,8,0,0,1-11.32-11.32L188.69,184H48a8,8,0,0,1,0-16H188.69l-18.35-18.34a8,8,0,0,1,11.32-11.32l32,32A8,8,0,0,1,213.66,181.66Zm-139.32-64a8,8,0,0,0,11.32-11.32L67.31,88H208a8,8,0,0,0,0-16H67.31L85.66,53.66A8,8,0,0,0,74.34,42.34l-32,32a8,8,0,0,0,0,11.32Z'/></svg>);   // phosphor: arrows-left-right
export const IconX = ({ size, color }: IconProps) => (<svg {...svg(size, color)}><path d='M205.66,194.34a8,8,0,0,1-11.32,11.32L128,139.31,61.66,205.66a8,8,0,0,1-11.32-11.32L116.69,128,50.34,61.66A8,8,0,0,1,61.66,50.34L128,116.69l66.34-66.35a8,8,0,0,1,11.32,11.32L139.31,128Z'/></svg>);   // phosphor: x
export const IconCheck = ({ size, color }: IconProps) => (<svg {...svg(size, color)}><path d='M229.66,77.66l-128,128a8,8,0,0,1-11.32,0l-56-56a8,8,0,0,1,11.32-11.32L96,188.69,218.34,66.34a8,8,0,0,1,11.32,11.32Z'/></svg>);   // phosphor: check
export const IconAlert = ({ size, color }: IconProps) => (<svg {...svg(size, color)}><path d='M236.8,188.09,149.35,36.22h0a24.76,24.76,0,0,0-42.7,0L19.2,188.09a23.51,23.51,0,0,0,0,23.72A24.35,24.35,0,0,0,40.55,224h174.9a24.35,24.35,0,0,0,21.33-12.19A23.51,23.51,0,0,0,236.8,188.09ZM222.93,203.8a8.5,8.5,0,0,1-7.48,4.2H40.55a8.5,8.5,0,0,1-7.48-4.2,7.59,7.59,0,0,1,0-7.72L120.52,44.21a8.75,8.75,0,0,1,15,0l87.45,151.87A7.59,7.59,0,0,1,222.93,203.8ZM120,144V104a8,8,0,0,1,16,0v40a8,8,0,0,1-16,0Zm20,36a12,12,0,1,1-12-12A12,12,0,0,1,140,180Z'/></svg>);   // phosphor: warning
export const IconUser = ({ size, color }: IconProps) => (<svg {...svg(size, color)}><path d='M230.92,212c-15.23-26.33-38.7-45.21-66.09-54.16a72,72,0,1,0-73.66,0C63.78,166.78,40.31,185.66,25.08,212a8,8,0,1,0,13.85,8c18.84-32.56,52.14-52,89.07-52s70.23,19.44,89.07,52a8,8,0,1,0,13.85-8ZM72,96a56,56,0,1,1,56,56A56.06,56.06,0,0,1,72,96Z'/></svg>);   // phosphor: user
export const IconUsers = ({ size, color }: IconProps) => (<svg {...svg(size, color)}><path d='M117.25,157.92a60,60,0,1,0-66.5,0A95.83,95.83,0,0,0,3.53,195.63a8,8,0,1,0,13.4,8.74,80,80,0,0,1,134.14,0,8,8,0,0,0,13.4-8.74A95.83,95.83,0,0,0,117.25,157.92ZM40,108a44,44,0,1,1,44,44A44.05,44.05,0,0,1,40,108Zm210.14,98.7a8,8,0,0,1-11.07-2.33A79.83,79.83,0,0,0,172,168a8,8,0,0,1,0-16,44,44,0,1,0-16.34-84.87,8,8,0,1,1-5.94-14.85,60,60,0,0,1,55.53,105.64,95.83,95.83,0,0,1,47.22,37.71A8,8,0,0,1,250.14,206.7Z'/></svg>);   // phosphor: users
export const IconSettings = ({ size, color }: IconProps) => (<svg {...svg(size, color)}><path d='M128,80a48,48,0,1,0,48,48A48.05,48.05,0,0,0,128,80Zm0,80a32,32,0,1,1,32-32A32,32,0,0,1,128,160Zm88-29.84q.06-2.16,0-4.32l14.92-18.64a8,8,0,0,0,1.48-7.06,107.21,107.21,0,0,0-10.88-26.25,8,8,0,0,0-6-3.93l-23.72-2.64q-1.48-1.56-3-3L186,40.54a8,8,0,0,0-3.94-6,107.71,107.71,0,0,0-26.25-10.87,8,8,0,0,0-7.06,1.49L130.16,40Q128,40,125.84,40L107.2,25.11a8,8,0,0,0-7.06-1.48A107.6,107.6,0,0,0,73.89,34.51a8,8,0,0,0-3.93,6L67.32,64.27q-1.56,1.49-3,3L40.54,70a8,8,0,0,0-6,3.94,107.71,107.71,0,0,0-10.87,26.25,8,8,0,0,0,1.49,7.06L40,125.84Q40,128,40,130.16L25.11,148.8a8,8,0,0,0-1.48,7.06,107.21,107.21,0,0,0,10.88,26.25,8,8,0,0,0,6,3.93l23.72,2.64q1.49,1.56,3,3L70,215.46a8,8,0,0,0,3.94,6,107.71,107.71,0,0,0,26.25,10.87,8,8,0,0,0,7.06-1.49L125.84,216q2.16.06,4.32,0l18.64,14.92a8,8,0,0,0,7.06,1.48,107.21,107.21,0,0,0,26.25-10.88,8,8,0,0,0,3.93-6l2.64-23.72q1.56-1.48,3-3L215.46,186a8,8,0,0,0,6-3.94,107.71,107.71,0,0,0,10.87-26.25,8,8,0,0,0-1.49-7.06Zm-16.1-6.5a73.93,73.93,0,0,1,0,8.68,8,8,0,0,0,1.74,5.48l14.19,17.73a91.57,91.57,0,0,1-6.23,15L187,173.11a8,8,0,0,0-5.1,2.64,74.11,74.11,0,0,1-6.14,6.14,8,8,0,0,0-2.64,5.1l-2.51,22.58a91.32,91.32,0,0,1-15,6.23l-17.74-14.19a8,8,0,0,0-5-1.75h-.48a73.93,73.93,0,0,1-8.68,0,8,8,0,0,0-5.48,1.74L100.45,215.8a91.57,91.57,0,0,1-15-6.23L82.89,187a8,8,0,0,0-2.64-5.1,74.11,74.11,0,0,1-6.14-6.14,8,8,0,0,0-5.1-2.64L46.43,170.6a91.32,91.32,0,0,1-6.23-15l14.19-17.74a8,8,0,0,0,1.74-5.48,73.93,73.93,0,0,1,0-8.68,8,8,0,0,0-1.74-5.48L40.2,100.45a91.57,91.57,0,0,1,6.23-15L69,82.89a8,8,0,0,0,5.1-2.64,74.11,74.11,0,0,1,6.14-6.14A8,8,0,0,0,82.89,69L85.4,46.43a91.32,91.32,0,0,1,15-6.23l17.74,14.19a8,8,0,0,0,5.48,1.74,73.93,73.93,0,0,1,8.68,0,8,8,0,0,0,5.48-1.74L155.55,40.2a91.57,91.57,0,0,1,15,6.23L173.11,69a8,8,0,0,0,2.64,5.1,74.11,74.11,0,0,1,6.14,6.14,8,8,0,0,0,5.1,2.64l22.58,2.51a91.32,91.32,0,0,1,6.23,15l-14.19,17.74A8,8,0,0,0,199.87,123.66Z'/></svg>);   // phosphor: gear
export const IconBook = ({ size, color }: IconProps) => (<svg {...svg(size, color)}><path d='M208,24H72A32,32,0,0,0,40,56V224a8,8,0,0,0,8,8H192a8,8,0,0,0,0-16H56a16,16,0,0,1,16-16H208a8,8,0,0,0,8-8V32A8,8,0,0,0,208,24Zm-8,160H72a31.82,31.82,0,0,0-16,4.29V56A16,16,0,0,1,72,40H200Z'/></svg>);   // phosphor: book
export const IconStar = ({ size, color }: IconProps) => (<svg {...svg(size, color)}><path d='M239.18,97.26A16.38,16.38,0,0,0,224.92,86l-59-4.76L143.14,26.15a16.36,16.36,0,0,0-30.27,0L90.11,81.23,31.08,86a16.46,16.46,0,0,0-9.37,28.86l45,38.83L53,211.75a16.38,16.38,0,0,0,24.5,17.82L128,198.49l50.53,31.08A16.4,16.4,0,0,0,203,211.75l-13.76-58.07,45-38.83A16.43,16.43,0,0,0,239.18,97.26Zm-15.34,5.47-48.7,42a8,8,0,0,0-2.56,7.91l14.88,62.8a.37.37,0,0,1-.17.48c-.18.14-.23.11-.38,0l-54.72-33.65a8,8,0,0,0-8.38,0L69.09,215.94c-.15.09-.19.12-.38,0a.37.37,0,0,1-.17-.48l14.88-62.8a8,8,0,0,0-2.56-7.91l-48.7-42c-.12-.1-.23-.19-.13-.5s.18-.27.33-.29l63.92-5.16A8,8,0,0,0,103,91.86l24.62-59.61c.08-.17.11-.25.35-.25s.27.08.35.25L153,91.86a8,8,0,0,0,6.75,4.92l63.92,5.16c.15,0,.24,0,.33.29S224,102.63,223.84,102.73Z'/></svg>);   // phosphor: star
export const IconArrow = ({ size, color }: IconProps) => (<svg {...svg(size, color)}><path d='M221.66,133.66l-72,72a8,8,0,0,1-11.32-11.32L196.69,136H40a8,8,0,0,1,0-16H196.69L138.34,61.66a8,8,0,0,1,11.32-11.32l72,72A8,8,0,0,1,221.66,133.66Z'/></svg>);   // phosphor: arrow-right
export const IconList = ({ size, color }: IconProps) => (<svg {...svg(size, color)}><path d='M224,128a8,8,0,0,1-8,8H40a8,8,0,0,1,0-16H216A8,8,0,0,1,224,128ZM40,72H216a8,8,0,0,0,0-16H40a8,8,0,0,0,0,16ZM216,184H40a8,8,0,0,0,0,16H216a8,8,0,0,0,0-16Z'/></svg>);   // phosphor: list
export const IconSpark = ({ size, color }: IconProps) => (<svg {...svg(size, color)}><path d='M197.58,129.06,146,110l-19-51.62a15.92,15.92,0,0,0-29.88,0L78,110l-51.62,19a15.92,15.92,0,0,0,0,29.88L78,178l19,51.62a15.92,15.92,0,0,0,29.88,0L146,178l51.62-19a15.92,15.92,0,0,0,0-29.88ZM137,164.22a8,8,0,0,0-4.74,4.74L112,223.85,91.78,169A8,8,0,0,0,87,164.22L32.15,144,87,123.78A8,8,0,0,0,91.78,119L112,64.15,132.22,119a8,8,0,0,0,4.74,4.74L191.85,144ZM144,40a8,8,0,0,1,8-8h16V16a8,8,0,0,1,16,0V32h16a8,8,0,0,1,0,16H184V64a8,8,0,0,1-16,0V48H152A8,8,0,0,1,144,40ZM248,88a8,8,0,0,1-8,8h-8v8a8,8,0,0,1-16,0V96h-8a8,8,0,0,1,0-16h8V72a8,8,0,0,1,16,0v8h8A8,8,0,0,1,248,88Z'/></svg>);   // phosphor: sparkle
export const IconClipboard = ({ size, color }: IconProps) => (<svg {...svg(size, color)}><path d='M168,152a8,8,0,0,1-8,8H96a8,8,0,0,1,0-16h64A8,8,0,0,1,168,152Zm-8-40H96a8,8,0,0,0,0,16h64a8,8,0,0,0,0-16Zm56-64V216a16,16,0,0,1-16,16H56a16,16,0,0,1-16-16V48A16,16,0,0,1,56,32H92.26a47.92,47.92,0,0,1,71.48,0H200A16,16,0,0,1,216,48ZM96,64h64a32,32,0,0,0-64,0ZM200,48H173.25A47.93,47.93,0,0,1,176,64v8a8,8,0,0,1-8,8H88a8,8,0,0,1-8-8V64a47.93,47.93,0,0,1,2.75-16H56V216H200Z'/></svg>);   // phosphor: clipboard-text
export const IconChat = ({ size, color }: IconProps) => (<svg {...svg(size, color)}><path d='M168,112a8,8,0,0,1-8,8H96a8,8,0,0,1,0-16h64A8,8,0,0,1,168,112Zm-8,24H96a8,8,0,0,0,0,16h64a8,8,0,0,0,0-16Zm72-8A104,104,0,0,1,79.12,219.82L45.07,231.17a16,16,0,0,1-20.24-20.24l11.35-34.05A104,104,0,1,1,232,128Zm-16,0A88,88,0,1,0,51.81,172.06a8,8,0,0,1,.66,6.54L40,216,77.4,203.53a7.85,7.85,0,0,1,2.53-.42,8,8,0,0,1,4,1.08A88,88,0,0,0,216,128Z'/></svg>);   // phosphor: chat-circle-text
export const IconChevron = ({ size, color }: IconProps) => (<svg {...svg(size, color)}><path d='M181.66,133.66l-80,80a8,8,0,0,1-11.32-11.32L164.69,128,90.34,53.66a8,8,0,0,1,11.32-11.32l80,80A8,8,0,0,1,181.66,133.66Z'/></svg>);   // phosphor: caret-right
export const IconLock = ({ size, color }: IconProps) => (<svg {...svg(size, color)}><path d='M208,80H176V56a48,48,0,0,0-96,0V80H48A16,16,0,0,0,32,96V208a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V96A16,16,0,0,0,208,80ZM96,56a32,32,0,0,1,64,0V80H96ZM208,208H48V96H208V208Z'/></svg>);   // phosphor: lock-simple
export const IconClock = ({ size, color }: IconProps) => (<svg {...svg(size, color)}><path d='M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Zm64-88a8,8,0,0,1-8,8H128a8,8,0,0,1-8-8V72a8,8,0,0,1,16,0v48h48A8,8,0,0,1,192,128Z'/></svg>);   // phosphor: clock
export const IconPuerta = ({ size, color }: IconProps) => (<svg {...svg(size, color)}><path d='M120,216a8,8,0,0,1-8,8H48a8,8,0,0,1-8-8V40a8,8,0,0,1,8-8h64a8,8,0,0,1,0,16H56V208h56A8,8,0,0,1,120,216Zm109.66-93.66-40-40a8,8,0,0,0-11.32,11.32L204.69,120H112a8,8,0,0,0,0,16h92.69l-26.35,26.34a8,8,0,0,0,11.32,11.32l40-40A8,8,0,0,0,229.66,122.34Z'/></svg>);   // phosphor: sign-out
export const IconCalculadora = ({ size, color }: IconProps) => (<svg {...svg(size, color)}><path d='M80,120h96a8,8,0,0,0,8-8V64a8,8,0,0,0-8-8H80a8,8,0,0,0-8,8v48A8,8,0,0,0,80,120Zm8-48h80v32H88ZM200,24H56A16,16,0,0,0,40,40V216a16,16,0,0,0,16,16H200a16,16,0,0,0,16-16V40A16,16,0,0,0,200,24Zm0,192H56V40H200ZM100,148a12,12,0,1,1-12-12A12,12,0,0,1,100,148Zm40,0a12,12,0,1,1-12-12A12,12,0,0,1,140,148Zm40,0a12,12,0,1,1-12-12A12,12,0,0,1,180,148Zm-80,40a12,12,0,1,1-12-12A12,12,0,0,1,100,188Zm40,0a12,12,0,1,1-12-12A12,12,0,0,1,140,188Zm40,0a12,12,0,1,1-12-12A12,12,0,0,1,180,188Z'/></svg>);   // phosphor: calculator

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
