"use client";
import { C, FONT, HARD, Dots, IconCheck, IconSpark, IconStar, IconLock, subjectLabel } from "./ui";
import type { PlanItem, Subject } from "./tipos";

/**
 * ¿Le fue bien en la lección? La regla se mudó a `nota.ts` cuando el servidor
 * pasó a necesitarla también (ver el submit de la prueba). Se re-exporta para
 * que quien pinta nodos la siga pidiendo acá, donde la busca.
 */
import { aprobado } from "./nota";
export { aprobado };

// ── GEOMETRÍA DEL CAMINO ────────────────────────────────────────────────────
// Antes era una lista vertical: todos los nodos alineados, todas las filas del
// mismo alto. Se leía como una tabla de contenidos, no como un recorrido — y
// "¿por dónde voy?" costaba tanto como en el índice del libro.
//
// Ahora serpentea. La amplitud sale de un seno para que la curva sea pareja sin
// tabular offsets a mano, y el paso vertical es fijo para que el largo del
// camino sea proporcional a lo que falta.
const NODO = 64;      // diámetro del nodo
const PASO = 150;     // distancia vertical entre centros
const AMP = 124;      // cuánto se corre a los costados
/** Ancho del texto de cada parada. */
const ETIQUETA = 150;
/**
 * El serpenteo, como patrón EXPLÍCITO de 8 paradas y no como seno.
 *
 * Con `sin(i * 0.62)` la primera media onda se comía las cinco paradas
 * iniciales del MISMO lado: el camino arrancaba en el centro, se iba a la
 * derecha y recién en la sexta volvía. En una pantalla de teléfono se ve la
 * primera pantallada nada más, así que el alumno veía una curva floja pegada a
 * un costado y el ancho izquierdo desperdiciado.
 *
 * El patrón alterna desde el arranque y toca los dos extremos en cada vuelta.
 * Al ser una tabla se puede leer de un vistazo qué forma tiene, que con una
 * fase en radianes había que ir a calcularlo.
 */
const VAIVEN = [0, 0.6, 1, 0.6, 0, -0.6, -1, -0.6];
const posX = (i: number) => VAIVEN[i % VAIVEN.length]! * AMP;

export function CaminoView({
  items, done, scores, subject, loading,
  onAbrir, onExamen, onRegen, testLoading,
}: {
  items: PlanItem[]; done: string[]; scores: Record<string, { score: number; total: number }>;
  subject?: Subject; loading: boolean;
  /** Tocar una parada abre SU PÁGINA. Antes desplegaba una hoja acá encima; el
   *  camino no tiene por qué saber nada del cuestionario. */
  onAbrir: (it: PlanItem) => void;
  onExamen: () => void; onRegen: () => void; testLoading: boolean;
}) {
  const area = subject ? subjectLabel(subject) : "";
  const actual = items.find((it) => !done.includes(it.key))?.key ?? "";
  // Un examen cada 5 lecciones. Cada 5 y no "por unidad" porque varios planes
  // vienen con `unit: null` — el índice del libro no la trae — y agrupar por
  // unidad dejaría materias enteras sin ningún hito.
  const CADA = 5;

  // Se construye la secuencia de paradas: lecciones + exámenes intercalados, así
  // el examen es una parada del camino y no un cartel al costado.
  type Parada =
    | { tipo: "leccion"; item: PlanItem; i: number }
    | { tipo: "examen"; desde: number; hasta: number; listo: boolean };
  const paradas: Parada[] = [];
  items.forEach((item, i) => {
    paradas.push({ tipo: "leccion", item, i });
    const ultimo = i === items.length - 1;
    if ((i + 1) % CADA === 0 && !ultimo) {
      const bloque = items.slice(Math.max(0, i + 1 - CADA), i + 1);
      paradas.push({
        tipo: "examen",
        desde: Math.max(1, i + 2 - CADA),
        hasta: i + 1,
        listo: bloque.every((b) => done.includes(b.key)),
      });
    }
  });

  const alto = paradas.length * PASO + NODO;
  const centro = (k: number) => ({ x: posX(k), y: k * PASO + NODO / 2 });

  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, marginBottom: 6 }}>
        <div>
          <div style={{ fontFamily: FONT.round, fontWeight: 800, fontSize: 21 }}>Tu camino</div>
          <div style={{ color: C.dim, fontSize: 13.5 }}>{area} · {done.length} de {items.length} lecciones</div>
        </div>
        <button onClick={onRegen} disabled={loading} title="Armar otro plan"
          style={{ display: "inline-flex", alignItems: "center", gap: 6, background: C.panel, color: C.text, border: `1.5px solid ${C.ink}`, borderRadius: 999, padding: "7px 13px", cursor: loading ? "default" : "pointer", fontFamily: FONT.round, fontWeight: 600, fontSize: 13, flexShrink: 0 }}>
          {loading ? <Dots /> : <><IconSpark size={15} /> Rehacer</>}
        </button>
      </div>

      <div style={{ position: "relative", height: alto, width: "100%" }}>
        {/* El sendero, detrás de todo. Se dibuja de una sola pieza: dos tramos
            sueltos entre nodos se ven como escalones, no como un camino. */}
        <svg width={AMP * 2 + NODO} height={alto} viewBox={`${-(AMP + NODO / 2)} 0 ${AMP * 2 + NODO} ${alto}`}
          style={{ position: "absolute", top: 0, left: "50%", transform: "translateX(-50%)", pointerEvents: "none" }} aria-hidden="true">
          <path d={sendero(paradas.length)} fill="none" stroke={C.border} strokeWidth={14} strokeLinecap="round" />
          {/* Lo recorrido, encima y en color: el avance se ve sin contar nodos. */}
          <path d={sendero(hechasSeguidas(paradas, done))} fill="none" stroke={C.ok} strokeWidth={14} strokeLinecap="round" />
        </svg>

        {paradas.map((p, k) => {
          const { x, y } = centro(k);
          // El nodo va sobre la curva; la ETIQUETA al costado contrario. Debajo
          // no entra: con el paso vertical que pide la curva, un título de dos
          // líneas se mete sobre el nodo siguiente y el trazo lo cruza. Al
          // costado usa el ancho que el serpenteo deja libre.
          const alaDerecha = x <= 0;
          const nodoPos: React.CSSProperties = {
            position: "absolute", left: "50%", top: y,
            transform: `translate(calc(-50% + ${x}px), -50%)`,
          };
          // La etiqueta va DEBAJO del nodo y centrada. Con el paso corto de
          // antes (112 px) esto no entraba: un título de dos líneas se metía
          // sobre el nodo siguiente, así que solo lo llevaba el nodo actual.
          // Con 158 px de paso quedan ~94 px libres entre bordes y entran los
          // catorce — que es lo que hace navegable el camino: sin nombres hay
          // que tocar nodo por nodo para saber qué es cada uno.
          // ⚠️ NINGÚN TEXTO SOBRE EL CAMINO. La etiqueta va AL COSTADO del
          // nodo, a la altura de su centro, y del lado que da al ancho libre:
          // si el nodo está corrido a la derecha, el texto va a su izquierda, y
          // al revés. Debajo del nodo el sendero lo cruzaba en diagonal —se leía
          // tachado— y taparlo con un fondo blanco dejaba cajas apoyadas sobre
          // el camino.
          //
          // El lado se elige por la posición del nodo y no por el rumbo de la
          // curva porque es lo que garantiza ESPACIO: con el nodo en un extremo,
          // el lado de afuera tiene 40 px y el de adentro casi 300.
          const aLaIzquierda = x > 0 || (x === 0 && posX(k + 1) >= 0);
          const etiquetaPos: React.CSSProperties = aLaIzquierda
            ? {
                position: "absolute", top: y, transform: "translateY(-50%)",
                right: `calc(50% - ${x - NODO / 2 - 14}px)`,
                width: `calc(50% + ${x - NODO / 2 - 18}px)`,
                textAlign: "right",
                display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 5,
              }
            : {
                position: "absolute", top: y, transform: "translateY(-50%)",
                left: `calc(50% + ${x + NODO / 2 + 14}px)`,
                width: `calc(50% - ${x + NODO / 2 + 18}px)`,
                textAlign: "left",
                display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 5,
              };
          if (p.tipo === "examen") {
            return (
              <div key={`ex-${k}`}>
                <div style={etiquetaPos}>
                  <span style={{ fontFamily: FONT.round, fontWeight: 700, fontSize: 12, color: p.listo ? C.text : C.dim, lineHeight: 1.25 }}>
                    Prueba · lecciones {p.desde} a {p.hasta}
                  </span>
                </div>
                <button onClick={() => p.listo && onExamen()} disabled={!p.listo || testLoading}
                  title={p.listo ? `Prueba de las lecciones ${p.desde} a ${p.hasta}` : `Se abre al terminar la ${p.hasta}`}
                  style={{
                    ...nodoPos,
                    transform: `${nodoPos.transform} rotate(45deg)`,
                    width: NODO, height: NODO, borderRadius: 18, border: `3px solid ${C.ink}`,
                    background: p.listo ? C.accentSoft : C.panel2, color: p.listo ? "#fff" : C.dim,
                    display: "grid", placeItems: "center", cursor: p.listo ? "pointer" : "default",
                    boxShadow: p.listo ? HARD(C.ink) : "none",
                  }}>
                  <span style={{ transform: "rotate(-45deg)", display: "grid", placeItems: "center" }}>
                    {p.listo ? <IconStar size={24} /> : <IconLock size={20} />}
                  </span>
                </button>
              </div>
            );
          }
          const hecho = done.includes(p.item.key);
          const sc = scores[p.item.key];
          const bien = sc ? aprobado(sc.score, sc.total) : false;
          const esActual = p.item.key === actual;
          const fondo = hecho ? (bien ? C.ok : C.warn) : esActual ? C.accent : C.panel;
          const tinta = hecho || esActual ? "#fff" : C.dim;
          return (
            <div key={p.item.key}>
              <div style={etiquetaPos}>
                <span style={{ fontFamily: FONT.round, fontWeight: 700, fontSize: 12.5, lineHeight: 1.25, color: hecho && !esActual ? C.dim : C.text }}>
                  {p.item.title}
                </span>
                {/* Chapa y nota van con el título, no sueltas junto al nodo:
                    ahí también las cruzaba el trazo. */}
                {esActual && !hecho && (
                  <span style={{ fontFamily: FONT.round, fontWeight: 700, fontSize: 10, letterSpacing: .4, textTransform: "uppercase", color: "#fff", background: C.accent, borderRadius: 999, padding: "2px 9px", whiteSpace: "nowrap" }}>
                    Estás acá
                  </span>
                )}
                {sc && (
                  <span style={{ fontFamily: FONT.round, fontWeight: 800, fontSize: 10.5, color: bien ? C.okTx : C.warnTx, background: bien ? C.okBg : C.warnBg, border: `1.5px solid ${bien ? C.ok : C.warn}`, borderRadius: 999, padding: "1px 7px" }}>
                    {sc.score}/{sc.total}
                  </span>
                )}
              </div>

              <button onClick={() => onAbrir(p.item)} title={p.item.title}
                style={{
                  ...nodoPos,
                  width: NODO, height: NODO, borderRadius: "50%", border: `3px solid ${C.ink}`,
                  background: fondo, color: tinta, fontFamily: FONT.round, fontWeight: 800, fontSize: 21,
                  display: "grid", placeItems: "center", cursor: "pointer",
                  boxShadow: esActual ? HARD(C.ink) : "none",
                  transform: nodoPos.transform,
                  transition: "transform .12s, box-shadow .12s",
                }}>
                {hecho ? <IconCheck size={26} /> : p.i + 1}
              </button>
            </div>
          );
        })}
      </div>

    </div>
  );
}

/** Curva que pasa por los centros de las primeras `n` paradas. */
function sendero(n: number): string {
  if (n <= 0) return "";
  const pt = (k: number) => ({ x: posX(k), y: k * PASO + NODO / 2 });
  let d = "";
  for (let k = 0; k < n; k++) {
    const p = pt(k);
    if (k === 0) { d += `M ${p.x} ${p.y}`; continue; }
    const a = pt(k - 1);
    // Curva suave: los puntos de control a media altura dan la ondulación sin
    // que el trazo se despegue de los nodos.
    d += ` C ${a.x} ${a.y + PASO / 2}, ${p.x} ${p.y - PASO / 2}, ${p.x} ${p.y}`;
  }
  return d;
}

/** Cuántas paradas seguidas van completas desde el arranque. El tramo en color
 *  llega HASTA ahí: pintar lecciones sueltas más adelante daría la idea de que
 *  el camino ya está recorrido cuando no lo está. */
function hechasSeguidas(
  paradas: ({ tipo: "leccion"; item: PlanItem } | { tipo: "examen" })[],
  done: string[],
): number {
  let n = 0;
  for (const p of paradas) {
    if (p.tipo === "examen") { n++; continue; }
    if (!done.includes(p.item.key)) break;
    n++;
  }
  return n;
}
