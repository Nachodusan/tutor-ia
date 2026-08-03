"use client";

import { useEffect, useMemo, useState } from "react";
import {
  C, FONT, HARD, gradeLabel, subjectLabel, subjectColor, scoreTone,
  AuroraDot, Pill, IconBtn, BigBtn,
  IconAlert, IconBook, IconChevron, IconClock, IconLock, IconSwap, IconUsers,
} from "../ui";
import type { TeacherOverview, AlumnoFila } from "../api/teacher/overview/route";

/**
 * PANEL DEL CURSO — lo que ve el docente.
 *
 * Dos cosas que esta pantalla dice en voz alta, y que no son detalles de copy:
 *
 *  1. **No muestra conversaciones.** Ni acá ni en la ruta que la alimenta. Si un
 *     chico sospecha que su profe lee lo que le pregunta al tutor, empieza a
 *     preguntar lo que queda bien en vez de lo que no entiende.
 *  2. **Los alumnos son anónimos.** Se ve "7b-01", no un nombre, y el docente
 *     necesita la lista en papel para saber quién es.
 *
 * ── Sobre la disposición ────────────────────────────────────────────────────
 * La primera versión apilaba TODO en una columna y le daba a cada bloque el
 * mismo tratamiento de "Bloques" (borde de tinta 2px + sombra dura). Con tres
 * métricas, catorce temas, tres materias y nueve alumnos eso son ~30 objetos
 * compitiendo por la misma atención: el lenguaje visual que hace que UNA tarjeta
 * resalte, repetido treinta veces, no resalta nada.
 *
 * Lo que cambió:
 *  - El curso pasó de 12 pastillas (once con "0") a UN selector. Elegir curso es
 *    un control, no contenido.
 *  - El resumen es una sola franja dividida —"el estado del curso" es un objeto,
 *    no tres—, y perdió la sombra dura.
 *  - Dos columnas en pantalla ancha: a la izquierda lo accionable (qué volver a
 *    explicar), a la derecha el contexto (cuánto avanzó cada materia).
 *  - Los temas difíciles se cortan en 6, con el resto a un clic. Catorce cajas
 *    pesadas seguidas eran el grueso del amontonamiento.
 *  - La sombra dura queda reservada para el bloque de refuerzo, que es el único
 *    que tiene que gritar.
 */

const RECIENTE_DIAS = 7;
/** Temas visibles antes de "ver el resto". La cola larga es ruido en la primera lectura. */
const TOP_TEMAS = 6;
const ANCHO = 1080;

export default function DocentePage() {
  const [data, setData] = useState<TeacherOverview | null>(null);
  const [grade, setGrade] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [denegado, setDenegado] = useState(false);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [verTodos, setVerTodos] = useState(false);
  const [orden, setOrden] = useState<"usuario" | "avance" | "reforzar" | "acceso">("usuario");

  // El middleware solo mira que HAYA cookie: no sabe de roles. El 403 de la
  // ruta es la frontera real; esto solo decide qué se muestra.
  useEffect(() => {
    let vivo = true;
    setCargando(true);
    const url = grade ? `/api/teacher/overview?grade=${encodeURIComponent(grade)}` : "/api/teacher/overview";
    fetch(url)
      .then(async (r) => {
        // Sin sesión: a la puerta del docente, que es la que corresponde a /docente.
        if (r.status === 401) { window.location.href = "/login/docente"; return null; }
        // CON sesión pero de alumno: se EXPLICA, no se rebota. Antes esto hacía
        // un redirect mudo al panel del alumno y el efecto era exactamente el de
        // una página rota: escribís /docente y aparecés en otro lado sin que
        // nadie te diga que el problema es con qué cuenta entraste.
        if (r.status === 403) { if (vivo) setDenegado(true); return null; }
        if (!r.ok) throw new Error("fallo");
        return (await r.json()) as TeacherOverview;
      })
      .then((j) => {
        if (!vivo || !j) return;
        setData(j);
        setGrade(j.grade);
        setError("");
      })
      .catch(() => { if (vivo) setError("No pudimos cargar el curso. Probá de nuevo."); })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [grade]);

  const materias = useMemo(
    () => new Map((data?.subjects ?? []).map((s) => [s.id, s])),
    [data],
  );

  const alumnos = useMemo(() => {
    const xs = [...(data?.students ?? [])];
    if (orden === "avance") xs.sort((a, b) => b.done - a.done);
    if (orden === "reforzar") xs.sort((a, b) => b.weak - a.weak);
    // Sin acceso va al FINAL y no al principio: una cuenta sin estrenar no es
    // "hace muchísimo", es otra cosa, y mezclarlas escondería al que dejó de venir.
    if (orden === "acceso") {
      xs.sort((a, b) => (b.lastSeen ? new Date(b.lastSeen).getTime() : -1) - (a.lastSeen ? new Date(a.lastSeen).getTime() : -1));
    }
    return xs;
  }, [data, orden]);

  async function salir() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    // A la puerta del DOCENTE, no a la del alumno: quien sale de acá vuelve acá.
    window.location.href = "/login/docente";
  }

  if (denegado) return <SoloDocentes onSalir={salir} />;

  const weak = data?.weak ?? [];
  const visibles = verTodos ? weak : weak.slice(0, TOP_TEMAS);
  const maxAfectados = Math.max(1, ...weak.map((w) => w.students));

  return (
    <div style={{ minHeight: "100dvh", background: C.bg, color: C.text, fontFamily: FONT.sans }}>
      <Estilos />
      <div style={{ maxWidth: ANCHO, margin: "0 auto", padding: "24px 20px 72px" }}>

        {/* ── Barra superior: identidad + control de curso ─────────────────── */}
        <header className="dc-top">
          <div style={{ display: "flex", alignItems: "center", gap: 13, minWidth: 0 }}>
            <AuroraDot size={44} square ink />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: FONT.round, fontSize: 21, fontWeight: 800, letterSpacing: -0.3, lineHeight: 1.15 }}>
                Panel del curso
              </div>
              <div style={{ color: C.dim, fontSize: 13 }}>
                {data?.grade
                  ? `${data.summary.students} ${data.summary.students === 1 ? "alumno" : "alumnos"}`
                  : "Elegí un curso"}
              </div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {(data?.grades.length ?? 0) > 0 && (
              <SelectorCurso
                grades={data!.grades}
                valor={data!.grade}
                onChange={(g) => { setAbierto(null); setVerTodos(false); setGrade(g); }}
              />
            )}
            <IconBtn onClick={salir} title="Salir"><IconSwap size={17} /></IconBtn>
          </div>
        </header>

        <Privacidad />

        {cargando && !data && <p style={{ color: C.dim, marginTop: 28 }}>Cargando…</p>}
        {error && <p style={{ color: C.badTx, marginTop: 28 }}>{error}</p>}

        {data && data.grades.length === 0 && (
          <Vacio>
            Todavía no hay material cargado ni alumnos con curso elegido. Cuando el
            colegio suba los libros y reparta las cuentas, los cursos aparecen acá.
          </Vacio>
        )}

        {data && data.grade && (
          <>
            <Resumen s={data.summary} />

            <div className="dc-cols">
              {/* ── Columna principal: lo que hay que hacer algo al respecto ── */}
              <section style={{ minWidth: 0 }}>
                <Titulo icon={<IconAlert size={14} />} nota={weak.length ? `${weak.length} en total` : undefined}>
                  Lo que más le cuesta al curso
                </Titulo>

                {weak.length > 0 ? (
                  <>
                    <p style={{ color: C.dim, fontSize: 13, margin: "0 0 14", lineHeight: 1.5 }}>
                      Ordenados por cuántos alumnos los fallaron en las pruebas.
                    </p>
                    <div style={{ display: "grid", gap: 8 }}>
                      {visibles.map((w) => (
                        <TemaDificil
                          key={`${w.subjectId}-${w.topicKey}`}
                          w={w}
                          m={materias.get(w.subjectId)}
                          max={maxAfectados}
                        />
                      ))}
                    </div>
                    {weak.length > TOP_TEMAS && (
                      <button onClick={() => setVerTodos((v) => !v)} style={verMasBtn}>
                        {verTodos
                          ? "Ver solo los más frecuentes"
                          : `Ver los ${weak.length - TOP_TEMAS} temas restantes`}
                      </button>
                    )}
                  </>
                ) : (
                  <Vacio>
                    Todavía nadie rindió una prueba en {gradeLabel(data.grade)}. Cuando lo
                    hagan, acá vas a ver qué temas les cuestan y a cuántos.
                  </Vacio>
                )}
              </section>

              {/* ── Columna lateral: contexto ────────────────────────────────── */}
              <aside style={{ minWidth: 0 }}>
                <AvancePorMateria data={data} />
              </aside>
            </div>

            {/* ── Ancho completo: la lista larga ──────────────────────────── */}
            <section style={{ marginTop: 40 }}>
              <Titulo
                icon={<IconUsers size={14} />}
                nota={data.students.length ? `${data.students.length}` : undefined}
              >
                Alumnos
              </Titulo>

              {data.students.length > 0 ? (
                <>
                  <div className="dc-orden">
                    <span style={{ color: C.dim, fontSize: 12.5 }}>Ordenar por</span>
                    {([["usuario", "Usuario"], ["avance", "Avance"], ["reforzar", "Para reforzar"], ["acceso", "Último acceso"]] as const).map(([k, t]) => (
                      <button key={k} onClick={() => setOrden(k)} style={ordenBtn(orden === k)}>{t}</button>
                    ))}
                  </div>

                  {/* Encabezado de columnas: sin esto, "3/5" es un número sin nombre. */}
                  <div className="dc-fila dc-cab">
                    <span className="dc-nombre" style={{ paddingLeft: 25 }}>Alumno</span>
                    <span>Último acceso</span>
                    <span>Lecciones</span>
                    <span>Para reforzar</span>
                    <span className="dc-num" style={{ textAlign: "right" }}>Prueba</span>
                  </div>

                  <div style={{ border: `1.5px solid ${C.border}`, borderRadius: 14, overflow: "hidden" }}>
                    {alumnos.map((a, i) => (
                      <FilaAlumno key={a.username} a={a} materias={materias} primera={i === 0}
                        maxLecciones={Math.max(1, ...data.students.map((x) => x.done))}
                        abierto={abierto === a.username}
                        onToggle={() => setAbierto((x) => (x === a.username ? null : a.username))} />
                    ))}
                  </div>
                </>
              ) : (
                <Vacio>
                  Ningún alumno eligió {gradeLabel(data.grade)} como su curso todavía.
                  El curso lo elige cada chico la primera vez que entra.
                </Vacio>
              )}
            </section>

            <button onClick={() => (window.location.href = "/")} style={pieLink}>
              <IconBook size={14} /> Ver la app como la ve un alumno
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** Las dos reglas que necesitan media queries. Todo lo demás va en línea. */
function Estilos() {
  return (
    <style>{`
      .dc-top { display:flex; align-items:center; justify-content:space-between; gap:16px; flex-wrap:wrap; margin-bottom:14px }
      .dc-cols { display:grid; gap:30px; align-items:start; grid-template-columns:minmax(0,1.65fr) minmax(0,1fr) }
      .dc-orden { display:flex; align-items:center; gap:14px; flex-wrap:wrap; margin:-2px 0 14px }
      /* El divisor del resumen tiene que seguir a la dirección en que se apila:
         de costado es una línea vertical, apilado es horizontal. Con borderLeft
         fijo, en el teléfono quedaban tres rayitas sueltas al margen izquierdo. */
      .dc-metrica + .dc-metrica { border-left:1.5px solid var(--dc-borde) }

      /* La lista de alumnos es una TABLA: las mismas columnas en todas las
         filas. Antes era un flex con un espaciador elástico, así que la nota de
         un alumno sin temas para reforzar caía en otra posición horizontal que
         la del de al lado — nada se podía comparar recorriendo la columna. */
      .dc-fila { display:grid; grid-template-columns:minmax(0,1fr) 108px 128px 118px 74px; align-items:center; gap:14px }
      .dc-cab { padding:0 14px 8px; color:#5E5769; font-size:11px; font-weight:700; letter-spacing:.6px; text-transform:uppercase }

      @media (max-width: 880px) { .dc-cols { grid-template-columns:1fr; gap:34px } }
      @media (max-width: 760px) {
        /* El orden importa: el encabezado tiene las DOS clases, y con la misma
           especificidad gana la última. Si .dc-cab va antes, .dc-fila le
           devuelve el display y la fila de títulos reaparece en el teléfono. */
        .dc-fila { display:flex; flex-wrap:wrap; gap:9px 14px }
        .dc-cab { display:none }
        .dc-nombre { flex:1 1 100% }
        .dc-num { text-align:left !important }
      }
      @media (max-width: 560px) {
        .dc-metrica + .dc-metrica { border-left:none; border-top:1.5px solid var(--dc-borde) }
      }
    `}</style>
  );
}

/**
 * Curso: UN control, no doce botones.
 *
 * Con material de 1° básico a 4° medio eran 12 pastillas del mismo tamaño, once
 * de ellas con un "0" al lado. Ocupaban tres renglones antes de que empezara la
 * información, y el curso que el docente sí usa no se distinguía del resto.
 */
function SelectorCurso({ grades, valor, onChange }: {
  grades: TeacherOverview["grades"];
  valor: string | null;
  onChange: (g: string) => void;
}) {
  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <span style={{ color: C.dim, fontSize: 12.5, fontWeight: 600 }}>Curso</span>
      <select
        value={valor ?? ""}
        onChange={(e) => onChange(e.target.value)}
        style={{
          appearance: "none", padding: "9px 32px 9px 13px", borderRadius: 11,
          border: `2px solid ${C.ink}`, background: C.panel, color: C.text,
          fontFamily: FONT.round, fontWeight: 700, fontSize: 14, cursor: "pointer",
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%235E5769' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'><path d='m6 9 6 6 6-6'/></svg>\")",
          backgroundRepeat: "no-repeat", backgroundPosition: "right 11px center",
        }}
      >
        {grades.map((g) => (
          <option key={g.grade} value={g.grade}>
            {gradeLabel(g.grade)}{g.students > 0 ? ` · ${g.students}` : " · sin alumnos"}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * El límite del panel, en UNA línea.
 *
 * Antes era un bloque de cuatro renglones arriba de todo. Lo importante es que
 * esté siempre, no que ocupe el lugar de la información; el detalle queda a un
 * clic para quien lo lea la primera vez.
 */
function Privacidad() {
  return (
    <details style={{ marginBottom: 26 }}>
      <summary style={{
        // flex-start y no center: cuando el texto pasa a dos líneas (teléfono),
        // centrar el candado lo deja flotando a media altura del párrafo.
        display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer",
        color: C.dim, fontSize: 12.5, listStyle: "none", lineHeight: 1.5,
      }}>
        <span style={{ display: "flex", flexShrink: 0, marginTop: 2 }}><IconLock size={13} /></span>
        <span>
          Ves avance y temas difíciles, <strong style={{ color: C.text, fontWeight: 700 }}>no las conversaciones</strong> de tus alumnos.
          Las cuentas son anónimas.
        </span>
      </summary>
      <p style={{ margin: "10px 0 0 21px", fontSize: 12.5, color: C.dim, lineHeight: 1.6, maxWidth: 620 }}>
        Nada de lo que los chicos le escriben al tutor llega a esta pantalla, y no
        hay forma de pedirlo: la decisión está en el servidor, no en un permiso que
        se pueda cambiar. Un alumno que sospecha que su profe lee sus preguntas deja
        de preguntar con honestidad, y ahí el tutor pierde su razón de ser.
        <br /><br />
        Los usuarios tampoco dicen quién es quién: <em>7b-01</em> es un identificador,
        y la lista que lo conecta con cada chico la tiene el colegio en papel.
      </p>
    </details>
  );
}

/** El estado del curso es UN objeto: una franja dividida, no tres tarjetas sueltas. */
function Resumen({ s }: { s: TeacherOverview["summary"] }) {
  const items: [number, string][] = [
    [s.students, s.students === 1 ? "alumno" : "alumnos"],
    [s.activos, `entraron en ${RECIENTE_DIAS} días`],
    [s.conPrueba, s.conPrueba === 1 ? "rindió una prueba" : "rindieron una prueba"],
  ];
  return (
    <div style={{
      display: "flex", flexWrap: "wrap", border: `1.5px solid ${C.border}`,
      borderRadius: 16, background: C.panel2, overflow: "hidden", marginBottom: 34,
      // El divisor lo dibuja el CSS (necesita media query para cambiar de eje).
      ["--dc-borde" as string]: C.border,
    } as React.CSSProperties}>
      {items.map(([n, t]) => (
        <div key={t} className="dc-metrica" style={{ flex: "1 1 150px", padding: "15px 20px" }}>
          <div style={{ fontFamily: FONT.round, fontSize: 26, fontWeight: 800, lineHeight: 1 }}>{n}</div>
          <div style={{ color: C.dim, fontSize: 12.5, marginTop: 5 }}>{t}</div>
        </div>
      ))}
    </div>
  );
}

/** Encabezado de sección: filete coral + icono + un contador discreto a la derecha. */
function Titulo({ icon, children, nota }: { icon: React.ReactNode; children: React.ReactNode; nota?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
      <span style={{ width: 16, height: 3, borderRadius: 2, background: C.coral, flexShrink: 0 }} />
      <span style={{ color: C.dim, display: "flex" }}>{icon}</span>
      <span style={{
        color: C.dim, fontFamily: FONT.round, fontWeight: 700, fontSize: 12,
        textTransform: "uppercase", letterSpacing: 0.7,
      }}>
        {children}
      </span>
      {nota && (
        <>
          <span style={{ flex: 1 }} />
          <span style={{ color: C.dim, fontSize: 12, fontFamily: FONT.round, fontWeight: 700 }}>{nota}</span>
        </>
      )}
    </div>
  );
}

/**
 * Una fila de tema difícil.
 *
 * La barra va en ROJO y no en el color de la materia: mide cuántos chicos
 * fallaron, y en Física —que es verde— una barra verde larga leía como buena
 * noticia. El color de la materia queda en el cuadradito, que es donde funciona
 * como identidad y no como semáforo.
 */
function TemaDificil({ w, m, max }: {
  w: TeacherOverview["weak"][number];
  m?: TeacherOverview["subjects"][number];
  max: number;
}) {
  const col = m ? subjectColor({ name: m.name, subject_area: m.subjectArea }) : C.accent;
  const nombre = m ? subjectLabel({ name: m.name, subject_area: m.subjectArea }) : "Materia";
  const pct = Math.round((w.students / max) * 100);
  return (
    <div style={{
      border: `1.5px solid ${C.border}`, borderLeft: `4px solid ${col}`,
      borderRadius: 12, background: C.panel, padding: "11px 14px",
    }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <span style={{ fontFamily: FONT.round, fontWeight: 700, fontSize: 15, flex: 1, minWidth: 0, lineHeight: 1.35 }}>
          {w.topic}
        </span>
        <span style={{ fontFamily: FONT.round, fontWeight: 800, fontSize: 13, color: C.badTx, whiteSpace: "nowrap" }}>
          {w.students} {w.students === 1 ? "alumno" : "alumnos"}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
        {/* Ancho FIJO y con puntos suspensivos: con el ancho natural, "Historia
            Geografía Y Ciencias Sociales" empujaba su barra 150px a la derecha y
            las filas dejaban de ser comparables de un vistazo. El nombre completo
            queda en el title, y la franja de color ya identifica la materia. */}
        <span
          title={nombre}
          style={{
            color: C.dim, fontSize: 12, width: 132, flexShrink: 0,
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}
        >
          {nombre}
        </span>
        <div style={{ flex: 1, height: 6, borderRadius: 999, background: C.panel2, overflow: "hidden", minWidth: 40 }}>
          <div style={{ width: `${pct}%`, height: "100%", background: C.bad }} />
        </div>
        <span style={{ color: C.dim, fontSize: 11.5, whiteSpace: "nowrap" }}>
          {w.misses} {w.misses === 1 ? "error" : "errores"}
        </span>
      </div>
    </div>
  );
}

/**
 * Cuánto del plan lleva el curso en cada materia.
 *
 * El promedio se calcula sobre los alumnos QUE EMPEZARON, no sobre los 35: con
 * el denominador completo, una materia que tres chicos están estudiando bien se
 * ve como un 8% y parece un fracaso. Cuántos empezaron se muestra al lado, así
 * que las dos lecturas están disponibles y ninguna se disfraza de la otra.
 */
function AvancePorMateria({ data }: { data: TeacherOverview }) {
  const filas = data.subjects
    .map((s) => {
      const conAvance = data.students
        .map((a) => a.bySubject.find((x) => x.subjectId === s.id)?.done ?? 0)
        .filter((n) => n > 0);
      const prom = conAvance.length ? conAvance.reduce((a, b) => a + b, 0) / conAvance.length : 0;
      return { s, empezaron: conAvance.length, prom };
    })
    .filter((f) => f.empezaron > 0)
    .sort((a, b) => b.empezaron - a.empezaron);

  if (filas.length === 0) return null;

  return (
    <>
      <Titulo icon={<IconBook size={14} />}>Avance por materia</Titulo>
      <div style={{ border: `1.5px solid ${C.border}`, borderRadius: 14, background: C.panel, overflow: "hidden" }}>
        {filas.map(({ s, empezaron, prom }, i) => {
          const col = subjectColor({ name: s.name, subject_area: s.subjectArea });
          const pct = s.planTotal > 0 ? Math.min(100, Math.round((prom / s.planTotal) * 100)) : 0;
          return (
            <div key={s.id} style={{
              padding: "13px 15px",
              borderTop: i === 0 ? "none" : `1.5px solid ${C.border}`,
            }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 9 }}>
                <span style={{ width: 9, height: 9, borderRadius: 3, background: col, flexShrink: 0 }} />
                <span style={{ fontFamily: FONT.round, fontWeight: 700, fontSize: 14, flex: 1, minWidth: 0, lineHeight: 1.3 }}>
                  {subjectLabel({ name: s.name, subject_area: s.subjectArea })}
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
                <div style={{ flex: 1, height: 6, borderRadius: 999, background: C.panel2, overflow: "hidden", minWidth: 40 }}>
                  <div style={{ width: `${pct}%`, height: "100%", background: col }} />
                </div>
                <span style={{ color: C.dim, fontSize: 11.5, whiteSpace: "nowrap" }}>
                  {s.planTotal > 0
                    // planTotal 0 = el índice de ese libro no dio lecciones legibles.
                    // Decirlo es mejor que dibujar una barra sobre un total falso.
                    ? `${prom.toFixed(1)} de ${s.planTotal}`
                    : "sin plan legible"}
                </span>
              </div>
              <div style={{ color: C.dim, fontSize: 11.5, marginTop: 5 }}>
                {empezaron} {empezaron === 1 ? "alumno empezó" : "alumnos empezaron"}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

/**
 * Una fila de la tabla de alumnos.
 *
 * Las cinco columnas son FIJAS (ver `.dc-fila`). En la versión anterior era un
 * flex con espaciador elástico: la nota de un alumno sin temas para reforzar
 * quedaba corrida respecto de la del de al lado, y recorrer la columna con la
 * vista —que es lo único que un docente hace con 35 filas— no servía de nada.
 *
 * La barrita de lecciones es RELATIVA al alumno más avanzado del curso, no a un
 * total absoluto: cada chico estudia distintas materias, así que un "18 de 42"
 * y un "5 de 14" no se pueden comparar. Lo que el docente sí quiere ver de un
 * vistazo es quién va adelante y quién se quedó, y eso es exactamente lo que
 * mide la barra. El número al lado queda para la lectura exacta.
 */
function FilaAlumno({ a, materias, abierto, primera, maxLecciones, onToggle }: {
  a: AlumnoFila;
  materias: Map<string, TeacherOverview["subjects"][number]>;
  abierto: boolean;
  primera: boolean;
  maxLecciones: number;
  onToggle: () => void;
}) {
  const detalle = a.bySubject.filter((x) => x.done > 0 || x.weak > 0);
  const r = a.lastScore && a.lastScore.total > 0 ? a.lastScore.score / a.lastScore.total : null;
  const tono = r === null ? null : scoreTone(r);
  const nunca = a.lastSeen === null;
  return (
    <div style={{
      borderTop: primera ? "none" : `1.5px solid ${C.border}`,
      background: abierto ? C.panel2 : C.panel,
    }}>
      <button onClick={onToggle} disabled={detalle.length === 0}
        className="dc-fila"
        style={{
          width: "100%", background: "none", border: "none", padding: "10px 14px",
          textAlign: "left", cursor: detalle.length ? "pointer" : "default", color: C.text,
        }}>
        <span className="dc-nombre" style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
          <span style={{ transform: abierto ? "rotate(90deg)" : "none", transition: "transform .15s", color: detalle.length ? C.dim : "transparent", display: "flex", flexShrink: 0 }}>
            <IconChevron size={13} />
          </span>
          <span style={{ fontFamily: FONT.mono, fontWeight: 600, fontSize: 13.5, overflow: "hidden", textOverflow: "ellipsis" }}>
            {a.username}
          </span>
        </span>

        <span style={{
          // "nunca entró" en ámbar: es la única fila sobre la que el docente
          // puede hacer algo hoy (repartir de nuevo la cuenta), así que no
          // puede leerse igual que "hace 6 días".
          color: nunca ? C.warnTx : C.dim, fontSize: 12, whiteSpace: "nowrap",
          display: "inline-flex", alignItems: "center", gap: 5, minWidth: 0,
        }}>
          <IconClock size={12} /> {desdeCuando(a.lastSeen)}
        </span>

        <span style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
          <span style={{
            fontFamily: FONT.round, fontWeight: 700, fontSize: 13, minWidth: 20,
            textAlign: "right", fontVariantNumeric: "tabular-nums",
            color: a.done > 0 ? C.text : C.dim,
          }}>
            {a.done}
          </span>
          <span style={{ flex: 1, height: 5, borderRadius: 999, background: C.panel2, overflow: "hidden", minWidth: 30 }}>
            <span style={{ display: "block", width: `${Math.round((a.done / maxLecciones) * 100)}%`, height: "100%", background: C.accent }} />
          </span>
        </span>

        <span>
          {a.weak > 0 ? (
            <span style={{ background: C.badBg, color: C.badTx, borderRadius: 999, padding: "3px 10px", fontFamily: FONT.round, fontWeight: 700, fontSize: 11.5, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
              {a.weak} tema{a.weak === 1 ? "" : "s"}
            </span>
          ) : (
            <span style={{ color: C.border, fontSize: 13 }}>—</span>
          )}
        </span>

        <span className="dc-num" style={{ textAlign: "right", whiteSpace: "nowrap" }}>
          {a.lastScore && tono ? (
            <span style={{ background: tono.bg, color: tono.tx, borderRadius: 999, padding: "3px 10px", fontFamily: FONT.round, fontWeight: 700, fontSize: 11.5, fontVariantNumeric: "tabular-nums" }}>
              {a.lastScore.score}/{a.lastScore.total}
            </span>
          ) : (
            <span style={{ color: C.border, fontSize: 13 }}>—</span>
          )}
        </span>
      </button>

      {abierto && detalle.length > 0 && (
        <div style={{ borderTop: `1px solid ${C.border}`, background: C.panel2, padding: "10px 14px 12px", display: "grid", gap: 7 }}>
          {detalle.map((d) => {
            const m = materias.get(d.subjectId);
            const nombre = m ? subjectLabel({ name: m.name, subject_area: m.subjectArea }) : "Materia";
            const col = m ? subjectColor({ name: m.name, subject_area: m.subjectArea }) : C.accent;
            const total = m?.planTotal ?? 0;
            return (
              <div key={d.subjectId} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12.5, flexWrap: "wrap" }}>
                <span style={{ width: 9, height: 9, borderRadius: 3, background: col, flexShrink: 0 }} />
                <span style={{ flex: 1, minWidth: 110 }}>{nombre}</span>
                <span style={{ color: C.dim, whiteSpace: "nowrap" }}>
                  {total > 0 ? `${d.done} de ${total} lecciones` : `${d.done} ${d.done === 1 ? "lección" : "lecciones"}`}
                </span>
                {d.weak > 0 && <span style={{ color: C.badTx, fontWeight: 600, whiteSpace: "nowrap" }}>· {d.weak} para reforzar</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Entraste con una cuenta que no es de docente.
 *
 * Que esta pantalla exista y no sea un redirect es el punto: el rebote mudo se
 * ve idéntico a un bug ("escribo /docente y me tira al panel del alumno"), y
 * manda a buscar el problema al lugar equivocado.
 */
function SoloDocentes({ onSalir }: { onSalir: () => void }) {
  return (
    <div style={{ minHeight: "100dvh", background: C.bg, color: C.text, fontFamily: FONT.sans, display: "grid", placeItems: "center", padding: 20 }}>
      <div style={{ maxWidth: 440, textAlign: "center", display: "grid", gap: 14, justifyItems: "center" }}>
        <span style={{ color: C.dim }}><IconLock size={34} /></span>
        <h1 style={{ fontFamily: FONT.round, fontSize: 23, fontWeight: 800, margin: 0, letterSpacing: -0.3 }}>
          El panel del curso es para docentes
        </h1>
        <p style={{ margin: 0, fontSize: 14.5, color: C.dim, lineHeight: 1.6 }}>
          Tu sesión está abierta, pero con una cuenta de alumno. Para ver el avance
          y los temas difíciles del curso necesitás entrar con la cuenta de profe
          que te dieron.
        </p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center", marginTop: 6 }}>
          <BigBtn onClick={onSalir}>Entrar como docente</BigBtn>
          <Pill onClick={() => (window.location.href = "/")}>Ir a mi panel</Pill>
        </div>
      </div>
    </div>
  );
}

function Vacio({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      border: `1.5px dashed ${C.border}`, borderRadius: 14, background: C.panel2,
      padding: "20px 18px", color: C.dim, fontSize: 13.5, lineHeight: 1.6,
    }}>
      {children}
    </div>
  );
}

/**
 * "Último acceso" con granularidad de día. Deliberadamente NO muestra la hora:
 * `last_seen_at` se refresca como mucho una vez por hora (session.ts), así que
 * un reloj exacto sería precisión inventada.
 */
function desdeCuando(iso: string | null): string {
  if (!iso) return "nunca entró";
  const dias = Math.floor((Date.now() - new Date(iso).getTime()) / 86400_000);
  if (dias <= 0) return "hoy";
  if (dias === 1) return "ayer";
  if (dias < 30) return `hace ${dias} días`;
  const meses = Math.floor(dias / 30);
  return `hace ${meses} ${meses === 1 ? "mes" : "meses"}`;
}

const verMasBtn: React.CSSProperties = {
  marginTop: 10, background: "none", border: "none", padding: "4px 0", cursor: "pointer",
  color: C.accent, fontFamily: FONT.round, fontWeight: 700, fontSize: 13,
  textDecoration: "underline", textUnderlineOffset: 3,
};

const ordenBtn = (on: boolean): React.CSSProperties => ({
  background: "none", border: "none", cursor: "pointer", padding: 0,
  fontFamily: FONT.round, fontWeight: 700, fontSize: 12.5,
  color: on ? C.accent : C.dim,
  textDecoration: on ? "underline" : "none", textUnderlineOffset: 3,
});

const pieLink: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 6, marginTop: 38,
  background: "none", border: "none", padding: 0, cursor: "pointer",
  color: C.dim, fontFamily: FONT.round, fontWeight: 600, fontSize: 13,
};
