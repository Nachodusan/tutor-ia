"use client";
/**
 * UNA PARADA DEL CAMINO — el apunte de esa lección.
 *
 * ⚠️ ACÁ VIVÍAN LA CLASE Y LAS DIEZ PREGUNTAS, y se sacaron a pedido del dueño
 * del producto: la parada ahora es EL APUNTE y nada más. El código de la clase
 * (`clase-parada.tsx`, `/api/lesson/clase`, la tabla `lesson_classes`) y el de
 * las preguntas (`/api/lesson/quiz`) siguen enteros y con sus datos generados —
 * simplemente ya no se entra desde acá. Volver a colgarlos es agregar la pestaña,
 * no reconstruirlos.
 *
 * ⚠️ Y ESO SE LLEVÓ PUESTO LO QUE MARCABA EL AVANCE. Era el submit del quiz el
 * que escribía `student_plan_progress`, así que sin preguntas el camino no
 * avanzaría nunca y la barra de la materia quedaría clavada. Por eso el apunte
 * cierra con "Ya lo estudié": lo dice el alumno, que es la única señal que queda
 * cuando no hay nada que corregir. Es más floja que un 7 de 10 y no se disfraza
 * de otra cosa.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { traerMateria } from "../../../../datos";
import { ApunteParada } from "../../../../apunte-parada";
import { C, FONT, HARD, Dots, IconCheck, IconChat, IconArrow, subjectLabel, ANCHO } from "../../../../ui";
import type { Apunte, PlanItem, Subject } from "../../../../tipos";

export default function LeccionPage() {
  const { id, tema } = useParams<{ id: string; tema: string }>();
  const router = useRouter();
  const [subject, setSubject] = useState<Subject | undefined>();
  const [plan, setPlan] = useState<PlanItem[]>([]);
  const [done, setDone] = useState<string[]>([]);
  /** `false` = esta parada no puede tener apunte (sin texto en el libro). */
  const [apunte, setApunte] = useState<Apunte | null | false>(null);
  const [apunteErr, setApunteErr] = useState("");
  const [marcando, setMarcando] = useState(false);
  /**
   * ⚠️ UNA SOLA GENERACIÓN POR PARADA. En StrictMode el efecto corre DOS veces, y
   * como la primera visita de cada parada genera el apunte con el modelo, eso son
   * dos generaciones simultáneas del mismo apunte: se duplica el gasto y encima
   * compiten entre sí — medido, una tardó 92 s y la otra se pasó del límite de
   * 120 s y se perdió. El ref recuerda para qué clave ya se pidió.
   */
  const pedido = useRef<string | null>(null);

  /**
   * EL PLAN, APLANADO A PASOS ABRIBLES. Desde que el camino es de UNIDADES, las
   * claves de lección viven ANIDADAS en `item.lecciones` — buscar solo en el
   * nivel de arriba terminaba en "No encontré esa lección" al tocar cualquier
   * moneda del camino.
   */
  const pasos = useMemo(() => plan.flatMap((p) =>
    p.lecciones?.length
      ? p.lecciones.map((l) => ({ ...p, key: l.key, title: l.title, p0: l.p0, p1: l.p1, unit: l.unit, lesson: l.lesson, lecciones: undefined }))
      : [p]
  ), [plan]);
  const item = useMemo(
    () => plan.find((p) => p.key === tema) ?? pasos.find((p) => p.key === tema),
    [plan, pasos, tema],
  );
  const idx = useMemo(() => pasos.findIndex((p) => p.key === tema), [pasos, tema]);

  /**
   * EL NÚMERO DE ESTA PARADA — "1", "1.3", "2.1"…
   *
   * ⚠️ ACÁ SE MOSTRABA `item.n`, QUE ES EL NÚMERO DE LA UNIDAD. Como las
   * lecciones heredan el ítem de su unidad al aplanarse, TODAS las lecciones de
   * la unidad 2 se anunciaban como "2." — abrir tres lecciones seguidas mostraba
   * "2. …", "2. …", "2. …" y no había forma de saber en cuál estabas. Es la misma
   * numeración que ahora pinta el camino, para que las dos pantallas digan lo
   * mismo.
   */
  const numero = useMemo(() => {
    const u = plan.findIndex((p) => p.key === tema);
    if (u >= 0) return String(u + 1);            // es el nodo de una unidad
    for (let i = 0; i < plan.length; i++) {
      const j = (plan[i]!.lecciones ?? []).findIndex((l) => l.key === tema);
      if (j >= 0) return `${i + 1}.${j + 1}`;
    }
    return item?.n != null ? String(item.n) : "";
  }, [plan, tema, item?.n]);
  /** Para una clave de UNIDAD, "la siguiente" es SU primera lección. */
  const siguiente = useMemo(() => {
    if (idx >= 0) return pasos[idx + 1];
    const u = plan.find((p) => p.key === tema);
    return u?.lecciones?.length ? pasos.find((p) => p.key === u.lecciones![0]!.key) : undefined;
  }, [idx, pasos, plan, tema]);

  useEffect(() => { void traerMateria(id).then(setSubject); }, [id]);

  /**
   * EL PLAN — de acá sale la lección que se está abriendo.
   *
   * ⚠️ SIN ESTO LA PANTALLA QUEDA EN BLANCO. `item` se busca dentro de `plan`, y
   * con `plan` vacío el componente cae en su rama `!item`, que pinta los tres
   * puntitos de "cargando" para siempre: sin error, sin cartel, sin nada. Ya se
   * borró una vez al reacomodar los efectos de al lado, y el síntoma fue una
   * parada muda — la peor forma de romper algo, porque parece lentitud.
   */
  useEffect(() => {
    fetch(`/api/plan?subjectId=${id}`).then((r) => r.json())
      .then((j) => { setPlan(j.items ?? []); setDone(j.doneKeys ?? []); })
      .catch(() => setPlan([]));
  }, [id]);

  /**
   * El apunte. Se pide al ABRIR la parada porque ahora es lo único que hay acá:
   * cuando había pestañas se esperaba al clic para no gastar una llamada al
   * modelo en algo que quizá no se miraba, pero si es la pantalla entera, no
   * pedirlo es dejarla vacía.
   *
   * La primera visita de cada parada paga la generación; después sale de la
   * tabla y es instantánea para todos.
   */
  useEffect(() => {
    if (!item || pedido.current === item.key) return;
    pedido.current = item.key;
    let vivo = true;
    setApunte(null); setApunteErr("");
    fetch("/api/lesson/apunte", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subjectId: id, topicKey: item.key, title: item.title, p0: item.p0, p1: item.p1 }),
    })
      .then(async (r) => {
        const j = await r.json();
        if (!vivo) return;
        if (!r.ok || !j.apunte?.puntos?.length) {
          setApunte(false);
          // El MOTIVO importa: "esta parte son puras imágenes" y "probá de nuevo"
          // piden cosas distintas del alumno.
          setApunteErr(
            j.error === "sin_material" || j.error === "sin_paginas" || j.error === "sin_libro"
              ? "Esta parte del libro no la tengo en texto (son puras imágenes o el escaneo salió mal), así que no puedo armar el apunte."
              : "No pude armar el apunte ahora. Probá de nuevo en un momento.",
          );
          return;
        }
        setApunte(j.apunte);
      })
      .catch(() => { if (vivo) { setApunte(false); setApunteErr("No hay conexión con el servidor."); } })
      // Falló: se libera la clave para que "Probar de nuevo" pueda reintentar.
      .finally(() => { if (vivo) setApunte((a) => { if (a === false) pedido.current = null; return a; }); });
    return () => { vivo = false; };
  }, [id, item?.key]);   // eslint-disable-line react-hooks/exhaustive-deps

  /** "Ya lo estudié" — la única señal de avance que queda sin preguntas. */
  async function marcarHecho() {
    if (!item || marcando || done.includes(tema)) return;
    setMarcando(true);
    try {
      const r = await fetch("/api/plan/progress", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subjectId: id, topicKey: item.key, done: true }),
      });
      const j = await r.json();
      if (r.ok) setDone(j.doneKeys ?? [...done, tema]);
    } catch { /* que reintente */ }
    finally { setMarcando(false); }
  }

  /** "No entiendo esto": al chat con el tema cargado y estudio dirigido. */
  function preguntar() {
    if (!item) return;
    const q = `Estoy estudiando "${item.title}"${item.focus ? ` (${item.focus})` : ""} y hay algo que no me cierra. Explicámelo desde el principio, simple y con un ejemplo.`;
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

  const hecho = done.includes(tema);
  /**
   * EL FONDO DICE EN QUÉ NIVEL ESTÁS.
   *
   * Una parada principal —la unidad 1, la 2, la 3— llega con el fondo COBALTO
   * apagado; sus lecciones (1.1, 1.2) llegan con el papel neutro de siempre.
   *
   * El color no es decorativo: es el MISMO cobalto que en el camino significa
   * "unidad", así que el alumno que viene de tocar el nodo grande reconoce el
   * mismo mundo, y el que baja a una lección ve que bajó un nivel sin leer
   * ningún número. Es la señal que el número solo puede dar leyéndolo.
   *
   * `esPrincipal` se deduce del PLAN y no del formato del número: una parada es
   * principal si figura en el nivel de arriba, punto.
   */
  const esPrincipal = plan.some((p) => p.key === tema);

  /**
   * EL FONDO ES EL PAPEL PUNTEADO DEL CAMINO, en el color del nivel.
   *
   * El lienzo del camino es papel punteado (`radial-gradient` cada 26 px). Traer
   * esa MISMA textura acá es lo que hace que la parada se sienta un zoom del
   * camino y no otra pantalla: el alumno tocó una moneda y siguió sobre el mismo
   * papel. Un color plano no dice eso; dice "cambiaste de pantalla".
   *
   * El degradado va de más saturado arriba a casi nada abajo. No es decorativo:
   * concentra el peso donde está la baldosa del número —que es lo que hay que
   * mirar primero— y lo suelta donde empieza la hoja, para que la hoja no pelee
   * con el fondo por la atención.
   *
   * Los dos niveles comparten la textura y se separan por el TONO: cobalto para
   * la unidad, el neutro cálido de la app para la lección. Misma familia,
   * distinto peldaño.
   */
  const fondo = esPrincipal
    ? {
        backgroundColor: "#EEF1FF",
        backgroundImage:
          `radial-gradient(rgba(43,68,255,.16) 1.5px, transparent 1.5px), ` +
          `linear-gradient(180deg, #D9E1FF 0%, #EAEEFF 42%, #F6F8FF 100%)`,
      }
    : {
        backgroundColor: C.bg,
        backgroundImage:
          `radial-gradient(rgba(94,87,105,.13) 1.5px, transparent 1.5px), ` +
          `linear-gradient(180deg, ${C.panel2} 0%, #FAF8F4 46%, ${C.bg} 100%)`,
      };

  return (
    <div style={{
      ...fondo,
      backgroundSize: "26px 26px, 100% 100%",
      // El degradado NO se repite con los puntos: sin esto, el `backgroundSize`
      // de 26 px se le aplica también y el fondo sale a rayas.
      backgroundRepeat: "repeat, no-repeat",
      backgroundAttachment: "local, local",
      minHeight: "100%", transition: "background-color .2s",
    }}>
    <div style={{ maxWidth: ANCHO.lectura, margin: "0 auto", padding: "14px 16px 32px" }}>
      {/* Cabecera: qué es y dónde está en el libro. */}
      <button onClick={volver}
        style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "none", border: "none", color: C.dim, cursor: "pointer", padding: 0, fontSize: 13, fontFamily: FONT.sans }}>
        ← Volver al camino
      </button>
      {/* LA CABECERA: el número como PIEZA, no como prefijo del título.
          Antes era "1. Evolución y registro fósil" en una sola línea, y el
          número se perdía adentro del texto — que es justo lo que había que
          destacar. Ahora es una baldosa cobalto con borde de tinta y sombra
          dura: el mismo idioma de Bloques que usan los nodos del camino, para
          que el alumno reconozca el "1" de la pantalla anterior. */}
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start", marginTop: 10 }}>
        {numero && (
          <span style={{
            flexShrink: 0, minWidth: 46, height: 46, padding: "0 9px",
            display: "grid", placeItems: "center", borderRadius: 13,
            background: C.accent, color: "#fff", border: `2px solid ${C.ink}`,
            boxShadow: HARD(C.ink), fontFamily: FONT.round, fontWeight: 800,
            // El cuerpo cede con el largo: "3.1.1" no entra al tamaño de "1".
            fontSize: numero.length <= 1 ? 24 : numero.length <= 3 ? 19 : 15,
            fontVariantNumeric: "tabular-nums", letterSpacing: -0.5,
          }}>{numero}</span>
        )}
        <span style={{ minWidth: 0, paddingTop: 2 }}>
          <span style={{ display: "block", fontFamily: FONT.round, fontWeight: 800, fontSize: 21, lineHeight: 1.2, textWrap: "balance" }}>
            {item.title}
          </span>
          {item.focus && <span style={{ display: "block", color: C.dim, fontSize: 13.5, marginTop: 3, lineHeight: 1.4 }}>{item.focus}</span>}
          {pages && <span style={{ display: "block", fontFamily: FONT.mono, fontSize: 11.5, color: C.dim, marginTop: 3 }}>{pages}</span>}
        </span>
      </div>

      {apunte === null && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: C.dim, fontSize: 13.5, padding: "30px 0" }}>
          <Dots /> Armando el apunte de esta lección…
        </div>
      )}

      {apunte === false && (
        <div style={{ marginTop: 16, color: C.warnTx, background: C.warnBg, border: `1px solid ${C.warn}`, borderRadius: 12, padding: "12px 14px", fontSize: 13.5, lineHeight: 1.55 }}>
          {apunteErr}
          <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
            {/* Reintentar solo cuando el fallo es del modelo. Si el libro no
                tiene texto en estas páginas, reintentar no arregla nada y el
                botón sería una promesa falsa. */}
            {!/no la tengo en texto/.test(apunteErr) && (
              <button onClick={() => { pedido.current = null; setApunte(null); }}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, background: C.panel, color: C.text, border: `1.5px solid ${C.ink}`, borderRadius: 10, padding: "8px 12px", fontFamily: FONT.round, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
                Probar de nuevo
              </button>
            )}
            <button onClick={preguntar}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, background: C.panel, color: C.text, border: `1.5px solid ${C.ink}`, borderRadius: 10, padding: "8px 12px", fontFamily: FONT.round, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
              <IconChat size={14} /> Preguntarle al tutor
            </button>
          </div>
        </div>
      )}

      {apunte !== null && apunte !== false && (
        <ApunteParada apunte={apunte} titulo={item.title} numero={numero}
          materia={subject ? subjectLabel(subject) : ""} paginas={pages} />
      )}

      {/* ── EL PIE ──────────────────────────────────────────────────────────
          Las dos cosas que la pantalla de preguntas daba y que no se pueden
          perder: marcar el avance y SEGUIR DE CORRIDO. Sin lo segundo, terminar
          una lección obliga a volver al camino y buscar la próxima, y ahí es
          donde se corta la sesión. */}
      <div style={{ display: "grid", gap: 8, marginTop: 20 }}>
        <button onClick={marcarHecho} disabled={hecho || marcando}
          style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 7, background: hecho ? C.okBg : C.ok, color: hecho ? C.okTx : "#fff", border: `2px solid ${hecho ? C.ok : C.ink}`, borderRadius: 12, padding: "12px 16px", fontFamily: FONT.round, fontWeight: 800, fontSize: 15, cursor: hecho ? "default" : "pointer" }}>
          {marcando ? <Dots /> : <><IconCheck size={16} /> {hecho ? "Ya lo estudiaste" : "Ya lo estudié"}</>}
        </button>

        {siguiente ? (
          <button onClick={() => router.push(`/materia/${id}/camino/${siguiente.key}`)}
            style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, textAlign: "left", background: C.accent, color: "#fff", border: `2px solid ${C.ink}`, borderRadius: 14, boxShadow: HARD(C.ink), padding: "14px 15px", cursor: "pointer" }}>
            <span style={{ minWidth: 0 }}>
              {/* "la siguiente" y no "la {n}": con lecciones anidadas, dos
                  seguidas comparten el número de SU unidad y "Seguir con la 2"
                  dos veces al hilo parecía un botón trabado. */}
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

        {apunte !== null && apunte !== false && (
          <button onClick={preguntar}
            style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, background: "transparent", color: C.text, border: `2px solid ${C.ink}`, borderRadius: 11, padding: "10px 14px", fontFamily: FONT.round, fontWeight: 700, fontSize: 13.5, cursor: "pointer" }}>
            <IconChat size={15} /> No entiendo algo de esto
          </button>
        )}
      </div>
    </div>
    </div>
  );
}
