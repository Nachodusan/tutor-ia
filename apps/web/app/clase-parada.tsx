"use client";
/**
 * LA CLASE DE UNA PARADA — lo que el alumno lee ANTES de las preguntas.
 *
 * Hasta acá, tocar una parada del camino abría diez preguntas de opción múltiple
 * sobre unas páginas que nadie le había explicado. Esto es la clase: la apertura,
 * uno a cuatro momentos, y una consigna final para que lo diga con sus palabras.
 *
 * ── LAS TRES VOCES, Y POR QUÉ SE VEN DISTINTO ───────────────────────────────
 *
 * Todo lo que se lee acá pertenece a una de tres voces, y la pantalla las separa
 * a simple vista porque el alumno tiene derecho a saber qué lo respalda:
 *
 *   EN TU LIBRO   fondo crema, filete cobalto, PÁGINA a la derecha.
 *                 Texto literal del corpus. No lo escribió el modelo: lo pegó el
 *                 sistema a partir de los índices de oración que eligió.
 *   la glosa      texto corriente. Prosa del tutor, pasada por el gate de NLI.
 *   UN EJEMPLO MÍO  borde PUNTEADO, gris, SIN página, y lo dice en el rótulo.
 *                 No se verifica contra el libro porque no está en el libro.
 *
 * Esa última es la importante. El sello de hoy ("está en tu libro") certifica
 * PROCEDENCIA —hubo material— y no contenido; darle ese sello a una analogía
 * inventada sería mentir con la interfaz. Acá va sin sello, a propósito.
 *
 * El bloque del libro del profesor ("Acá se equivoca casi todo el mundo") lleva
 * su procedencia escrita: no es una opinión del tutor, es el error que el autor
 * de la guía docente predijo para esta lección.
 */
import { useState } from "react";
import { C, FONT, HARD, IconArrow, IconChat } from "./ui";
import type { Clase } from "./tipos";

/** Rótulo chico de un recuadro, con su procedencia a la derecha. */
function Rotulo({ txt, der, color }: { txt: string; der?: string; color: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 5 }}>
      <span style={{ fontFamily: FONT.round, fontWeight: 800, fontSize: 10.5, letterSpacing: .7, textTransform: "uppercase", color }}>{txt}</span>
      {der && <span style={{ fontFamily: FONT.mono, fontSize: 10.5, color, opacity: .8, flexShrink: 0 }}>{der}</span>}
    </div>
  );
}

export function ClaseParada({
  clase, onTerminar, onPreguntar,
}: {
  clase: Clase;
  /** La clase terminó: la pantalla pasa a las preguntas. */
  onTerminar: () => void;
  /** "No entiendo": se va al chat con el tema cargado. */
  onPreguntar: () => void;
}) {
  /** -1 = apertura · 0..n-1 = momentos · n = decilo vos. */
  const [fase, setFase] = useState(-1);
  const [apertura, setApertura] = useState("");
  const [dicho, setDicho] = useState("");
  /** Chequeo del momento actual: qué eligió y si ya lo mostró. */
  const [eleccion, setEleccion] = useState<number | null>(null);
  const total = clase.momentos.length;

  function avanzar() {
    setEleccion(null);
    if (fase >= total - 1) setFase(total);
    else setFase((f) => f + 1);
  }

  // ── APERTURA ──────────────────────────────────────────────────────────────
  // No se corrige, y se dice. Un adulto que volvió a estudiar después de años no
  // puede fracasar en el primer turno de la primera pantalla: si la apertura
  // tuviera respuesta correcta, la parada empezaría midiéndolo.
  if (fase === -1) {
    return (
      <div style={{ marginTop: 18 }}>
        <div style={{ fontSize: 13, color: C.dim, marginBottom: 8 }}>Antes de que te explique nada, una pregunta que no tiene nota:</div>
        <div style={{ fontSize: 16.5, fontWeight: 600, lineHeight: 1.4 }}>{clase.apertura}</div>
        <textarea
          value={apertura} onChange={(e) => setApertura(e.target.value)}
          placeholder="escribí lo que se te ocurra…" rows={3}
          style={{ width: "100%", marginTop: 12, background: C.panel, color: C.text, border: `2px solid ${C.border}`, borderRadius: 12, padding: "11px 12px", fontSize: 14.5, fontFamily: FONT.sans, lineHeight: 1.45, resize: "vertical" }}
        />
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button onClick={avanzar}
            style={{ flex: 1, background: C.accent, color: "#fff", border: `2px solid ${C.ink}`, borderRadius: 12, padding: "12px 16px", fontFamily: FONT.round, fontWeight: 800, fontSize: 15, cursor: "pointer" }}>
            {apertura.trim() ? "Contestar" : "No se me ocurre"}
          </button>
        </div>
        <div style={{ fontSize: 12, color: C.dim, marginTop: 9, lineHeight: 1.45 }}>
          Esta no se corrige. Es para que arranques pensando, no para medirte.
        </div>
      </div>
    );
  }

  // ── DECILO VOS ────────────────────────────────────────────────────────────
  // El único lugar donde el alumno produce lenguaje y alguien lo escucha. NO
  // puntúa y no entra en el resultado de la parada: si puntuara, un adulto que
  // escribe poco o con faltas quedaría castigado por la redacción y no por lo
  // que entendió.
  if (fase >= total) {
    return (
      <div style={{ marginTop: 18 }}>
        <div style={{ fontSize: 13, color: C.dim, marginBottom: 8 }}>Antes de las preguntas, una sola cosa:</div>
        <div style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.4 }}>{clase.cierre}</div>
        <textarea
          value={dicho} onChange={(e) => setDicho(e.target.value)}
          placeholder="con tus palabras, tres renglones alcanzan…" rows={3}
          style={{ width: "100%", marginTop: 12, background: C.panel, color: C.text, border: `2px solid ${C.border}`, borderRadius: 12, padding: "11px 12px", fontSize: 14.5, fontFamily: FONT.sans, lineHeight: 1.45, resize: "vertical" }}
        />
        <button onClick={onTerminar}
          style={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 10, background: C.ok, color: "#fff", border: `2px solid ${C.ink}`, borderRadius: 14, boxShadow: HARD(C.ink), padding: "14px 15px", cursor: "pointer" }}>
          <span style={{ fontFamily: FONT.round, fontWeight: 800, fontSize: 15 }}>Ahora sí, las preguntas</span>
          <IconArrow size={20} />
        </button>
        <div style={{ fontSize: 12, color: C.dim, marginTop: 9, lineHeight: 1.45 }}>
          Esto no se corrige ni cuenta para tu nota.
        </div>
      </div>
    );
  }

  // ── UN MOMENTO ────────────────────────────────────────────────────────────
  const m = clase.momentos[fase]!;
  const acerto = eleccion != null && eleccion === m.chequeo.correcta;

  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 7 }}>
        <span style={{ fontFamily: FONT.round, fontWeight: 700, fontSize: 13 }}>{m.titulo}</span>
        <span style={{ fontSize: 12, color: C.dim }}>Momento {fase + 1} de {total}</span>
      </div>
      <div style={{ display: "flex", gap: 3, marginBottom: 16 }}>
        {clase.momentos.map((_, i) => (
          <span key={i} style={{ flex: 1, height: 6, borderRadius: 3, background: i === fase ? C.accent : i < fase ? C.accentSoft : C.panel2, border: `1px solid ${i <= fase ? "transparent" : C.border}` }} />
        ))}
      </div>

      {m.entrada && <div style={{ fontSize: 14.5, lineHeight: 1.6, marginBottom: 12 }}>{m.entrada}</div>}

      {/* EN TU LIBRO — literal, con página. Es lo único de la pantalla que un
          escéptico puede señalar con el dedo. */}
      <div style={{ background: C.panel2, borderLeft: `4px solid ${C.accent}`, border: `1.5px solid ${C.border}`, borderRadius: 10, padding: "11px 13px" }}>
        <Rotulo txt="En tu libro" der={m.pagina != null ? `pág. ${m.pagina}` : undefined} color={C.accent} />
        <div style={{ fontSize: 14.5, lineHeight: 1.55, fontStyle: "italic" }}>“{m.texto}”</div>
      </div>

      <div style={{ fontSize: 13, color: C.dim, margin: "14px 0 5px" }}>Qué está diciendo, en criollo:</div>
      <div style={{ fontSize: 15, lineHeight: 1.62 }}>{m.glosa}</div>

      {m.palabras.length > 0 && (
        <div style={{ marginTop: 13, background: C.userBubble, borderLeft: `4px solid ${C.accentSoft}`, borderRadius: 10, padding: "10px 13px" }}>
          <Rotulo txt="Las palabras difíciles" color={C.accentSoft} />
          {m.palabras.map((p, i) => (
            <div key={i} style={{ fontSize: 13.5, lineHeight: 1.5, marginTop: i === 0 ? 0 : 4 }}>
              <b>{p.palabra}</b> <span style={{ color: C.dim }}>— {p.enCriollo}</span>
            </div>
          ))}
        </div>
      )}

      {/* SIN SELLO. Borde punteado, gris, sin página, y el rótulo lo declara:
          esto no está en el libro y no lo verificó nadie contra el libro. */}
      {m.ejemplo && (
        <div style={{ marginTop: 11, background: C.panel, border: `1.5px dashed ${C.dim}`, borderRadius: 10, padding: "10px 13px" }}>
          <Rotulo txt="Un ejemplo mío" der="no está en el libro" color={C.dim} />
          <div style={{ fontSize: 13.5, lineHeight: 1.55 }}>{m.ejemplo}</div>
        </div>
      )}

      {/* El libro del profesor, con su procedencia escrita. Solo en el último
          momento: es el cierre conceptual de la parada, no una nota al pie que
          conviene repetir en cada pantalla. */}
      {clase.errorFrecuente && fase === total - 1 && (
        <div style={{ marginTop: 11, background: C.warnBg, borderLeft: `4px solid ${C.warn}`, borderRadius: 10, padding: "10px 13px" }}>
          <Rotulo txt="Acá se equivoca casi todo el mundo" der="libro del profesor" color={C.warnTx} />
          <div style={{ fontSize: 13.5, lineHeight: 1.55, color: C.warnTx }}>{clase.errorFrecuente}</div>
        </div>
      )}

      {/* CHEQUEO DEL MOMENTO. Se corrige en el acto, mientras todavía se puede
          volver treinta segundos atrás — que es lo que no permite un quiz al
          final de todo. */}
      <div style={{ marginTop: 17, fontSize: 15, fontWeight: 600, lineHeight: 1.4 }}>{m.chequeo.pregunta}</div>
      <div style={{ display: "grid", gap: 7, marginTop: 10 }}>
        {m.chequeo.opciones.map((o, i) => {
          const sel = eleccion === i;
          const esLaBuena = eleccion != null && i === m.chequeo.correcta;
          const borde = esLaBuena ? C.ok : sel ? C.bad : C.border;
          const fondo = esLaBuena ? C.okBg : sel ? C.badBg : C.panel;
          return (
            <button key={i} onClick={() => eleccion == null && setEleccion(i)}
              style={{ textAlign: "left", background: fondo, border: `2px solid ${borde}`, borderRadius: 12, padding: "12px 13px", fontSize: 14, lineHeight: 1.35, cursor: eleccion == null ? "pointer" : "default", color: C.text }}>
              {o}
            </button>
          );
        })}
      </div>

      {eleccion != null && (
        <div style={{ marginTop: 10, fontSize: 13.5, color: acerto ? C.okTx : C.warnTx, lineHeight: 1.5 }}>
          {acerto ? "Eso es. Seguimos." : "No era esa — mirá cuál quedó en verde y volvé a leer el recuadro de arriba."}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        {fase > 0 && (
          <button onClick={() => { setEleccion(null); setFase((f) => f - 1); }}
            style={{ background: C.panel, color: C.text, border: `2px solid ${C.ink}`, borderRadius: 12, padding: "12px 15px", fontFamily: FONT.round, fontWeight: 700, fontSize: 14, cursor: "pointer" }}>
            Atrás
          </button>
        )}
        <button onClick={avanzar} disabled={eleccion == null}
          style={{ flex: 1, background: eleccion == null ? C.panel2 : C.accent, color: eleccion == null ? C.dim : "#fff", border: `2px solid ${C.ink}`, borderRadius: 12, padding: "12px 16px", fontFamily: FONT.round, fontWeight: 800, fontSize: 15, cursor: eleccion == null ? "default" : "pointer" }}>
          {eleccion == null ? "Elegí una para seguir" : fase >= total - 1 ? "Terminar la clase" : "Lo entendí, seguí"}
        </button>
      </div>

      <button onClick={onPreguntar}
        style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 14, background: "transparent", color: C.text, border: `2px solid ${C.ink}`, borderRadius: 11, padding: "9px 13px", fontFamily: FONT.round, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
        <IconChat size={15} /> Explicámelo de otra manera
      </button>
    </div>
  );
}
