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
import { C, FONT, AuroraDot, IconBack, gradeLabel, subjectLabel } from "../../ui";
import type { Subject } from "../../tipos";

export default function MateriaLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { id } = useParams<{ id: string }>();
  const [subject, setSubject] = useState<Subject | null>(null);
  const [grade, setGrade] = useState("");

  useEffect(() => {
    fetch("/api/subjects").then((r) => r.json())
      .then((j) => setSubject((j.subjects ?? j).find((s: Subject) => s.id === id) ?? null))
      .catch(() => setSubject(null));
    fetch("/api/me").then((r) => r.json())
      .then((j) => setGrade(j.profile?.grade ?? ""))
      .catch(() => { /* el encabezado se muestra sin curso */ });
  }, [id]);

  const base = `/materia/${id}`;
  const tabs = [
    { href: base, label: "Camino" },
    { href: `${base}/chat`, label: "Preguntar" },
    { href: `${base}/prueba`, label: "Prueba" },
  ];

  return (
    <div style={{ height: "100dvh", display: "flex", flexDirection: "column", background: C.bg, color: C.text, fontFamily: FONT.sans }}>
      <header style={{ borderBottom: `1px solid ${C.border}`, background: C.bg, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "10px 14px 8px" }}>
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
        </div>

        {/* Las tres actividades, al mismo nivel. Ninguna es "la principal con
            las otras encima": el camino es la que abre por defecto y ya. */}
        <nav style={{ display: "flex", gap: 4, padding: "0 12px 8px" }}>
          {tabs.map((t) => {
            const activo = t.href === base ? pathname === base : pathname.startsWith(t.href);
            return (
              <button key={t.href} onClick={() => router.push(t.href)}
                style={{
                  flex: 1, padding: "8px 10px", borderRadius: 10, cursor: "pointer",
                  fontFamily: FONT.round, fontWeight: 700, fontSize: 13.5,
                  background: activo ? C.ink : "transparent",
                  color: activo ? "#fff" : C.dim,
                  border: `1.5px solid ${activo ? C.ink : C.border}`,
                }}>
                {t.label}
              </button>
            );
          })}
        </nav>
      </header>
      <main style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>{children}</main>
    </div>
  );
}
