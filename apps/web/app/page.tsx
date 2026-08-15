"use client";
/**
 * EL PANEL — la única responsabilidad de `/`.
 *
 * Antes este archivo tenía 1.585 líneas y hacía TODO: panel, chat, camino,
 * prueba y la llamada de voz, con vistas condicionales sobre el mismo estado.
 * Ahora la materia vive en `/materia/[id]` con sus tres páginas, "Para reforzar"
 * en `/reforzar`, y acá queda lo que de verdad es el panel: quién sos, qué
 * materias tenés y cómo vas.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Dashboard, Onboarding, Centered, CursoCerrado, type Actividad } from "./panel";
import { C, Dots } from "./ui";
import { cursoBloqueado } from "@/lib/cursos";
import { useAlumno, cerrarSesion } from "./usar-alumno";
import type { Profile } from "./tipos";

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
  const { loaded, profile, setProfile, subjects, stats, role } = useAlumno();
  const [editing, setEditing] = useState(false);

  useEffect(() => { limpiarLocalStorageViejo(); }, []);

  // `?editar=1` abre directo la elección de curso. Lo usa "Mi curso" desde otra
  // pantalla del nav, que no puede prender un estado que vive acá. Se lee del
  // `location` y no con `useSearchParams` a propósito: ese hook obliga a
  // envolver la página en un <Suspense> para el prerender, y esto es un flag.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("editar") === "1") {
      setEditing(true);
      // Se limpia la URL: si queda, el "atrás" del navegador vuelve a abrir el
      // editor y el alumno no entiende por qué le repreguntan el curso.
      window.history.replaceState(null, "", "/");
    }
  }, []);

  async function saveProfile(p: Profile) {
    // Un curso cerrado no se guarda ni se pinta: la pantalla de elección ya no
    // lo ofrece, pero el estado local no tiene por qué confiar en eso.
    if (cursoBloqueado(p.grade)) return;
    setProfile(p);
    try {
      // `POST /api/me` devolvía 405 —esa ruta solo tiene GET— y el `catch` de
      // abajo se tragaba el error: el curso se veía cambiado en pantalla y NO
      // se guardaba. La ruta que guarda es esta, y no la llamaba nadie.
      await fetch("/api/me/profile", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grade: p.grade }),
      });
    } catch { /* queda en memoria; se reintenta al próximo guardado */ }
  }

  async function logout() {
    await cerrarSesion();
    router.replace("/login");
  }

  if (!loaded) return <Centered><span style={{ color: C.dim }}><Dots /></span></Centered>;
  // Curso cerrado (1º a 5º básico): el perfil pudo quedar de antes o haberlo
  // puesto el CLI. Se le explica en vez de mostrarle un panel vacío. `editing`
  // manda: es la salida — cambiar de curso.
  if (profile && !editing && cursoBloqueado(profile.grade)) {
    return <CursoCerrado grade={profile.grade} onEdit={() => setEditing(true)} onLogout={logout} />;
  }
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
      onEdit={() => setEditing(true)}
      onLogout={logout}
    />
  );
}
