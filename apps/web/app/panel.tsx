"use client";
import { useState } from "react";
import { C, FONT, HARD, CTA, AURORA, AuroraDot, Dots, Pill, BigBtn, SectionTitle, IconUser, IconUsers, IconSettings, IconBook, IconSwap, IconArrow, IconStar, IconLock, gradeLabel, gradeSort, subjectLabel, subjectColor, isLight, backLink, IconBack, IconBtn, IconAlert, scoreTone, IconList, IconClipboard } from "./ui";
import { REVIEW_MAX } from "./tipos";
import type { Profile, Subject, SubjectStats, WeakTopic } from "./tipos";

export function Centered({ children }: { children: React.ReactNode }) {
  return <div style={{ minHeight: "100dvh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", background: C.bg, color: C.text, fontFamily: FONT.sans, padding: 20 }}>{children}</div>;
}

export function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 18, width: "100%", maxWidth: 560 }}>
      <div style={{ color: C.dim, fontFamily: FONT.round, fontWeight: 700, fontSize: 12, marginBottom: 10, textTransform: "uppercase", letterSpacing: 1 }}>{label}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "center" }}>{children}</div>
    </div>
  );
}

/**
 * Onboarding: UN solo paso, el curso.
 *
 * Antes había un segundo paso —"¿qué te interesa priorizar?"— que partía el
 * panel en "tus materias" y "otras materias". Se sacó porque la premisa era
 * falsa: el alumno cursa TODAS y ninguna es opcional. Lo único que producía era
 * que las no elegidas quedaran en una fila de pastillas chicas al pie, con su
 * avance escondido, y que un chico que se apuraba en el onboarding terminara
 * con una sola materia visible sin entender por qué.
 *
 * El paso del NOMBRE ya se había eliminado antes: las cuentas son anónimas y el
 * alumno se identifica con su usuario en el login.
 */
export function Onboarding({ subjects, initial, onCancel, onDone }: { subjects: Subject[]; initial?: Profile; onCancel?: () => void; onDone: (p: Profile) => void }) {
  const [grade, setGrade] = useState(initial?.grade ?? "");
  const grades = [...new Set(subjects.map((s) => s.grade).filter(Boolean) as string[])].sort((a, b) => gradeSort(a) - gradeSort(b));
  const cuantas = grade ? subjects.filter((s) => s.grade === grade).length : 0;

  return (
    <div style={{ minHeight: "100dvh", display: "flex", flexDirection: "column", textAlign: "center", background: C.bg, color: C.text, fontFamily: FONT.sans }}>
      <div style={{ padding: "48px 24px 0" }}>
        <div style={{ maxWidth: 760, margin: "0 auto", textAlign: "left" }}>
          {onCancel && <button onClick={onCancel} style={{ ...backLink, marginBottom: 0 }}><IconBack size={15} /> Cancelar</button>}
        </div>
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "12px 20px 80px" }}>
        <div style={{ width: "100%", maxWidth: 600 }}>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}><AuroraDot size={54} /></div>
          <h1 style={{ margin: "0 0 6px", fontFamily: FONT.round, fontWeight: 800, fontSize: 26 }}>¿En qué curso vas?</h1>
          <p style={{ color: C.dim, margin: "0 0 26px", fontSize: 15 }}>
            Elegí tu grado y vas a tener todas tus materias en el panel.
          </p>
          <Group label="Básica">{grades.filter((g) => g.endsWith("B")).map((g) => <Pill key={g} active={g === grade} onClick={() => setGrade(g)}>{gradeLabel(g)}</Pill>)}</Group>
          {grades.some((g) => g.endsWith("M")) && <Group label="Media">{grades.filter((g) => g.endsWith("M")).map((g) => <Pill key={g} active={g === grade} onClick={() => setGrade(g)}>{gradeLabel(g)}</Pill>)}</Group>}

          <div style={{ marginTop: 26 }}>
            <BigBtn disabled={!grade} onClick={() => onDone({ username: initial?.username ?? "", grade })}>
              {initial ? "Guardar" : "Crear mi panel"} <IconArrow size={17} />
            </BigBtn>
            {grade && (
              <p style={{ color: C.dim, fontSize: 12.5, marginTop: 10 }}>
                {cuantas} {cuantas === 1 ? "materia" : "materias"} de {gradeLabel(grade)}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Panel del alumno (mundo Bloques) ---

export function Dashboard({ profile, subjects, stats, teacher, onAbrir, onReinforce, onEdit, onLogout }: { profile: Profile; subjects: Subject[]; stats: Record<string, SubjectStats>; teacher?: boolean; onAbrir: (id: string, a: Actividad) => void; onReinforce: (id: string, w: WeakTopic) => void; onEdit: () => void; onLogout: () => void }) {
  // TODAS las materias del curso, con el mismo peso. Antes se partían en
  // "prioritarias" (tarjetas grandes) y "otras" (pastillas chicas al pie, sin
  // avance a la vista), según lo que el alumno hubiera tildado en el onboarding.
  // La premisa era falsa: cursa todas y ninguna es opcional.
  // Las desactivadas van al final pero SIGUEN a la vista: una materia que
  // desaparece y una que no existe se ven igual, y así hay que acordarse de
  // memoria de cuáles se apagaron.
  const misSubjects = subjects
    .filter((s) => s.grade === profile.grade)
    .sort((a, b) =>
      Number(!!a.disabled) - Number(!!b.disabled) ||
      subjectLabel(a).localeCompare(subjectLabel(b)));
  const apagadas = misSubjects.filter((s) => s.disabled).length;
  // Para reforzar: de TODAS las materias — el alumno pudo rendir una prueba en
  // cualquiera. Se excluyen las apagadas: mandarlo a repasar algo que no puede
  // abrir es un callejón sin salida.
  const toReview = subjects
    .filter((s) => !s.disabled)
    .flatMap((s) => (stats[s.id]?.weak ?? []).map((w) => ({ s, w })))
    .sort((a, b) => b.w.misses - a.w.misses);
  return (
    <div style={{ minHeight: "100dvh", overflowY: "auto", background: C.bg, color: C.text, fontFamily: FONT.sans }}>
      <div style={{ maxWidth: 820, margin: "0 auto", padding: "26px 18px 60px" }}>
        <header style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 30 }}>
          <AuroraDot size={52} square ink />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: FONT.round, fontSize: 24, fontWeight: 800, letterSpacing: -0.3 }}>Hola, {profile.username || "que bueno verte"} 👋</div>
            <div style={{ color: C.dim, fontSize: 14 }}>
              {gradeLabel(profile.grade)} · {misSubjects.length - apagadas} {misSubjects.length - apagadas === 1 ? "materia" : "materias"}
              {apagadas > 0 && ` · ${apagadas} en pausa`}
            </div>
          </div>
          {teacher && <IconBtn onClick={() => (window.location.href = "/docente")} title="Panel del curso"><IconUsers size={17} /></IconBtn>}
          <IconBtn onClick={onEdit} title="Editar perfil"><IconSettings size={17} /></IconBtn>
          <IconBtn onClick={onLogout} title="Cambiar de alumno"><IconSwap size={17} /></IconBtn>
        </header>

        <SectionTitle icon={<IconStar size={15} />}>Tus materias</SectionTitle>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: 16, marginBottom: 36 }}>
          {misSubjects.map((s) => <SubjectCard key={s.id} s={s} st={stats[s.id]} onAbrir={(a) => onAbrir(s.id, a)} />)}

          {misSubjects.length === 0 && (
            <p style={{ color: C.dim, fontSize: 14 }}>
              Todavía no hay material cargado para {gradeLabel(profile.grade)}. Tocá el engranaje si te equivocaste de curso.
            </p>
          )}
        </div>

        {toReview.length > 0 && (
          <>
            <SectionTitle icon={<IconAlert size={15} />}>Para reforzar</SectionTitle>
            <p style={{ color: C.dim, fontSize: 13.5, marginTop: -6, marginBottom: 14, lineHeight: 1.5 }}>
              Temas que fallaste en las pruebas. Tocá uno y te lo explico de nuevo desde el principio.
            </p>
            <div style={{ display: "grid", gap: 10, marginBottom: toReview.length > REVIEW_MAX ? 12 : 36 }}>
              {toReview.slice(0, REVIEW_MAX).map(({ s, w }) => <WeakCard key={`${s.id}-${w.topic}`} s={s} w={w} onClick={() => onReinforce(s.id, w)} />)}
            </div>
            {toReview.length > REVIEW_MAX && (
              <p style={{ color: C.dim, fontSize: 13, marginBottom: 36 }}>
                Y {toReview.length - REVIEW_MAX} tema{toReview.length - REVIEW_MAX === 1 ? "" : "s"} más. Reforzá estos primero.
              </p>
            )}
          </>
        )}

      </div>
    </div>
  );
}

/**
 * Tarjeta de materia = bloque con borde de tinta + sombra dura de su color.
 *
 * Si la materia está EN PAUSA se dibuja igual pero apagada: sin sombra dura,
 * en gris y sin reaccionar al mouse. Se muestra —en vez de esconderla— porque
 * una materia ausente y una inexistente se ven idénticas, y el alumno (o el
 * profe probando) no tiene forma de saber que Matemática existe y va a volver.
 * El candado dice que es temporal; el 404 de /api/plan y /api/test es lo que
 * realmente impide usarla.
 */
/** Las tres actividades de una materia, tal como se ofrecen desde el panel. */
const ACTIVIDADES = [
  { clave: "camino", label: "Camino", icono: (n: number) => <IconList size={n} />, sinTexto: false },
  // El orbe de Aurora, SIN etiqueta. Es la identidad de la IA en el resto de la
  // app —el encabezado, la llamada de voz, el avatar del alumno—, así que ya
  // dice "con esto hablás con el tutor"; el texto abajo repetía lo que el
  // símbolo comunica solo. `label` se conserva para el `title` y el aria-label,
  // que es lo que necesita quien navega con teclado o lector de pantalla: lo que
  // se saca es el texto VISIBLE, no el nombre accesible.
  { clave: "chat", label: "Preguntar", icono: (n: number) => <AuroraDot size={n + 4} />, sinTexto: true },
  { clave: "prueba", label: "Prueba", icono: (n: number) => <IconClipboard size={n} />, sinTexto: false },
] as const;
export type Actividad = (typeof ACTIVIDADES)[number]["clave"];

/**
 * La tarjeta de una materia, con SUS TRES ACCIONES abajo.
 *
 * Antes la tarjeta entera era un botón que llevaba a una pantalla intermedia
 * ("¿qué querés hacer?"). Esa pantalla no aportaba: el alumno ya sabía a qué
 * venía cuando tocó la materia, y le cobraba un toque y un cambio de página
 * para volver a preguntárselo. Ahora las tres opciones están acá y se va
 * directo.
 *
 * ⚠️ Por eso la tarjeta es un `div` y no un `button`: un botón adentro de otro
 * botón es HTML inválido, y el navegador lo "arregla" sacando el de adentro —
 * las acciones dejarían de existir sin que nada avise. El cuerpo (nombre y
 * avance) es su propio botón e igual lleva al camino, que es lo más probable.
 */
export function SubjectCard({ s, st, onAbrir }: { s: Subject; st?: SubjectStats; onAbrir: (a: Actividad) => void }) {
  const hasGuide = Number(s.pedagogy_chunks) > 0;
  const off = !!s.disabled;
  const col = off ? C.border : subjectColor(s);
  const onCol = isLight(col) ? C.ink : "#fff";
  const total = st?.planTotal ?? 0;
  const done = st?.planDone ?? 0;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const weak = st?.weak.length ?? 0;
  // Sin lecciones no hay camino que recorrer: el libro de esa materia no dio un
  // índice legible. Se apaga la acción en vez de llevar a una pantalla vacía.
  const sinCamino = total === 0;

  return (
    <div
      style={{ position: "relative", overflow: "hidden", display: "flex", flexDirection: "column", background: off ? C.panel2 : C.panel, color: off ? C.dim : C.text, border: `2px solid ${off ? C.border : C.ink}`, borderRadius: 16, boxShadow: off ? "none" : HARD(col), transition: "transform .13s, box-shadow .13s" }}
      onMouseEnter={(e) => { if (off) return; e.currentTarget.style.transform = "translate(-2px,-2px)"; e.currentTarget.style.boxShadow = `6px 6px 0 0 ${col}`; }}
      onMouseLeave={(e) => { if (off) return; e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = HARD(col); }}>
      {!off && <div style={{ position: "absolute", top: -14, right: -14, width: 34, height: 34, borderRadius: "50%", background: col }} />}

      <button onClick={off ? undefined : () => onAbrir(sinCamino ? "chat" : "camino")} disabled={off}
        title={off ? "Esta materia está en pausa" : undefined}
        // `flex: 1` para que el cuerpo se coma el alto sobrante y EMPUJE las
        // acciones al fondo. Las tarjetas se estiran a la altura de la más alta
        // (grid), pero sin esto el bloque de acciones queda pegado al contenido:
        // "Lengua Y Literatura" —título de una línea y sin chapa de refuerzo—
        // dejaba un hueco de ~100 px debajo de sus botones, y las tres filas de
        // acciones quedaban a alturas distintas.
        style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10, textAlign: "left", background: "none", border: "none", color: "inherit", padding: "16px 16px 12px", cursor: off ? "default" : "pointer", font: "inherit" }}>
        <span style={{ width: 34, height: 34, borderRadius: 10, background: col, color: onCol, display: "grid", placeItems: "center", position: "relative" }}>
          {off ? <IconLock size={18} /> : <IconBook size={20} />}
        </span>
        <span style={{ fontFamily: FONT.round, fontSize: 17, fontWeight: 700, lineHeight: 1.25 }}>{subjectLabel(s)}</span>

        {off && (
          <>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, alignSelf: "flex-start", background: C.panel, color: C.dim, border: `1.5px solid ${C.border}`, borderRadius: 999, padding: "3px 10px", fontFamily: FONT.round, fontWeight: 700, fontSize: 11.5 }}>
              <IconLock size={11} /> En pausa
            </span>
            <span style={{ color: C.dim, fontSize: 12.5, lineHeight: 1.45 }}>
              Todavía no está disponible. Tu avance se guarda para cuando vuelva.
            </span>
          </>
        )}

        {/* Nada de avance ni notas en una materia en pausa: no se puede actuar
            sobre eso, y compite con lo que el alumno sí puede abrir. */}
        {!off && (total > 0 ? (
          <span style={{ display: "block", position: "relative" }}>
            <span style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
              <span style={{ fontFamily: FONT.round, fontWeight: 700, fontSize: 12.5, color: C.text }}>
                {done} de {total} {total === 1 ? "lección" : "lecciones"}
              </span>
              <span style={{ fontFamily: FONT.round, fontWeight: 800, fontSize: 12.5, color: done === total ? C.okTx : C.dim }}>
                {done === total ? "¡Completo!" : `${pct}%`}
              </span>
            </span>
            <span style={{ display: "block", height: 9, borderRadius: 999, background: C.panel2, border: `1.5px solid ${C.ink}`, overflow: "hidden" }}>
              <span style={{ display: "block", width: `${pct}%`, height: "100%", background: done === total ? C.ok : col, transition: "width .25s" }} />
            </span>
          </span>
        ) : (
          <span style={{ color: C.dim, fontSize: 12.5 }}>{hasGuide ? "Con guía docente" : "Material disponible"}</span>
        ))}

        {!off && (weak > 0 || st?.lastScore) && (
          <span style={{ display: "flex", flexWrap: "wrap", gap: 6, position: "relative" }}>
            {weak > 0 && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4, background: C.badBg, color: C.badTx, border: `1.5px solid ${C.badTx}`, borderRadius: 999, padding: "2px 8px", fontFamily: FONT.round, fontWeight: 700, fontSize: 11.5 }}>
                <IconAlert size={11} /> {weak} para reforzar
              </span>
            )}
            {st?.lastScore && (() => {
              // El color sigue a la nota: un 0/6 en verde leía como logro.
              const t = scoreTone(st.lastScore.total > 0 ? st.lastScore.score / st.lastScore.total : 0);
              return (
                <span style={{ background: t.bg, color: t.tx, border: `1.5px solid ${t.tx}`, borderRadius: 999, padding: "2px 8px", fontFamily: FONT.round, fontWeight: 700, fontSize: 11.5 }}>
                  Prueba: {st.lastScore.score}/{st.lastScore.total}
                </span>
              );
            })()}
          </span>
        )}
      </button>

      {/* LAS TRES ACCIONES. Con etiqueta y no solo el ícono: un chico de 13 no
          tiene por qué saber que un portapapeles significa "prueba". */}
      {!off && (
        <div style={{ display: "flex", flexShrink: 0, borderTop: `1.5px solid ${C.border}`, position: "relative" }}>
          {ACTIVIDADES.map((a, i) => {
            const apagada = a.clave === "camino" && sinCamino;
            return (
              <button key={a.clave} onClick={() => !apagada && onAbrir(a.clave)} disabled={apagada}
                title={apagada ? "Esta materia todavía no tiene camino" : a.label}
                style={{
                  flex: 1, display: "flex", flexDirection: "column", alignItems: "center",
                  justifyContent: "center", gap: 3,
                  padding: "9px 4px 10px", background: "none", border: "none",
                  borderLeft: i === 0 ? "none" : `1.5px solid ${C.border}`,
                  color: apagada ? C.border : C.dim, cursor: apagada ? "default" : "pointer",
                }}
                onMouseEnter={(e) => { if (!apagada) e.currentTarget.style.color = col; }}
                onMouseLeave={(e) => { if (!apagada) e.currentTarget.style.color = C.dim; }}>
                {a.icono(18)}
                {!a.sinTexto && (
                  <span style={{ fontFamily: FONT.round, fontWeight: 700, fontSize: 11 }}>{a.label}</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function WeakCard({ s, w, onClick }: { s: Subject; w: WeakTopic; onClick: () => void }) {
  const col = subjectColor(s);
  return (
    <button onClick={onClick}
      style={{ display: "flex", alignItems: "center", gap: 12, textAlign: "left", width: "100%", background: C.panel, color: C.text, border: `2px solid ${C.ink}`, borderRadius: 14, padding: "12px 14px", cursor: "pointer", transition: "transform .13s, box-shadow .13s" }}
      onMouseEnter={(e) => { e.currentTarget.style.transform = "translate(-2px,-2px)"; e.currentTarget.style.boxShadow = HARD(col); }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = "none"; }}>
      <span style={{ width: 10, height: 34, flexShrink: 0, borderRadius: 4, background: col }} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontFamily: FONT.round, fontWeight: 700, fontSize: 15, lineHeight: 1.3 }}>{w.topic}</span>
        <span style={{ display: "block", color: C.dim, fontSize: 12.5, marginTop: 2 }}>
          {subjectLabel(s)}
          {w.misses > 1 && <> · fallado {w.misses} veces</>}
        </span>
      </span>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 5, flexShrink: 0, background: CTA, color: "#fff", border: `2px solid ${C.ink}`, borderRadius: 999, padding: "6px 12px", fontFamily: FONT.round, fontWeight: 700, fontSize: 12.5 }}>
        Reforzar <IconArrow size={13} />
      </span>
    </button>
  );
}

// --- Simulación de prueba (mundo Panel · bloques) ---
