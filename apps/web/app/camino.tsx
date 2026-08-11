"use client";
import { C, FONT, HARD, Dots, IconCheck, IconSpark, IconStar, IconLock, IconChat, subjectLabel } from "./ui";
import type { PlanItem, QuizQ, QuizResult, Subject } from "./tipos";

/**
 * ¿Le fue bien en la lección? DOS TERCIOS, no "0.67": `ceil(3 * 0.67)` daba 3, o
 * sea que con 2 de 3 —que es lo que se quiso pedir— el nodo salía ámbar. El
 * redondeo de un decimal escrito a mano se comió la regla entera.
 */
export function aprobado(score: number, total: number): boolean {
  return total > 0 && score >= Math.ceil((total * 2) / 3);
}

// ── GEOMETRÍA DEL CAMINO ────────────────────────────────────────────────────
// Antes era una lista vertical: todos los nodos alineados, todas las filas del
// mismo alto. Se leía como una tabla de contenidos, no como un recorrido — y
// "¿por dónde voy?" costaba tanto como en el índice del libro.
//
// Ahora serpentea. La amplitud sale de un seno para que la curva sea pareja sin
// tabular offsets a mano, y el paso vertical es fijo para que el largo del
// camino sea proporcional a lo que falta.
const NODO = 62;      // diámetro del nodo
const PASO = 112;     // distancia vertical entre centros
const AMP = 74;       // cuánto se corre a los costados
const posX = (i: number) => Math.sin(i * 0.85) * AMP;

export function CaminoView({
  items, done, scores, subject, loading, abierta,
  onAbrir, onCerrar, onExamen, onRegen, testLoading, children,
}: {
  items: PlanItem[]; done: string[]; scores: Record<string, { score: number; total: number }>;
  subject?: Subject; loading: boolean; abierta: string;
  onAbrir: (it: PlanItem) => void; onCerrar: () => void;
  onExamen: () => void; onRegen: () => void; testLoading: boolean;
  /** La hoja de la lección abierta. La monta la página, que es dueña del quiz. */
  children?: React.ReactNode;
}) {
  const area = subject ? subjectLabel(subject) : "";
  const actual = items.find((it) => !done.includes(it.key))?.key ?? "";
  // Un examen cada 5 lecciones. Cada 5 y no "por unidad" porque varios planes
  // vienen con `unit: null` — el índice del libro no la trae — y agrupar por
  // unidad dejaría materias enteras sin ningún hito.
  const CADA = 5;

  // Se construye la secuencia de paradas: lecciones + exámenes intercalados, así
  // el examen es una parada del camino y no un cartel al costado.
  type Parada =
    | { tipo: "leccion"; item: PlanItem; i: number }
    | { tipo: "examen"; desde: number; hasta: number; listo: boolean };
  const paradas: Parada[] = [];
  items.forEach((item, i) => {
    paradas.push({ tipo: "leccion", item, i });
    const ultimo = i === items.length - 1;
    if ((i + 1) % CADA === 0 && !ultimo) {
      const bloque = items.slice(Math.max(0, i + 1 - CADA), i + 1);
      paradas.push({
        tipo: "examen",
        desde: Math.max(1, i + 2 - CADA),
        hasta: i + 1,
        listo: bloque.every((b) => done.includes(b.key)),
      });
    }
  });

  const alto = paradas.length * PASO + NODO;
  const centro = (k: number) => ({ x: posX(k), y: k * PASO + NODO / 2 });

  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, marginBottom: 6 }}>
        <div>
          <div style={{ fontFamily: FONT.round, fontWeight: 800, fontSize: 21 }}>Tu camino</div>
          <div style={{ color: C.dim, fontSize: 13.5 }}>{area} · {done.length} de {items.length} lecciones</div>
        </div>
        <button onClick={onRegen} disabled={loading} title="Armar otro plan"
          style={{ display: "inline-flex", alignItems: "center", gap: 6, background: C.panel, color: C.text, border: `1.5px solid ${C.ink}`, borderRadius: 999, padding: "7px 13px", cursor: loading ? "default" : "pointer", fontFamily: FONT.round, fontWeight: 600, fontSize: 13, flexShrink: 0 }}>
          {loading ? <Dots /> : <><IconSpark size={15} /> Rehacer</>}
        </button>
      </div>

      <div style={{ position: "relative", height: alto, width: "100%" }}>
        {/* El sendero, detrás de todo. Se dibuja de una sola pieza: dos tramos
            sueltos entre nodos se ven como escalones, no como un camino. */}
        <svg width={AMP * 2 + 16} height={alto} viewBox={`${-(AMP + 8)} 0 ${AMP * 2 + 16} ${alto}`}
          style={{ position: "absolute", top: 0, left: "50%", transform: "translateX(-50%)", pointerEvents: "none" }} aria-hidden="true">
          <path d={sendero(paradas.length)} fill="none" stroke={C.border} strokeWidth={12} strokeLinecap="round" />
          {/* Lo recorrido, encima y en color: el avance se ve sin contar nodos. */}
          <path d={sendero(hechasSeguidas(paradas, done))} fill="none" stroke={C.ok} strokeWidth={12} strokeLinecap="round" />
        </svg>

        {paradas.map((p, k) => {
          const { x, y } = centro(k);
          // El nodo va sobre la curva; la ETIQUETA al costado contrario. Debajo
          // no entra: con el paso vertical que pide la curva, un título de dos
          // líneas se mete sobre el nodo siguiente y el trazo lo cruza. Al
          // costado usa el ancho que el serpenteo deja libre.
          const alaDerecha = x <= 0;
          const nodoPos: React.CSSProperties = {
            position: "absolute", left: "50%", top: y,
            transform: `translate(calc(-50% + ${x}px), -50%)`,
          };
          // La etiqueta va DEBAJO del nodo y centrada, pero SOLO donde hace
          // falta: el nodo actual, el abierto y los exámenes. Ponerle título a
          // los catorce llenaba la pantalla de texto —al costado quedaban
          // columnas de 100px partidas en tres líneas, y debajo se pisaban
          // entre sí— y encima tapaba lo único que el alumno necesita ver de un
          // golpe: por dónde va. El título completo está en la hoja, a un toque.
          const etiquetaPos: React.CSSProperties = {
            position: "absolute", top: y + NODO / 2 + 7, left: "50%",
            transform: `translateX(calc(-50% + ${x}px))`,
            width: 168, textAlign: "center",
            display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
          };
          if (p.tipo === "examen") {
            return (
              <div key={`ex-${k}`}>
                <div style={etiquetaPos}>
                  <span style={{ fontFamily: FONT.round, fontWeight: 700, fontSize: 12, color: p.listo ? C.text : C.dim, lineHeight: 1.25 }}>
                    Prueba · lecciones {p.desde} a {p.hasta}
                  </span>
                </div>
                <button onClick={() => p.listo && onExamen()} disabled={!p.listo || testLoading}
                  title={p.listo ? `Prueba de las lecciones ${p.desde} a ${p.hasta}` : `Se abre al terminar la ${p.hasta}`}
                  style={{
                    ...nodoPos,
                    transform: `${nodoPos.transform} rotate(45deg)`,
                    width: NODO, height: NODO, borderRadius: 18, border: `3px solid ${C.ink}`,
                    background: p.listo ? C.accentSoft : C.panel2, color: p.listo ? "#fff" : C.dim,
                    display: "grid", placeItems: "center", cursor: p.listo ? "pointer" : "default",
                    boxShadow: p.listo ? HARD(C.ink) : "none",
                  }}>
                  <span style={{ transform: "rotate(-45deg)", display: "grid", placeItems: "center" }}>
                    {p.listo ? <IconStar size={24} /> : <IconLock size={20} />}
                  </span>
                </button>
              </div>
            );
          }
          const hecho = done.includes(p.item.key);
          const sc = scores[p.item.key];
          const bien = sc ? aprobado(sc.score, sc.total) : false;
          const esActual = p.item.key === actual;
          const seleccionado = abierta === p.item.key;
          const fondo = hecho ? (bien ? C.ok : C.warn) : esActual ? C.accent : C.panel;
          const tinta = hecho || esActual ? "#fff" : C.dim;
          return (
            <div key={p.item.key}>
              {/* La chapa va ARRIBA del nodo y el título abajo. Las dos abajo
                  no entran en el paso vertical de la curva: la chapa terminaba
                  metida debajo del nodo siguiente. */}
              {esActual && !hecho && (
                <span style={{ position: "absolute", top: y - NODO / 2 - 20, left: "50%", transform: `translateX(calc(-50% + ${x}px))`, fontFamily: FONT.round, fontWeight: 700, fontSize: 10, letterSpacing: .4, textTransform: "uppercase", color: "#fff", background: C.accent, borderRadius: 999, padding: "2px 9px", whiteSpace: "nowrap" }}>
                  Estás acá
                </span>
              )}
              {(esActual || seleccionado) && (
                <div style={etiquetaPos}>
                  <span style={{ fontFamily: FONT.round, fontWeight: 700, fontSize: 12.5, color: C.text, lineHeight: 1.25 }}>
                    {p.item.title}
                  </span>
                </div>
              )}
              {/* La nota va PEGADA al nodo, no en la etiqueta: es el único dato
                  que tiene que verse en todos los nodos hechos a la vez. */}
              {sc && (
                <span style={{ position: "absolute", top: y + NODO / 2 - 8, left: "50%", transform: `translateX(calc(-50% + ${x + NODO / 2 - 4}px))`, fontFamily: FONT.round, fontWeight: 800, fontSize: 10.5, color: bien ? C.okTx : C.warnTx, background: bien ? C.okBg : C.warnBg, border: `1.5px solid ${bien ? C.ok : C.warn}`, borderRadius: 999, padding: "1px 6px", whiteSpace: "nowrap" }}>
                  {sc.score}/{sc.total}
                </span>
              )}
              <button onClick={() => (seleccionado ? onCerrar() : onAbrir(p.item))} title={p.item.title}
                style={{
                  ...nodoPos,
                  width: NODO, height: NODO, borderRadius: "50%", border: `3px solid ${C.ink}`,
                  background: fondo, color: tinta, fontFamily: FONT.round, fontWeight: 800, fontSize: 21,
                  display: "grid", placeItems: "center", cursor: "pointer",
                  boxShadow: seleccionado || esActual ? HARD(C.ink) : "none",
                  transform: seleccionado ? `${nodoPos.transform} scale(1.06)` : nodoPos.transform,
                  transition: "transform .12s, box-shadow .12s",
                }}>
                {hecho ? <IconCheck size={26} /> : p.i + 1}
              </button>
            </div>
          );
        })}
      </div>

      {children}
    </div>
  );
}

/** Curva que pasa por los centros de las primeras `n` paradas. */
function sendero(n: number): string {
  if (n <= 0) return "";
  const pt = (k: number) => ({ x: Math.sin(k * 0.85) * AMP, y: k * PASO + NODO / 2 });
  let d = "";
  for (let k = 0; k < n; k++) {
    const p = pt(k);
    if (k === 0) { d += `M ${p.x} ${p.y}`; continue; }
    const a = pt(k - 1);
    // Curva suave: los puntos de control a media altura dan la ondulación sin
    // que el trazo se despegue de los nodos.
    d += ` C ${a.x} ${a.y + PASO / 2}, ${p.x} ${p.y - PASO / 2}, ${p.x} ${p.y}`;
  }
  return d;
}

/** Cuántas paradas seguidas van completas desde el arranque. El tramo en color
 *  llega HASTA ahí: pintar lecciones sueltas más adelante daría la idea de que
 *  el camino ya está recorrido cuando no lo está. */
function hechasSeguidas(
  paradas: ({ tipo: "leccion"; item: PlanItem } | { tipo: "examen" })[],
  done: string[],
): number {
  let n = 0;
  for (const p of paradas) {
    if (p.tipo === "examen") { n++; continue; }
    if (!done.includes(p.item.key)) break;
    n++;
  }
  return n;
}

/**
 * LA HOJA DE LA LECCIÓN: puntos clave + las preguntas.
 *
 * Se abre sobre el camino en vez de expandir la fila. Con los nodos ubicados en
 * coordenadas, crecer uno empujaría a todos los de abajo y la curva quedaría
 * partida; y en un teléfono, una lección de 10 preguntas dentro del camino deja
 * al alumno sin saber dónde está parado.
 */
export function HojaLeccion({
  item, quiz, quizAns, quizRes, quizLoading, quizErr,
  onResponder, onEnviar, onReintentar, onRepasar, onCerrar,
}: {
  item: PlanItem;
  quiz: QuizQ[] | null; quizAns: Record<number, number>; quizRes: QuizResult | null;
  quizLoading: boolean; quizErr: string;
  onResponder: (n: number, i: number) => void;
  onEnviar: () => void; onReintentar: () => void;
  /** Manda al chat lo que el alumno falló. `pregunta` vacía = la lección entera. */
  onRepasar: (pregunta?: string) => void;
  onCerrar: () => void;
}) {
  const pages = item.p0 != null ? (item.p1 && item.p1 !== item.p0 ? `págs. ${item.p0}–${item.p1}` : `pág. ${item.p0}`) : "";
  const falladas = quizRes?.items.filter((r) => !r.ok) ?? [];
  const respondidas = quiz ? Object.keys(quizAns).length : 0;

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 40, display: "flex", flexDirection: "column", justifyContent: "flex-end", background: "rgba(25,22,33,.34)" }}
      onClick={onCerrar}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ background: C.panel, borderTop: `2px solid ${C.ink}`, borderRadius: "20px 20px 0 0", maxHeight: "86dvh", overflowY: "auto", padding: "14px 16px 26px", boxShadow: "0 -10px 30px -12px rgba(25,22,33,.35)" }}>
        <div style={{ width: 42, height: 5, borderRadius: 999, background: C.border, margin: "0 auto 12px" }} />

        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: FONT.round, fontWeight: 800, fontSize: 18, lineHeight: 1.25 }}>{item.title}</div>
            {item.focus && <div style={{ color: C.dim, fontSize: 13.5, marginTop: 2, lineHeight: 1.4 }}>{item.focus}</div>}
            {pages && <div style={{ fontFamily: FONT.mono, fontSize: 12, color: C.dim, marginTop: 4 }}>{pages}</div>}
          </div>
          <button onClick={onCerrar} title="Cerrar"
            style={{ flexShrink: 0, width: 34, height: 34, borderRadius: 10, border: `1.5px solid ${C.border}`, background: C.panel, color: C.dim, cursor: "pointer", fontSize: 18, lineHeight: 1 }}>×</button>
        </div>

        {item.points && item.points.length > 0 && (
          <div style={{ marginTop: 12, background: C.panel2, border: `1.5px solid ${C.border}`, borderRadius: 12, padding: "10px 12px" }}>
            <div style={{ fontSize: 12, color: C.dim, marginBottom: 6 }}>Cuando termines vas a poder explicar:</div>
            {item.points.map((p, i) => (
              <div key={i} style={{ display: "flex", gap: 7, alignItems: "flex-start", marginTop: i === 0 ? 0 : 4 }}>
                <span style={{ width: 5, height: 5, borderRadius: "50%", background: C.accent, flexShrink: 0, marginTop: 6.5 }} />
                <span style={{ fontSize: 12.5, lineHeight: 1.45 }}>{p}</span>
              </div>
            ))}
          </div>
        )}

        {quizLoading && !quiz && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: C.dim, fontSize: 13.5, padding: "18px 0" }}>
            <Dots /> Armando las preguntas de esta lección…
          </div>
        )}
        {quizErr && (
          <div style={{ marginTop: 12, color: C.badTx, background: C.badBg, border: `1px solid ${C.bad}`, borderRadius: 10, padding: "9px 11px", fontSize: 12.5 }}>{quizErr}</div>
        )}

        {quiz && (
          <div style={{ marginTop: 14 }}>
            {!quizRes && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ fontFamily: FONT.round, fontWeight: 700, fontSize: 13.5 }}>Ponete a prueba</span>
                <span style={{ fontSize: 12, color: C.dim }}>{respondidas} de {quiz.length}</span>
              </div>
            )}
            {quiz.map((q) => {
              const res = quizRes?.items.find((r) => r.n === q.n);
              return (
                <div key={q.n} style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.4, marginBottom: 6 }}>{q.n}. {q.question}</div>
                  <div style={{ display: "grid", gap: 5 }}>
                    {q.options.map((o, i) => {
                      const elegido = quizAns[q.n] === i;
                      const esCorrecta = res && res.correct === i;
                      const falloAca = res && res.chosen === i && !res.ok;
                      const bg = esCorrecta ? C.okBg : falloAca ? C.badBg : elegido ? C.userBubble : C.panel;
                      const bd = esCorrecta ? C.ok : falloAca ? C.bad : elegido ? C.accentSoft : C.border;
                      return (
                        <button key={i} disabled={!!quizRes} onClick={() => onResponder(q.n, i)}
                          style={{ textAlign: "left", background: bg, border: `1.5px solid ${bd}`, borderRadius: 10, padding: "9px 11px", fontSize: 13, cursor: quizRes ? "default" : "pointer", color: C.text }}>
                          {o}
                        </button>
                      );
                    })}
                  </div>
                  {res && !res.ok && (
                    <div style={{ marginTop: 7, background: C.warnBg, border: `1px solid ${C.warn}`, borderRadius: 10, padding: "9px 11px" }}>
                      {res.explain && <div style={{ fontSize: 12.5, color: C.warnTx, lineHeight: 1.45 }}>{res.explain}</div>}
                      {/* DÓNDE REFORZAR: la página exacta, no "repasá la lección". */}
                      {pages && <div style={{ fontFamily: FONT.mono, fontSize: 11.5, color: C.warnTx, marginTop: 4 }}>Está en {pages}</div>}
                      <button onClick={() => onRepasar(res.question)}
                        style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 8, background: C.panel, color: C.text, border: `1.5px solid ${C.ink}`, borderRadius: 9, padding: "6px 11px", fontFamily: FONT.round, fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}>
                        <IconChat size={14} /> Repasarlo en el chat
                      </button>
                    </div>
                  )}
                  {res && res.ok && res.explain && (
                    <div style={{ fontSize: 12, color: C.dim, marginTop: 5, lineHeight: 1.45 }}>{res.explain}</div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
          {quiz && !quizRes && (
            <button onClick={onEnviar} disabled={respondidas < quiz.length || quizLoading}
              style={{ flex: 1, minWidth: 150, background: respondidas < quiz.length ? C.panel2 : C.accent, color: respondidas < quiz.length ? C.dim : "#fff", border: `2px solid ${C.ink}`, borderRadius: 11, padding: "11px 14px", fontFamily: FONT.round, fontWeight: 800, fontSize: 14.5, cursor: respondidas < quiz.length ? "default" : "pointer" }}>
              {quizLoading ? <Dots /> : respondidas < quiz.length ? `Faltan ${quiz.length - respondidas}` : "Corregir"}
            </button>
          )}
          {quizRes && (
            <button onClick={onReintentar}
              style={{ background: C.panel, color: C.text, border: `2px solid ${C.ink}`, borderRadius: 11, padding: "11px 14px", fontFamily: FONT.round, fontWeight: 700, fontSize: 13.5, cursor: "pointer" }}>
              Volver a intentar
            </button>
          )}
          <button onClick={() => onRepasar()}
            style={{ background: "transparent", color: C.text, border: `2px solid ${C.ink}`, borderRadius: 11, padding: "11px 14px", fontFamily: FONT.round, fontWeight: 700, fontSize: 13.5, cursor: "pointer" }}>
            No entiendo esto
          </button>
        </div>

        {quizRes && (
          <div style={{ marginTop: 12, padding: "11px 13px", borderRadius: 12, border: `2px solid ${C.ink}`, background: aprobado(quizRes.score, quizRes.total) ? C.okBg : C.warnBg }}>
            <div style={{ fontFamily: FONT.round, fontWeight: 800, fontSize: 15, color: aprobado(quizRes.score, quizRes.total) ? C.okTx : C.warnTx }}>
              {quizRes.score} de {quizRes.total}
              {aprobado(quizRes.score, quizRes.total) ? " — lección dominada 🎉" : ""}
            </div>
            {falladas.length > 0 && (
              <div style={{ fontSize: 12.5, color: C.warnTx, marginTop: 4, lineHeight: 1.45 }}>
                Quedaron {falladas.length} para reforzar{pages ? `, en ${pages}` : ""}. Podés repasarlas
                una por una arriba, o pedirle al tutor la lección entera.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
