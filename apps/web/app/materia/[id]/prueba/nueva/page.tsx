"use client";
/**
 * QUÉ ENTRA EN LA PRUEBA — la pantalla que decide, antes de generar nada.
 *
 * Antes "Rendir una prueba nueva" disparaba la generación en el acto, con temas
 * repartidos por todo el libro. Eso da una prueba distinta cada vez, que está
 * bien para medirse en general y mal para lo que el alumno hace la semana antes
 * de la prueba de verdad: sabe qué le cuesta y quiere que le tomen ESO.
 *
 * Los puntos son los mismos del camino (misma `key`, mismo orden, mismo título):
 * si acá se listaran otros, el chico no podría relacionar lo que eligió con lo
 * que viene estudiando.
 *
 * Lo que el alumno YA falló viene marcado. Es la razón de ser de esta pantalla:
 * elegir bien exige saber en qué se está flojo, y esa información ya existe (la
 * prueba anterior y los cuestionarios del camino) pero vivía en otra pantalla.
 */
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { C, FONT, HARD, Dots, IconCheck, IconArrow, IconAlert, IconBack } from "../../../../ui";
import { aprobado } from "../../../../nota";
import { repartoPrueba, TOPE_TEMAS } from "../../../../reparto-prueba";
import type { PlanItem } from "../../../../tipos";

export default function ElegirPuntosPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [items, setItems] = useState<PlanItem[] | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [flojos, setFlojos] = useState<Set<string>>(new Set());
  const [hechos, setHechos] = useState<Set<string>>(new Set());

  useEffect(() => {
    let vivo = true;
    // Los puntos del camino + cómo le fue en cada cuestionario.
    fetch(`/api/plan?subjectId=${id}`)
      .then((r) => r.json())
      .then((j: { items?: PlanItem[]; doneKeys?: string[]; scores?: Record<string, { score: number; total: number }> }) => {
        if (!vivo) return;
        const its = Array.isArray(j.items) ? j.items : [];
        setItems(its);
        // Arranca TODO elegido: es lo que hacía el botón antes de esta pantalla,
        // así que quien solo quiere rendir sigue apretando una vez. Elegir es la
        // opción, no el peaje.
        setSel(new Set(its.map((i) => i.key)));
        setHechos(new Set(j.doneKeys ?? []));
        const malos = Object.entries(j.scores ?? {})
          .filter(([, s]) => !aprobado(s.score, s.total))
          .map(([k]) => k);
        setFlojos((f) => new Set([...f, ...malos]));
      })
      .catch(() => { if (vivo) setItems([]); });

    // Lo que falló en pruebas ANTERIORES (student_weak_topics). Es la misma
    // `topic_key`, así que se juntan las dos señales en una sola marca.
    fetch("/api/progress")
      .then((r) => r.json())
      .then((j: { progress?: Record<string, { weak?: { topicKey: string }[] }> }) => {
        if (!vivo) return;
        const w = j.progress?.[id]?.weak ?? [];
        setFlojos((f) => new Set([...f, ...w.map((x) => x.topicKey)]));
      })
      .catch(() => { /* la pantalla funciona sin las marcas */ });

    return () => { vivo = false; };
  }, [id]);

  const elegidos = useMemo(() => (items ?? []).filter((i) => sel.has(i.key)), [items, sel]);
  const reparto = repartoPrueba(elegidos.length);
  const conFlojos = (items ?? []).filter((i) => flojos.has(i.key));

  function alternar(key: string) {
    setSel((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n; });
  }

  function rendir(keys?: string[]) {
    const q = keys?.length ? `?temas=${keys.map(encodeURIComponent).join(",")}` : "";
    router.push(`/materia/${id}/prueba/rendir${q}`);
  }

  return (
    <div style={{ maxWidth: 620, margin: "0 auto", padding: "16px 16px 0" }}>
      <button onClick={() => router.push(`/materia/${id}/prueba`)} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "none", border: "none", color: C.dim, cursor: "pointer", fontFamily: FONT.round, fontWeight: 600, fontSize: 13.5, padding: 0, marginBottom: 12 }}>
        <IconBack size={15} /> Las pruebas que rendiste
      </button>

      <div style={{ fontFamily: FONT.round, fontWeight: 800, fontSize: 21 }}>¿Qué te tomamos?</div>
      <div style={{ color: C.dim, fontSize: 13.5, marginTop: 2, lineHeight: 1.45 }}>
        Elegí los puntos que entran en la prueba. Podés dejar todos o quedarte con uno solo.
      </div>

      {items === null && <div style={{ color: C.dim, marginTop: 20 }}><Dots /></div>}

      {/* Sin plan legible no hay puntos que elegir. La prueba de todo el libro
          sigue disponible: es lo que hacía este botón antes, y es lo único que
          se puede armar cuando el índice del libro no se pudo leer. */}
      {items?.length === 0 && (
        <div style={{ marginTop: 18 }}>
          <div style={{ display: "flex", gap: 9, alignItems: "flex-start", background: C.warnBg, color: C.warnTx, borderRadius: 12, padding: "12px 14px", fontSize: 13.5, lineHeight: 1.5 }}>
            <span style={{ flexShrink: 0, marginTop: 1 }}><IconAlert size={15} /></span>
            <span>Esta materia todavía no tiene su camino armado, así que no hay puntos para elegir. Puedo tomarte una prueba de todo el libro.</span>
          </div>
          <button onClick={() => rendir()} style={{ ...botonGrande, marginTop: 14 }}>
            Prueba de todo el libro <IconArrow size={18} />
          </button>
        </div>
      )}

      {items && items.length > 0 && (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "16px 0 12px" }}>
            <Chip onClick={() => setSel(new Set(items.map((i) => i.key)))} activo={sel.size === items.length}>
              Todos
            </Chip>
            <Chip onClick={() => setSel(new Set())} activo={sel.size === 0}>Ninguno</Chip>
            {conFlojos.length > 0 && (
              <Chip onClick={() => setSel(new Set(conFlojos.map((i) => i.key)))}
                activo={sel.size === conFlojos.length && conFlojos.every((i) => sel.has(i.key))}
                tono={C.coral}>
                Los que me costaron ({conFlojos.length})
              </Chip>
            )}
          </div>

          <div style={{ display: "grid", gap: 8 }}>
            {items.map((it) => {
              const marcado = sel.has(it.key);
              const flojo = flojos.has(it.key);
              return (
                <button key={it.key} onClick={() => alternar(it.key)}
                  aria-pressed={marcado} aria-label={`${it.n}. ${it.title}`} title={it.title}
                  style={{
                    display: "flex", alignItems: "center", gap: 12, textAlign: "left", width: "100%",
                    background: marcado ? "rgba(43,68,255,.06)" : C.panel,
                    border: `2px solid ${marcado ? C.accent : C.border}`,
                    borderRadius: 14, padding: "12px 14px", cursor: "pointer",
                  }}>
                  <span style={{
                    width: 24, height: 24, flexShrink: 0, borderRadius: 8,
                    border: `2px solid ${marcado ? C.accent : C.border}`,
                    background: marcado ? C.accent : "transparent",
                    color: "#fff", display: "grid", placeItems: "center",
                  }}>
                    {marcado && <IconCheck size={15} />}
                  </span>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ display: "block", fontFamily: FONT.round, fontWeight: 700, fontSize: 14.5, color: C.text, lineHeight: 1.3 }}>
                      {it.n}. {it.title}
                    </span>
                    <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 7, marginTop: 4 }}>
                      {it.p0 != null && (
                        <span style={{ fontFamily: FONT.mono, fontSize: 11.5, color: C.dim }}>
                          pág. {it.p0}{it.p1 && it.p1 !== it.p0 ? `–${it.p1}` : ""}
                        </span>
                      )}
                      {flojo && (
                        <span style={{ fontFamily: FONT.round, fontWeight: 700, fontSize: 10.5, letterSpacing: .3, textTransform: "uppercase", color: C.badTx, background: C.badBg, border: `1px solid ${C.bad}`, borderRadius: 999, padding: "1px 8px" }}>
                          Te costó
                        </span>
                      )}
                      {!flojo && hechos.has(it.key) && (
                        <span style={{ fontFamily: FONT.round, fontWeight: 700, fontSize: 10.5, letterSpacing: .3, textTransform: "uppercase", color: C.okTx, background: C.okBg, border: `1px solid ${C.ok}`, borderRadius: 999, padding: "1px 8px" }}>
                          Hecho
                        </span>
                      )}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          {/* La acción, pegada abajo mientras se elige: con 14 puntos, un botón
              al final de la lista obliga a bajar hasta el fondo para rendir. */}
          <div style={{ position: "sticky", bottom: 0, background: C.bg, borderTop: `1px solid ${C.border}`, margin: "18px -16px 0", padding: "12px 16px 16px" }}>
            <button onClick={() => rendir(elegidos.map((i) => i.key))} disabled={elegidos.length === 0}
              style={{ ...botonGrande, ...(elegidos.length === 0 ? apagado : null) }}>
              {/* "unas" y no el número pelado: la clave de cada pregunta se
                  verifica a ciegas antes de servirla y la que no cuadra se
                  descarta, así que la prueba puede salir con una menos. Medido:
                  10 pedidas → 9 servidas. Prometer 10 exactas sería mentir para
                  que quede más prolijo. */}
              {elegidos.length === 0
                ? "Elegí al menos un punto"
                : <>Rendir la prueba · unas {reparto.total} preguntas <IconArrow size={18} /></>}
            </button>
            {/* Nada de recortes silenciosos: si eligió más de los que entran, se
                dice acá y no después, cuando ya rindió. */}
            {reparto.recortados > 0 && (
              <p style={{ color: C.dim, fontSize: 12, lineHeight: 1.45, margin: "9px 0 0", textAlign: "center" }}>
                Elegiste {elegidos.length}: entran {TOPE_TEMAS}, repartidos entre lo que marcaste.
              </p>
            )}
            {elegidos.length > 0 && reparto.recortados === 0 && reparto.porTema > 1 && (
              <p style={{ color: C.dim, fontSize: 12, lineHeight: 1.45, margin: "9px 0 0", textAlign: "center" }}>
                {reparto.porTema} preguntas de {reparto.temas === 1 ? "ese punto" : "cada punto"}.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

const botonGrande: React.CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "center", gap: 9, width: "100%",
  background: C.coral, color: "#fff", border: `2px solid ${C.ink}`, borderRadius: 14,
  boxShadow: HARD(C.ink), padding: "14px 16px", cursor: "pointer",
  fontFamily: FONT.round, fontWeight: 800, fontSize: 16,
};
const apagado: React.CSSProperties = {
  background: C.panel2, color: C.dim, border: `2px solid ${C.border}`, boxShadow: "none", cursor: "default",
};

function Chip({ children, onClick, activo, tono }: { children: React.ReactNode; onClick: () => void; activo?: boolean; tono?: string }) {
  const c = tono ?? C.accent;
  return (
    <button onClick={onClick}
      style={{
        background: activo ? c : C.panel, color: activo ? "#fff" : C.text,
        border: `1.5px solid ${activo ? c : C.ink}`, borderRadius: 999,
        padding: "7px 14px", cursor: "pointer",
        fontFamily: FONT.round, fontWeight: 700, fontSize: 13,
      }}>
      {children}
    </button>
  );
}
