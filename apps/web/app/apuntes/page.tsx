"use client";
/**
 * REPASÁ CON TUS APUNTES — **MAQUETA**.
 *
 * El alumno escanea su cuaderno y el tutor se lo devuelve en cuatro formas de
 * repasar: mapa conceptual, fichas de memoria, entrenar con la IA y una
 * grabación de repaso — la única que no pide ojos, para escuchar en el camino
 * al colegio.
 *
 * ⚠️ NADA DE ESTO PROCESA TODAVÍA, y la pantalla lo dice en la cara —chapa
 * "Maqueta" arriba y aviso al tocar los botones—. Es deliberado: una pantalla
 * de producto que se ve terminada y calla que es un dibujo termina en manos de
 * un chico que sube la foto de su cuaderno y espera un mapa conceptual que no
 * va a llegar. Mientras sea maqueta, tiene que verse como maqueta.
 *
 * Lo que sí es real por debajo, cuando se conecte: el corpus del alumno todavía
 * NO admite material propio (la ingesta es del libro del colegio), así que esto
 * necesita una tubería nueva —foto → OCR → chunks del alumno— y no solamente
 * "llamar a una API que ya está".
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PanelShell, PanelNav, contarReforzar, Centered } from "../panel";
import { C, FONT, HARD, SOFT, AuroraDot, Dots, IconArrow } from "../ui";
import { CLASE_HUECO_RELOJ } from "../pomodoro";
import { cursoBloqueado } from "@/lib/cursos";
import { useAlumno, cerrarSesion } from "../usar-alumno";

export default function ApuntesPage() {
  const router = useRouter();
  const { loaded, profile, subjects, stats, role } = useAlumno();
  const [aviso, setAviso] = useState(false);

  useEffect(() => {
    if (loaded && (!profile || cursoBloqueado(profile.grade))) router.replace("/");
  }, [loaded, profile, router]);

  if (!loaded || !profile) return <Centered><span style={{ color: C.dim }}><Dots /></span></Centered>;

  return (
    <PanelShell nav={
      <PanelNav profile={profile} pendientes={contarReforzar(subjects, stats)}
        teacher={role === "teacher" || role === "admin"}
        onEdit={() => router.push("/?editar=1")}
        onLogout={() => { void cerrarSesion().then(() => router.replace("/login")); }} />
    }>
      <header className={CLASE_HUECO_RELOJ} style={{ marginBottom: 22 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontFamily: FONT.round, fontSize: 24, fontWeight: 800, letterSpacing: -0.3 }}>
            Repasá con tus apuntes
          </span>
          <span style={{ background: C.warnBg, color: C.warnTx, border: `1.5px solid ${C.warnTx}`, borderRadius: 999, padding: "2px 10px", fontFamily: FONT.round, fontWeight: 800, fontSize: 11.5, textTransform: "uppercase", letterSpacing: 0.6 }}>
            Maqueta
          </span>
        </div>
        <p style={{ color: C.dim, fontSize: 14, lineHeight: 1.55, margin: "4px 0 0", maxWidth: 620 }}>
          Sacale una foto a tu cuaderno y te lo devuelvo en cuatro formas de repasar. Así se
          va a ver: todavía no procesa nada.
        </p>
      </header>

      {/* ── EL ESCÁNER ────────────────────────────────────────────────────── */}
      <div style={{ background: C.panel, border: `2px dashed ${C.border}`, borderRadius: 20, padding: "28px 20px", textAlign: "center", marginBottom: 34 }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}>
          <span style={{ width: 62, height: 62, borderRadius: 18, background: C.panel2, color: C.accent, display: "grid", placeItems: "center", border: `1.5px solid ${C.border}` }}>
            <IconEscanear size={30} />
          </span>
        </div>
        <div style={{ fontFamily: FONT.round, fontWeight: 800, fontSize: 18 }}>Escaneá tu página</div>
        <p style={{ color: C.dim, fontSize: 13.5, lineHeight: 1.5, margin: "5px auto 16px", maxWidth: 420 }}>
          Una foto derecha de la hoja, con luz. También podés subir un PDF o una foto que ya
          tengas en el teléfono.
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
          <button onClick={() => setAviso(true)}
            style={{ display: "inline-flex", alignItems: "center", gap: 8, background: C.accent, color: "#fff", border: `2px solid ${C.ink}`, borderRadius: 14, padding: "12px 20px", cursor: "pointer", fontFamily: FONT.round, fontWeight: 700, fontSize: 14.5, boxShadow: HARD(C.coral) }}>
            <IconCamara size={17} /> Sacar una foto
          </button>
          <button onClick={() => setAviso(true)}
            style={{ display: "inline-flex", alignItems: "center", gap: 8, background: C.panel2, color: C.dim, border: `1.5px solid ${C.border}`, borderRadius: 14, padding: "12px 18px", cursor: "pointer", fontFamily: FONT.round, fontWeight: 700, fontSize: 14 }}>
            Subir un archivo
          </button>
        </div>
        {aviso && (
          <p style={{ display: "inline-flex", gap: 7, alignItems: "flex-start", textAlign: "left", marginTop: 16, marginBottom: 0, background: C.warnBg, color: C.warnTx, border: `1.5px solid ${C.warnTx}`, borderRadius: 12, padding: "9px 13px", fontSize: 12.5, lineHeight: 1.5, maxWidth: 460 }}>
            Todavía no está conectado. Esta pantalla es una maqueta para ver cómo se vería:
            falta la tubería que convierte la foto en material tuyo.
          </p>
        )}
      </div>

      {/* ── LAS CUATRO FORMAS ─────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        <span style={{ fontFamily: FONT.round, fontWeight: 800, fontSize: 17 }}>Y con eso te armo</span>
        <span style={{ color: C.dim, fontSize: 13 }}>cuatro formas de repasar lo mismo</span>
      </div>

      {/* CUATRO O DOS COLUMNAS, NUNCA TRES. Con `auto-fit` el ancho del panel
          (~900) da para tres tarjetas y deja la cuarta huérfana abajo, que se
          lee como "esta última es otra cosa" — y son cuatro hermanas. El número
          de columnas se fija a mano por eso; es la misma razón por la que el nav
          del panel tiene CSS de verdad y no estilos en línea. */}
      <style>{`
        .apuntes-formas { display: grid; gap: 16px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
        @media (min-width: 1120px) { .apuntes-formas { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
        @media (max-width: 520px)  { .apuntes-formas { grid-template-columns: minmax(0, 1fr); } }
      `}</style>
      <div className="apuntes-formas" style={{ marginBottom: 40 }}>
        <Forma
          color={C.accent}
          titulo="Mapa conceptual"
          bajada="Cómo se conectan las ideas de tu página, de un vistazo. Sirve para ver el bosque cuando los apuntes son una lista."
          vista={<VistaMapa />}
        />
        <Forma
          color={C.coral}
          titulo="Fichas de memoria"
          bajada="Pregunta de un lado, respuesta del otro. Para lo que hay que saber de memoria: fechas, fórmulas, definiciones."
          vista={<VistaFichas />}
        />
        <Forma
          color={C.accentSoft}
          titulo="Entrenar con la IA"
          bajada="Te pregunto yo, con tus propios apuntes, y te digo dónde flaqueás. Lo que falles cae en Reforzar."
          vista={<VistaEntrenar />}
          icono={<AuroraDot size={20} />}
        />
        {/* La cuarta es la única que NO pide ojos: se escucha yendo al colegio o
            antes de dormir. Por eso dice cuánto dura — en audio, el largo es la
            primera pregunta, y un repaso de 40 minutos no se escucha nunca. */}
        <Forma
          color={C.sun}
          titulo="Grabación de repaso"
          bajada="Tus apuntes contados en voz alta, de corrido. Para escuchar mientras vas al colegio, sin tener que mirar la pantalla."
          vista={<VistaGrabacion />}
        />
      </div>
    </PanelShell>
  );
}

/**
 * Una de las cuatro formas. Con VISTA PREVIA dibujada y no solo un título: la
 * pregunta que esta pantalla tiene que contestar es "¿qué me va a dar?", y
 * cuatro cajas con un nombre adentro no la contestan.
 */
function Forma({ color, titulo, bajada, vista, icono }: {
  color: string; titulo: string; bajada: string; vista: React.ReactNode; icono?: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", background: C.panel, border: `2px solid ${C.ink}`, borderRadius: 18, boxShadow: HARD(color), overflow: "hidden" }}>
      <div style={{ background: C.panel2, borderBottom: `1.5px solid ${C.border}`, padding: 14, height: 116, display: "grid", placeItems: "center" }}>
        {vista}
      </div>
      <div style={{ padding: "13px 15px 16px", display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {icono ?? <span style={{ width: 11, height: 11, borderRadius: 4, background: color, flexShrink: 0 }} />}
          <span style={{ fontFamily: FONT.round, fontWeight: 800, fontSize: 16 }}>{titulo}</span>
        </div>
        <p style={{ color: C.dim, fontSize: 13, lineHeight: 1.5, margin: 0, flex: 1 }}>{bajada}</p>
        {/* Sin botón: no hay a dónde ir todavía, y un "Empezar" que no empieza
            nada es la parte de la maqueta que después alguien jura que probó. */}
      </div>
    </div>
  );
}

// ── Vistas previas (dibujos, no datos) ──────────────────────────────────────

/** Tres nodos y sus líneas: la forma de un mapa, sin fingir un contenido. */
function VistaMapa() {
  return (
    <svg width="150" height="86" viewBox="0 0 150 86" fill="none" aria-hidden>
      {/* Las líneas van en tinta al 30% y no en `C.border`: sobre el fondo
          crudo de la vista previa, el borde contra el panel es casi el mismo
          color y el mapa se veía como tres cajas sueltas — justo lo contrario
          de lo que un mapa conceptual tiene que mostrar. */}
      <path d="M75 30v12M75 42 42 58M75 42l33 16" stroke={C.ink} strokeOpacity=".3" strokeWidth="2" strokeLinecap="round" />
      <rect x="45" y="8" width="60" height="22" rx="8" fill={C.accent} />
      <rect x="55" y="16" width="40" height="6" rx="3" fill="#fff" opacity=".85" />
      <rect x="12" y="56" width="60" height="20" rx="8" fill={C.panel} stroke={C.ink} strokeWidth="1.6" />
      <rect x="22" y="63" width="40" height="6" rx="3" fill={C.border} />
      <rect x="80" y="56" width="60" height="20" rx="8" fill={C.panel} stroke={C.ink} strokeWidth="1.6" />
      <rect x="90" y="63" width="40" height="6" rx="3" fill={C.border} />
    </svg>
  );
}

/** Dos fichas apiladas, la de arriba con su pregunta. */
function VistaFichas() {
  return (
    <span style={{ position: "relative", width: 132, height: 82, display: "block" }}>
      <span style={{ position: "absolute", left: 14, top: 10, width: 118, height: 66, borderRadius: 12, background: C.panel, border: `1.5px solid ${C.border}`, transform: "rotate(5deg)" }} />
      <span style={{ position: "absolute", left: 0, top: 0, width: 118, height: 66, borderRadius: 12, background: C.panel, border: `2px solid ${C.ink}`, boxShadow: SOFT, padding: 12, display: "flex", flexDirection: "column", gap: 7 }}>
        <span style={{ fontFamily: FONT.round, fontWeight: 800, fontSize: 10.5, color: C.coral, letterSpacing: 0.6 }}>PREGUNTA</span>
        <span style={{ display: "block", width: "86%", height: 6, borderRadius: 3, background: C.border }} />
        <span style={{ display: "block", width: "60%", height: 6, borderRadius: 3, background: C.border }} />
      </span>
    </span>
  );
}

/** Un turno de la conversación: el orbe pregunta, hay tres opciones. */
function VistaEntrenar() {
  return (
    <span style={{ width: 146, display: "flex", flexDirection: "column", gap: 7 }}>
      <span style={{ display: "flex", gap: 7, alignItems: "flex-start" }}>
        <AuroraDot size={16} />
        <span style={{ flex: 1, background: C.panel, border: `1.5px solid ${C.border}`, borderRadius: "10px 10px 10px 3px", padding: "7px 9px", display: "flex", flexDirection: "column", gap: 5 }}>
          <span style={{ display: "block", width: "92%", height: 5, borderRadius: 3, background: C.border }} />
          <span style={{ display: "block", width: "64%", height: 5, borderRadius: 3, background: C.border }} />
        </span>
      </span>
      <span style={{ display: "flex", gap: 5, paddingLeft: 23 }}>
        {[0, 1, 2].map((i) => (
          <span key={i} style={{ flex: 1, height: 14, borderRadius: 7, background: i === 1 ? C.accentSoft : C.panel, border: `1.5px solid ${i === 1 ? C.accentSoft : C.border}` }} />
        ))}
      </span>
    </span>
  );
}

/**
 * Un reproductor: play, la onda del audio y cuánto dura.
 *
 * La onda va con alturas FIJAS y no aleatorias: `Math.random()` en el render
 * daría una forma distinta en el servidor y en el cliente, y React protesta por
 * la hidratación. Además, una maqueta que cambia de dibujo en cada recarga se
 * lee como un gráfico de datos reales que no lo son.
 */
const ONDA = [7, 13, 22, 16, 28, 19, 34, 24, 30, 15, 25, 11, 20, 26, 14, 8];

function VistaGrabacion() {
  return (
    <span style={{ width: 150, display: "flex", flexDirection: "column", gap: 8 }}>
      <span style={{ display: "flex", alignItems: "center", gap: 9 }}>
        <span style={{ width: 30, height: 30, flexShrink: 0, borderRadius: "50%", background: C.sun, border: `2px solid ${C.ink}`, display: "grid", placeItems: "center" }}>
          {/* El triángulo corrido 1px a la derecha: centrado de verdad se ve
              descentrado, porque el peso visual de un play cae a la izquierda. */}
          <span style={{ marginLeft: 2, width: 0, height: 0, borderLeft: `9px solid ${C.ink}`, borderTop: "6px solid transparent", borderBottom: "6px solid transparent" }} />
        </span>
        <span style={{ flex: 1, display: "flex", alignItems: "center", gap: 2, height: 36 }}>
          {ONDA.map((h, i) => (
            <span key={i} style={{
              flex: 1, height: h, borderRadius: 2,
              // La primera parte, "ya escuchada": el mismo truco que el sendero
              // del camino — el avance se ve sin leer un número.
              background: i < 6 ? C.ink : C.border,
            }} />
          ))}
        </span>
      </span>
      <span style={{ display: "flex", justifyContent: "space-between", fontFamily: FONT.mono, fontSize: 10.5, color: C.dim }}>
        <span>2:41</span>
        <span>8:12</span>
      </span>
    </span>
  );
}

// ── Iconos propios de esta pantalla ─────────────────────────────────────────
// Viven acá y no en `ui.tsx` porque son de una maqueta: si el día de mañana la
// pantalla se cae, no dejan basura en el kit compartido.

const trazo = (size: number) => ({
  width: size, height: size, viewBox: "0 0 24 24", fill: "none",
  stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
});

/** Las cuatro esquinas del encuadre, con la hoja adentro. */
function IconEscanear({ size = 24 }: { size?: number }) {
  return (
    <svg {...trazo(size)}>
      <path d="M3 8V5.5A2.5 2.5 0 0 1 5.5 3H8" />
      <path d="M16 3h2.5A2.5 2.5 0 0 1 21 5.5V8" />
      <path d="M21 16v2.5a2.5 2.5 0 0 1-2.5 2.5H16" />
      <path d="M8 21H5.5A2.5 2.5 0 0 1 3 18.5V16" />
      <path d="M8 9h8M8 13h8M8 17h5" />
    </svg>
  );
}

function IconCamara({ size = 24 }: { size?: number }) {
  return (
    <svg {...trazo(size)}>
      <path d="M4 7h3l1.5-2h7L17 7h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1Z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  );
}
