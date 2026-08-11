"use client";
/**
 * ENTRAR A LA MATERIA — la pregunta antes de la pantalla.
 *
 * Antes se caía directo al camino. Eso decide por el alumno: el que viene a
 * repasar para la prueba del viernes tenía que darse cuenta solo de que arriba
 * había una pestaña. Acá se le muestran las tres cosas que puede hacer, con lo
 * que hay adentro de cada una, y elige.
 *
 * Es la única pantalla de la materia sin los accesos en la esquina: acá no hay
 * "las otras dos", están las tres.
 */
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { C, FONT, HARD, Dots, IconList, IconChat, IconClipboard, IconChevron, subjectLabel } from "../../ui";
import type { Subject } from "../../tipos";

export default function ElegirPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [subject, setSubject] = useState<Subject | undefined>();
  const [plan, setPlan] = useState<{ total: number; hechas: number } | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    fetch("/api/subjects").then((r) => r.json())
      .then((j) => setSubject((j.subjects ?? j).find((s: Subject) => s.id === id)))
      .catch(() => { /* el título lo pone el layout */ });
  }, [id]);

  useEffect(() => {
    fetch(`/api/plan?subjectId=${id}`).then((r) => r.json())
      .then((j) => {
        const total = j.items?.length ?? 0;
        setPlan(total ? { total, hechas: (j.doneKeys ?? []).length } : null);
      })
      .catch(() => setPlan(null))
      .finally(() => setCargando(false));
  }, [id]);

  const nombre = subject ? subjectLabel(subject) : "esta materia";

  const opciones = [
    {
      href: `/materia/${id}/camino`,
      icono: <IconList size={22} />,
      color: C.accent,
      titulo: "Tu camino",
      // El subtítulo dice el ESTADO, no una promesa: "seguí por la 3" ubica más
      // que "estudiá el material del libro".
      sub: cargando
        ? "…"
        : plan
          ? plan.hechas === 0
            ? `${plan.total} lecciones del libro, en orden`
            : `Vas ${plan.hechas} de ${plan.total} · seguí por la ${plan.hechas + 1}`
          : "Esta materia todavía no tiene camino",
      apagado: !cargando && !plan,
    },
    {
      href: `/materia/${id}/chat`,
      icono: <IconChat size={22} />,
      color: C.accentSoft,
      titulo: "Preguntar",
      sub: "Una duda puntual, con tus palabras",
      apagado: false,
    },
    {
      href: `/materia/${id}/prueba`,
      icono: <IconClipboard size={22} />,
      color: C.coral,
      titulo: "Simulación de prueba",
      sub: "Ponete a prueba y mirá qué reforzar",
      apagado: false,
    },
  ];

  return (
    <div style={{ maxWidth: 560, margin: "0 auto", padding: "26px 18px 40px" }}>
      <h1 style={{ fontFamily: FONT.round, fontWeight: 800, fontSize: 23, margin: "0 0 4px", lineHeight: 1.2 }}>
        ¿Qué querés hacer?
      </h1>
      <p style={{ color: C.dim, fontSize: 14.5, margin: "0 0 22px" }}>{nombre}</p>

      <div style={{ display: "grid", gap: 12 }}>
        {opciones.map((o) => (
          <button key={o.href} onClick={() => !o.apagado && router.push(o.href)} disabled={o.apagado}
            style={{
              display: "flex", alignItems: "center", gap: 14, textAlign: "left", width: "100%",
              background: C.panel, border: `2px solid ${C.ink}`, borderRadius: 16,
              boxShadow: o.apagado ? "none" : HARD(o.color),
              padding: "16px 15px", cursor: o.apagado ? "default" : "pointer",
              opacity: o.apagado ? 0.5 : 1,
            }}>
            <span style={{ width: 46, height: 46, flexShrink: 0, borderRadius: 13, display: "grid", placeItems: "center", background: o.color, color: "#fff", border: `2px solid ${C.ink}` }}>
              {o.icono}
            </span>
            <span style={{ minWidth: 0, flex: 1 }}>
              <span style={{ display: "block", fontFamily: FONT.round, fontWeight: 800, fontSize: 17 }}>{o.titulo}</span>
              <span style={{ display: "block", color: C.dim, fontSize: 13.5, lineHeight: 1.4, marginTop: 2 }}>
                {o.sub === "…" ? <Dots /> : o.sub}
              </span>
            </span>
            {!o.apagado && <span style={{ color: C.dim, flexShrink: 0 }}><IconChevron size={20} /></span>}
          </button>
        ))}
      </div>
    </div>
  );
}
