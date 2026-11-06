"use client";
/**
 * TU RESUMEN — lo que el alumno lleva hecho y lo que ya le sale.
 *
 * Es la pantalla que en algún momento se va a juntar con "Reforzar": fortalezas
 * y debilidades del mismo alumno, en un solo lugar. Por ahora muestra la mitad
 * que se puede sostener con datos —lo hecho y lo aprobado— y deja lo que falla
 * donde ya vive, a un toque.
 *
 * ⚠️ LA REGLA DE "FORTALEZA" ES PROVISORIA Y ESTÁ ESCRITA EN LA PANTALLA. Hoy
 * un tema cuenta como fuerte cuando el alumno aprobó su chequeo (dos tercios) y
 * no lo tiene pendiente de refuerzo. No alcanza para decir "sos bueno en la
 * célula" —diez preguntas de opción múltiple un martes no son dominio— y por eso
 * la pantalla dice de dónde sale el dato en vez de dar un veredicto. La
 * definición fuerte se decide aparte; cuando llegue, cambia `/api/resumen` y
 * esta pantalla no se entera.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PanelShell, PanelNav, contarReforzar, Centered } from "../panel";
import {
  C, FONT, HARD, Dots, IconCheck, IconAlert, IconReforzar, IconArrow, IconBook,
  subjectColor, subjectLabel, isLight,
} from "../ui";
import { CLASE_HUECO_RELOJ } from "../pomodoro";
import { cursoBloqueado } from "@/lib/cursos";
import { useAlumno, cerrarSesion } from "../usar-alumno";

interface ResumenPaso { key: string; n: number; title: string; done: boolean; doneAt: string | null }
interface ResumenMateria {
  id: string; name: string; grade: string | null;
  planDone: number; planTotal: number;
  pasos: ResumenPaso[];
  fuertes: { topicKey: string; topic: string; score: number; total: number }[];
  pendientes: number;
  lastScore: { score: number; total: number } | null;
}
interface Resumen {
  hechas: { lecciones: number; chequeos: number; pruebas: number };
  materias: ResumenMateria[];
  huerfanos: number;
}

export default function ResumenPage() {
  const router = useRouter();
  const { loaded, profile, subjects, stats } = useAlumno();
  const [datos, setDatos] = useState<Resumen | null>(null);

  useEffect(() => {
    if (loaded && (!profile || cursoBloqueado(profile.grade))) router.replace("/");
  }, [loaded, profile, router]);

  useEffect(() => {
    fetch("/api/resumen").then((r) => (r.ok ? r.json() : null)).then(setDatos)
      .catch(() => { /* la pantalla muestra ceros */ });
  }, []);

  if (!loaded || !profile) return <Centered><span style={{ color: C.dim }}><Dots /></span></Centered>;

  const hechas = datos?.hechas ?? { lecciones: 0, chequeos: 0, pruebas: 0 };
  /**
   * SOLO LAS MATERIAS DE SU CURSO. Un alumno cursa UN año, y punto.
   *
   * Acá había una excepción —"las de otro curso también, si hizo algo ahí"— y
   * producía una sección "De otros cursos" con Física 1º y Biología 1º colgando
   * de un alumno de 4º Medio. La excepción se apoyaba en un caso que no existe:
   * el alumno no cursa dos años a la vez, y si tiene trabajo registrado en otro
   * curso es porque se equivocó de año al arrancar o porque cambió de curso —
   * dos cosas que se arreglan en el perfil, no mostrándole materias que no son
   * suyas.
   *
   * Es además la regla que ya usan el panel (`panel.tsx:382`) y el perfil
   * (`perfil/page.tsx:60`), los dos con este mismo `===`. Esta pantalla era la
   * única que se salía, y por eso el panel decía "5 materias" y el resumen
   * listaba siete.
   */
  const materias = (datos?.materias ?? []).filter((m) => m.grade === profile.grade);
  const fuertes = materias.flatMap((m) => m.fuertes.map((f) => ({ m, f })));
  const pendientes = contarReforzar(subjects, stats, profile.grade);

  return (
    <PanelShell nav={
      <PanelNav profile={profile} pendientes={pendientes}
        onEdit={() => router.push("/?editar=1")}
        onLogout={() => { void cerrarSesion().then(() => router.replace("/login")); }} />
    }>
      <header className={CLASE_HUECO_RELOJ} style={{ marginBottom: 22 }}>
        <div style={{ fontFamily: FONT.round, fontSize: 24, fontWeight: 800, letterSpacing: -0.3 }}>Tu resumen</div>
        <p style={{ color: C.dim, fontSize: 14, lineHeight: 1.5, margin: "3px 0 0", maxWidth: 560 }}>
          Todo lo que llevás hecho, y lo que ya te sale.
        </p>
      </header>

      {/* ── TODO EL CAMINO, DE UN VISTAZO ─────────────────────────────────── */}
      <AvanceTotal materias={materias} />

      {/* ── LO HECHO ──────────────────────────────────────────────────────
          Tres números y nada más. Son cuentas de filas que existen: lecciones
          terminadas, chequeos respondidos, pruebas rendidas. Nada de "minutos
          de estudio" ni "días activo": eso mide asistencia, no trabajo. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 30 }}>
        <Numero n={hechas.lecciones} que={hechas.lecciones === 1 ? "lección terminada" : "lecciones terminadas"} color={C.accent} />
        <Numero n={hechas.chequeos} que={hechas.chequeos === 1 ? "chequeo respondido" : "chequeos respondidos"} color={C.accentSoft} />
        <Numero n={hechas.pruebas} que={hechas.pruebas === 1 ? "prueba rendida" : "pruebas rendidas"} color={C.coral} />
      </div>

      {/* ── LO QUE TE SALE ────────────────────────────────────────────────── */}
      <Titulo>Lo que ya te sale</Titulo>
      {fuertes.length > 0 ? (
        <>
          <p style={{ color: C.dim, fontSize: 13.5, lineHeight: 1.5, margin: "0 0 14px", maxWidth: 560 }}>
            Temas donde aprobaste el chequeo y no te quedó nada pendiente.
          </p>
          <div style={{ display: "grid", gap: 10, marginBottom: 32 }}>
            {fuertes.map(({ m, f }) => (
              <div key={`${m.id}-${f.topicKey}`}
                style={{ display: "flex", alignItems: "center", gap: 12, background: C.panel, border: `2px solid ${C.ink}`, borderRadius: 14, boxShadow: HARD(C.ok), padding: "11px 14px" }}>
                <span style={{ width: 30, height: 30, flexShrink: 0, borderRadius: 10, background: C.okBg, color: C.okTx, display: "grid", placeItems: "center", border: `1.5px solid ${C.ok}` }}>
                  <IconCheck size={16} />
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontFamily: FONT.round, fontWeight: 700, fontSize: 15, lineHeight: 1.3 }}>{f.topic}</span>
                  <span style={{ display: "block", color: C.dim, fontSize: 12.5, marginTop: 1 }}>
                    {subjectLabel(m)} · {f.score} de {f.total} en el chequeo
                  </span>
                </span>
              </div>
            ))}
          </div>
        </>
      ) : (
        // VACÍO QUE EXPLICA CÓMO SE LLENA. Un "todavía nada" a secas deja al
        // chico sin saber si le falta hacer algo o si la pantalla está rota.
        <div style={{ background: C.panel2, border: `1.5px solid ${C.border}`, borderRadius: 16, padding: "20px 22px", maxWidth: 560, marginBottom: 32 }}>
          <div style={{ fontFamily: FONT.round, fontWeight: 800, fontSize: 16 }}>Todavía no hay nada acá</div>
          <p style={{ color: C.dim, fontSize: 13.5, lineHeight: 1.55, margin: "6px 0 0" }}>
            Un tema aparece cuando <strong style={{ color: C.text }}>aprobás su chequeo</strong> —las
            preguntas del final de una lección— y no te queda pendiente. Terminá una lección del
            camino y probá las preguntas.
          </p>
        </div>
      )}

      {/* ── MATERIA POR MATERIA ───────────────────────────────────────────── */}
      <Titulo>Materia por materia</Titulo>
      <div style={{ display: "grid", gap: 10, marginBottom: 34 }}>
        {materias.map((m) => <FilaMateria key={m.id} m={m} onReforzar={() => router.push("/reforzar")} />)}
        {materias.length === 0 && (
          <p style={{ color: C.dim, fontSize: 14 }}>Todavía no hay materias cargadas para tu curso.</p>
        )}
      </div>
    </PanelShell>
  );
}

/**
 * EL AVANCE TOTAL — todo el camino del alumno en una sola tira.
 *
 * Arriba había tres números sueltos (lecciones, chequeos, pruebas) y ninguno
 * contestaba "¿cuánto me falta?". Esto sí, y con la misma pieza que las filas de
 * abajo: un segmento por paso, agrupados por materia y con su color. La pantalla
 * queda leyéndose como una sola cosa —el total arriba, el detalle abajo— en vez
 * de dos aparatos que no se hablan.
 *
 * ⚠️ NO ES UN PORCENTAJE SOLO. El número se dice completo ("3 de 41 pasos")
 * porque un 7% no le dice nada a alguien que empieza: 41 pasos sí, son
 * contables y se ven en la tira. El porcentaje va al lado, chico.
 *
 * ⚠️ Y NO SE ORDENA POR AVANCE. Las materias van en el orden en que aparecen
 * abajo: si acá se reordenaran por porcentaje, la misma materia estaría en dos
 * lugares distintos de la misma pantalla.
 */
function AvanceTotal({ materias }: { materias: ResumenMateria[] }) {
  const conPasos = materias.filter((m) => (m.pasos ?? []).length > 0);
  const total = conPasos.reduce((n, m) => n + m.pasos.length, 0);
  if (total === 0) return null;
  const hechos = conPasos.reduce((n, m) => n + m.pasos.filter((p) => p.done).length, 0);
  const pct = Math.round((hechos / total) * 100);

  return (
    <div style={{ minWidth: 0, background: C.panel, border: `2px solid ${C.ink}`, borderRadius: 16, boxShadow: HARD(C.accent), padding: "16px 18px", marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontFamily: FONT.round, fontWeight: 800, fontSize: 15 }}>Todo tu camino</span>
        <span style={{ marginLeft: "auto", fontFamily: FONT.round, fontWeight: 800, fontSize: 20, letterSpacing: -0.3, color: hechos > 0 ? C.text : C.dim }}>
          {hechos} <span style={{ fontSize: 14, fontWeight: 700, color: C.dim }}>de {total} pasos</span>
        </span>
        {hechos > 0 && (
          <span style={{ fontFamily: FONT.round, fontWeight: 800, fontSize: 13, color: C.accent }}>{pct}%</span>
        )}
      </div>

      {/* Un grupo por materia, separados por un hueco más grande que el que hay
          entre pasos: sin eso, 41 segmentos seguidos se leen como una sola
          barra y se pierde de qué materia es cada tramo. */}
      <div style={{ display: "flex", gap: 7, marginTop: 12 }}>
        {conPasos.map((m) => {
          const col = subjectColor(m);
          return (
            <span key={m.id} title={`${subjectLabel(m)} — ${m.pasos.filter((p) => p.done).length} de ${m.pasos.length}`}
              style={{ display: "flex", gap: 2, flex: m.pasos.length, minWidth: 0 }}>
              {m.pasos.map((p) => (
                <span key={p.key}
                  style={{
                    flex: 1, minWidth: 0, height: 12, borderRadius: 3,
                    // Lo que falta va en el color de la materia MUY tenue y no en
                    // gris: así, aun sin nada hecho, la tira muestra de qué está
                    // compuesto el año y cuánto pesa cada materia.
                    background: p.done ? col : `${col}22`,
                  }} />
              ))}
            </span>
          );
        })}
      </div>

      {/* El curso NO se muestra: todas las materias son del mismo año, así que
          repetirlo siete veces es ruido. `subjectLabel` ya se lo saca al nombre. */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px", marginTop: 11 }}>
        {conPasos.map((m) => (
          <span key={m.id} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: C.dim }}>
            <span style={{ width: 9, height: 9, borderRadius: 3, background: subjectColor(m), flexShrink: 0 }} />
            {subjectLabel(m)}
            <b style={{ fontFamily: FONT.round, color: C.text }}>
              {m.pasos.filter((p) => p.done).length}/{m.pasos.length}
            </b>
          </span>
        ))}
      </div>
    </div>
  );
}

function Titulo({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
      <span style={{ width: 16, height: 3, borderRadius: 2, background: C.coral }} />
      <span style={{ fontFamily: FONT.round, fontWeight: 800, fontSize: 17 }}>{children}</span>
    </div>
  );
}

/** Un número grande y qué es. El número manda; la palabra explica. */
function Numero({ n, que, color }: { n: number; que: string; color: string }) {
  return (
    <div style={{ background: C.panel, border: `2px solid ${C.ink}`, borderRadius: 14, boxShadow: HARD(color), padding: "13px 15px" }}>
      <div style={{ fontFamily: FONT.round, fontWeight: 800, fontSize: 28, lineHeight: 1, letterSpacing: -0.5, color: n > 0 ? C.text : C.dim }}>
        {n}
      </div>
      <div style={{ color: C.dim, fontSize: 12.5, marginTop: 4 }}>{que}</div>
    </div>
  );
}

/**
 * Una materia: cuánto del camino lleva, cuántos temas domina y cuántos le
 * quedan. Los pendientes NO se listan acá —viven en Reforzar— pero se cuentan y
 * se puede saltar: es la costura por donde estas dos pantallas se van a unir.
 */
/**
 * LA PISTA — el camino de la materia, estirado y visto de arriba.
 *
 * Reemplaza a "0 de 9 temas · 0%". Un porcentaje contesta *cuánto*; esto
 * contesta *dónde*, que es la pregunta con la que el alumno abre esta pantalla.
 * Y no es una metáfora nueva: son las mismas paradas del camino, en el mismo
 * orden, con el mismo color de la materia. Lo único que cambia es que acá el
 * sendero está enderezado para que entre entero de un vistazo.
 *
 * TRES ESTADOS Y NADA MÁS: hecho, el que sigue, y lo que falta. Se resistió la
 * tentación de traer los símbolos del camino (número · ! · ?), que contestan
 * otra pregunta —"¿tengo con qué estudiar esto?" (§12.6)— y acá serían ruido:
 * en una tira de 9 px no hay lugar para dos significados.
 *
 * ⚠️ Los segmentos son `flex: 1` y no un ancho fijo: los planes van de 2 a 23
 * pasos, y con ancho fijo los de 23 se salían de la fila en el teléfono.
 */
function PistaAvance({ pasos, col }: { pasos: ResumenPaso[]; col: string }) {
  const siguiente = pasos.findIndex((p) => !p.done);
  return (
    <span role="img"
      aria-label={`${pasos.filter((p) => p.done).length} de ${pasos.length} pasos hechos`}
      style={{ display: "flex", gap: 3, marginTop: 9 }}>
      {pasos.map((p, i) => {
        const esSiguiente = i === siguiente;
        return (
          <span key={p.key}
            title={`${p.n}. ${p.title}${p.done ? " — hecho" : esSiguiente ? " — vas por acá" : ""}`}
            style={{
              flex: 1, minWidth: 0, height: 9, borderRadius: 3,
              background: p.done ? col : esSiguiente ? "transparent" : C.border,
              // El que sigue va HUECO con borde y no relleno a media tinta: a
              // 9 px de alto un relleno claro se lee como "hecho a medias", y
              // no es eso — es el que todavía no empezó.
              border: esSiguiente ? `2px solid ${col}` : "none",
              boxSizing: "border-box",
            }} />
        );
      })}
    </span>
  );
}

const fechaCorta = (iso: string) =>
  new Date(iso).toLocaleDateString("es-CL", { day: "numeric", month: "short" });

function FilaMateria({ m, onReforzar }: { m: ResumenMateria; onReforzar: () => void }) {
  const col = subjectColor(m);
  const onCol = isLight(col) ? C.ink : "#fff";
  // `?? []` y no `m.pasos` a secas: si el bundle del navegador queda una
  // versión adelante de la API —pasa en cada despliegue, y pasó acá mismo con
  // una respuesta cacheada— la pantalla entera se caía con "cannot read
  // properties of undefined". Un resumen sin pista es una degradación; un
  // resumen en blanco es un bug.
  const pasos = m.pasos ?? [];
  const hechos = pasos.filter((p) => p.done);
  const siguiente = pasos.find((p) => !p.done);
  // La última vez que avanzó. Sale de `doneAt`, así que dice algo real y no
  // "activo hace 3 días", que mide asistencia.
  const ultimo = hechos.reduce<string | null>(
    (max, p) => (p.doneAt && (!max || p.doneAt > max) ? p.doneAt : max), null);

  return (
    /* ⚠️ `minWidth: 0` NO es decorativo. La tarjeta es un ítem de grilla, y un
       ítem de grilla no baja de su ancho MÍNIMO DE CONTENIDO. El renglón "Seguís
       por 1. Estructura y función de la noticia" va en `nowrap`, así que ese
       mínimo pasaba a ser el título entero y estiraba la tarjeta: medido, 64 px
       de scroll horizontal a 375. El `overflow: hidden` del renglón recorta lo
       que se ve, pero no achica el mínimo — eso lo hace esto. */
    <div style={{ minWidth: 0, background: C.panel, border: `2px solid ${C.ink}`, borderRadius: 14, padding: "12px 14px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ width: 32, height: 32, flexShrink: 0, borderRadius: 10, background: col, color: onCol, display: "grid", placeItems: "center" }}>
          <IconBook size={17} />
        </span>

        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "block", fontFamily: FONT.round, fontWeight: 800, fontSize: 15, lineHeight: 1.25 }}>
            {subjectLabel(m)}
          </span>
          <span style={{ display: "block", color: C.dim, fontSize: 12.5, marginTop: 1 }}>
            {pasos.length > 0
              ? <><b style={{ color: hechos.length > 0 ? C.text : C.dim, fontFamily: FONT.round }}>{hechos.length}</b> de {pasos.length} pasos</>
              : "Sin camino armado"}
            {ultimo && <> · último el {fechaCorta(ultimo)}</>}
            {m.lastScore && <> · última prueba {m.lastScore.score}/{m.lastScore.total}</>}
          </span>
        </span>

        <span style={{ display: "flex", alignItems: "center", gap: 7, flexShrink: 0 }}>
          {m.fuertes.length > 0 && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, background: C.okBg, color: C.okTx, borderRadius: 999, padding: "3px 9px", fontFamily: FONT.round, fontWeight: 800, fontSize: 12 }}>
              <IconCheck size={11} /> {m.fuertes.length}
            </span>
          )}
          {m.pendientes > 0 && (
            <button onClick={onReforzar} title="Ver qué te falta reforzar"
              style={{ display: "inline-flex", alignItems: "center", gap: 4, background: C.badBg, color: C.badTx, border: "none", borderRadius: 999, padding: "3px 9px", cursor: "pointer", fontFamily: FONT.round, fontWeight: 800, fontSize: 12 }}>
              <IconReforzar size={11} /> {m.pendientes} <IconArrow size={11} />
            </button>
          )}
        </span>
      </div>

      {pasos.length > 0 && <PistaAvance pasos={pasos} col={col} />}

      {/* EL PASO QUE SIGUE, CON NOMBRE. Es lo que convierte la pista en algo
          accionable: sin esto el alumno ve dónde está pero no qué le toca. */}
      {siguiente && (
        <div style={{ marginTop: 7, fontSize: 12.5, color: C.dim, lineHeight: 1.4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {hechos.length === 0 ? "Empezás por" : "Seguís por"}{" "}
          <b style={{ color: C.text, fontFamily: FONT.round }}>{siguiente.n}. {siguiente.title}</b>
        </div>
      )}
      {!siguiente && pasos.length > 0 && (
        <div style={{ marginTop: 7, fontSize: 12.5, color: C.okTx, fontFamily: FONT.round, fontWeight: 700 }}>
          Terminaste el camino de esta materia.
        </div>
      )}
    </div>
  );
}
