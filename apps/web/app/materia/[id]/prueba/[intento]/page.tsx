"use client";
/**
 * UNA PRUEBA YA RENDIDA — su contenido completo.
 *
 * Muestra las preguntas tal como se tomaron, qué respondió el alumno y cuál era
 * la correcta. Es material de repaso: acá SÍ se revela la clave, porque la
 * prueba ya se corrigió y quedó registrada. (Durante la prueba no viaja nunca:
 * ver /api/test/route.ts.)
 */
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { C, FONT, HARD, Dots, IconChat, scoreTone } from "../../../../ui";

interface Pregunta {
  n: number; topic: string; question: string; options: string[];
  correct: number; explain: string; chosen: number; ok: boolean;
  unit: number | null; lesson: number | null;
}
interface Intento { id: string; title: string; at: string; score: number; total: number; preguntas: Pregunta[] }

const FECHA = new Intl.DateTimeFormat("es-CL", {
  day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit",
});

export default function IntentoPage() {
  const { id, intento } = useParams<{ id: string; intento: string }>();
  const router = useRouter();
  const [dato, setDato] = useState<Intento | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    fetch(`/api/test/historial?id=${intento}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) { setErr(j.error ?? "No pude abrir esta prueba."); return; }
        setDato(j.intento);
      })
      .catch(() => setErr("No hay conexión con el servidor."));
  }, [intento]);

  function repasar(p: Pregunta) {
    const q = `En la prueba me equivoqué en esto: "${p.question}". Explicámelo de nuevo, simple y con un ejemplo, y después preguntame algo parecido para ver si entendí.`;
    const s = new URLSearchParams({ q, unit: String(p.unit ?? ""), lesson: String(p.lesson ?? "") });
    router.push(`/materia/${id}/chat?${s}`);
  }

  if (err) return <div style={{ padding: 40, textAlign: "center", color: C.dim }}>{err}</div>;
  if (!dato) return <div style={{ display: "grid", placeItems: "center", padding: 48, color: C.dim }}><Dots /></div>;

  const t = scoreTone(dato.total > 0 ? dato.score / dato.total : 0);
  const falladas = dato.preguntas.filter((p) => !p.ok).length;

  return (
    <div style={{ maxWidth: 620, margin: "0 auto", padding: "16px 16px 32px" }}>
      <button onClick={() => router.push(`/materia/${id}/prueba`)}
        style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "none", border: "none", color: C.dim, cursor: "pointer", padding: 0, fontSize: 13, fontFamily: FONT.sans }}>
        ← Todas las pruebas
      </button>

      <div style={{ marginTop: 10, border: `2px solid ${C.ink}`, borderRadius: 16, boxShadow: HARD(t.tx), background: t.bg, padding: "16px 15px" }}>
        <div style={{ fontFamily: FONT.round, fontWeight: 800, fontSize: 24, color: t.tx }}>
          {dato.score} de {dato.total}
        </div>
        <div style={{ fontSize: 13, color: t.tx, marginTop: 3 }}>{FECHA.format(new Date(dato.at))}</div>
        {falladas > 0 && (
          <div style={{ fontSize: 13, color: t.tx, marginTop: 6, lineHeight: 1.45 }}>
            {falladas === 1 ? "Fallaste 1 pregunta." : `Fallaste ${falladas} preguntas.`} Están marcadas abajo.
          </div>
        )}
      </div>

      {/* TODAS las preguntas, no solo las falladas: acá el alumno viene a repasar
          la prueba entera, y ver las que acertó le dice qué SÍ sabe. */}
      <div style={{ display: "grid", gap: 12, marginTop: 16 }}>
        {dato.preguntas.map((p) => (
          <div key={p.n} style={{ border: `2px solid ${p.ok ? C.border : C.warn}`, borderRadius: 14, background: C.panel, padding: "13px 14px" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
              <span style={{ fontFamily: FONT.round, fontWeight: 800, fontSize: 12, color: p.ok ? C.okTx : C.warnTx, background: p.ok ? C.okBg : C.warnBg, borderRadius: 999, padding: "2px 8px", flexShrink: 0 }}>
                {p.ok ? "Bien" : "Mal"}
              </span>
              {p.topic && <span style={{ fontSize: 11.5, color: C.dim, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.topic}</span>}
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.4 }}>{p.n}. {p.question}</div>

            <div style={{ display: "grid", gap: 5, marginTop: 8 }}>
              {p.options.map((o, i) => {
                const esCorrecta = i === p.correct;
                const laTuya = i === p.chosen;
                const bg = esCorrecta ? C.okBg : laTuya ? C.badBg : C.panel;
                const bd = esCorrecta ? C.ok : laTuya ? C.bad : C.border;
                return (
                  <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, background: bg, border: `1.5px solid ${bd}`, borderRadius: 9, padding: "8px 10px", fontSize: 13, lineHeight: 1.35 }}>
                    <span style={{ flex: 1, minWidth: 0 }}>{o}</span>
                    {(esCorrecta || laTuya) && (
                      <span style={{ flexShrink: 0, fontSize: 11, fontFamily: FONT.round, fontWeight: 700, color: esCorrecta ? C.okTx : C.badTx }}>
                        {esCorrecta ? "correcta" : "tu respuesta"}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            {p.explain && (
              <div style={{ fontSize: 12.5, color: C.dim, marginTop: 7, lineHeight: 1.45 }}>{p.explain}</div>
            )}
            {!p.ok && (
              <button onClick={() => repasar(p)}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 9, background: C.panel, color: C.text, border: `1.5px solid ${C.ink}`, borderRadius: 9, padding: "7px 11px", fontFamily: FONT.round, fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}>
                <IconChat size={14} /> Repasarlo en el chat
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
