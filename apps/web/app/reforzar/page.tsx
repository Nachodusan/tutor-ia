"use client";
/**
 * REFORZAR — los temas que se le escaparon al alumno, materia por materia.
 *
 * Pantalla propia y no una sección al pie del panel: mezclada ahí abajo, el que
 * venía a reforzar tenía que pasar por arriba de todo lo demás para llegar.
 *
 * DOS DECISIONES QUE LA HACEN LEGIBLE PARA UN CHICO DE 12:
 *
 * 1. Están TODAS las materias del curso, no solo las que tienen algo fallado.
 *    Con la lista filtrada, un chico que rindió una sola prueba veía una sola
 *    materia y no podía saber si las otras estaban bien o si el tutor no las
 *    conocía. Las que no tienen nada dicen "al día", que es una respuesta.
 * 2. Es un ACORDEÓN: una materia abierta por vez. Nueve temas de Biología más
 *    los de las otras cuatro materias, todos desplegados, son una pared de
 *    treinta renglones iguales — que es exactamente lo "engorroso" que había.
 *    Abre sola la que más lo necesita, así la pantalla nunca arranca muda.
 *
 * No tiene ruta de API propia: los temas débiles ya vienen en `/api/progress`.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PanelShell, PanelNav, WeakCard, contarReforzar, Centered } from "../panel";
import {
  C, FONT, HARD, Dots, IconBook, IconCheck, IconChevron, IconLock,
  subjectColor, subjectLabel, isLight,
} from "../ui";
import { CLASE_HUECO_RELOJ } from "../pomodoro";
import { cursoBloqueado } from "@/lib/cursos";
import { useAlumno, cerrarSesion } from "../usar-alumno";
import type { Subject, WeakTopic } from "../tipos";

export default function ReforzarPage() {
  const router = useRouter();
  const { loaded, profile, subjects, stats, role } = useAlumno();
  // `null` = todavía no tocó nada (manda la que abre sola); "" = las cerró todas.
  const [elegida, setElegida] = useState<string | null>(null);

  useEffect(() => {
    if (loaded && (!profile || cursoBloqueado(profile.grade))) router.replace("/");
  }, [loaded, profile, router]);

  if (!loaded || !profile) return <Centered><span style={{ color: C.dim }}><Dots /></span></Centered>;

  const temasDe = (s: Subject): WeakTopic[] => stats[s.id]?.weak ?? [];
  const fallosDe = (s: Subject) => temasDe(s).reduce((n, w) => n + w.misses, 0);

  // TODAS las del curso: primero las que tienen algo para reforzar (la que más
  // pesa arriba), después las que están al día, y al final las que están en
  // pausa — que no se pueden abrir, pero tampoco desaparecen.
  const delCurso = subjects
    .filter((s) => s.grade === profile.grade)
    .sort((a, b) =>
      Number(!!a.disabled) - Number(!!b.disabled) ||
      Number(temasDe(b).length > 0) - Number(temasDe(a).length > 0) ||
      fallosDe(b) - fallosDe(a) ||
      subjectLabel(a).localeCompare(subjectLabel(b)));

  // Lo fallado en materias de OTRO curso (el alumno pudo rendir una prueba ahí)
  // no se tira: se muestra aparte y dicho, en vez de desaparecer sin aviso.
  const deOtroCurso = subjects
    .filter((s) => s.grade !== profile.grade && !s.disabled && temasDe(s).length > 0)
    .sort((a, b) => fallosDe(b) - fallosDe(a));

  const total = contarReforzar(subjects, stats);
  const conTemas = [...delCurso, ...deOtroCurso].filter((s) => temasDe(s).length > 0).length;
  const alDia = delCurso.filter((s) => !s.disabled && temasDe(s).length === 0).length;

  // La que abre sola: la primera con temas. Sin esto la pantalla arranca con
  // todo cerrado y hay que adivinar dónde tocar.
  const primera = [...delCurso, ...deOtroCurso].find((s) => temasDe(s).length > 0)?.id ?? null;
  const abierta = elegida === null ? primera : elegida || null;

  function reforzar(id: string, w: WeakTopic) {
    const q = `Quiero repasar: ${w.topic}. Explicámelo simple, desde el principio y con un ejemplo.`;
    const p = new URLSearchParams({ q, unit: String(w.unit ?? ""), lesson: String(w.lesson ?? "") });
    router.push(`/materia/${id}/chat?${p}`);
  }

  const fila = (s: Subject) => (
    <FilaMateria key={s.id} s={s} temas={temasDe(s)} abierta={abierta === s.id}
      onAbrir={() => setElegida(abierta === s.id ? "" : s.id)}
      onReforzar={(w) => reforzar(s.id, w)} />
  );

  return (
    <PanelShell nav={
      <PanelNav profile={profile} pendientes={total}
        teacher={role === "teacher" || role === "admin"}
        onEdit={() => router.push("/?editar=1")}
        onLogout={() => { void cerrarSesion().then(() => router.replace("/login")); }} />
    }>
      <header className={CLASE_HUECO_RELOJ} style={{ marginBottom: 18 }}>
        <div style={{ fontFamily: FONT.round, fontSize: 24, fontWeight: 800, letterSpacing: -0.3 }}>Para reforzar</div>
        <p style={{ color: C.dim, fontSize: 14, lineHeight: 1.5, margin: "3px 0 0", maxWidth: 560 }}>
          Lo que se te escapó en las pruebas. Tocá una materia para ver sus temas.
        </p>
      </header>

      {/* EL RESUMEN, en números grandes. Un chico tiene que poder saber si está
          bien o mal sin leer una lista: el número manda, la frase explica. */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", background: total > 0 ? C.warnBg : C.okBg, border: `2px solid ${C.ink}`, borderRadius: 18, boxShadow: HARD(total > 0 ? C.sun : C.ok), padding: "16px 18px", marginBottom: 26 }}>
        <span style={{ fontSize: 30, lineHeight: 1 }}>{total > 0 ? "🎯" : "🎉"}</span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: FONT.round, fontWeight: 800, fontSize: 18, color: total > 0 ? C.warnTx : C.okTx }}>
            {total > 0
              ? `${total} ${total === 1 ? "tema para afirmar" : "temas para afirmar"}`
              : "¡Estás al día!"}
          </div>
          <div style={{ color: C.dim, fontSize: 13.5, lineHeight: 1.5 }}>
            {/* "Empezá por la de más arriba" SOLO cuando es verdad: si lo único
                fallado está en una materia de otro curso, la de más arriba está
                al día y el consejo manda al chico al lugar equivocado. */}
            {total > 0
              ? <>En {conTemas} {conTemas === 1 ? "materia" : "materias"}{alDia > 0 && <> · las otras {alDia} están al día</>}.{!!delCurso[0] && temasDe(delCurso[0]).length > 0 && " Empezá por la de más arriba."}</>
              : <>No fallaste nada en tus pruebas. Cuando algo se te escape, va a aparecer acá.</>}
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gap: 10, marginBottom: 30 }}>
        {delCurso.map(fila)}
        {delCurso.length === 0 && (
          <p style={{ color: C.dim, fontSize: 14 }}>
            Todavía no hay materias cargadas para tu curso.
          </p>
        )}
      </div>

      {deOtroCurso.length > 0 && (
        <>
          <div style={{ color: C.dim, fontFamily: FONT.round, fontWeight: 700, fontSize: 12, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 10 }}>
            De otros cursos
          </div>
          <p style={{ color: C.dim, fontSize: 13, lineHeight: 1.5, margin: "0 0 12px", maxWidth: 560 }}>
            Rendiste pruebas de materias que no son de {profile.grade ? "tu curso" : "este curso"}. Lo que fallaste ahí también cuenta.
          </p>
          <div style={{ display: "grid", gap: 10, marginBottom: 34 }}>
            {deOtroCurso.map(fila)}
          </div>
        </>
      )}
    </PanelShell>
  );
}

/**
 * UNA MATERIA: la cabecera siempre, los temas cuando está abierta.
 *
 * La cabecera dice el estado con TRES señales a la vez —color, ícono y
 * palabra— porque se lee de reojo: cuadrito de color con candado/tilde/libro,
 * la chapa ("9 para reforzar" · "Al día" · "En pausa") y el nombre.
 */
function FilaMateria({ s, temas, abierta, onAbrir, onReforzar }: {
  s: Subject; temas: WeakTopic[]; abierta: boolean; onAbrir: () => void; onReforzar: (w: WeakTopic) => void;
}) {
  const off = !!s.disabled;
  const hayQue = temas.length > 0;
  const col = off ? C.border : subjectColor(s);
  const onCol = isLight(col) ? C.ink : "#fff";
  // Solo se abre lo que tiene algo adentro: un acordeón que se despliega vacío
  // enseña que abrir no sirve.
  const abrible = hayQue && !off;

  return (
    <div style={{ background: C.panel, border: `2px solid ${off ? C.border : C.ink}`, borderRadius: 16, boxShadow: abierta ? HARD(col) : "none", overflow: "hidden", transition: "box-shadow .15s" }}>
      <button onClick={abrible ? onAbrir : undefined} disabled={!abrible}
        title={off ? "Esta materia está en pausa" : abrible ? (abierta ? "Cerrar" : "Ver los temas") : "Nada para reforzar acá"}
        style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", background: "none", border: "none", padding: "13px 15px", cursor: abrible ? "pointer" : "default", font: "inherit", textAlign: "left", color: off ? C.dim : C.text }}>
        <span style={{ width: 36, height: 36, flexShrink: 0, borderRadius: 11, background: off ? C.panel2 : col, color: off ? C.dim : onCol, display: "grid", placeItems: "center" }}>
          {off ? <IconLock size={17} /> : hayQue ? <IconBook size={19} /> : <IconCheck size={19} />}
        </span>

        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "block", fontFamily: FONT.round, fontWeight: 800, fontSize: 16.5, lineHeight: 1.25 }}>
            {subjectLabel(s)}
          </span>
          <span style={{ display: "block", color: C.dim, fontSize: 12.5, marginTop: 1 }}>
            {off ? "En pausa · vuelve más adelante"
              : hayQue ? (abierta ? "Tocá un tema y te lo explico" : "Tocá para ver los temas")
                : "Nada que reforzar por acá"}
          </span>
        </span>

        <span style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 10 }}>
          {!off && (
            hayQue ? (
              <span style={{ background: C.badBg, color: C.badTx, borderRadius: 999, padding: "4px 11px", fontFamily: FONT.round, fontWeight: 800, fontSize: 12.5, whiteSpace: "nowrap" }}>
                {temas.length} para reforzar
              </span>
            ) : (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5, background: C.okBg, color: C.okTx, borderRadius: 999, padding: "4px 11px", fontFamily: FONT.round, fontWeight: 800, fontSize: 12.5, whiteSpace: "nowrap" }}>
                <IconCheck size={12} /> Al día
              </span>
            )
          )}
          {abrible && (
            <span style={{ display: "flex", color: C.dim, transform: abierta ? "rotate(90deg)" : "none", transition: "transform .18s" }}>
              <IconChevron size={17} />
            </span>
          )}
        </span>
      </button>

      {abierta && abrible && (
        <div style={{ display: "grid", gap: 9, padding: "2px 15px 15px" }}>
          {temas.map((w) => (
            <WeakCard key={w.topicKey} s={s} w={w} onClick={() => onReforzar(w)} />
          ))}
        </div>
      )}
    </div>
  );
}
