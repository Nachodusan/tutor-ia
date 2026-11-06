"use client";
/**
 * EL HISTORIAL DE CONVERSACIONES.
 *
 * ── POR QUÉ EXISTE ──────────────────────────────────────────────────────────
 *
 * Las charlas se venían guardando desde el principio (`study_sessions` +
 * `messages`, y `/api/conversations` ya sabía listarlas), pero **no había
 * ninguna pantalla que las mostrara**. Al recargar, el chat arrancaba en blanco
 * y el servidor abría una sesión nueva. Resultado medido antes de esto: 337
 * conversaciones guardadas que el alumno nunca pudo volver a abrir, y catorce
 * charlas distintas con el mismo título porque cada visita empezaba de cero.
 *
 * Así que esto no agrega persistencia: **le da puerta a la que ya había**.
 *
 * ── POR QUÉ AL COSTADO Y NO EN UN MENÚ ──────────────────────────────────────
 *
 * Pedido del dueño: al costado, a la vista. Un historial detrás de un botón se
 * usa cuando ya sabés que está; a la vista, enseña que existe. Es el mismo
 * argumento del §13.2 con el nav: si hay que descubrirlo deslizando o abriendo,
 * para el que no sabe que está, no está.
 *
 * Abajo de 1024 no hay costado, así que ahí es un cajón. Como en el resto de la
 * app, **el responsive lo decide el CSS y no una medición de la ventana en JS**:
 * se renderizan las dos formas y la hoja esconde una. Medir con JS pinta
 * primero el layout equivocado y después salta.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { C, FONT, HARD, IconMas, IconLapiz, IconTacho, IconX, IconCheck } from "./ui";

export interface Charla {
  id: string;
  subjectId: string | null;
  title: string | null;
  messages: number;
  lastAt: string;
}

/** Ancho de la columna. 268 y no menos: los títulos llegan a 80 caracteres y
 *  con 220 se cortaban en la mitad de casi todos. */
export const ANCHO_HISTORIAL = 268;
/** Abajo de esto la columna se vuelve cajón. Coincide con el salto del nav. */
export const CORTE_HISTORIAL = 1024;

// ── El agrupado por fecha ───────────────────────────────────────────────────
/**
 * El alumno de EPJA estudia en tandas y vuelve días después. "Hoy / Ayer /
 * Últimos 7 días / Antes" contesta la pregunta con la que abre el historial,
 * que no es "¿cómo se llamaba?" sino **"¿dónde iba?"**. Una lista plana
 * ordenada por fecha tiene la misma información y no la contesta.
 */
function grupoDe(iso: string): string {
  const d = new Date(iso);
  const hoy = new Date();
  const dias = Math.floor(
    (Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate()) -
      Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000,
  );
  if (dias <= 0) return "Hoy";
  if (dias === 1) return "Ayer";
  if (dias < 7) return "Esta semana";
  if (dias < 30) return "Este mes";
  return "Más atrás";
}

const fechaCorta = (iso: string) =>
  new Date(iso).toLocaleDateString("es-CL", { day: "numeric", month: "short" });

// ── El hook: los datos ──────────────────────────────────────────────────────
/**
 * Vive acá y no en la página del chat para que la página no tenga que saber
 * cómo se listan, se renombran ni se borran las charlas: solo cuándo recargar.
 */
export function useHistorial(subjectId: string | undefined) {
  const [charlas, setCharlas] = useState<Charla[]>([]);
  const [cargando, setCargando] = useState(true);

  const recargar = useCallback(async () => {
    if (!subjectId) return;
    try {
      const r = await fetch(`/api/conversations?subjectId=${subjectId}`);
      if (!r.ok) return;
      const j = (await r.json()) as { conversations: Charla[] };
      setCharlas(j.conversations ?? []);
    } catch { /* el historial es secundario: si falla, el chat sigue */ }
    finally { setCargando(false); }
  }, [subjectId]);

  useEffect(() => { void recargar(); }, [recargar]);

  const renombrar = useCallback(async (id: string, title: string) => {
    setCharlas((cs) => cs.map((c) => (c.id === id ? { ...c, title } : c)));   // optimista
    try {
      await fetch("/api/conversations", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, title }),
      });
    } catch { void recargar(); }
  }, [recargar]);

  const borrar = useCallback(async (id: string) => {
    setCharlas((cs) => cs.filter((c) => c.id !== id));
    try { await fetch(`/api/conversations?id=${id}`, { method: "DELETE" }); }
    catch { void recargar(); }
  }, [recargar]);

  return { charlas, cargando, recargar, renombrar, borrar };
}

// ── Una fila ────────────────────────────────────────────────────────────────
function Fila({ c, activa, onAbrir, onRenombrar, onBorrar }: {
  c: Charla; activa: boolean;
  onAbrir: (id: string) => void;
  onRenombrar: (id: string, t: string) => void;
  onBorrar: (id: string) => void;
}) {
  const [editando, setEditando] = useState(false);
  const [borrando, setBorrando] = useState(false);
  const [texto, setTexto] = useState(c.title ?? "");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (editando) inputRef.current?.select(); }, [editando]);

  function confirmarNombre() {
    const t = texto.trim();
    if (t && t !== c.title) onRenombrar(c.id, t);
    setEditando(false);
  }

  if (editando) {
    return (
      <div style={{ display: "flex", gap: 5, alignItems: "center", padding: "5px 6px" }}>
        <input ref={inputRef} value={texto} maxLength={80}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") confirmarNombre();
            if (e.key === "Escape") { setTexto(c.title ?? ""); setEditando(false); }
          }}
          aria-label="Nuevo nombre de la conversación"
          style={{ flex: 1, minWidth: 0, fontFamily: FONT.sans, fontSize: 13.5, padding: "7px 9px", borderRadius: 9, border: `1.5px solid ${C.accent}`, background: C.panel, color: C.text, outline: "none" }} />
        <button onClick={confirmarNombre} aria-label="Guardar el nombre" title="Guardar"
          style={{ ...btnIcono, color: C.ok }}><IconCheck size={15} /></button>
      </div>
    );
  }

  return (
    <div className="hc-fila" style={{
      display: "flex", alignItems: "center", gap: 2, borderRadius: 10,
      background: activa ? C.accentTint : "transparent",
      border: `1.5px solid ${activa ? C.accent : "transparent"}`,
    }}>
      <button onClick={() => onAbrir(c.id)} aria-current={activa ? "true" : undefined}
        title={c.title ?? "Conversación sin nombre"}
        style={{
          flex: 1, minWidth: 0, textAlign: "left", background: "none", border: "none",
          cursor: "pointer", padding: "9px 4px 9px 10px", color: C.text, borderRadius: 9,
        }}>
        <span style={{
          display: "block", fontFamily: FONT.round, fontWeight: activa ? 700 : 600,
          fontSize: 13.5, lineHeight: 1.35, color: activa ? C.accent : C.text,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {c.title?.trim() || "Sin nombre"}
        </span>
        <span style={{ display: "block", fontSize: 11.5, lineHeight: 1.4, color: C.dim, marginTop: 2 }}>
          {c.messages} {c.messages === 1 ? "mensaje" : "mensajes"} · {fechaCorta(c.lastAt)}
        </span>
      </button>

      {/* Renombrar y borrar aparecen al pasar el mouse o al enfocar con teclado.
          En pantalla táctil no hay hover, así que la hoja los deja siempre
          visibles ahí (ver HISTORIAL_CSS): esconderlos detrás de un gesto que
          el teléfono no tiene sería esconderlos y punto. */}
      <span className="hc-acciones" style={{ display: "flex", flexShrink: 0, paddingRight: 4 }}>
        {borrando ? (
          <>
            <button onClick={() => onBorrar(c.id)} aria-label="Confirmar que se borra"
              title="Sí, borrar" style={{ ...btnIcono, color: C.bad }}><IconCheck size={14} /></button>
            <button onClick={() => setBorrando(false)} aria-label="No borrar"
              title="Cancelar" style={btnIcono}><IconX size={14} /></button>
          </>
        ) : (
          <>
            <button onClick={() => { setTexto(c.title ?? ""); setEditando(true); }}
              aria-label={`Cambiarle el nombre a ${c.title ?? "esta conversación"}`}
              title="Cambiarle el nombre" style={btnIcono}><IconLapiz size={13} /></button>
            <button onClick={() => setBorrando(true)}
              aria-label={`Borrar ${c.title ?? "esta conversación"}`}
              title="Borrar" style={btnIcono}><IconTacho size={13} /></button>
          </>
        )}
      </span>
    </div>
  );
}

const btnIcono: React.CSSProperties = {
  display: "grid", placeItems: "center", width: 30, height: 30,
  background: "none", border: "none", borderRadius: 8,
  color: C.dim, cursor: "pointer", flexShrink: 0,
};

// ── La lista ────────────────────────────────────────────────────────────────
function Lista({ charlas, cargando, activa, onAbrir, onNueva, onRenombrar, onBorrar }: {
  charlas: Charla[]; cargando: boolean; activa: string | null;
  onAbrir: (id: string) => void; onNueva: () => void;
  onRenombrar: (id: string, t: string) => void; onBorrar: (id: string) => void;
}) {
  // El orden ya viene del servidor (last_message_at desc); acá solo se parte en
  // tramos, sin reordenar: si el agrupado cambiara el orden, una charla de hoy
  // podría quedar debajo de una de la semana pasada.
  const grupos: { nombre: string; items: Charla[] }[] = [];
  for (const c of charlas) {
    const g = grupoDe(c.lastAt);
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.nombre === g) ultimo.items.push(c);
    else grupos.push({ nombre: g, items: [c] });
  }

  return (
    <>
      {/* LA LISTA PRIMERO Y EL BOTÓN ABAJO (pedido del dueño).
          Además de lo que se ve, el orden ayuda: arriba, el botón era lo primero
          que leía el ojo cada vez que se abría el historial, cuando lo que se
          viene a hacer nueve de cada diez veces es RETOMAR una charla, no
          empezar otra. Abajo queda a mano y deja de competir con la lista. */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", marginLeft: -6, marginRight: -6 }}>
        {cargando && <p style={{ ...vacio, margin: 0 }}>Buscando tus conversaciones…</p>}

        {!cargando && charlas.length === 0 && (
          <p style={{ ...vacio, margin: 0 }}>
            Todavía no hay conversaciones de esta materia. Preguntale algo al tutor y va a
            quedar guardada acá.
          </p>
        )}

        {grupos.map((g) => (
          <div key={g.nombre} style={{ marginBottom: 14 }}>
            <div style={{
              fontFamily: FONT.round, fontWeight: 700, fontSize: 11, letterSpacing: .7,
              textTransform: "uppercase", color: C.dim, padding: "0 10px", marginBottom: 5,
            }}>
              {g.nombre}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {g.items.map((c) => (
                <Fila key={c.id} c={c} activa={c.id === activa}
                  onAbrir={onAbrir} onRenombrar={onRenombrar} onBorrar={onBorrar} />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* El filete de arriba lo ancla: sin él, con la lista corta el botón queda
          flotando en el medio de la nada y no se lee como el pie de la columna. */}
      <div style={{ flexShrink: 0, paddingTop: 10, marginTop: 4, borderTop: `1px solid ${C.border}` }}>
        <button onClick={onNueva}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            width: "100%", background: C.accent, color: "#fff",
            border: `1.5px solid ${C.ink}`, borderRadius: 10, boxShadow: HARD(C.ink),
            // 40 de alto: más chico de lo que era, pero sigue siendo un blanco
            // que un dedo acierta en el teléfono, que es donde vive el cajón.
            padding: "0 12px", minHeight: 40, cursor: "pointer",
            fontFamily: FONT.round, fontWeight: 700, fontSize: 13,
          }}>
          <IconMas size={14} /> Conversación nueva
        </button>
      </div>
    </>
  );
}

const vacio: React.CSSProperties = {
  fontSize: 13, lineHeight: 1.55, color: C.dim, padding: "10px 10px 0",
};

// ── Lo que monta la página ──────────────────────────────────────────────────
export function HistorialChats(props: {
  charlas: Charla[]; cargando: boolean; activa: string | null;
  abierto: boolean; onCerrar: () => void;
  onAbrir: (id: string) => void; onNueva: () => void;
  onRenombrar: (id: string, t: string) => void; onBorrar: (id: string) => void;
}) {
  const { abierto, onCerrar } = props;
  const [montado, setMontado] = useState(false);
  useEffect(() => setMontado(true), []);

  // Escape cierra el cajón. Sin esto, en una tablet con teclado el cajón se abre
  // y la única salida es tocar el velo.
  useEffect(() => {
    if (!abierto) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onCerrar(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [abierto, onCerrar]);

  const cajon = abierto && montado
    /* VA EN UN PORTAL AL BODY, como los modales del panel y por lo mismo: la
       cabecera de la materia es fixed con z-index, o sea que CREA UN CONTEXTO
       DE APILAMIENTO, y un cajón dibujado adentro del chat solo compite contra
       sus hermanos. Subirle el z-index no alcanza: el techo lo pone el ancestro. */
    ? createPortal(
        <div role="dialog" aria-modal="true" aria-label="Tus conversaciones"
          style={{ position: "fixed", inset: 0, zIndex: 900, display: "flex" }}>
          <div onClick={onCerrar} aria-hidden
            style={{ position: "absolute", inset: 0, background: "rgba(25,22,33,.42)" }} />
          {/* 300 y no 320: el reloj de estudio flota fijo arriba a la derecha y
              arranca a los 316px en un teléfono de 375. Con el cajón a 320, su
              botón de cerrar quedaba DEBAJO del reloj —se tocaba igual, porque
              el portal gana en z-index, pero se veía como un choque. Con 300
              queda libre, y de paso el borde del chat que asoma dice sin
              palabras que esto es un cajón y no otra pantalla. */}
          <aside style={{
            position: "relative", width: "min(82vw, 300px)", height: "100%",
            /* ⚠️ `border-box` NO es decorativo acá: el proyecto no tiene reset
               global, así que la caja es `content-box` y un `height: 100%` con
               `padding: 14px` daba 840px de alto en una pantalla de 812. El
               botón del pie quedaba 14px POR DEBAJO del borde, cortado. */
            boxSizing: "border-box",
            background: C.panel, borderRight: `1.5px solid ${C.border}`,
            display: "flex", flexDirection: "column",
            paddingTop: 14, paddingLeft: 12, paddingRight: 12,
            /* La franja de gestos del iPhone se come el último renglón de
               cualquier cosa pegada al borde de abajo. Vale 0 donde no hay muesca.
               Mismo criterio que la barra inferior del nav (§13.2). */
            paddingBottom: "calc(14px + env(safe-area-inset-bottom))",
            boxShadow: "6px 0 28px -12px rgba(40,30,60,.45)",
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexShrink: 0 }}>
              <span style={{ fontFamily: FONT.round, fontWeight: 800, fontSize: 15 }}>Tus conversaciones</span>
              <button onClick={onCerrar} aria-label="Cerrar el historial"
                style={{ ...btnIcono, width: 36, height: 36, border: `1.5px solid ${C.border}` }}>
                <IconX size={16} />
              </button>
            </div>
            <Lista {...props} onAbrir={(id) => { props.onAbrir(id); onCerrar(); }}
              onNueva={() => { props.onNueva(); onCerrar(); }} />
          </aside>
        </div>,
        document.body,
      )
    : null;

  return (
    <>
      {/* La columna. La hoja la esconde abajo de 1024.
          ⚠️ `display` y `flexDirection` NO van acá en línea, y no es un capricho:
          un estilo en línea le gana a la hoja, así que con `display: "flex"` acá
          el `display: none` del media query no lo tocaba y la columna se comía
          268 de los 375px del teléfono. Es la trampa que `panel.tsx:540` ya tenía
          anotada. Se resuelve moviendo la propiedad al CSS, no con `!important`. */}
      <aside className="hc-col" aria-label="Tus conversaciones"
        style={{
          width: ANCHO_HISTORIAL, flexShrink: 0, borderRight: `1px solid ${C.border}`,
          background: C.panel2, padding: "14px 12px", minHeight: 0,
        }}>
        <Lista {...props} />
      </aside>
      {cajon}
    </>
  );
}

/**
 * ⚠️ NADA DE BACKTICKS ACÁ ADENTRO. Este bloque es un template literal: un
 * backtick lo CIERRA y el error ("Expected a semicolon") aparece en una línea
 * cualquiera del CSS, no donde está el problema. Ya pasó dos veces con NAV_CSS
 * (§13.6). Si hay que nombrar una propiedad, va sin comillas.
 */
export const HISTORIAL_CSS = `
.hc-col { display: flex; flex-direction: column; }
.hc-fila:hover { background: rgba(43,68,255,.06); }
.hc-acciones { opacity: 0; transition: opacity .12s; }
.hc-fila:hover .hc-acciones, .hc-fila:focus-within .hc-acciones { opacity: 1; }
/* En pantalla táctil no hay hover: si las acciones dependieran de él, en el
   teléfono no habría forma de renombrar ni de borrar. */
@media (hover: none) { .hc-acciones { opacity: 1; } }
.hc-abrir { display: inline-flex; }
@media (min-width: ${CORTE_HISTORIAL}px) {
  .hc-abrir { display: none; }
}
@media (max-width: ${CORTE_HISTORIAL - 1}px) {
  .hc-col { display: none; }
}
`;
