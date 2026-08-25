"use client";
import { useEffect, useRef, useState } from "react";
import { C, FONT, SOFT, AURORA, Dots, IconVolume, IconCheck, IconAlert, IconChevron, IconBook } from "./ui";
import type { AnswerMode, AnswerScope, Citation, Msg, Verification, CallState } from "./tipos";

/**
 * EL MODO CONVERSACIÓN NO TAPA NADA.
 *
 * Antes era una pantalla completa con un orbe grande en el medio. Se veía muy
 * bien y escondía lo único que importa: EL TEXTO. El chico habla, el tutor
 * transcribe lo que dijo y contesta por escrito mientras lo lee en voz alta —
 * y todo eso estaba pasando DEBAJO de una pantalla que no dejaba verlo. En una
 * app para estudiar, la respuesta escrita no es el detrás de escena: es el
 * material que después se relee.
 *
 * Así que el modo voz ahora es esto: LUCES ABAJO. La conversación sigue en
 * pantalla, entera y desplazándose sola, y el estado de la llamada vive en la
 * misma barra donde antes se escribía.
 *
 * Las barras se mueven con el sonido REAL (`levelRef`, que alimentan el
 * micrófono al escuchar y el analizador del audio al hablar). Una animación
 * decorativa que se mueve igual con silencio y con voz no dice nada: acá el
 * movimiento ES la señal de que te está escuchando.
 */
const BARRAS = 5;
/** Alto relativo de cada barra: el centro reacciona más que los extremos. */
const PESO = [0.55, 0.85, 1, 0.85, 0.55];

export function VozLuces({ levelRef, state }: { levelRef: React.RefObject<number>; state: CallState }) {
  const barras = useRef<(HTMLSpanElement | null)[]>([]);
  const halo = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const loop = () => {
      const t = performance.now() - t0;
      // Pensando: no hay audio que seguir (no entra ni sale sonido), así que la
      // onda la pone el reloj. Es el único estado con movimiento inventado, y
      // se nota distinto a propósito: más lento y más parejo.
      const pensando = state === "thinking";
      const lvl = pensando ? 0.28 + 0.22 * Math.sin(t / 280) : (levelRef.current ?? 0);
      for (let i = 0; i < BARRAS; i++) {
        const el = barras.current[i];
        if (!el) continue;
        const fase = Math.sin(t / (pensando ? 320 : 170) + i * 0.9) * 0.5 + 0.5;
        const alto = 5 + lvl * 26 * PESO[i]! * (0.55 + 0.45 * fase);
        el.style.height = `${alto.toFixed(1)}px`;
      }
      if (halo.current) {
        halo.current.style.opacity = `${(0.22 + lvl * 0.7).toFixed(2)}`;
        halo.current.style.transform = `scaleY(${(0.8 + lvl * 0.6).toFixed(2)})`;
      }
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [state, levelRef]);

  return (
    <span style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 4, height: 32, flexShrink: 0 }}>
      {/* El resplandor detrás de las barras: es lo que se ve de reojo cuando se
          está leyendo la respuesta y no mirando la barra. */}
      <span ref={halo} aria-hidden style={{
        position: "absolute", left: -14, right: -14, top: 2, bottom: 2, borderRadius: 999,
        background: AURORA, filter: "blur(11px)", transformOrigin: "center", pointerEvents: "none",
      }} />
      {Array.from({ length: BARRAS }, (_, i) => (
        <span key={i} ref={(el) => { barras.current[i] = el; }}
          style={{ position: "relative", width: 4, height: 6, borderRadius: 999, background: i % 2 ? C.accentSoft : C.peach, willChange: "height" }} />
      ))}
    </span>
  );
}

/** Rótulo del estado de la llamada. */
export function estadoVoz(state: CallState): string {
  return state === "listening" ? "Escuchando…" : state === "thinking" ? "Pensando…" : "Hablando…";
}
export function CiteChip({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 6, background: C.panel2, border: `1px solid ${C.border}`, borderRadius: 10, padding: "5px 11px", fontFamily: FONT.mono, fontSize: 12.5, color: C.dim, overflow: "hidden" }}>
      {children}
      <span style={{ position: "absolute", top: 0, right: 0, width: 0, height: 0, borderStyle: "solid", borderWidth: "0 9px 9px 0", borderColor: `transparent ${C.bg} transparent transparent` }} />
    </span>
  );
}

// Burbuja de mensaje (mundo Aurora)

export function Bubble({ m, onSpeak }: { m: Msg; onSpeak?: () => void }) {
  const [refsOpen, setRefsOpen] = useState(false);
  if (m.role === "user")
    return <div style={{ alignSelf: "flex-end", maxWidth: "82%", background: C.userBubble, color: "#2B2740", borderRadius: "18px 18px 6px 18px", padding: "11px 15px", fontSize: 15, lineHeight: 1.5 }}>{m.content}</div>;
  return (
    <div style={{ alignSelf: "flex-start", maxWidth: "94%" }}>
      {m.streaming && !m.content ? <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: "18px 18px 18px 6px", padding: "12px 16px", boxShadow: SOFT, color: C.dim, fontSize: 15, display: "inline-block" }}><Dots /></div>
        : (
          <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: "18px 18px 18px 6px", padding: "13px 16px", boxShadow: SOFT, display: "flex", gap: 8, alignItems: "flex-start" }}>
            <div style={{ whiteSpace: "pre-wrap", fontSize: 16, lineHeight: 1.6, flex: 1 }}>{m.content}</div>
            {m.content && !m.streaming && onSpeak && <button onClick={onSpeak} title="Leer en voz alta" style={{ background: "none", border: "none", color: C.accentSoft, cursor: "pointer", flexShrink: 0, padding: 2, display: "flex" }}><IconVolume size={16} /></button>}
          </div>
        )}
      <VerificationBadge v={m.verification} mode={m.mode} scope={m.scope} citations={m.citations} temaLocal={m.temaLocal} />
      {m.citations && m.citations.length > 0 && (() => {
        const seen = new Set<string>();
        // Dedupe por ROTULO: con material de varios cursos, dos "pág. 12" de
        // libros distintos son fuentes distintas y no se pueden colapsar.
        const refs = m.citations.filter((c) => { const k = c.label ?? `${c.page}·${c.source ?? ""}`; if (seen.has(k)) return false; seen.add(k); return true; });
        return (
          <div style={{ marginTop: 11 }}>
            <button onClick={() => setRefsOpen((o) => !o)} title={refsOpen ? "Ocultar fuentes" : "Ver de dónde salió esto"}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, background: refsOpen ? "rgba(108,92,231,.10)" : C.panel2, border: `1px solid ${refsOpen ? C.accentSoft : C.border}`, borderRadius: 999, padding: "5px 12px", cursor: "pointer", fontFamily: FONT.round, fontWeight: 700, fontSize: 11, letterSpacing: 0.4, textTransform: "uppercase", color: refsOpen ? C.accentSoft : C.dim, transition: "border-color .15s, background .15s" }}
              onMouseEnter={(e) => { if (!refsOpen) e.currentTarget.style.borderColor = C.accentSoft; }} onMouseLeave={(e) => { if (!refsOpen) e.currentTarget.style.borderColor = C.border; }}>
              <span style={{ display: "flex", transform: refsOpen ? "rotate(90deg)" : "none", transition: "transform .18s" }}><IconChevron size={13} /></span>
              Fuentes en tu material ({refs.length})
            </button>
            {refsOpen && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginTop: 9 }}>
                {refs.map((c) => <CiteChip key={c.index}>{c.label || (c.page != null ? `pág. ${c.page}` : `#${c.index}`)}{c.source === "pedagogy" ? " · guía" : ""}</CiteChip>)}
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}

export function Note({ children, tone }: { children: React.ReactNode; tone: "warn" | "bad" }) {
  const t = tone === "bad" ? { c: C.badTx, bg: C.badBg } : { c: C.warnTx, bg: C.warnBg };
  return <div style={{ marginTop: 8, padding: "9px 12px", borderRadius: 12, background: t.bg, color: t.c, fontSize: 13, display: "flex", gap: 7, alignItems: "flex-start", lineHeight: 1.5 }}>{children}</div>;
}

/**
 * De dónde salió la respuesta. Tres estados, no uno.
 *
 * Antes esto arrancaba con `if (!v || grounded === false) return null` — o sea,
 * cuando NO había material no se mostraba nada. Tenía sentido mientras esa rama
 * devolvía una negativa fija (no había respuesta que sellar). Ahora que el tutor
 * responde igual, ese es justamente el caso que MÁS necesita marcador: es la
 * única señal de que lo que el chico está leyendo no salió de su libro.
 */
export function VerificationBadge({ v, mode, scope, citations, temaLocal }: { v?: Verification | null; mode?: AnswerMode; scope?: AnswerScope; citations?: Citation[]; temaLocal?: string | null }) {
  // "De tu libro" cuando el material salió de OTRA MATERIA es engañoso, aunque
  // la cita nombre el libro correcto: el alumno está en Lengua y el sello, ahí,
  // se lee como "está en tu libro de Lengua". Medido sobre el golden: 12 de 24
  // preguntas que ningún libro de Lengua cubre traían material legítimo de
  // Ciencias Naturales o Biología y se mostraban con el sello verde.
  if (mode === "libro" && (scope === "otra_materia" || scope === "otro_curso" || scope === "area")) {
    const libro = citations?.[0]?.label?.split(" · ").slice(0, 2).join(" · ");
    return (
      <div style={{ marginTop: 9, display: "inline-flex", gap: 7, alignItems: "flex-start", background: C.panel2, color: C.dim, border: `1px solid ${C.border}`, fontSize: 12.5, padding: "8px 12px", borderRadius: 12, lineHeight: 1.5, maxWidth: 480 }}>
        <span style={{ display: "flex", flexShrink: 0, marginTop: 1 }}><IconBook size={14} /></span>
        <span>Esto no está en el libro de esta materia. Lo saqué de <strong style={{ color: C.text }}>{libro || "otro libro tuyo"}</strong>.</span>
      </div>
    );
  }
  /**
   * GENERAL SOBRE CONTENIDO LOCAL: la advertencia fuerte. Es el único caso sin
   * red — la NLI verifica contra el material citable y acá no hay citable, así
   * que el sello no puede medir si los particulares chilenos son ciertos. El
   * eje local es SEPARADO del modo (sale del currículum, antes de generar); lo
   * que ve el alumno combina los dos.
   */
  if (mode === "general" && temaLocal) {
    return (
      <div style={{ marginTop: 9, display: "inline-flex", gap: 7, alignItems: "flex-start", background: C.badBg, color: C.badTx, fontSize: 12.5, padding: "8px 12px", borderRadius: 12, lineHeight: 1.5, maxWidth: 480 }}>
        <span style={{ display: "flex", flexShrink: 0, marginTop: 1 }}><IconAlert size={14} /></span>
        <span>Esto <strong>no está en tu libro</strong> y es un tema de Chile: los nombres, lugares y datos concretos <strong>verificalos en tu material o con tu profe</strong> antes de usarlos.</span>
      </div>
    );
  }
  // Sin material: el aviso va sí o sí, aunque no haya nada que verificar.
  if (mode === "general") {
    return (
      <div style={{ marginTop: 9, display: "inline-flex", gap: 7, alignItems: "flex-start", background: C.warnBg, color: C.warnTx, fontSize: 12.5, padding: "8px 12px", borderRadius: 12, lineHeight: 1.5, maxWidth: 460 }}>
        <span style={{ display: "flex", flexShrink: 0, marginTop: 1 }}><IconAlert size={14} /></span>
        {/* Antes cerraba con "así que conviene que lo chequees con tu profe", y
            eso salía en TODA respuesta fuera del libro. Un tutor que termina
            cada explicación mandándote a preguntarle a otro se vuelve inútil:
            el sello sirve para que el alumno sepa QUÉ está respaldado por su
            material, no para desautorizar lo que acaba de leer. */}
        <span>Esto <strong>no está en tu libro</strong>: te lo expliqué con lo que sé.</span>
      </div>
    );
  }
  // MATERIAL PARCIAL: el libro toca el tema pero no responde la pregunta. El
  // sello va aunque no haya verificación que mostrar — es justamente el caso en
  // que el chico necesita saber qué parte puede dar por respaldada. Se distingue
  // de la DERIVA porque esa trae contradicciones; ésta no trae ninguna.
  if (mode === "apoyado" && !(v?.contradicted?.length)) {
    return (
      <div style={{ marginTop: 9, display: "inline-flex", gap: 7, alignItems: "flex-start", background: C.panel2, color: C.dim, border: `1px solid ${C.border}`, fontSize: 12.5, padding: "8px 12px", borderRadius: 12, lineHeight: 1.5, maxWidth: 480 }}>
        <span style={{ display: "flex", flexShrink: 0, marginTop: 1 }}><IconBook size={14} /></span>
        <span>Tu material toca este tema pero <strong style={{ color: C.text }}>no responde del todo</strong> lo que preguntaste. Lo que falta lo completé con lo que sé.</span>
      </div>
    );
  }
  if (!v) return null;
  if (v.unavailable) return <div style={{ marginTop: 8, color: C.dim, fontSize: 12.5 }}>No pude verificar esta respuesta contra tu material.</div>;
  // Deriva: el material habla de otra cosa. Es la única alerta del verificador
  // que está calibrada contra datos, y por eso es la única que se muestra.
  if (mode === "apoyado" || v.grounded === false) {
    return (
      <div style={{ display: "grid", gap: 8, marginTop: 8, fontSize: 13 }}>
        {v.contradicted?.length > 0 && <Note tone="bad"><IconAlert size={15} /><span>Tu material dice lo <strong>contrario</strong> de esto:<ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>{v.contradicted.map((s, i) => <li key={i}>{s}</li>)}</ul></span></Note>}
      </div>
    );
  }
  return (v.checked ?? 0) > 0 ? (
    <div style={{ marginTop: 9, display: "inline-flex", gap: 6, alignItems: "center", background: C.okBg, color: C.okTx, fontFamily: FONT.round, fontWeight: 700, fontSize: 12, padding: "6px 11px", borderRadius: 12 }}>
      <IconCheck size={14} /> De tu libro
    </div>
  ) : null;
}
