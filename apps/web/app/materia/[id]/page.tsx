"use client";
/**
 * `/materia/[id]` — ya no es una pantalla, es una redirección.
 *
 * Fue por un rato la pantalla de "¿qué querés hacer?", con las tres actividades
 * en grande. La sacamos: el alumno elige la actividad desde la tarjeta de la
 * materia en el panel, así que llegar acá significaba contestar dos veces la
 * misma pregunta y pagar un cambio de página en el medio.
 *
 * Se conserva la ruta redirigiendo porque hay links viejos apuntando acá (los
 * que se compartieron, el historial del navegador) y morir en un 404 por un
 * cambio de navegación interno es gratuito de evitar.
 */
import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

export default function MateriaIndex() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  useEffect(() => { router.replace(`/materia/${id}/camino`); }, [id, router]);
  return null;
}
