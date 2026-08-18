"use client";
/**
 * EL PERFIL DEL ALUMNO — su avatar y sus logros. Nada más, y es a propósito.
 *
 * Acá NO hay nombre, ni foto, ni fecha de nacimiento, ni colegio, ni un campo
 * "contame de vos". Las cuentas son de menores y son anónimas: el mapeo de
 * "7b-01" a una persona vive en papel en el colegio y no entra a esta base
 * (ver `schema_auth.sql`). Lo único que se puede cambiar es el bicho del
 * avatar, que alcanza para que la cuenta se sienta propia sin decir quién es.
 *
 * Los logros salen de datos REALES (`/api/progress` + el perfil), no de una
 * tabla nueva ni de un mockup: ver `logros.ts`. Los que faltan se muestran
 * apagados y con la condición escrita — el que no se ve no motiva a nadie.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PanelShell, PanelNav, Avatar, contarReforzar, Centered } from "../panel";
import { C, FONT, HARD, Dots, IconCheck, IconLock, gradeLabel, subjectLabel } from "../ui";
import { CLASE_HUECO_RELOJ } from "../pomodoro";
import { AVATARES } from "../avatares";
import { IconoLogro } from "../iconos-logros";
import { calcularLogros } from "../logros";
import { cursoBloqueado } from "@/lib/cursos";
import { useAlumno, cerrarSesion } from "../usar-alumno";

export default function PerfilPage() {
  const router = useRouter();
  const { loaded, profile, setProfile, subjects, stats, role, pomodoroLastAt } = useAlumno();
  const [guardando, setGuardando] = useState<string | null>(null);

  useEffect(() => {
    if (loaded && (!profile || cursoBloqueado(profile.grade))) router.replace("/");
  }, [loaded, profile, router]);

  if (!loaded || !profile) return <Centered><span style={{ color: C.dim }}><Dots /></span></Centered>;

  /** El avatar se pinta YA y se guarda detrás: elegir un bicho no puede tener
   *  latencia. Si el guardado falla, el próximo `/api/me` lo devuelve al que
   *  estaba — y el alumno vuelve a tocar, que es barato. */
  function elegirAvatar(id: string) {
    const nuevo = profile!.avatar === id ? null : id;   // tocar el mismo lo quita
    setProfile({ ...profile!, avatar: nuevo });
    setGuardando(id);
    void fetch("/api/me/profile", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ avatar: nuevo }),
    })
      .catch(() => { /* queda en pantalla; se reintenta al próximo toque */ })
      .finally(() => setGuardando(null));
  }

  const logros = calcularLogros({ subjects, stats, pomodoroLastAt });
  const ganados = logros.filter((l) => l.logrado).length;

  // Las materias del curso son las que CURSA; las lecciones hechas se cuentan
  // sobre TODAS (mismo universo que `calcularLogros`). Si acá se contaran solo
  // las del curso, un alumno que rindió en otro curso vería "0 lecciones" al
  // lado de un "Primer paso ✓" ganado — dos números de la misma pantalla
  // contradiciéndose.
  const propias = subjects.filter((s) => s.grade === profile.grade && !s.disabled);
  const hechas = subjects
    .filter((s) => !s.disabled)
    .reduce((n, s) => n + (stats[s.id]?.planDone ?? 0), 0);

  return (
    <PanelShell nav={
      <PanelNav profile={profile} pendientes={contarReforzar(subjects, stats)}
        teacher={role === "teacher" || role === "admin"}
        onEdit={() => router.push("/?editar=1")}
        onLogout={() => { void cerrarSesion().then(() => router.replace("/login")); }} />
    }>
      {/* ── QUIÉN SOS ─────────────────────────────────────────────────────── */}
      <header className={CLASE_HUECO_RELOJ} style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 28 }}>
        <Avatar id={profile.avatar} size={72} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: FONT.round, fontSize: 26, fontWeight: 800, letterSpacing: -0.3 }}>
            {profile.username}
          </div>
          <div style={{ color: C.dim, fontSize: 14, lineHeight: 1.5 }}>
            {gradeLabel(profile.grade)} · {propias.length} {propias.length === 1 ? "materia" : "materias"}
            {hechas > 0 && <> · {hechas} {hechas === 1 ? "lección hecha" : "lecciones hechas"}</>}
          </div>
        </div>
      </header>

      {/* ── LOS LOGROS ────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 9, marginBottom: 12, flexWrap: "wrap" }}>
        <span style={{ fontFamily: FONT.round, fontWeight: 800, fontSize: 17 }}>Tus logros</span>
        <span style={{ color: C.dim, fontSize: 13 }}>{ganados} de {logros.length}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: 12, marginBottom: 34 }}>
        {logros.map((l) => (
          <div key={l.id}
            style={{
              display: "flex", alignItems: "center", gap: 12,
              background: l.logrado ? C.panel : C.panel2,
              border: `2px solid ${l.logrado ? C.ink : C.border}`, borderRadius: 14,
              boxShadow: l.logrado ? HARD(C.sun) : "none", padding: "11px 13px",
            }}>
            {/* El que falta va en gris y con candado, no escondido: el logro que
                no se ve no motiva a nadie, y el chico tiene derecho a saber qué
                le falta para ganarlo. */}
            {/* El pendiente se atenúa por COLOR, no con grayscale + opacidad:
                el dibujo queda nítido y solo más callado. Con emoji eso no se
                podía y salía borroso. */}
            <span style={{ display: "flex", flexShrink: 0, lineHeight: 1 }}>
              <IconoLogro id={l.icono} size={26} color={l.logrado ? C.ink : "#9B94A6"} />
            </span>
            <span style={{ minWidth: 0, flex: 1 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 5, fontFamily: FONT.round, fontWeight: 800, fontSize: 14.5, color: l.logrado ? C.text : C.dim }}>
                {l.nombre}
                {l.logrado && <IconCheck size={13} color={C.okTx} />}
              </span>
              <span style={{ display: "block", color: C.dim, fontSize: 12, lineHeight: 1.4, marginTop: 1 }}>
                {l.detalle}
              </span>
            </span>
          </div>
        ))}
      </div>

      {/* ── EL AVATAR ─────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 9, marginBottom: 4, flexWrap: "wrap" }}>
        <span style={{ fontFamily: FONT.round, fontWeight: 800, fontSize: 17 }}>Tu avatar</span>
        <span style={{ color: C.dim, fontSize: 13 }}>tocá el que quieras</span>
      </div>
      <p style={{ color: C.dim, fontSize: 13, lineHeight: 1.5, margin: "0 0 14px", maxWidth: 560 }}>
        Es lo único que se puede cambiar de tu cuenta, y está bien así: acá nadie
        sabe quién sos —ni tu nombre, ni tu foto— y eso es lo que te deja preguntar
        cualquier cosa sin vergüenza.
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 34 }}>
        {AVATARES.map((a) => {
          const puesto = profile.avatar === a.id;
          return (
            <button key={a.id} onClick={() => elegirAvatar(a.id)}
              title={puesto ? `${a.nombre} · tocá para sacarlo` : a.nombre}
              aria-pressed={puesto}
              style={{
                width: 54, height: 54, borderRadius: 16, background: a.color,
                border: `2.5px solid ${puesto ? C.ink : "transparent"}`,
                boxShadow: puesto ? HARD(C.ink) : "none",
                display: "grid", placeItems: "center", fontSize: 27, lineHeight: 1,
                cursor: "pointer", padding: 0, opacity: guardando === a.id ? 0.6 : 1,
                transition: "transform .12s, box-shadow .12s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-3px)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.transform = "none"; }}>
              {a.emoji}
            </button>
          );
        })}
      </div>

      {/* ── LO QUE NO SE GUARDA ───────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 11, alignItems: "flex-start", background: C.panel2, border: `1.5px solid ${C.border}`, borderRadius: 14, padding: "13px 15px", maxWidth: 620, marginBottom: 34 }}>
        <span style={{ display: "flex", flexShrink: 0, color: C.dim, marginTop: 1 }}><IconLock size={17} /></span>
        <span style={{ fontSize: 13, lineHeight: 1.55, color: C.dim }}>
          <strong style={{ color: C.text, fontFamily: FONT.round }}>Tu cuenta es anónima.</strong>{" "}
          No guardamos tu nombre ni ningún dato tuyo, y tu profe ve cómo vas
          {propias.length > 0 && <> en {subjectLabel(propias[0]!)} y las demás</>} — pero
          <strong style={{ color: C.text }}> nunca lo que le preguntás al tutor</strong>.
        </span>
      </div>
    </PanelShell>
  );
}
