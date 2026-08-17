"use client";
/**
 * RENDIR LA PRUEBA.
 *
 * Vivía en `/prueba/nueva`, que ahora es la pantalla donde se ELIGE qué entra.
 * Son dos pasos con dos URLs: se puede volver atrás a cambiar la selección sin
 * perder la prueba que ya está rindiéndose en la otra pestaña, y "atrás" desde
 * acá lleva a los puntos, no al listado.
 *
 * Los puntos elegidos viajan en la URL (`?temas=k1,k2`) y no en un estado que se
 * pierde al recargar: recargar acá arma OTRA prueba, pero de los mismos puntos.
 */
import { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { TestView } from "../../../../prueba";
import { subjectLabel } from "../../../../ui";
import { traerMateria } from "../../../../datos";
import { limpiarPregunta } from "../../../../limpiar-texto";
import type { Subject, TestItem } from "../../../../tipos";

export default function RendirPage() {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const router = useRouter();
  const temas = params.get("temas") ?? "";
  const [subject, setSubject] = useState<Subject | undefined>();
  const [items, setItems] = useState<TestItem[] | null>(null);
  const [testId, setTestId] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void traerMateria(id).then(setSubject);
  }, [id]);

  // La prueba se arma al ENTRAR: llegar a esta página ya es pedirla, y un botón
  // "generar" antes de la prueba sería un clic que no decide nada — lo que había
  // que decidir se decidió en la pantalla anterior.
  useEffect(() => { void generar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id, temas]);

  async function generar() {
    if (loading) return;
    setLoading(true); setItems(null); setTestId(null); setAnswers({}); setSubmitted(false); setError(null);
    try {
      const topicKeys = temas.split(",").map((k) => k.trim()).filter(Boolean);
      const r = await fetch("/api/test", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subjectId: id,
          subjectName: subject ? subjectLabel(subject) : null,
          ...(topicKeys.length ? { topicKeys } : {}),
        }),
      });
      const j = await r.json();
      // El motivo del servidor se muestra tal cual: "no encontré esos puntos" y
      // "el modelo no está respondiendo" piden cosas distintas del alumno, y el
      // cartel genérico de antes ("no pude armar una prueba todavía") las tapaba
      // a las dos.
      if (!r.ok) setError(typeof j?.error === "string" ? j.error : null);
      setItems(r.ok ? (j.items ?? []).map(limpiarPregunta) : []);
      setTestId(r.ok ? (j.testId ?? null) : null);
    } catch {
      setItems([]);
      setError("No pude conectarme para armar la prueba. Revisá tu conexión.");
    }
    finally { setLoading(false); }
  }

  async function corregir() {
    if (!items || !testId) return;
    try {
      // La clave vive en el servidor: se mandan SOLO las respuestas.
      const r = await fetch("/api/test/submit", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ testId, answers: items.map((it) => answers[it.n] ?? null) }),
      });
      if (!r.ok) return;
      const j = await r.json();
      const porN = new Map<number, { correct: number; explain: string }>(
        (j.key ?? []).map((k: { n: number; correct: number; explain: string }) => [k.n, k]),
      );
      setItems((prev) => (prev ?? []).map((it) => ({ ...it, ...(porN.get(it.n) ?? {}) })));
      setSubmitted(true);
    } catch { /* que reintente */ }
  }

  /** "Estudiar esto" desde el resultado: va al chat con la pregunta armada. */
  function estudiar(it: TestItem) {
    const q = `Quiero repasar: ${it.topic}. Explicámelo simple, desde el principio y con un ejemplo.`;
    const p = new URLSearchParams({ q, unit: String(it.unit ?? ""), lesson: String(it.lesson ?? "") });
    router.push(`/materia/${id}/chat?${p}`);
  }

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "14px 16px 28px" }}>
      <TestView
        items={items} loading={loading} answers={answers} submitted={submitted} subject={subject}
        error={error}
        onAnswer={(n, i) => { if (!submitted) setAnswers((a) => ({ ...a, [n]: i })); }}
        onSubmit={corregir}
        onRetake={generar}
        onStudy={estudiar}
        // Salir vuelve a ELEGIR, no al listado: el que sale de una prueba a
        // medio hacer casi siempre quiere otra, y ahí decide de qué.
        onClose={() => router.push(`/materia/${id}/prueba/nueva`)}
      />
    </div>
  );
}
