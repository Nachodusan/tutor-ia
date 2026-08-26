"use client";
/**
 * UNA LECCIÓN DEL CAMINO — página propia, preguntas de a una.
 *
 * Antes esto era una hoja que subía sobre el camino con las diez preguntas
 * apiladas. Dos problemas: en un teléfono el alumno perdía de vista dónde
 * estaba, y ver diez preguntas juntas antes de empezar desanima más que una
 * sola con su barra de avance.
 *
 * Acá se responde de a una. La barra de arriba dice cuánto falta, y al terminar
 * la lección ofrece SEGUIR CON LA SIGUIENTE sin volver al camino — que es lo que
 * hace que se estudie de corrido en vez de una lección por sesión.
 */
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { traerMateria } from "../../../../datos";
import { aprobado } from "../../../../camino";
import { C, FONT, HARD, Dots, IconCheck, IconChat, IconArrow, subjectLabel } from "../../../../ui";
import { limpiarPregunta } from "../../../../limpiar-texto";
import { ClaseParada } from "../../../../clase-parada";
import { ApunteParada } from "../../../../apunte-parada";
import type { Apunte, Clase, PlanItem, QuizQ, QuizResult, Subject } from "../../../../tipos";

export default function LeccionPage() {
  const { id, tema } = useParams<{ id: string; tema: string }>();
  const router = useRouter();
  const [subject, setSubject] = useState<Subject | undefined>();
  const [plan, setPlan] = useState<PlanItem[]>([]);
  const [done, setDone] = useState<string[]>([]);
  const [quiz, setQuiz] = useState<QuizQ[] | null>(null);
  const [ans, setAns] = useState<Record<number, number>>({});
  const [res, setRes] = useState<QuizResult | null>(null);
  const [cargando, setCargando] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [err, setErr] = useState("");
  /** Índice de la pregunta que se está mostrando. */
  const [paso, setPaso] = useState(0);
  /**
   * LA CLASE DE LA PARADA — lo que se enseña antes de preguntar.
   *
   * `null` mientras se busca; `false` cuando esta parada todavía no tiene clase
   * generada (hoy son casi todas: el batch va de a poco). En ese caso la
   * pantalla se comporta exactamente como antes y va derecho a las preguntas, así
   * que el camino entero sigue funcionando mientras las clases se van generando.
   */
  const [clase, setClase] = useState<Clase | null | false>(null);
  const [enClase, setEnClase] = useState(true);
  /**
   * EL APUNTE — de acá se estudia, y se vuelve. `false` = esta parada todavía no
   * tiene apunte generado, y entonces la pestaña ni aparece.
   */
  const [apunte, setApunte] = useState<Apunte | null | false>(null);
  /** Qué está mirando: la clase/preguntas o el apunte. */
  const [vista, setVista] = useState<"clase" | "apunte">("clase");

  /**
   * EL PLAN, APLANADO A PASOS ABRIBLES. Desde que el camino es de UNIDADES,
   * las claves de lección viven ANIDADAS en `item.lecciones` — y esta página
   * buscaba solo en el nivel de arriba: tocar cualquier moneda de lección del
   * camino terminaba en "No encontré esa lección". Cada lección anidada se
   * aplana con la MISMA forma que arma el camino al abrirla, y "la siguiente"
   * pasa a ser la próxima lección real (la que sigue dentro de la unidad, o la
   * primera de la unidad que viene), no el próximo nodo gordo.
   */
  const pasos = useMemo(() => plan.flatMap((p) =>
    p.lecciones?.length
      ? p.lecciones.map((l) => ({ ...p, key: l.key, title: l.title, p0: l.p0, p1: l.p1, unit: l.unit, lesson: l.lesson, lecciones: undefined }))
      : [p]
  ), [plan]);
  // Primero el nivel de arriba (el nodo grande de una unidad también se abre,
  // con su propia clave); si no está ahí, es una lección anidada.
  const item = useMemo(
    () => plan.find((p) => p.key === tema) ?? pasos.find((p) => p.key === tema),
    [plan, pasos, tema],
  );
  const idx = useMemo(() => pasos.findIndex((p) => p.key === tema), [pasos, tema]);
  // Para una clave de UNIDAD (nodo grande) el índice no está en `pasos` — la
  // lista aplanada la reemplazó por sus lecciones. Sin el segundo caso,
  // `siguiente` quedaba undefined y el final del quiz de la unidad 2 de 10
  // decía "Era la última lección del camino 🎉": mentira, y un callejón sin
  // salida justo en el botón que existe para seguir de corrido. Después del
  // quiz de la unidad, lo que sigue es SU primera lección.
  const siguiente = useMemo(() => {
    if (idx >= 0) return pasos[idx + 1];
    const u = plan.find((p) => p.key === tema);
    return u?.lecciones?.length
      ? pasos.find((p) => p.key === u.lecciones![0]!.key)
      : undefined;
  }, [idx, pasos, plan, tema]);

  useEffect(() => { void traerMateria(id).then(setSubject); }, [id]);

  // La clase se pide aparte de las preguntas y no las bloquea: son dos fetch
  // independientes que corren juntos. La clase sale de una tabla (0 llamadas al
  // modelo), así que vuelve enseguida y casi siempre gana la carrera.
  useEffect(() => {
    if (!item) return;
    let vivo = true;
    setClase(null); setEnClase(true);
    fetch(`/api/lesson/clase?subjectId=${id}&topicKey=${encodeURIComponent(item.key)}`)
      .then(async (r) => {
        if (!vivo) return;
        if (!r.ok) { setClase(false); return; }
        const j = await r.json();
        setClase(j.clase?.momentos?.length ? j.clase : false);
      })
      .catch(() => { if (vivo) setClase(false); });
    return () => { vivo = false; };
  }, [id, item?.key]);   // eslint-disable-line react-hooks/exhaustive-deps

  // El apunte, igual que la clase: sale de una tabla, no cuesta una llamada al
  // modelo y no bloquea nada de lo demás.
  useEffect(() => {
    if (!item) return;
    let vivo = true;
    setApunte(null); setVista("clase");
    fetch(`/api/lesson/apunte?subjectId=${id}&topicKey=${encodeURIComponent(item.key)}`)
      .then(async (r) => {
        if (!vivo) return;
        if (!r.ok) { setApunte(false); return; }
        const j = await r.json();
        setApunte(j.apunte?.puntos?.length ? j.apunte : false);
      })
      .catch(() => { if (vivo) setApunte(false); });
    return () => { vivo = false; };
  }, [id, item?.key]);   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetch(`/api/plan?subjectId=${id}`).then((r) => r.json())
      .then((j) => { setPlan(j.items ?? []); setDone(j.doneKeys ?? []); })
      .catch(() => setPlan([]));
  }, [id]);

  // Las preguntas se piden en cuanto se conoce la lección. Con el plan ya
  // cargado esto es una sola llamada; la primera vez de cada lección paga la
  // generación y por eso la pantalla lo dice en vez de quedarse muda.
  useEffect(() => {
    if (!item) return;
    let vivo = true;
    setCargando(true); setErr(""); setQuiz(null); setAns({}); setRes(null); setPaso(0);
    fetch("/api/lesson/quiz", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subjectId: id, topicKey: item.key, title: item.title, unit: item.unit, lesson: item.lesson, p0: item.p0, p1: item.p1 }),
    })
      .then(async (r) => {
        const j = await r.json();
        if (!vivo) return;
        if (!r.ok) { setErr(j.error ?? "No pude armar las preguntas."); return; }
        // Limpio al RECIBIR: lo generado se cachea, así que las tandas viejas con
        // LaTeX crudo solo se arreglan del lado de la pantalla.
        setQuiz((j.items ?? []).map(limpiarPregunta));
      })
      .catch(() => { if (vivo) setErr("No hay conexión con el servidor."); })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [id, item?.key]);   // eslint-disable-line react-hooks/exhaustive-deps

  async function corregir() {
    if (!quiz || res || enviando) return;
    setEnviando(true);
    try {
      const r = await fetch("/api/lesson/quiz/submit", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subjectId: id, topicKey: tema, answers: ans }),
      });
      const j = await r.json();
      if (!r.ok) { setErr(j.error ?? "No pude corregir."); return; }
      // La corrección devuelve otra vez pregunta/opciones/explicación: también se
      // pintan, así que también se limpian.
      setRes({ ...j, items: (j.items ?? []).map(limpiarPregunta) });
      setDone((d) => (d.includes(tema) ? d : [...d, tema]));
    } catch { setErr("No hay conexión con el servidor."); }
    finally { setEnviando(false); }
  }

  function repasar(pregunta?: string) {
    if (!item) return;
    const q = pregunta
      ? `En "${item.title}" me equivoqué en esto: "${pregunta}". Explicámelo de nuevo, simple y con un ejemplo, y después preguntame algo parecido para ver si entendí.`
      : `Quiero estudiar: ${item.title}${item.focus ? ` (${item.focus})` : ""}. Enseñámelo desde el principio, paso a paso y con ejemplos.`;
    const p = new URLSearchParams({ q, unit: String(item.unit ?? ""), lesson: String(item.lesson ?? "") });
    router.push(`/materia/${id}/chat?${p}`);
  }

  const volver = () => router.push(`/materia/${id}/camino`);
  const pages = item?.p0 != null ? (item.p1 && item.p1 !== item.p0 ? `págs. ${item.p0}–${item.p1}` : `pág. ${item.p0}`) : "";

  if (!item) {
    return (
      <div style={{ display: "grid", placeItems: "center", padding: 48, color: C.dim }}>
        {plan.length === 0 ? <Dots /> : "No encontré esa lección."}
      </div>
    );
  }

  // La clase está en pantalla mientras exista, no haya terminado y no haya
  // resultado. `clase === null` es "todavía buscando": no se pinta nada, para no
  // hacer parpadear las preguntas y después taparlas con la clase.
  const enClaseVisible = enClase && clase !== null && clase !== false && !res;

  const q = quiz?.[paso];
  const elegida = q ? ans[q.n] : undefined;
  const total = quiz?.length ?? 0;

  return (
    <div style={{ maxWidth: 620, margin: "0 auto", padding: "14px 16px 32px" }}>
      {/* Cabecera de la lección: qué es y dónde está en el libro. */}
      <button onClick={volver}
        style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "none", border: "none", color: C.dim, cursor: "pointer", padding: 0, fontSize: 13, fontFamily: FONT.sans }}>
        ← Volver al camino
      </button>
      <div style={{ fontFamily: FONT.round, fontWeight: 800, fontSize: 20, lineHeight: 1.25, marginTop: 6 }}>
        {item.n}. {item.title}
      </div>
      {item.focus && <div style={{ color: C.dim, fontSize: 13.5, marginTop: 2, lineHeight: 1.4 }}>{item.focus}</div>}
      {pages && <div style={{ fontFamily: FONT.mono, fontSize: 12, color: C.dim, marginTop: 3 }}>{pages}</div>}

      {/* LAS DOS FORMAS DE USAR LA PARADA. Solo aparecen si hay apunte: sin él,
          una pestaña sola no es una elección, es ruido. */}
      {apunte !== null && apunte !== false && (
        <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
          {(["clase", "apunte"] as const).map((v) => (
            <button key={v} onClick={() => setVista(v)}
              style={{ flex: 1, background: vista === v ? C.accent : C.panel, color: vista === v ? "#fff" : C.text, border: `2px solid ${C.ink}`, borderRadius: 11, padding: "9px 12px", fontFamily: FONT.round, fontWeight: 700, fontSize: 13.5, cursor: "pointer" }}>
              {v === "clase" ? "Estudiar y responder" : "Ver el apunte"}
            </button>
          ))}
        </div>
      )}

      {vista === "apunte" && apunte !== null && apunte !== false && (
        <ApunteParada apunte={apunte} titulo={item.title}
          materia={subject ? subjectLabel(subject) : ""} paginas={pages} />
      )}

      {item.points && item.points.length > 0 && !res && !enClaseVisible && vista === "clase" && (
        <div style={{ marginTop: 14, background: C.panel2, border: `1.5px solid ${C.border}`, borderRadius: 12, padding: "11px 13px" }}>
          <div style={{ fontSize: 12, color: C.dim, marginBottom: 6 }}>Cuando termines vas a poder explicar:</div>
          {item.points.map((p, i) => (
            <div key={i} style={{ display: "flex", gap: 7, alignItems: "flex-start", marginTop: i === 0 ? 0 : 4 }}>
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: C.accent, flexShrink: 0, marginTop: 6.5 }} />
              <span style={{ fontSize: 12.5, lineHeight: 1.45 }}>{p}</span>
            </div>
          ))}
        </div>
      )}

      {/* LA CLASE. Va antes que todo lo demás: el alumno lee y recién después
          se le pregunta. Mientras no haya clase generada para esta parada, esto
          no se pinta y la pantalla es la de siempre. */}
      {enClaseVisible && vista === "clase" && (
        <ClaseParada
          clase={clase as Clase}
          onTerminar={() => setEnClase(false)}
          onPreguntar={() => repasar()}
        />
      )}

      {cargando && !enClaseVisible && vista === "clase" && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: C.dim, fontSize: 13.5, padding: "26px 0" }}>
          <Dots /> Armando las preguntas de esta lección…
        </div>
      )}
      {err && (
        <div style={{ marginTop: 14, color: C.badTx, background: C.badBg, border: `1px solid ${C.bad}`, borderRadius: 10, padding: "10px 12px", fontSize: 13 }}>{err}</div>
      )}

      {/* ── DE A UNA ─────────────────────────────────────────────────────── */}
      {quiz && !res && q && !enClaseVisible && vista === "clase" && (
        <div style={{ marginTop: 18 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 7 }}>
            <span style={{ fontFamily: FONT.round, fontWeight: 700, fontSize: 13 }}>Pregunta {paso + 1} de {total}</span>
            <span style={{ fontSize: 12, color: C.dim }}>{Object.keys(ans).length} respondidas</span>
          </div>
          <div style={{ display: "flex", gap: 3, marginBottom: 16 }}>
            {quiz.map((x, i) => (
              <span key={x.n} style={{ flex: 1, height: 6, borderRadius: 3, background: i === paso ? C.accent : ans[x.n] != null ? C.accentSoft : C.panel2, border: `1px solid ${i === paso || ans[x.n] != null ? "transparent" : C.border}` }} />
            ))}
          </div>

          <div style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.4, marginBottom: 12 }}>{q.question}</div>
          <div style={{ display: "grid", gap: 8 }}>
            {q.options.map((o, i) => {
              const sel = elegida === i;
              return (
                <button key={i} onClick={() => setAns((a) => ({ ...a, [q.n]: i }))}
                  style={{ textAlign: "left", background: sel ? C.userBubble : C.panel, border: `2px solid ${sel ? C.accentSoft : C.border}`, borderRadius: 12, padding: "13px 14px", fontSize: 14.5, lineHeight: 1.35, cursor: "pointer", color: C.text }}>
                  {o}
                </button>
              );
            })}
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
            {paso > 0 && (
              <button onClick={() => setPaso((p) => p - 1)}
                style={{ background: C.panel, color: C.text, border: `2px solid ${C.ink}`, borderRadius: 12, padding: "12px 16px", fontFamily: FONT.round, fontWeight: 700, fontSize: 14, cursor: "pointer" }}>
                Anterior
              </button>
            )}
            {paso < total - 1 ? (
              <button onClick={() => setPaso((p) => p + 1)} disabled={elegida == null}
                style={{ flex: 1, background: elegida == null ? C.panel2 : C.accent, color: elegida == null ? C.dim : "#fff", border: `2px solid ${C.ink}`, borderRadius: 12, padding: "12px 16px", fontFamily: FONT.round, fontWeight: 800, fontSize: 15, cursor: elegida == null ? "default" : "pointer" }}>
                Siguiente
              </button>
            ) : (
              <button onClick={corregir} disabled={Object.keys(ans).length < total || enviando}
                style={{ flex: 1, background: Object.keys(ans).length < total ? C.panel2 : C.ok, color: Object.keys(ans).length < total ? C.dim : "#fff", border: `2px solid ${C.ink}`, borderRadius: 12, padding: "12px 16px", fontFamily: FONT.round, fontWeight: 800, fontSize: 15, cursor: Object.keys(ans).length < total ? "default" : "pointer" }}>
                {enviando ? <Dots /> : Object.keys(ans).length < total ? `Faltan ${total - Object.keys(ans).length}` : "Terminar"}
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── RESULTADO ────────────────────────────────────────────────────── */}
      {res && vista === "clase" && (
        <div style={{ marginTop: 18 }}>
          <div style={{ border: `2px solid ${C.ink}`, borderRadius: 16, boxShadow: HARD(aprobado(res.score, res.total) ? C.ok : C.warn), background: aprobado(res.score, res.total) ? C.okBg : C.warnBg, padding: "16px 15px" }}>
            <div style={{ fontFamily: FONT.round, fontWeight: 800, fontSize: 22, color: aprobado(res.score, res.total) ? C.okTx : C.warnTx }}>
              {res.score} de {res.total}
            </div>
            <div style={{ fontSize: 13.5, color: aprobado(res.score, res.total) ? C.okTx : C.warnTx, marginTop: 3, lineHeight: 1.45 }}>
              {aprobado(res.score, res.total)
                ? "Lección dominada 🎉"
                : `Quedaron ${res.items.filter((x) => !x.ok).length} para reforzar${pages ? `, en ${pages}` : ""}.`}
            </div>
          </div>

          {/* Solo lo que falló. Repasar lo que ya sabe es tiempo que no tiene. */}
          {res.items.filter((x) => !x.ok).map((x) => (
            <div key={x.n} style={{ marginTop: 12, border: `1.5px solid ${C.warn}`, background: C.panel, borderRadius: 12, padding: "12px 13px" }}>
              <div style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.4 }}>{x.question}</div>
              <div style={{ fontSize: 13, color: C.okTx, marginTop: 6 }}>Era: {x.options[x.correct]}</div>
              {x.explain && <div style={{ fontSize: 12.5, color: C.dim, marginTop: 4, lineHeight: 1.45 }}>{x.explain}</div>}
              <button onClick={() => repasar(x.question)}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 9, background: C.panel, color: C.text, border: `1.5px solid ${C.ink}`, borderRadius: 9, padding: "7px 11px", fontFamily: FONT.round, fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}>
                <IconChat size={14} /> Repasarlo en el chat
              </button>
            </div>
          ))}

          {/* SEGUIR DE CORRIDO. Sin esto, terminar una lección obliga a volver al
              camino y buscar la próxima, y ahí es donde se corta la sesión. */}
          <div style={{ display: "grid", gap: 8, marginTop: 18 }}>
            {siguiente ? (
              <button onClick={() => router.push(`/materia/${id}/camino/${siguiente.key}`)}
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, textAlign: "left", background: C.accent, color: "#fff", border: `2px solid ${C.ink}`, borderRadius: 14, boxShadow: HARD(C.ink), padding: "14px 15px", cursor: "pointer" }}>
                <span style={{ minWidth: 0 }}>
                  {/* "la siguiente" y no "la {n}": con lecciones anidadas, dos
                      seguidas comparten el número de SU unidad y "Seguir con la
                      2" dos veces al hilo parecía un botón trabado. */}
                  <span style={{ display: "block", fontFamily: FONT.round, fontWeight: 800, fontSize: 15 }}>Seguir con la siguiente</span>
                  <span style={{ display: "block", fontSize: 13, opacity: .85, marginTop: 1, lineHeight: 1.3 }}>{siguiente.title}</span>
                </span>
                <IconArrow size={20} />
              </button>
            ) : (
              <div style={{ textAlign: "center", color: C.dim, fontSize: 13.5, padding: "6px 0" }}>
                Era la última lección del camino. 🎉
              </div>
            )}
            <button onClick={() => { setRes(null); setAns({}); setPaso(0); }}
              style={{ background: C.panel, color: C.text, border: `2px solid ${C.ink}`, borderRadius: 12, padding: "12px 16px", fontFamily: FONT.round, fontWeight: 700, fontSize: 14, cursor: "pointer" }}>
              Volver a intentar
            </button>
            <button onClick={volver}
              style={{ background: "transparent", color: C.dim, border: "none", padding: "8px 0", fontFamily: FONT.round, fontWeight: 600, fontSize: 13.5, cursor: "pointer" }}>
              Volver al camino
            </button>
          </div>
        </div>
      )}

      {/* "No entiendo" está siempre disponible: si se traba en la pregunta 3 no
          tiene que terminar las diez para poder preguntar. */}
      {!res && !enClaseVisible && vista === "clase" && (
        <button onClick={() => repasar()}
          style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 20, background: "transparent", color: C.text, border: `2px solid ${C.ink}`, borderRadius: 11, padding: "10px 14px", fontFamily: FONT.round, fontWeight: 700, fontSize: 13.5, cursor: "pointer" }}>
          <IconChat size={15} /> No entiendo esto
        </button>
      )}

      {done.includes(tema) && !res && !cargando && !enClaseVisible && (
        <div style={{ marginTop: 14, display: "inline-flex", alignItems: "center", gap: 6, color: C.okTx, fontSize: 12.5 }}>
          <IconCheck size={14} /> Ya hiciste esta lección antes
        </div>
      )}
    </div>
  );
}
