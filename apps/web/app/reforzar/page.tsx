"use client";
/**
 * REPASO DE HOY — la sesión diaria de refuerzo.
 *
 * Antes esta pantalla mostraba la deuda entera: nueve temas fallados en una
 * lista que no se terminaba nunca, porque un tema sale de ahí recién cuando el
 * alumno lo aprueba en otra prueba. Se leía como un inventario de fracasos.
 *
 * Ahora son TRES por día, elegidos en el servidor (`lib/repaso.ts`) con un
 * criterio distinto cada uno, y la sesión termina. El resto sigue existiendo, a
 * un toque, pero no es lo primero que ve.
 *
 * ⚠️ EL MEDIDOR CUENTA LO INTENTADO, NO LO APROBADO. Es la decisión que sostiene
 * todo: si contara aciertos, el chico que estudia media hora, rinde y no aprueba
 * mira un "0 de 3" — el "estudié y no me sirvió de nada" que esta pantalla
 * existe para matar. El tilde lleno (aprobó) es otra señal y se dibuja distinta.
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PanelShell, PanelNav, contarReforzar, Centered } from "../panel";
import {
  C, FONT, HARD, Dots, IconCheck, IconArrow, IconChevron,
  subjectColor, subjectLabel,
} from "../ui";
import { CLASE_HUECO_RELOJ } from "../pomodoro";
import { cursoBloqueado } from "@/lib/cursos";
import { useAlumno, cerrarSesion } from "../usar-alumno";
import type { Subject, WeakTopic } from "../tipos";

interface TemaDelDia {
  slot: number; subjectId: string; subjectName: string;
  topicKey: string; topic: string; misses: number;
  hecho: boolean; aprobado: boolean;
}

export default function ReforzarPage() {
  const router = useRouter();
  const { loaded, profile, subjects, stats, role } = useAlumno();
  const [hoy, setHoy] = useState<{ temas: TemaDelDia[]; pendientes: number } | null>(null);
  const [verTodo, setVerTodo] = useState(false);

  useEffect(() => {
    if (loaded && (!profile || cursoBloqueado(profile.grade))) router.replace("/");
  }, [loaded, profile, router]);

  useEffect(() => {
    fetch("/api/reforzar/hoy").then((r) => (r.ok ? r.json() : null)).then(setHoy)
      .catch(() => { /* la pantalla lo dice abajo */ });
  }, []);

  /** Explicar: el chat con el tema, como siempre. Es el paso 1 del bucle. */
  const explicar = useCallback((t: { subjectId: string; topic: string }) => {
    const q = `Quiero repasar: ${t.topic}. Explicámelo simple, desde el principio y con un ejemplo.`;
    router.push(`/materia/${t.subjectId}/chat?${new URLSearchParams({ q })}`);
  }, [router]);

  /** Probar: el chequeo de esa lección. Es el paso que CIERRA el tema — al
   *  aprobarlo, el servidor lo saca de refuerzo y marca la sesión de hoy. */
  const probar = useCallback((t: { subjectId: string; topicKey: string }) => {
    router.push(`/materia/${t.subjectId}/camino/${t.topicKey}`);
  }, [router]);

  if (!loaded || !profile) return <Centered><span style={{ color: C.dim }}><Dots /></span></Centered>;

  const temas = hoy?.temas ?? [];
  const hechos = temas.filter((t) => t.hecho).length;
  const total = temas.length;
  const terminado = total > 0 && hechos === total;
  const pendientes = hoy?.pendientes ?? contarReforzar(subjects, stats);

  return (
    <PanelShell nav={
      <PanelNav profile={profile} pendientes={pendientes}
        teacher={role === "teacher" || role === "admin"}
        onEdit={() => router.push("/?editar=1")}
        onLogout={() => { void cerrarSesion().then(() => router.replace("/login")); }} />
    }>
      <header className={CLASE_HUECO_RELOJ} style={{ marginBottom: 20 }}>
        <div style={{ fontFamily: FONT.round, fontSize: 24, fontWeight: 800, letterSpacing: -0.3 }}>Repaso de hoy</div>
        <p style={{ color: C.dim, fontSize: 14, lineHeight: 1.5, margin: "3px 0 0", maxWidth: 560 }}>
          {!hoy ? "Buscando qué te conviene repasar…"
            : total === 0 ? "Acá va a estar lo que se te escape en las pruebas."
              : terminado ? "Terminaste."
                : total === 1 ? "Te queda un tema. Con ese terminás."
                  : `${total} temas. Cuando los termines, listo por hoy.`}
        </p>
      </header>

      {!hoy ? (
        <div style={{ color: C.dim, padding: "20px 0" }}><Dots /></div>
      ) : total === 0 ? (
        <Vacio hayPendientes={pendientes > 0} onVerTodo={() => setVerTodo(true)} />
      ) : (
        <>
          {/* EL MEDIDOR. Cuenta lo intentado; nunca baja. */}
          <div style={{ display: "grid", gap: 6, marginBottom: 18, maxWidth: 420 }}>
            <div style={{ height: 10, borderRadius: 999, background: C.panel2, border: `2px solid ${C.ink}`, overflow: "hidden" }}>
              <div style={{ width: `${Math.max(4, (hechos / total) * 100)}%`, height: "100%", background: terminado ? C.ok : `linear-gradient(90deg, ${C.ok}, #35C579)`, transition: "width .5s cubic-bezier(.2,.8,.2,1)" }} />
            </div>
            <span style={{ fontFamily: FONT.mono, fontSize: 12, color: C.dim }}>{hechos} de {total}</span>
          </div>

          {terminado && (
            <div style={{ display: "flex", alignItems: "center", gap: 13, background: C.okBg, border: `2px solid ${C.ink}`, borderRadius: 16, boxShadow: HARD(C.ok), padding: "14px 16px", marginBottom: 20 }}>
              <span style={{ fontSize: 26, lineHeight: 1 }}>🌱</span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontFamily: FONT.round, fontWeight: 800, fontSize: 16.5, color: C.okTx }}>Listo por hoy</div>
                {/* El cierre NOMBRA cuánto queda. Sin eso, tres días seguidos de
                    "listo" que no achican la pila enseñan que la frase es
                    decorativa. */}
                <div style={{ color: C.dim, fontSize: 13, lineHeight: 1.45 }}>
                  {pendientes === 0
                    ? "No te queda nada pendiente. En serio."
                    : <>Mañana te propongo otros. Te quedan {pendientes} en total.</>}
                </div>
              </div>
            </div>
          )}

          <div style={{ display: "grid", gap: 10, marginBottom: 26 }}>
            {temas.map((t) => (
              <TemaFila key={t.topicKey} t={t}
                color={subjectColor({ name: t.subjectName })}
                onExplicar={() => explicar(t)} onProbar={() => probar(t)} />
            ))}
          </div>
        </>
      )}

      {/* EL RESTO. Existe, pero detrás de un toque: mostrarlo entero es volver a
          la deuda de nueve renglones que esta pantalla vino a reemplazar. */}
      {pendientes > temas.length && (
        <>
          <button onClick={() => setVerTodo((v) => !v)}
            style={{ display: "inline-flex", alignItems: "center", gap: 7, background: "none", border: "none", color: C.dim, cursor: "pointer", fontFamily: FONT.round, fontWeight: 700, fontSize: 13.5, padding: 0, marginBottom: verTodo ? 14 : 0 }}>
            <span style={{ display: "flex", transform: verTodo ? "rotate(90deg)" : "none", transition: "transform .18s" }}>
              <IconChevron size={15} />
            </span>
            {verTodo ? "Ocultar el resto" : `Ver todo lo que te falta (${pendientes})`}
          </button>
          {verTodo && <TodoLoQueFalta subjects={subjects} stats={stats} onExplicar={explicar} />}
        </>
      )}
    </PanelShell>
  );
}

/**
 * Un tema del día. Tres estados y tres pesos visuales:
 *   pendiente  → borde de tinta, dos acciones
 *   intentado  → medio tono, "lo intentaste" y la invitación a volver
 *   aprobado   → tachado y tilde lleno
 */
function TemaFila({ t, color, onExplicar, onProbar }: {
  t: TemaDelDia; color: string; onExplicar: () => void; onProbar: () => void;
}) {
  const cerrado = t.aprobado;
  const intentado = t.hecho && !t.aprobado;
  return (
    <div style={{
      // `wrap` + un ancho mínimo para el texto: en el teléfono los dos botones
      // le comían el ancho al título y "Definición de cambio porcentual" salía
      // en tres líneas de dos palabras. Con esto, cuando no entra, los botones
      // bajan a su propio renglón y el título respira.
      display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
      background: cerrado ? C.okBg : C.panel,
      border: `2px solid ${cerrado ? C.border : C.ink}`, borderRadius: 14,
      boxShadow: cerrado ? "none" : HARD(color), padding: "12px 14px",
      opacity: cerrado ? 0.75 : 1,
    }}>
      <span style={{ width: 5, alignSelf: "stretch", minHeight: 34, borderRadius: 3, background: cerrado ? C.ok : color, flexShrink: 0 }} />

      <span style={{ flex: "1 1 190px", minWidth: 0 }}>
        <span style={{ display: "block", fontFamily: FONT.round, fontWeight: 700, fontSize: 15, lineHeight: 1.3, textDecoration: cerrado ? "line-through" : "none", color: cerrado ? C.dim : C.text }}>
          {t.topic}
        </span>
        <span style={{ display: "block", color: C.dim, fontSize: 12.5, marginTop: 1 }}>
          {/* El número de fallos NO se muestra: el chico no necesita ver su
              propio marcador de errores. Se usa para elegir, no para exhibir. */}
          {cerrado ? "Lo cerraste hoy" : intentado ? "Lo intentaste · probá de nuevo cuando quieras" : subjectLabel({ name: t.subjectName })}
        </span>
      </span>

      {cerrado ? (
        <span style={{ display: "grid", placeItems: "center", width: 30, height: 30, flexShrink: 0, borderRadius: "50%", background: C.ok, color: "#fff" }}>
          <IconCheck size={16} />
        </span>
      ) : (
        <span style={{ display: "flex", gap: 7, flexShrink: 0, marginLeft: "auto" }}>
          <button onClick={onExplicar}
            style={{ display: "inline-flex", alignItems: "center", gap: 5, background: C.panel2, color: C.dim, border: `1.5px solid ${C.border}`, borderRadius: 999, padding: "7px 12px", cursor: "pointer", fontFamily: FONT.round, fontWeight: 700, fontSize: 12.5 }}>
            Explicámelo
          </button>
          <button onClick={onProbar}
            style={{ display: "inline-flex", alignItems: "center", gap: 5, background: C.accent, color: "#fff", border: `2px solid ${C.ink}`, borderRadius: 999, padding: "7px 13px", cursor: "pointer", fontFamily: FONT.round, fontWeight: 700, fontSize: 12.5 }}>
            {intentado ? "Otra vez" : "Probar"} <IconArrow size={13} />
          </button>
        </span>
      )}
    </div>
  );
}

/** Sin sesión: o no falló nada, o lo que falló no se puede cerrar todavía. */
function Vacio({ hayPendientes, onVerTodo }: { hayPendientes: boolean; onVerTodo: () => void }) {
  if (!hayPendientes) {
    return (
      <div style={{ background: C.okBg, border: `2px solid ${C.ink}`, borderRadius: 18, boxShadow: HARD(C.ok), padding: "24px 22px", maxWidth: 560 }}>
        <div style={{ fontSize: 30, lineHeight: 1, marginBottom: 8 }}>🎉</div>
        <div style={{ fontFamily: FONT.round, fontWeight: 800, fontSize: 19, color: C.okTx }}>No tenés nada pendiente</div>
        <p style={{ color: C.dim, fontSize: 14, lineHeight: 1.55, margin: "6px 0 0" }}>
          Cuando algo se te escape en una prueba, aparece acá al día siguiente con su repaso listo.
        </p>
      </div>
    );
  }
  // Tiene temas fallados pero ninguno se puede cerrar: son de lecciones que ya
  // no existen en el camino (se regeneró el plan y cambiaron las claves).
  return (
    <div style={{ background: C.warnBg, border: `2px solid ${C.ink}`, borderRadius: 18, boxShadow: HARD(C.sun), padding: "22px 22px", maxWidth: 560 }}>
      <div style={{ fontFamily: FONT.round, fontWeight: 800, fontSize: 17, color: C.warnTx }}>
        Hoy no tengo repaso para armarte
      </div>
      <p style={{ color: C.dim, fontSize: 14, lineHeight: 1.55, margin: "6px 0 14px" }}>
        Lo que te falta es de lecciones que cambiaron cuando se rehízo el camino, así que no
        tienen preguntas para volver a intentar. Igual te lo puedo explicar.
      </p>
      <button onClick={onVerTodo}
        style={{ background: C.panel, color: C.text, border: `2px solid ${C.ink}`, borderRadius: 12, padding: "9px 15px", cursor: "pointer", fontFamily: FONT.round, fontWeight: 700, fontSize: 13.5 }}>
        Ver qué es
      </button>
    </div>
  );
}

/** La lista completa, agrupada por materia. Es lo que antes era TODA la
 *  pantalla; ahora vive detrás de un toque. */
function TodoLoQueFalta({ subjects, stats, onExplicar }: {
  subjects: Subject[];
  stats: Record<string, { weak: WeakTopic[] }>;
  onExplicar: (t: { subjectId: string; topic: string }) => void;
}) {
  const grupos = subjects
    .filter((s) => !s.disabled && (stats[s.id]?.weak.length ?? 0) > 0)
    .map((s) => ({ s, temas: stats[s.id]!.weak }));
  return (
    <div style={{ display: "grid", gap: 18, marginBottom: 30 }}>
      {grupos.map(({ s, temas }) => (
        <div key={s.id}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span style={{ width: 9, height: 9, borderRadius: 3, background: subjectColor(s) }} />
            <span style={{ fontFamily: FONT.round, fontWeight: 800, fontSize: 14 }}>{subjectLabel(s)}</span>
            <span style={{ color: C.dim, fontSize: 12.5 }}>{temas.length}</span>
          </div>
          <div style={{ display: "grid", gap: 7 }}>
            {temas.map((w) => (
              <button key={w.topicKey} onClick={() => onExplicar({ subjectId: s.id, topic: w.topic })}
                style={{ display: "flex", alignItems: "center", gap: 10, textAlign: "left", background: C.panel, border: `1.5px solid ${C.border}`, borderRadius: 11, padding: "9px 12px", cursor: "pointer", font: "inherit", color: C.text }}
                onMouseEnter={(e) => { e.currentTarget.style.background = C.panel2; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = C.panel; }}>
                <span style={{ flex: 1, minWidth: 0, fontFamily: FONT.round, fontWeight: 700, fontSize: 13.5 }}>{w.topic}</span>
                <IconArrow size={14} />
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
