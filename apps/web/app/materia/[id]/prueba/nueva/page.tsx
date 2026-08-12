"use client";
/**
 * RENDIR UNA PRUEBA NUEVA.
 *
 * Antes se abría ENCIMA del chat, así que rendirla y volver era un cambio de
 * estado invisible: sin URL, sin "atrás", y con el chat entero todavía montado
 * abajo. Acá es una página: se puede compartir el link, volver con el navegador
 * y salir sin perder nada (lo que importa se guardó en el servidor al corregir).
 */
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { TestView } from "../../../../prueba";
import { subjectLabel } from "../../../../ui";
import { traerMateria } from "../../../../datos";
import type { Subject, TestItem } from "../../../../tipos";

export default function PruebaPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [subject, setSubject] = useState<Subject | undefined>();
  const [items, setItems] = useState<TestItem[] | null>(null);
  const [testId, setTestId] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void traerMateria(id).then(setSubject);
  }, [id]);

  // La prueba se arma al ENTRAR: llegar a esta página ya es pedirla, y un botón
  // "generar" antes de la prueba sería un clic que no decide nada.
  useEffect(() => { void generar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  async function generar() {
    if (loading) return;
    setLoading(true); setItems(null); setTestId(null); setAnswers({}); setSubmitted(false);
    try {
      const r = await fetch("/api/test", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subjectId: id, subjectName: subject ? subjectLabel(subject) : null }),
      });
      const j = await r.json();
      setItems(r.ok ? (j.items ?? []) : []);
      setTestId(r.ok ? (j.testId ?? null) : null);
    } catch { setItems([]); }
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
        onAnswer={(n, i) => { if (!submitted) setAnswers((a) => ({ ...a, [n]: i })); }}
        onSubmit={corregir}
        onRetake={generar}
        onStudy={estudiar}
        onClose={() => router.push(`/materia/${id}/prueba`)}
      />
    </div>
  );
}
