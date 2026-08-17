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
  C, FONT, HARD, Dots, IconCheck, IconAlert, IconArrow, IconBook,
  subjectColor, subjectLabel, isLight,
} from "../ui";
import { CLASE_HUECO_RELOJ } from "../pomodoro";
import { cursoBloqueado } from "@/lib/cursos";
import { useAlumno, cerrarSesion } from "../usar-alumno";

interface ResumenMateria {
  id: string; name: string; grade: string | null;
  planDone: number; planTotal: number;
  fuertes: { topicKey: string; topic: string; score: number; total: number }[];
  pendientes: number;
  lastScore: { score: number; total: number } | null;
}
interface Resumen {
  hechas: { lecciones: number; chequeos: number; pruebas: number };
  materias: ResumenMateria[];
}

export default function ResumenPage() {
  const router = useRouter();
  const { loaded, profile, subjects, stats, role } = useAlumno();
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
  // Las de SU curso primero; las de otro curso solo si hizo algo ahí (rindió una
  // prueba de 1º Medio y esos temas también son suyos).
  const materias = (datos?.materias ?? []).filter((m) =>
    m.grade === profile.grade || m.planDone > 0 || m.fuertes.length > 0 || m.pendientes > 0);
  const delCurso = materias.filter((m) => m.grade === profile.grade);
  const deOtro = materias.filter((m) => m.grade !== profile.grade);
  const fuertes = materias.flatMap((m) => m.fuertes.map((f) => ({ m, f })));
  const pendientes = contarReforzar(subjects, stats);

  return (
    <PanelShell nav={
      <PanelNav profile={profile} pendientes={pendientes}
        teacher={role === "teacher" || role === "admin"}
        onEdit={() => router.push("/?editar=1")}
        onLogout={() => { void cerrarSesion().then(() => router.replace("/login")); }} />
    }>
      <header className={CLASE_HUECO_RELOJ} style={{ marginBottom: 22 }}>
        <div style={{ fontFamily: FONT.round, fontSize: 24, fontWeight: 800, letterSpacing: -0.3 }}>Tu resumen</div>
        <p style={{ color: C.dim, fontSize: 14, lineHeight: 1.5, margin: "3px 0 0", maxWidth: 560 }}>
          Todo lo que llevás hecho, y lo que ya te sale.
        </p>
      </header>

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
      <div style={{ display: "grid", gap: 10, marginBottom: deOtro.length ? 26 : 34 }}>
        {delCurso.map((m) => <FilaMateria key={m.id} m={m} onReforzar={() => router.push("/reforzar")} />)}
        {delCurso.length === 0 && (
          <p style={{ color: C.dim, fontSize: 14 }}>Todavía no hay materias cargadas para tu curso.</p>
        )}
      </div>

      {deOtro.length > 0 && (
        <>
          <p style={{ color: C.dim, fontFamily: FONT.round, fontWeight: 700, fontSize: 12, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 10 }}>
            De otros cursos
          </p>
          <div style={{ display: "grid", gap: 10, marginBottom: 34 }}>
            {deOtro.map((m) => <FilaMateria key={m.id} m={m} otro onReforzar={() => router.push("/reforzar")} />)}
          </div>
        </>
      )}
    </PanelShell>
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
function FilaMateria({ m, otro, onReforzar }: { m: ResumenMateria; otro?: boolean; onReforzar: () => void }) {
  const col = subjectColor(m);
  const onCol = isLight(col) ? C.ink : "#fff";
  const pct = m.planTotal > 0 ? Math.round((m.planDone / m.planTotal) * 100) : 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, background: C.panel, border: `2px solid ${C.ink}`, borderRadius: 14, padding: "12px 14px" }}>
      <span style={{ width: 32, height: 32, flexShrink: 0, borderRadius: 10, background: col, color: onCol, display: "grid", placeItems: "center" }}>
        <IconBook size={17} />
      </span>

      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontFamily: FONT.round, fontWeight: 800, fontSize: 15, lineHeight: 1.25 }}>
          {subjectLabel(m)}{otro && m.grade && <span style={{ color: C.dim, fontWeight: 700 }}> · {m.grade}</span>}
        </span>
        <span style={{ display: "block", color: C.dim, fontSize: 12.5, marginTop: 1 }}>
          {m.planTotal > 0 ? <>{m.planDone} de {m.planTotal} temas · {pct}%</> : "Sin camino armado"}
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
            <IconAlert size={11} /> {m.pendientes} <IconArrow size={11} />
          </button>
        )}
      </span>
    </div>
  );
}
