"use client";
/**
 * LAS PRUEBAS RENDIDAS — la pantalla que abre "Prueba".
 *
 * Antes tocar "Prueba" generaba una nueva al instante. Eso perdía todo lo
 * anterior: la prueba se veía una vez al corregir y desaparecía, aunque quedara
 * guardada entera en la base. Y es justo lo que un chico quiere mirar la noche
 * antes de la prueba de verdad — qué le tomaron y en qué se equivocó.
 *
 * Ahora esto es el listado, y rendir una nueva es un botón.
 */
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { C, FONT, HARD, Dots, IconPrueba, IconChevron, IconArrow, scoreTone, ANCHO } from "../../../ui";

interface Intento { id: string; at: string; score: number; total: number; title?: string }
/** El título por defecto no aporta nada en una lista que ya se llama así. */
const GENERICO = "Simulación de prueba";

const FECHA = new Intl.DateTimeFormat("es-CL", {
  day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
});

export default function PruebasPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [intentos, setIntentos] = useState<Intento[] | null>(null);

  useEffect(() => {
    fetch(`/api/test/historial?subjectId=${id}`)
      .then((r) => r.json())
      .then((j) => setIntentos(j.intentos ?? []))
      .catch(() => setIntentos([]));
  }, [id]);

  return (
    <div style={{ maxWidth: ANCHO.lista, margin: "0 auto", padding: "16px 16px 32px" }}>
      <div style={{ fontFamily: FONT.round, fontWeight: 800, fontSize: 21 }}>Simulación de prueba</div>
      <div style={{ color: C.dim, fontSize: 13.5, marginTop: 2, lineHeight: 1.45 }}>
        Preguntas de opción múltiple armadas con tu material. Podés volver a mirar
        las que ya rendiste.
      </div>

      <button onClick={() => router.push(`/materia/${id}/prueba/nueva`)}
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, width: "100%", textAlign: "left", marginTop: 16, background: C.coral, color: "#fff", border: `2px solid ${C.ink}`, borderRadius: 14, boxShadow: HARD(C.ink), padding: "15px 16px", cursor: "pointer" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
          <span style={{ width: 40, height: 40, flexShrink: 0, borderRadius: 11, display: "grid", placeItems: "center", background: "rgba(255,255,255,.22)" }}>
            <IconPrueba size={20} />
          </span>
          <span style={{ minWidth: 0 }}>
            <span style={{ display: "block", fontFamily: FONT.round, fontWeight: 800, fontSize: 16 }}>Rendir una prueba nueva</span>
            <span style={{ display: "block", fontSize: 13, opacity: .9, marginTop: 1 }}>Elegís qué entra y se arma con tu libro</span>
          </span>
        </span>
        <IconArrow size={20} />
      </button>

      <div style={{ fontFamily: FONT.round, fontWeight: 700, fontSize: 13, color: C.dim, textTransform: "uppercase", letterSpacing: .6, margin: "26px 0 10px" }}>
        Las que rendiste
      </div>

      {intentos === null && <div style={{ color: C.dim }}><Dots /></div>}

      {intentos?.length === 0 && (
        <div style={{ color: C.dim, fontSize: 14, lineHeight: 1.55, background: C.panel2, border: `1.5px solid ${C.border}`, borderRadius: 12, padding: "14px 15px" }}>
          Todavía no rendiste ninguna. Cuando lo hagas, van a quedar acá con sus
          preguntas y tus respuestas, para que puedas repasarlas.
        </div>
      )}

      <div style={{ display: "grid", gap: 10 }}>
        {(intentos ?? []).map((i) => {
          // El color sigue a la nota: un 2 de 8 en verde leía como logro.
          const t = scoreTone(i.total > 0 ? i.score / i.total : 0);
          return (
            <button key={i.id} onClick={() => router.push(`/materia/${id}/prueba/${i.id}`)}
              // `minWidth: 0` en el ítem de la grilla: sin eso su ancho mínimo
              // es el del contenido, y un título largo sin cortes empuja la
              // tarjeta fuera de la pantalla (con barra horizontal y el chevron
              // afuera). El `ellipsis` de adentro no alcanza si el de afuera
              // puede crecer.
              style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0, textAlign: "left", background: C.panel, border: `2px solid ${C.ink}`, borderRadius: 14, padding: "13px 14px", cursor: "pointer" }}>
              <span style={{ flexShrink: 0, fontFamily: FONT.round, fontWeight: 800, fontSize: 15, color: t.tx, background: t.bg, border: `1.5px solid ${t.tx}`, borderRadius: 999, padding: "4px 11px" }}>
                {i.score}/{i.total}
              </span>
              <span style={{ minWidth: 0, flex: 1 }}>
                <span style={{ display: "block", fontSize: 13.5, color: C.text }}>
                  {FECHA.format(new Date(i.at))}
                </span>
                {i.title && i.title !== GENERICO && (
                  <span style={{ display: "block", fontSize: 12, color: C.dim, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {i.title}
                  </span>
                )}
              </span>
              <span style={{ color: C.dim, flexShrink: 0 }}><IconChevron size={18} /></span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
