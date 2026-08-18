"use client";
/**
 * LA MATERIA — encabezado y navegación entre sus tres páginas.
 *
 * Antes esto era UNA pantalla con vistas condicionales: el camino se dibujaba
 * encima del chat y la prueba encima de los dos. Eso tenía tres problemas que se
 * arreglan solos al partirlo en rutas:
 *  · No había URL. El alumno no podía volver con el botón "atrás" del navegador
 *    ni dejar abierta la prueba en una pestaña.
 *  · El estado de las tres vivía a la vez en el mismo componente, así que abrir
 *    la prueba obligaba a mantener en memoria el chat entero.
 *  · Visualmente el plan quedaba "arriba" del chat, que es exactamente lo que se
 *    quiso corregir: son actividades distintas, no capas de la misma.
 */
import { useRouter, usePathname, useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { C, FONT, AuroraDot, IconBack, IconCamino, IconPrueba, gradeLabel, subjectLabel } from "../../ui";
import { CLASE_HUECO_RELOJ } from "../../pomodoro";
import { traerMateria } from "../../datos";
import type { Subject } from "../../tipos";

export default function MateriaLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { id } = useParams<{ id: string }>();
  const [subject, setSubject] = useState<Subject | null>(null);
  const [grade, setGrade] = useState("");

  useEffect(() => {
    void traerMateria(id).then((s) => setSubject(s ?? null));
    fetch("/api/me").then((r) => r.json())
      .then((j) => setGrade(j.profile?.grade ?? ""))
      .catch(() => { /* el encabezado se muestra sin curso */ });
  }, [id]);

  const base = `/materia/${id}`;
  /**
   * Las tres actividades. En la esquina se muestran SOLO LAS OTRAS DOS: la que
   * estás usando no necesita un botón para ir a sí misma, y ponerlo obliga al
   * alumno a leer cuál está activa antes de tocar. Menos que decidir.
   *
   * En la pantalla de elección (`base`) no se muestra ninguna: ahí están las
   * tres, grandes, que es toda la pantalla.
   */
  const ACTIVIDADES = [
    { href: `${base}/camino`, label: "Tu camino", icono: <IconCamino size={17} /> },
    { href: `${base}/chat`, label: "Preguntar", icono: <AuroraDot size={18} /> },
    { href: `${base}/prueba`, label: "Prueba", icono: <IconPrueba size={17} /> },
  ];
  const enElegir = pathname === base;
  const otras = ACTIVIDADES.filter((a) => !pathname.startsWith(a.href));

  return (
    <div style={{ height: "100dvh", display: "flex", flexDirection: "column", background: C.bg, color: C.text, fontFamily: FONT.sans }}>
      <header style={{ borderBottom: `1px solid ${C.border}`, background: C.bg, flexShrink: 0 }}>
        {/* El `paddingRight` es el hueco del RELOJ FLOTANTE (esquina superior
            derecha, en todas las pantallas). Un elemento `fixed` no empuja a
            nadie: si este encabezado no le reserva el lugar, el reloj se sienta
            encima de los botones de las otras dos actividades. */}
        {/* El padding va en LONGHAND (sin el atajo `padding`) porque el hueco
            del reloj lo pone una clase, y un `padding: "10px 12px"` en línea le
            gana a la hoja de estilos: con el atajo, el reloj quedaba sentado
            justo encima del botón de "Prueba" en el teléfono. */}
        <div className={CLASE_HUECO_RELOJ} style={{ display: "flex", alignItems: "center", gap: 9, paddingTop: 10, paddingBottom: 10, paddingLeft: 12 }}>
          <button onClick={() => router.push("/")} title="Volver al panel"
            style={{ display: "flex", alignItems: "center", gap: 9, background: "none", border: "none", color: C.text, cursor: "pointer", padding: "5px 7px", borderRadius: 12, minWidth: 0, flex: 1 }}>
            <span style={{ color: C.dim, display: "flex", flexShrink: 0 }}><IconBack size={20} /></span>
            <AuroraDot size={26} />
            <span style={{ minWidth: 0, textAlign: "left" }}>
              <span style={{ display: "block", fontFamily: FONT.round, fontWeight: 700, fontSize: 15.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {subject ? subjectLabel(subject) : "Materia"}
              </span>
              <span style={{ display: "block", color: C.dim, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {grade && gradeLabel(grade)} · Volver al panel
              </span>
            </span>
          </button>

          {/* LA ESQUINA: las otras dos actividades, al lado del curso.
              Solo las OTRAS: la que estás usando no necesita un botón para ir a
              sí misma, y ponerlo obliga a leer cuál está activa antes de tocar. */}
          {!enElegir && (
            <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
              {otras.map((a) => (
                <button key={a.href} onClick={() => router.push(a.href)} title={a.label} aria-label={a.label}
                  style={{ width: 38, height: 38, display: "grid", placeItems: "center", borderRadius: 11, background: C.panel, color: C.text, border: `1.5px solid ${C.border}`, cursor: "pointer" }}>
                  {a.icono}
                </button>
              ))}
            </div>
          )}
        </div>
      </header>
      <main style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>{children}</main>
    </div>
  );
}
