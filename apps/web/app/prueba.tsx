"use client";
import { C, FONT, HARD, Dots, IconCheck, IconX, IconPrueba, IconArrow, subjectLabel, scoreTone, AuroraDot, BigBtn, IconBack, IconSpark } from "./ui";
import { aprobado } from "./nota";
import type { Subject, TestItem } from "./tipos";

const stripOptLetter = (o: string) => o.replace(/^\s*[A-Da-d1-4]\s*[)\.\-:]\s+/, "").trim();

export function TestView({ items, loading, answers, textos, corrigiendo, submitted, subject, error, onAnswer, onTexto, onSubmit, onRetake, onStudy, onClose }: { items: TestItem[] | null; loading: boolean; answers: Record<number, number>; textos: Record<number, string>; corrigiendo: boolean; submitted: boolean; subject?: Subject; error?: string | null; onAnswer: (n: number, i: number) => void; onTexto: (n: number, t: string) => void; onSubmit: () => void; onRetake: () => void; onStudy: (it: TestItem) => void; onClose: () => void }) {
  const area = subject ? subjectLabel(subject) : "";
  if (loading || items === null) {
    return (
      <div style={{ textAlign: "center", padding: "58px 8px", color: C.dim }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}><AuroraDot size={56} /></div>
        <div style={{ fontFamily: FONT.round, fontWeight: 800, fontSize: 18, color: C.text }}>Armando tu prueba…</div>
        <div style={{ marginTop: 6, fontSize: 13.5 }}>Leo tu material y preparo las preguntas.</div>
        <div style={{ marginTop: 16, display: "flex", justifyContent: "center" }}><Dots /></div>
      </div>
    );
  }
  if (items.length === 0) {
    // El MOTIVO del servidor, cuando lo hay: "no encontré esos puntos" se
    // arregla volviendo a elegir y "probá de nuevo en un momento" se arregla
    // reintentando. El cartel único de antes no distinguía, así que el alumno
    // tenía que adivinar cuál de las dos cosas le pasó.
    return (
      <div style={{ textAlign: "center", padding: "50px 8px", color: C.dim }}>
        <p style={{ fontSize: 14, lineHeight: 1.5, maxWidth: 420, margin: "0 auto" }}>
          {error ?? "No pude armar una prueba para esta materia todavía."}
        </p>
        <div style={{ marginTop: 14, display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
          <BigBtn onClick={onRetake}>Probar de nuevo</BigBtn>
          <button onClick={onClose} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: C.panel, color: C.text, border: `1.5px solid ${C.ink}`, borderRadius: 999, padding: "9px 18px", cursor: "pointer", fontFamily: FONT.round, fontWeight: 700, fontSize: 14 }}>
            <IconBack size={14} /> Elegir de nuevo
          </button>
        </div>
      </div>
    );
  }
  /**
   * CUÁNDO UNA PREGUNTA ESTÁ RESPONDIDA, según su tipo.
   *
   * En `vf` hacen falta LAS DOS COSAS: marcar la opción y justificar. Si
   * alcanzara con marcar, el alumno podría entregar sin escribir una sola
   * justificación y la mitad de la prueba se resolvería tirando la moneda —
   * que es exactamente lo que pedir justificación viene a evitar.
   */
  const respondida = (it: TestItem) => {
    const tipo = it.tipo ?? "multiple";
    const texto = (textos[it.n] ?? "").trim();
    if (tipo === "multiple") return answers[it.n] != null;
    if (tipo === "vf") return answers[it.n] != null && texto.length >= 8;
    return texto.length >= 8;
  };
  const answered = items.filter(respondida).length;
  // Tras corregir, el veredicto lo manda el SERVIDOR (`it.ok`): en las escritas
  // no hay forma de derivarlo comparando índices en el navegador.
  const results = items.map((it) => ({ it, ok: it.ok ?? (answers[it.n] === it.correct) }));
  const score = results.filter((r) => r.ok).length;

  // EL RESULTADO SE AGRUPA POR TEMA.
  //
  // Antes había una fila por PREGUNTA, que con una pregunta por lección era lo
  // mismo. Desde que el alumno elige los puntos, una prueba puede traer 4 del
  // mismo: fallar 3 mostraba "Sistema endocrino" tres veces seguidas, cada una
  // con su botón "Estudiar" al mismo lado.
  //
  // Y el criterio es el MISMO que usa el submit para anotar los temas a
  // reforzar (dos tercios): si acá dijera "lo dominás" por una respuesta buena
  // de cuatro, el chico vería un cartel verde por algo que el sistema le está
  // guardando como flojo.
  const temas = new Map<string, { it: TestItem; bien: number; total: number }>();
  for (const { it, ok } of results) {
    const k = it.key || it.topic;
    const t = temas.get(k) ?? { it, bien: 0, total: 0 };
    t.total++;
    if (ok) t.bien++;
    temas.set(k, t);
  }
  const porTema = [...temas.values()];
  const weak = porTema.filter((t) => !aprobado(t.bien, t.total));
  const strong = porTema.filter((t) => aprobado(t.bien, t.total)).map((t) => t.it);
  return (
    <div style={{ padding: "4px 2px 20px" }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, marginBottom: 10 }}>
        <div>
          <div style={{ fontFamily: FONT.round, fontWeight: 800, fontSize: 21 }}>Simulación de prueba</div>
          <div style={{ color: C.dim, fontSize: 13.5 }}>{area} · {submitted ? `${score} de ${items.length} correctas` : `${answered} de ${items.length} respondidas`}</div>
        </div>
        <button onClick={onClose} title="Cerrar" style={{ display: "inline-flex", alignItems: "center", gap: 6, background: C.panel, color: C.text, border: `1.5px solid ${C.ink}`, borderRadius: 999, padding: "7px 13px", cursor: "pointer", fontFamily: FONT.round, fontWeight: 600, fontSize: 13, flexShrink: 0 }}>
          <IconBack size={14} /> Salir
        </button>
      </div>

      {submitted && <ResultBanner score={score} total={items.length} weak={weak} strong={strong} onStudy={onStudy} onRetake={onRetake} />}

      <div style={{ display: "grid", gap: 12, marginTop: 16 }}>
        {items.map((it) => (
          <QuestionCard key={it.n} item={it} chosen={answers[it.n]} texto={textos[it.n] ?? ""}
            submitted={submitted} onAnswer={onAnswer} onTexto={onTexto} />
        ))}
      </div>

      {!submitted && (
        <div style={{ marginTop: 20, textAlign: "center" }}>
          <BigBtn disabled={answered < items.length || corrigiendo} onClick={onSubmit}>
            {corrigiendo ? <>Leyendo lo que escribiste… <Dots /></> : <>Corregir la prueba <IconCheck size={17} /></>}
          </BigBtn>
          {corrigiendo && <p style={{ color: C.dim, fontSize: 12.5, marginTop: 10 }}>Las respuestas escritas las lee el tutor: tarda unos segundos.</p>}
          {!corrigiendo && answered < items.length && (
            <p style={{ color: C.dim, fontSize: 12.5, marginTop: 10 }}>
              Te faltan {items.length - answered} de {items.length}. Las de verdadero o falso piden también la justificación.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** El recuadro donde el alumno escribe. Mismo trato en `vf` y en `abierta`. */
function CampoEscrito({ valor, placeholder, disabled, onChange }: { valor: string; placeholder: string; disabled: boolean; onChange: (t: string) => void }) {
  return (
    <textarea
      value={valor} onChange={(e) => onChange(e.target.value)} disabled={disabled}
      placeholder={placeholder} rows={3}
      style={{ width: "100%", background: disabled ? C.panel2 : C.panel, color: C.text, border: `1.5px solid ${C.border}`, borderRadius: 11, padding: "10px 12px", fontSize: 14.5, fontFamily: FONT.sans, lineHeight: 1.5, resize: "vertical" }}
    />
  );
}

/**
 * LO QUE LE FALTÓ, Y LO QUE SÍ DIJO.
 *
 * Los puntos NO los redacta nadie: son los puntos clave de la respuesta modelo,
 * que a su vez salió del material. Por eso se pueden mostrar como "esto tenía
 * que estar" sin riesgo de estar inventando una exigencia.
 *
 * Los cubiertos van primero y en verde a propósito. Un adulto que volvió a
 * estudiar y ve solo la lista de lo que le faltó lee "no sabés nada"; ver
 * primero lo que sí dijo es la diferencia entre una corrección y un reproche.
 */
function Devolucion({ item }: { item: TestItem }) {
  const cubiertos = item.cubiertos ?? [];
  const faltantes = item.faltantes ?? [];
  if (item.sinEscribir) {
    return (
      <div style={{ marginTop: 11, fontSize: 13.5, color: C.warnTx, background: C.warnBg, borderRadius: 10, padding: "9px 12px", lineHeight: 1.5 }}>
        No escribiste nada acá, así que no hay qué corregir. Mirá la respuesta de abajo y probá de nuevo.
      </div>
    );
  }
  if (cubiertos.length === 0 && faltantes.length === 0) return null;
  const linea = (t: string, col: string, marca: React.ReactNode) => (
    <div key={t} style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 5 }}>
      <span style={{ flexShrink: 0, marginTop: 2 }}>{marca}</span>
      <span style={{ fontSize: 13.5, lineHeight: 1.45, color: col }}>{t}</span>
    </div>
  );
  return (
    <div style={{ marginTop: 11, background: C.panel2, borderRadius: 10, padding: "10px 12px" }}>
      {cubiertos.length > 0 && (
        <>
          <div style={{ fontFamily: FONT.round, fontWeight: 700, fontSize: 12.5, color: C.okTx }}>Esto lo dijiste bien</div>
          {cubiertos.map((t) => linea(t, C.text, <IconCheck size={14} color={C.ok} />))}
        </>
      )}
      {faltantes.length > 0 && (
        <>
          <div style={{ fontFamily: FONT.round, fontWeight: 700, fontSize: 12.5, color: C.warnTx, marginTop: cubiertos.length ? 11 : 0 }}>
            Podrías completarlo con esto
          </div>
          {faltantes.map((t) => linea(t, C.text, <span style={{ display: "block", width: 6, height: 6, borderRadius: "50%", background: C.warn, marginTop: 5 }} />))}
        </>
      )}
    </div>
  );
}

/**
 * UNA PREGUNTA. Tres formas según el tipo:
 *
 *   multiple — cuatro opciones, como siempre.
 *   vf       — Verdadero / Falso Y la justificación por escrito. Las dos cosas:
 *              el veredicto del servidor exige acertar la opción y que la
 *              justificación toque al menos un punto de la respuesta modelo.
 *   abierta  — solo el recuadro. La corrige el tutor contra los puntos clave.
 *
 * ⚠️ Después de corregir, el acierto sale de `item.ok` (del SERVIDOR) y no de
 * comparar índices: en una abierta no hay índice que comparar, y en una `vf`
 * comparar solo la opción diría "correcta" en una respuesta cuya justificación
 * el tutor rechazó.
 */
export function QuestionCard({ item, chosen, texto, submitted, onAnswer, onTexto }: { item: TestItem; chosen: number | undefined; texto: string; submitted: boolean; onAnswer: (n: number, i: number) => void; onTexto: (n: number, t: string) => void }) {
  const tipo = item.tipo ?? "multiple";
  const ok = item.ok ?? (chosen === item.correct);
  const shadow = submitted ? (ok ? HARD(C.ok) : HARD(C.bad)) : "none";
  const opciones = tipo === "vf" ? ["Verdadero", "Falso"] : item.options;
  const ETIQUETA: Record<string, string> = { vf: "Verdadero o falso", abierta: "Respuesta escrita" };

  return (
    <div style={{ background: C.panel, border: `2px solid ${C.ink}`, borderRadius: 14, padding: "14px 16px", boxShadow: shadow }}>
      <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
        <span style={{ width: 26, height: 26, flexShrink: 0, borderRadius: 8, display: "grid", placeItems: "center", background: C.accent, color: "#fff", border: `2px solid ${C.ink}`, fontFamily: FONT.round, fontWeight: 800, fontSize: 13 }}>{item.n}</span>
        <span style={{ minWidth: 0 }}>
          {ETIQUETA[tipo] && (
            <span style={{ display: "block", fontFamily: FONT.round, fontWeight: 700, fontSize: 10.5, letterSpacing: .7, textTransform: "uppercase", color: C.dim, marginBottom: 3 }}>
              {ETIQUETA[tipo]}
            </span>
          )}
          <span style={{ fontFamily: FONT.round, fontWeight: 700, fontSize: 15.5, color: C.text, lineHeight: 1.35 }}>{item.question}</span>
        </span>
      </div>

      {tipo !== "abierta" && (
        <div style={{ display: "grid", gap: 8, gridTemplateColumns: tipo === "vf" ? "1fr 1fr" : "1fr" }}>
          {opciones.map((o, idx) => {
            const isChosen = chosen === idx;
            const isCorrect = idx === item.correct;
            let bg = C.panel, bd = C.border, col = C.text, dot = C.border, mark: React.ReactNode = null;
            if (submitted) {
              if (isCorrect) { bg = "rgba(31,157,87,.10)"; bd = C.ok; col = C.okTx; dot = C.ok; mark = <IconCheck size={15} color={C.ok} />; }
              else if (isChosen) { bg = "rgba(212,36,25,.08)"; bd = C.bad; col = C.badTx; dot = C.bad; mark = <IconX size={14} color={C.bad} />; }
            } else if (isChosen) { bg = "rgba(43,68,255,.10)"; bd = C.accent; col = C.accent; dot = C.accent; }
            return (
              <button key={idx} onClick={() => onAnswer(item.n, idx)} disabled={submitted}
                style={{ display: "flex", alignItems: "center", gap: 11, textAlign: "left", background: bg, border: `1.5px solid ${bd}`, borderRadius: 11, padding: "10px 12px", cursor: submitted ? "default" : "pointer", fontFamily: FONT.sans, fontSize: 14.5, color: col }}>
                <span style={{ width: 18, height: 18, flexShrink: 0, borderRadius: "50%", border: `2px solid ${dot}`, background: (isChosen || (submitted && isCorrect)) ? dot : "transparent" }} />
                <span style={{ flex: 1, minWidth: 0 }}>{stripOptLetter(o)}</span>
                {mark}
              </button>
            );
          })}
        </div>
      )}

      {tipo !== "multiple" && (
        <div style={{ marginTop: tipo === "vf" ? 11 : 0 }}>
          {tipo === "vf" && (
            <div style={{ fontSize: 12.5, color: C.dim, marginBottom: 5 }}>¿Por qué? Explicalo con tus palabras.</div>
          )}
          <CampoEscrito
            valor={texto} disabled={submitted}
            placeholder={tipo === "vf" ? "porque…" : "escribí tu respuesta, dos o tres renglones alcanzan…"}
            onChange={(t) => onTexto(item.n, t)}
          />
        </div>
      )}

      {submitted && tipo !== "multiple" && <Devolucion item={item} />}

      {submitted && tipo !== "multiple" && item.referencia && (
        <div style={{ marginTop: 9, fontSize: 13, color: C.dim, lineHeight: 1.5, background: C.panel2, borderRadius: 10, padding: "9px 12px" }}>
          <b style={{ color: C.text, fontFamily: FONT.round }}>Una respuesta completa:</b> {item.referencia}
        </div>
      )}

      {submitted && item.explain && (
        <div style={{ marginTop: 11, fontSize: 13, color: C.dim, lineHeight: 1.5, background: C.panel2, borderRadius: 10, padding: "9px 12px" }}>
          <b style={{ color: C.text, fontFamily: FONT.round }}>Por qué:</b> {item.explain}
        </div>
      )}
    </div>
  );
}

export function ResultBanner({ score, total, weak, strong, onStudy, onRetake }: { score: number; total: number; weak: { it: TestItem; bien: number; total: number }[]; strong: TestItem[]; onStudy: (it: TestItem) => void; onRetake: () => void }) {
  const pct = Math.round((score / total) * 100);
  const tone = pct >= 80 ? C.ok : pct >= 50 ? C.warn : C.bad;
  const msg = pct >= 80 ? "¡Muy bien! Dominás casi todo." : pct >= 50 ? "¡Buen trabajo! Reforcemos algunas cosas." : "Tranqui, repasemos juntos lo que cuesta.";
  const lbl = { fontFamily: FONT.round, fontWeight: 700, fontSize: 12.5, textTransform: "uppercase" as const, letterSpacing: 0.4, color: C.dim, marginBottom: 9, display: "flex", alignItems: "center", gap: 7 };
  return (
    <div style={{ background: C.panel, border: `2px solid ${C.ink}`, borderRadius: 16, padding: 18, boxShadow: HARD(tone), marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <div style={{ width: 62, height: 62, borderRadius: 14, background: `${tone}22`, color: tone, display: "grid", placeItems: "center", fontFamily: FONT.round, fontWeight: 800, fontSize: 19, flexShrink: 0, border: `2px solid ${tone}` }}>{score}/{total}</div>
        <div>
          <div style={{ fontFamily: FONT.round, fontWeight: 800, fontSize: 19, color: C.text }}>{pct}% correcto</div>
          <div style={{ fontSize: 13.5, color: C.dim }}>{msg}</div>
        </div>
      </div>

      {weak.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div style={lbl}>📌 Para reforzar</div>
          <div style={{ display: "grid", gap: 8 }}>
            {weak.map(({ it, bien, total: n }) => (
              <div key={it.key || it.n} style={{ display: "flex", alignItems: "center", gap: 10, background: C.panel2, border: `1px solid ${C.border}`, borderRadius: 12, padding: "10px 12px" }}>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontFamily: FONT.round, fontWeight: 700, fontSize: 14.5, color: C.text }}>{it.topic}</span>
                  <span style={{ display: "block", fontFamily: FONT.mono, fontSize: 11.5, color: C.dim }}>
                    {/* Cuánto de ESE punto salió bien. Con varias preguntas por
                        tema, "para reforzar" a secas no distingue el 0 de 4 del
                        2 de 4, que es justo lo que decide por dónde empezar. */}
                    {n > 1 ? `${bien} de ${n}` : ""}
                    {n > 1 && it.p0 != null ? " · " : ""}
                    {it.p0 != null ? `pág. ${it.p0}${it.p1 && it.p1 !== it.p0 ? `–${it.p1}` : ""}` : ""}
                  </span>
                </span>
                <button onClick={() => onStudy(it)}
                  style={{ display: "inline-flex", alignItems: "center", gap: 5, background: C.accent, color: "#fff", border: `2px solid ${C.ink}`, borderRadius: 10, padding: "7px 13px", cursor: "pointer", fontFamily: FONT.round, fontWeight: 700, fontSize: 13, flexShrink: 0, boxShadow: HARD(C.coral) }}>
                  Estudiar <IconArrow size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {strong.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={lbl}>💪 Lo que dominás</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
            {strong.map((it) => <span key={it.n} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: C.okBg, color: C.okTx, border: `1px solid ${C.ok}`, borderRadius: 999, padding: "5px 12px", fontFamily: FONT.round, fontWeight: 600, fontSize: 13 }}><IconCheck size={13} /> {it.topic}</span>)}
          </div>
        </div>
      )}

      <div style={{ marginTop: 18, textAlign: "center" }}>
        <button onClick={onRetake} style={{ display: "inline-flex", alignItems: "center", gap: 7, background: C.panel, color: C.text, border: `1.5px solid ${C.ink}`, borderRadius: 999, padding: "9px 18px", cursor: "pointer", fontFamily: FONT.round, fontWeight: 700, fontSize: 14 }}>
          <IconSpark size={15} /> Otra prueba nueva
        </button>
      </div>
    </div>
  );
}

// Primera conversación: elegir tema puntual o que el tutor arme un plan.
