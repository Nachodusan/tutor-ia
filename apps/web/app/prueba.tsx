"use client";
import { C, FONT, HARD, Dots, IconCheck, IconX, IconClipboard, IconArrow, subjectLabel, scoreTone, AuroraDot, BigBtn, IconBack, IconSpark } from "./ui";
import { aprobado } from "./nota";
import type { Subject, TestItem } from "./tipos";

const stripOptLetter = (o: string) => o.replace(/^\s*[A-Da-d1-4]\s*[)\.\-:]\s+/, "").trim();

export function TestView({ items, loading, answers, submitted, subject, error, onAnswer, onSubmit, onRetake, onStudy, onClose }: { items: TestItem[] | null; loading: boolean; answers: Record<number, number>; submitted: boolean; subject?: Subject; error?: string | null; onAnswer: (n: number, i: number) => void; onSubmit: () => void; onRetake: () => void; onStudy: (it: TestItem) => void; onClose: () => void }) {
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
  const answered = items.filter((it) => answers[it.n] != null).length;
  const results = items.map((it) => ({ it, ok: answers[it.n] === it.correct }));
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
        {items.map((it) => <QuestionCard key={it.n} item={it} chosen={answers[it.n]} submitted={submitted} onAnswer={onAnswer} />)}
      </div>

      {!submitted && (
        <div style={{ marginTop: 20, textAlign: "center" }}>
          <BigBtn disabled={answered < items.length} onClick={onSubmit}>Corregir la prueba <IconCheck size={17} /></BigBtn>
          {answered < items.length && <p style={{ color: C.dim, fontSize: 12.5, marginTop: 10 }}>Respondé las {items.length} preguntas para corregir.</p>}
        </div>
      )}
    </div>
  );
}

export function QuestionCard({ item, chosen, submitted, onAnswer }: { item: TestItem; chosen: number | undefined; submitted: boolean; onAnswer: (n: number, i: number) => void }) {
  const shadow = submitted ? (chosen === item.correct ? HARD(C.ok) : HARD(C.bad)) : "none";
  return (
    <div style={{ background: C.panel, border: `2px solid ${C.ink}`, borderRadius: 14, padding: "14px 16px", boxShadow: shadow }}>
      <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
        <span style={{ width: 26, height: 26, flexShrink: 0, borderRadius: 8, display: "grid", placeItems: "center", background: C.accent, color: "#fff", border: `2px solid ${C.ink}`, fontFamily: FONT.round, fontWeight: 800, fontSize: 13 }}>{item.n}</span>
        <span style={{ fontFamily: FONT.round, fontWeight: 700, fontSize: 15.5, color: C.text, lineHeight: 1.35 }}>{item.question}</span>
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        {item.options.map((o, idx) => {
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
