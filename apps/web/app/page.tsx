"use client";
/**
 * EL PANEL — la única responsabilidad de `/`.
 *
 * Antes este archivo tenía 1.585 líneas y hacía TODO: panel, chat, camino,
 * prueba y la llamada de voz, con vistas condicionales sobre el mismo estado.
 * Ahora la materia vive en `/materia/[id]` con sus tres páginas, y acá queda lo
 * que de verdad es el panel: quién sos, qué materias tenés y qué te falta.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Dashboard, Onboarding, Centered, type Actividad } from "./panel";
import { C, Dots } from "./ui";
import type { Profile, Subject, SubjectStats, WeakTopic } from "./tipos";

/** Claves del esquema VIEJO. Se borran al entrar: el perfil guardaba el NOMBRE
 *  del alumno —justo lo que se elimina por privacidad— y el plan/progreso
 *  pertenecían a "quien haya usado este navegador", que es el bug que el login
 *  arregla. Migrarlos le regalaría a un chico el progreso de otro. */
const CLAVES_VIEJAS = ["tutor_profile"];
function limpiarLocalStorageViejo() {
  try {
    for (const k of Object.keys(localStorage)) {
      if (CLAVES_VIEJAS.includes(k) || k.startsWith("tutor_plan_") || k.startsWith("tutor_progress_")) {
        localStorage.removeItem(k);
      }
    }
  } catch { /* Safari en privado tira al tocar localStorage */ }
}

export default function Home() {
  const router = useRouter();
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [stats, setStats] = useState<Record<string, SubjectStats>>({});
  const [role, setRole] = useState("student");
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    limpiarLocalStorageViejo();
    fetch("/api/subjects").then((r) => r.json()).then((j) => setSubjects(j.subjects ?? j)).catch(() => {});
    fetch("/api/me")
      .then((r) => { if (r.status === 401) { router.replace("/login"); return null; } return r.json(); })
      .then((j) => {
        if (!j) return;
        setRole(j.user?.role ?? "student");
        if (j.profile?.grade) setProfile({ username: j.user?.username ?? "", grade: j.profile.grade });
      })
      .catch(() => { /* sin red: se queda en el onboarding */ })
      .finally(() => setLoaded(true));
  }, [router]);

  // El avance se relee al volver al panel: el alumno pudo hacer lecciones o
  // rendir una prueba en otra página y espera verlo reflejado acá.
  useEffect(() => {
    if (!subjects.length) return;
    fetch("/api/progress").then((r) => r.json()).then((j) => setStats(j.progress ?? {}))
      .catch(() => { /* el panel muestra ceros */ });
  }, [subjects]);

  async function saveProfile(p: Profile) {
    setProfile(p);
    try {
      await fetch("/api/me", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grade: p.grade }),
      });
    } catch { /* queda en memoria; se reintenta al próximo guardado */ }
  }

  async function logout() {
    try { await fetch("/api/auth/logout", { method: "POST" }); } catch { /* igual salimos */ }
    router.replace("/login");
  }

  /** "Reforzar": abre la materia Y arranca el estudio dirigido, mandando la
   *  pregunta por la URL para que el chat la dispare al montar. */
  function reinforce(id: string, w: WeakTopic) {
    const q = `Quiero repasar: ${w.topic}. Explicámelo simple, desde el principio y con un ejemplo.`;
    const p = new URLSearchParams({ q, unit: String(w.unit ?? ""), lesson: String(w.lesson ?? "") });
    router.push(`/materia/${id}/chat?${p}`);
  }

  if (!loaded) return <Centered><span style={{ color: C.dim }}><Dots /></span></Centered>;
  if (!profile || editing) {
    return (
      <Onboarding
        subjects={subjects}
        initial={editing ? profile ?? undefined : undefined}
        onCancel={editing ? () => setEditing(false) : undefined}
        onDone={(p) => { void saveProfile(p); setEditing(false); }}
      />
    );
  }
  return (
    <Dashboard
      profile={profile}
      subjects={subjects}
      stats={stats}
      teacher={role === "teacher" || role === "admin"}
      // Directo a la actividad: la pantalla intermedia le preguntaba al alumno
      // algo que ya había contestado al elegir el ícono.
      onAbrir={(id, a: Actividad) => router.push(`/materia/${id}/${a}`)}
      onReinforce={reinforce}
      onEdit={() => setEditing(true)}
      onLogout={logout}
    />
  );
}
