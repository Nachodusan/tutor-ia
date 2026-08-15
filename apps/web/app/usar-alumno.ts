"use client";
/**
 * QUIÉN SOY, QUÉ CURSO, QUÉ MATERIAS Y CÓMO VOY — para las pantallas del alumno.
 *
 * Vivía adentro de `page.tsx` cuando el panel era la única pantalla con nav. Con
 * `/reforzar` al lado pasaron a ser dos, y copiar el bloque de carga tiene un
 * costo concreto: el que se olvida de mirar el 401 deja al alumno sin sesión
 * mirando una pantalla vacía en vez de mandarlo al login. Acá está una vez.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { traerMaterias } from "./datos";
import type { Profile, Subject, SubjectStats } from "./tipos";

export interface Alumno {
  /** `false` hasta que se sabe si hay sesión y perfil: sin esto, la pantalla
   *  parpadea el onboarding antes de mostrar el panel de alguien que ya eligió. */
  loaded: boolean;
  profile: Profile | null;
  setProfile: (p: Profile | null) => void;
  subjects: Subject[];
  stats: Record<string, SubjectStats>;
  role: string;
}

export function useAlumno(): Alumno {
  const router = useRouter();
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [stats, setStats] = useState<Record<string, SubjectStats>>({});
  const [role, setRole] = useState("student");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void traerMaterias().then(setSubjects);
    fetch("/api/me")
      .then((r) => { if (r.status === 401) { router.replace("/login"); return null; } return r.json(); })
      .then((j) => {
        if (!j) return;
        setRole(j.user?.role ?? "student");
        if (j.profile?.grade) setProfile({ username: j.user?.username ?? "", grade: j.profile.grade });
      })
      .catch(() => { /* sin red: la pantalla decide qué hacer con profile null */ })
      .finally(() => setLoaded(true));
  }, [router]);

  // El avance se relee al volver: el alumno pudo hacer lecciones o rendir una
  // prueba en otra página y espera verlo reflejado.
  useEffect(() => {
    if (!subjects.length) return;
    fetch("/api/progress").then((r) => r.json()).then((j) => setStats(j.progress ?? {}))
      .catch(() => { /* la pantalla muestra ceros */ });
  }, [subjects]);

  return { loaded, profile, setProfile, subjects, stats, role };
}

/** Cerrar sesión. Devuelve siempre: si el servidor no contesta, igual se sale. */
export async function cerrarSesion(): Promise<void> {
  try { await fetch("/api/auth/logout", { method: "POST" }); } catch { /* igual salimos */ }
}
