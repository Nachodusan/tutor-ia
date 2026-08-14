"use client";
/**
 * EL CAMINO — la página que abre la materia.
 *
 * Es dueña de su propio estado: plan, avance y las preguntas de la lección
 * abierta. Antes todo esto vivía en el componente único junto con el chat y la
 * prueba; ahora entrar acá no carga nada del chat.
 */
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { CaminoView } from "../../../camino";
import { C, Dots, FONT, HARD, IconSpark, subjectLabel } from "../../../ui";
import { traerMateria } from "../../../datos";
import type { PlanItem, Subject } from "../../../tipos";

export default function CaminoPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [subject, setSubject] = useState<Subject | undefined>();
  const [plan, setPlan] = useState<PlanItem[] | null>(null);
  const [done, setDone] = useState<string[]>([]);
  const [scores, setScores] = useState<Record<string, { score: number; total: number }>>({});
  const [cargando, setCargando] = useState(true);
  const [planLoading, setPlanLoading] = useState(false);
  // "No hay plan todavía" y "este libro no da para un plan" NO son lo mismo. El
  // servidor las distingue; antes acá se mostraba siempre el segundo mensaje.
  const [puedeArmarse, setPuedeArmarse] = useState(false);


  useEffect(() => {
    void traerMateria(id).then(setSubject);
  }, [id]);

  useEffect(() => {
    setCargando(true);
    fetch(`/api/plan?subjectId=${id}`).then((r) => r.json())
      .then((j) => {
        setPlan(j.items?.length ? j.items : null);
        setPuedeArmarse(!!j.puedeArmarse);
        setDone(j.doneKeys ?? []);
        setScores(j.scores ?? {});
      })
      .catch(() => setPlan(null))
      .finally(() => setCargando(false));
  }, [id]);



  async function generarPlan() {
    setPlanLoading(true);
    try {
      const r = await fetch("/api/plan", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subjectId: id, subjectName: subject ? subjectLabel(subject) : null }),
      });
      const j = await r.json();
      setPlan(j.items?.length ? j.items : null);
      setDone(j.doneKeys ?? []);
    } catch { /* se queda con el plan que había */ }
    finally { setPlanLoading(false); }
  }


  if (cargando) {
    return <div style={{ display: "grid", placeItems: "center", padding: 48, color: C.dim }}><Dots /></div>;
  }
  if (!plan) {
    // Se puede armar y todavía nadie lo armó: eso es un botón, no una disculpa.
    if (puedeArmarse) {
      return (
        <div style={{ padding: "40px 20px", textAlign: "center", maxWidth: 420, margin: "0 auto" }}>
          <p style={{ fontSize: 16, lineHeight: 1.6, color: C.text, fontFamily: FONT.round, fontWeight: 700 }}>
            Tu camino todavía no está armado.
          </p>
          <p style={{ fontSize: 14.5, lineHeight: 1.6, color: C.dim, marginBottom: 22 }}>
            Lo armamos con las lecciones de tu libro y te lo dejamos listo para empezar.
          </p>
          <button onClick={generarPlan} disabled={planLoading}
            style={{
              display: "inline-flex", alignItems: "center", gap: 8, background: C.ok, color: "#fff",
              border: `2px solid ${C.ink}`, borderRadius: 999, padding: "11px 22px", boxShadow: HARD(C.ink),
              cursor: planLoading ? "default" : "pointer", fontFamily: FONT.round, fontWeight: 800, fontSize: 15,
            }}>
            {planLoading ? <Dots /> : <><IconSpark size={16} /> Armar mi camino</>}
          </button>
        </div>
      );
    }
    return (
      <div style={{ padding: "28px 20px", textAlign: "center", color: C.dim, maxWidth: 420, margin: "0 auto" }}>
        <p style={{ fontSize: 15, lineHeight: 1.6 }}>
          Esta materia todavía no tiene un camino armado: su libro no trae un índice
          que se pueda leer.
        </p>
        <p style={{ fontSize: 14, lineHeight: 1.6 }}>
          Igual podés preguntarle lo que quieras al tutor desde <b>Preguntar</b>.
        </p>
      </div>
    );
  }


  return (
    // Ancho generoso: el camino serpentea más cuanto más ancho es su contenedor
    // (la amplitud es elástica, ver camino.tsx). 1100 y no "sin tope": en un
    // monitor ultra-ancho un vaivén de pantalla completa marea en vez de guiar.
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "14px 20px 40px" }}>
      <CaminoView
        items={plan} done={done} scores={scores} subject={subject} loading={planLoading}
        onAbrir={(it) => router.push(`/materia/${id}/camino/${it.key}`)}
        onExamen={() => router.push(`/materia/${id}/prueba`)}
        testLoading={false}
        onRegen={generarPlan}
      />
    </div>
  );
}
