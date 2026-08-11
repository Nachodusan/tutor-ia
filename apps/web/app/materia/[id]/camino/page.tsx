"use client";
/**
 * EL CAMINO — la página que abre la materia.
 *
 * Es dueña de su propio estado: plan, avance y las preguntas de la lección
 * abierta. Antes todo esto vivía en el componente único junto con el chat y la
 * prueba; ahora entrar acá no carga nada del chat.
 */
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { CaminoView, HojaLeccion } from "../../../camino";
import { C, Dots, subjectLabel } from "../../../ui";
import { traerMateria } from "../../../datos";
import type { PlanItem, QuizQ, QuizResult, Subject } from "../../../tipos";

export default function CaminoPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [subject, setSubject] = useState<Subject | undefined>();
  const [plan, setPlan] = useState<PlanItem[] | null>(null);
  const [done, setDone] = useState<string[]>([]);
  const [scores, setScores] = useState<Record<string, { score: number; total: number }>>({});
  const [cargando, setCargando] = useState(true);
  const [planLoading, setPlanLoading] = useState(false);

  const [quizKey, setQuizKey] = useState("");
  const [quiz, setQuiz] = useState<QuizQ[] | null>(null);
  const [quizAns, setQuizAns] = useState<Record<number, number>>({});
  const [quizRes, setQuizRes] = useState<QuizResult | null>(null);
  const [quizLoading, setQuizLoading] = useState(false);
  const [quizErr, setQuizErr] = useState("");

  useEffect(() => {
    void traerMateria(id).then(setSubject);
  }, [id]);

  useEffect(() => {
    setCargando(true);
    fetch(`/api/plan?subjectId=${id}`).then((r) => r.json())
      .then((j) => {
        setPlan(j.items?.length ? j.items : null);
        setDone(j.doneKeys ?? []);
        setScores(j.scores ?? {});
      })
      .catch(() => setPlan(null))
      .finally(() => setCargando(false));
  }, [id]);

  async function abrirQuiz(item: PlanItem) {
    if (quizKey === item.key) { setQuizKey(""); return; }
    setQuizKey(item.key); setQuiz(null); setQuizAns({}); setQuizRes(null); setQuizErr("");
    setQuizLoading(true);
    try {
      const r = await fetch("/api/lesson/quiz", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subjectId: id, topicKey: item.key, title: item.title, unit: item.unit, lesson: item.lesson, p0: item.p0, p1: item.p1 }),
      });
      const j = await r.json();
      if (!r.ok) { setQuizErr(j.error ?? "No pude armar las preguntas."); return; }
      setQuiz(j.items ?? []);
    } catch { setQuizErr("No hay conexión con el servidor."); }
    finally { setQuizLoading(false); }
  }

  async function enviarQuiz(item: PlanItem) {
    if (!quiz || quizRes) return;
    setQuizLoading(true);
    try {
      const r = await fetch("/api/lesson/quiz/submit", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subjectId: id, topicKey: item.key, answers: quizAns }),
      });
      const j = await r.json();
      if (!r.ok) { setQuizErr(j.error ?? "No pude corregir."); return; }
      setQuizRes(j);
      setDone((d) => (d.includes(item.key) ? d : [...d, item.key]));
      setScores((s) => ({ ...s, [item.key]: { score: j.score, total: j.total } }));
    } catch { setQuizErr("No hay conexión con el servidor."); }
    finally { setQuizLoading(false); }
  }

  async function generarPlan() {
    setPlanLoading(true);
    try {
      const r = await fetch("/api/plan", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subjectId: id, subjectName: subject ? subjectLabel(subject) : null }),
      });
      const j = await r.json();
      setPlan(j.items?.length ? j.items : null);
      setDone(j.doneKeys ?? []);
    } catch { /* se queda con el plan que había */ }
    finally { setPlanLoading(false); }
  }

  /**
   * Al chat, con contexto. Dos formas, y la diferencia importa:
   *  · Sin `pregunta`: "no entiendo esto" → la lección entera desde el principio.
   *  · Con `pregunta`: el alumno falló ESA pregunta → se le pide al tutor que
   *    explique justo eso. Mandarlo a repasar la lección completa por un ítem
   *    fallado es hacerle perder el rato que le quedaba.
   */
  function repasar(item: PlanItem, pregunta?: string) {
    const q = pregunta
      ? `En "${item.title}" me equivoqué en esto: "${pregunta}". Explicámelo de nuevo, simple y con un ejemplo, y después preguntame algo parecido para ver si entendí.`
      : `Quiero estudiar: ${item.title}${item.focus ? ` (${item.focus})` : ""}. Enseñámelo desde el principio, paso a paso y con ejemplos.`;
    const p = new URLSearchParams({ q, unit: String(item.unit ?? ""), lesson: String(item.lesson ?? "") });
    router.push(`/materia/${id}/chat?${p}`);
  }

  if (cargando) {
    return <div style={{ display: "grid", placeItems: "center", padding: 48, color: C.dim }}><Dots /></div>;
  }
  if (!plan) {
    return (
      <div style={{ padding: "28px 20px", textAlign: "center", color: C.dim, maxWidth: 420, margin: "0 auto" }}>
        <p style={{ fontSize: 15, lineHeight: 1.6 }}>
          Esta materia todavía no tiene un camino armado: su libro no trae un índice
          que se pueda leer.
        </p>
        <p style={{ fontSize: 14, lineHeight: 1.6 }}>
          Igual podés preguntarle lo que quieras al tutor desde <b>Preguntar</b>.
        </p>
      </div>
    );
  }

  const abiertaItem = plan.find((p) => p.key === quizKey);

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "14px 16px 40px" }}>
      <CaminoView
        items={plan} done={done} scores={scores} subject={subject} loading={planLoading}
        abierta={quizKey}
        onAbrir={abrirQuiz}
        onCerrar={() => setQuizKey("")}
        onExamen={() => router.push(`/materia/${id}/prueba`)}
        testLoading={false}
        onRegen={generarPlan}
      >
        {abiertaItem && (
          <HojaLeccion
            item={abiertaItem}
            quiz={quiz} quizAns={quizAns} quizRes={quizRes}
            quizLoading={quizLoading} quizErr={quizErr}
            onResponder={(n, i) => setQuizAns((a) => ({ ...a, [n]: i }))}
            onEnviar={() => enviarQuiz(abiertaItem)}
            onReintentar={() => { setQuizAns({}); setQuizRes(null); setQuizErr(""); }}
            onRepasar={(pregunta) => repasar(abiertaItem, pregunta)}
            onCerrar={() => setQuizKey("")}
          />
        )}
      </CaminoView>
    </div>
  );
}
