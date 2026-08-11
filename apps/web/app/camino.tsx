"use client";
import { C, FONT, HARD, Dots, IconCheck, IconSpark, IconStar, IconLock, subjectLabel } from "./ui";
import type { PlanItem, QuizQ, QuizResult, Subject } from "./tipos";

/**
 * ¿Le fue bien en la lección? DOS TERCIOS, no "0.67": `ceil(3 * 0.67)` da 3, o
 * sea que con 2 de 3 —que es lo que se quiso pedir— el nodo salía ámbar. El
 * redondeo de un decimal escrito a mano se comió la regla entera.
 */
export function aprobado(score: number, total: number): boolean {
  return total > 0 && score >= Math.ceil((total * 2) / 3);
}

/**
 * EL CAMINO — la pantalla de la materia.
 *
 * Una lección por fila, unidas por un riel vertical: el alumno ve de un vistazo
 * dónde está, qué hizo y qué falta. Cada nodo abre sus 3 puntos clave y 3
 * preguntas de chequeo.
 *
 * DECISIONES QUE SE VEN ACÁ (y por qué):
 *  · NO TRABA. Todos los nodos son clickeables aunque no hayas hecho el
 *    anterior. Duolingo traba porque su objetivo es el hábito; acá el alumno
 *    llega el jueves con prueba de la lección 9 el viernes, y trabarlo lo deja
 *    afuera justo cuando más lo necesita. El nodo "actual" (el primero sin
 *    hacer) se resalta como sugerencia, no como puerta.
 *  · El EXAMEN sí pide sus lecciones hechas: es lo único que se gana.
 *  · El color del nodo lo decide el ÚLTIMO INTENTO, no el tilde: verde si
 *    acertó 2 de 3, ámbar si respondió pero le fue peor. Así "avance" significa
 *    algo más que un checkbox que el chico se puso solo.
 */
export function CaminoView({
  items, done, scores, subject, loading, quizKey, quiz, quizAns, quizRes, quizLoading, quizErr,
  onAbrir, onResponder, onEnviar, onReintentar, onNoEntiendo, onExamen, onRegen, testLoading,
}: {
  items: PlanItem[]; done: string[]; scores: Record<string, { score: number; total: number }>;
  subject?: Subject; loading: boolean;
  quizKey: string; quiz: QuizQ[] | null; quizAns: Record<number, number>;
  quizRes: QuizResult | null; quizLoading: boolean; quizErr: string;
  onAbrir: (it: PlanItem) => void; onResponder: (n: number, i: number) => void;
  onEnviar: (it: PlanItem) => void; onReintentar: (it: PlanItem) => void;
  onNoEntiendo: (it: PlanItem) => void; onExamen: () => void;
  onRegen: () => void; testLoading: boolean;
}) {
  const area = subject ? subjectLabel(subject) : "";
  const actual = items.find((it) => !done.includes(it.key))?.key ?? "";
  // El examen cae cada 5 lecciones. No es "por unidad" porque varios planes
  // vienen con `unit: null` (el índice del libro no la trae), así que agrupar
  // por unidad dejaría materias enteras sin ningún hito.
  const CADA = 5;
  return (
    <div style={{ padding: "4px 2px 16px" }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
        <div>
          <div style={{ fontFamily: FONT.round, fontWeight: 800, fontSize: 21 }}>Tu camino</div>
          <div style={{ color: C.dim, fontSize: 13.5 }}>{area} · {done.length} de {items.length} lecciones</div>
        </div>
        <button onClick={onRegen} disabled={loading} title="Armar otro plan"
          style={{ display: "inline-flex", alignItems: "center", gap: 6, background: C.panel, color: C.text, border: `1.5px solid ${C.ink}`, borderRadius: 999, padding: "7px 13px", cursor: loading ? "default" : "pointer", fontFamily: FONT.round, fontWeight: 600, fontSize: 13, flexShrink: 0 }}>
          {loading ? <Dots /> : <><IconSpark size={15} /> Rehacer</>}
        </button>
      </div>

      <div>
        {items.map((it, i) => {
          const hecho = done.includes(it.key);
          const sc = scores[it.key];
          const bien = sc ? aprobado(sc.score, sc.total) : false;
          const abierto = quizKey === it.key;
          const ultimo = i === items.length - 1;
          // ¿Toca examen después de esta lección?
          const hayExamen = (i + 1) % CADA === 0 && !ultimo;
          const bloque = items.slice(Math.max(0, i + 1 - CADA), i + 1);
          const bloqueListo = bloque.every((b) => done.includes(b.key));
          return (
            <div key={it.key}>
              <Nodo
                item={it} hecho={hecho} bien={bien} score={sc} actual={it.key === actual}
                abierto={abierto} onAbrir={() => onAbrir(it)}
                quiz={abierto ? quiz : null} quizAns={quizAns} quizRes={abierto ? quizRes : null}
                quizLoading={abierto && quizLoading} quizErr={abierto ? quizErr : ""}
                onResponder={onResponder} onEnviar={() => onEnviar(it)}
                onReintentar={() => onReintentar(it)} onNoEntiendo={() => onNoEntiendo(it)}
                conRiel={!ultimo || hayExamen}
              />
              {hayExamen && (
                <NodoExamen
                  desde={Math.max(1, i + 2 - CADA)} hasta={i + 1}
                  listo={bloqueListo} loading={testLoading} onClick={onExamen}
                />
              )}
            </div>
          );
        })}
      </div>
      <p style={{ textAlign: "center", color: C.dim, fontSize: 12, marginTop: 16, lineHeight: 1.5 }}>
        Podés entrar a cualquier lección, aunque no hayas hecho la anterior.<br />
        Se guarda tu avance.
      </p>
    </div>
  );
}

/** Una lección del camino: nodo en el riel + su tarjeta. */
export function Nodo({
  item, hecho, bien, score, actual, abierto, conRiel,
  quiz, quizAns, quizRes, quizLoading, quizErr,
  onAbrir, onResponder, onEnviar, onReintentar, onNoEntiendo,
}: {
  item: PlanItem; hecho: boolean; bien: boolean; score?: { score: number; total: number };
  actual: boolean; abierto: boolean; conRiel: boolean;
  quiz: QuizQ[] | null; quizAns: Record<number, number>; quizRes: QuizResult | null;
  quizLoading: boolean; quizErr: string;
  onResponder: (n: number, i: number) => void; onAbrir: () => void;
  onEnviar: () => void; onReintentar: () => void; onNoEntiendo: () => void;
}) {
  const fondo = hecho ? (bien ? C.ok : C.warn) : actual ? C.accent : C.panel;
  const tinta = hecho || actual ? "#fff" : C.dim;
  const pages = item.p0 != null ? (item.p1 && item.p1 !== item.p0 ? `pág. ${item.p0}–${item.p1}` : `pág. ${item.p0}`) : "";
  return (
    <div style={{ display: "grid", gridTemplateColumns: "44px 1fr", gap: 10 }}>
      {/* riel */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
        <button onClick={onAbrir} title={item.title}
          style={{ width: 40, height: 40, flexShrink: 0, borderRadius: "50%", border: `2px solid ${C.ink}`, background: fondo, color: tinta, fontFamily: FONT.round, fontWeight: 800, fontSize: 15, cursor: "pointer", display: "grid", placeItems: "center", boxShadow: actual && !abierto ? HARD(C.accent) : "none" }}>
          {hecho ? <IconCheck size={17} /> : item.n}
        </button>
        {conRiel && <div style={{ flex: 1, width: 3, minHeight: 14, background: hecho ? C.ok : C.border, borderRadius: 2, margin: "2px 0" }} />}
      </div>

      {/* tarjeta */}
      <div style={{ paddingBottom: 14, minWidth: 0 }}>
        <button onClick={onAbrir}
          style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", padding: "8px 0 0", cursor: "pointer" }}>
          <span style={{ display: "block", fontFamily: FONT.round, fontWeight: 700, fontSize: 15.5, color: C.text }}>{item.title}</span>
          {item.focus && <span style={{ display: "block", color: C.dim, fontSize: 13, lineHeight: 1.45, marginTop: 2 }}>{item.focus}</span>}
          <span style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 5, flexWrap: "wrap" }}>
            {pages && <span style={{ fontFamily: FONT.mono, fontSize: 11.5, color: C.dim }}>{pages}</span>}
            {score && <span style={{ fontFamily: FONT.round, fontWeight: 700, fontSize: 11, color: bien ? C.okTx : C.warnTx, background: bien ? C.okBg : C.warnBg, borderRadius: 999, padding: "2px 8px" }}>{score.score} de {score.total}</span>}
            {actual && !hecho && <span style={{ fontFamily: FONT.round, fontWeight: 700, fontSize: 10.5, letterSpacing: .3, textTransform: "uppercase", color: "#fff", background: C.accent, borderRadius: 999, padding: "2px 8px" }}>Seguí por acá</span>}
          </span>
        </button>

        {abierto && (
          <div style={{ marginTop: 10, border: `2px solid ${C.ink}`, borderRadius: 12, background: C.panel2, padding: "12px 13px" }}>
            {item.points && item.points.length > 0 && (
              <>
                <div style={{ fontSize: 12, color: C.dim, marginBottom: 6 }}>Cuando termines vas a poder explicar:</div>
                {item.points.map((p, i) => (
                  <div key={i} style={{ display: "flex", gap: 7, alignItems: "flex-start", marginTop: i === 0 ? 0 : 4 }}>
                    <span style={{ width: 5, height: 5, borderRadius: "50%", background: C.accent, flexShrink: 0, marginTop: 6.5 }} />
                    <span style={{ fontSize: 12.5, lineHeight: 1.45, color: C.text }}>{p}</span>
                  </div>
                ))}
              </>
            )}

            <div style={{ height: 1, background: C.border, margin: "11px 0" }} />

            {quizLoading && !quiz && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, color: C.dim, fontSize: 13 }}>
                <Dots /> Armando las preguntas de esta lección…
              </div>
            )}
            {quizErr && <div style={{ color: C.badTx, background: C.badBg, border: `1px solid ${C.bad}`, borderRadius: 8, padding: "8px 10px", fontSize: 12.5 }}>{quizErr}</div>}

            {quiz && quiz.map((q) => {
              const res = quizRes?.items.find((r) => r.n === q.n);
              return (
                <div key={q.n} style={{ marginBottom: 12 }}>
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
                          style={{ textAlign: "left", background: bg, border: `1.5px solid ${bd}`, borderRadius: 9, padding: "8px 10px", fontSize: 13, cursor: quizRes ? "default" : "pointer", color: C.text }}>
                          {o}
                        </button>
                      );
                    })}
                  </div>
                  {res && res.explain && (
                    <div style={{ fontSize: 12, color: C.dim, marginTop: 5, lineHeight: 1.45 }}>{res.explain}</div>
                  )}
                </div>
              );
            })}

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
              {quiz && !quizRes && (
                <button onClick={onEnviar} disabled={Object.keys(quizAns).length < quiz.length || quizLoading}
                  style={{ background: Object.keys(quizAns).length < quiz.length ? C.panel2 : C.accent, color: Object.keys(quizAns).length < quiz.length ? C.dim : "#fff", border: `2px solid ${C.ink}`, borderRadius: 9, padding: "8px 14px", fontFamily: FONT.round, fontWeight: 700, fontSize: 13, cursor: Object.keys(quizAns).length < quiz.length ? "default" : "pointer" }}>
                  {quizLoading ? <Dots /> : "Corregir"}
                </button>
              )}
              {quizRes && (
                <button onClick={onReintentar}
                  style={{ background: C.panel, color: C.text, border: `2px solid ${C.ink}`, borderRadius: 9, padding: "8px 14px", fontFamily: FONT.round, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
                  Volver a intentar
                </button>
              )}
              <button onClick={onNoEntiendo}
                style={{ background: "transparent", color: C.text, border: `2px solid ${C.ink}`, borderRadius: 9, padding: "8px 14px", fontFamily: FONT.round, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
                No entiendo esto
              </button>
            </div>

            {quizRes && (
              <div style={{ marginTop: 10, fontSize: 13, fontWeight: 600, color: aprobado(quizRes.score, quizRes.total) ? C.okTx : C.warnTx }}>
                {quizRes.score} de {quizRes.total}
                {aprobado(quizRes.score, quizRes.total)
                  ? " — lección dominada 🎉"
                  : " — repasala cuando puedas, quedó anotada para reforzar."}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** El examen de un tramo, como un nodo más del camino. */
export function NodoExamen({ desde, hasta, listo, loading, onClick }: { desde: number; hasta: number; listo: boolean; loading: boolean; onClick: () => void }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "44px 1fr", gap: 10 }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div style={{ width: 40, height: 40, borderRadius: 12, border: `2px solid ${C.ink}`, background: listo ? C.accentSoft : C.panel2, color: listo ? "#fff" : C.dim, display: "grid", placeItems: "center" }}>
          {listo ? <IconStar size={18} /> : <IconLock size={16} />}
        </div>
        <div style={{ flex: 1, width: 3, minHeight: 14, background: C.border, borderRadius: 2, margin: "2px 0" }} />
      </div>
      <div style={{ paddingBottom: 14, paddingTop: 8 }}>
        <div style={{ fontFamily: FONT.round, fontWeight: 700, fontSize: 15, color: listo ? C.text : C.dim }}>
          Prueba · lecciones {desde} a {hasta}
        </div>
        <div style={{ color: C.dim, fontSize: 12.5, marginTop: 2 }}>
          {listo ? "Ya podés rendirla." : `Se abre cuando termines las ${hasta - desde + 1} lecciones.`}
        </div>
        {listo && (
          <button onClick={onClick} disabled={loading}
            style={{ marginTop: 8, background: C.accentSoft, color: "#fff", border: `2px solid ${C.ink}`, borderRadius: 9, padding: "8px 14px", fontFamily: FONT.round, fontWeight: 700, fontSize: 13, cursor: loading ? "default" : "pointer" }}>
            {loading ? <Dots /> : "Rendir la prueba"}
          </button>
        )}
      </div>
    </div>
  );
}

// Chip de cita (Aurora) — pastilla mono con esquina doblada
