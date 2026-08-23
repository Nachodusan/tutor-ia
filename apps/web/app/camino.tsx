"use client";
import { useEffect, useRef, useState } from "react";
import { C, FONT, HARD, Dots, IconCheck, IconSpark, IconStar, IconLock, subjectLabel } from "./ui";
import type { Pendiente, PlanItem, Subject } from "./tipos";

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
const PASO = 164;     // distancia vertical entre centros
/** Aire del tablero: margen interior arriba/abajo y a los costados. Sin esto el
 *  primer nodo nacía pegado al filo y los extremos del vaivén besaban el borde
 *  — todo correcto y todo asfixiado. */
const MARGEN_V = 48;
const MARGEN_H = 48;
/**
 * Cuánto se corre a los costados. Es el MÍNIMO y el valor de arranque (antes de
 * medir): la amplitud real es ELÁSTICA al ancho del contenedor — con 124 fijos,
 * en una pantalla ancha el camino quedaba como una cinta apretada en el medio y
 * los dos tercios de la página vacíos.
 */
const AMP = 124;
/** Tope de la amplitud: en un monitor ultra-ancho, un vaivén de pantalla
 *  completa marea en vez de guiar. */
const AMP_MAX = 440;
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
const posX = (i: number, amp: number) => VAIVEN[i % VAIVEN.length]! * amp;

export function CaminoView({
  items, done, scores, subject, loading, pendientes,
  onAbrir, onExamen, onRegen, testLoading,
}: {
  items: PlanItem[]; done: string[]; scores: Record<string, { score: number; total: number }>;
  /** Lo que el Estado exige y este libro no trae. Ver `pendientesDe` en el rag. */
  pendientes?: Pendiente[];
  subject?: Subject; loading: boolean;
  /** Tocar una parada abre SU PÁGINA. Antes desplegaba una hoja acá encima; el
   *  camino no tiene por qué saber nada del cuestionario. */
  onAbrir: (it: PlanItem) => void;
  onExamen: () => void; onRegen: () => void; testLoading: boolean;
}) {
  const area = subject ? subjectLabel(subject) : "";
  // "Hecho" se decide con la MISMA regla en todos lados. Antes esto miraba
  // `done.includes(it.key)` directo, y para una UNIDAD esa clave no se marca
  // nunca (el progreso se guarda por lección): el "Estás acá" se quedaba
  // clavado en la primera unidad aunque el chico la hubiera terminado entera.
  const nodoHecho = (it: PlanItem) => {
    const ls = it.lecciones ?? [];
    return ls.length > 0 ? ls.every((l) => done.includes(l.key)) : done.includes(it.key);
  };
  const actual = items.find((it) => !nodoHecho(it))?.key ?? "";
  // AMPLITUD ELÁSTICA: el serpenteo usa el ancho que el contenedor tenga de
  // verdad. Se mide con ResizeObserver (cubre el resize de la ventana Y el
  // cambio de contenedor); hasta la primera medición vale el mínimo, así el
  // primer render del servidor no difiere del cliente.
  const lienzo = useRef<HTMLDivElement>(null);
  const [ancho, setAncho] = useState(0);
  useEffect(() => {
    const el = lienzo.current;
    if (!el) return;
    const ro = new ResizeObserver((es) => setAncho(es[0]?.contentRect.width ?? 0));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // El PISO (AMP) no puede pisar el borde: en un teléfono, 124 dejaba el nodo a
  // 13 px del filo del tablero y se veía asfixiado. El piso se recorta a lo que
  // entre dejando al menos MARGEN_MIN.
  const MARGEN_MIN = 26;
  const amp = ancho
    ? Math.min(
        Math.max((ancho - NODO) / 2 - MARGEN_H, Math.min(AMP, (ancho - NODO) / 2 - MARGEN_MIN)),
        AMP_MAX,
      )
    : AMP;
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
        // La MISMA regla de "hecho" que todo lo demás. Con la clave cruda
        // (`done.includes(b.key)`), en un plan por unidades el candado no se
        // abría NUNCA: la clave de una unidad no se marca — se marcan sus
        // lecciones. El `||` deja valer también el quiz de la unidad entera
        // (nodo grande), que sí escribe la clave de la unidad.
        listo: bloque.every((b) => nodoHecho(b) || done.includes(b.key)),
      });
    }
  });

  // EL PASO YA NO ES FIJO: el tramo que sale de una unidad lleva ENCIMA sus
  // puntos de lección, y con puntos de 24 px una unidad de 6 lecciones no entra
  // en 164 de alto — los puntos se pisaban entre sí y con los nodos, que es la
  // mitad de por qué se confundían con la textura del fondo. Cada tramo mide lo
  // que su carga pide: los dos nodos de las puntas, y un lugar por punto.
  const largoTramo = (lecciones: number) =>
    lecciones === 0
      ? PASO
      : Math.max(PASO, NODO + PUNTO + AIRE_PUNTO * 2 + (lecciones + 1) * (PUNTO + GAP_PUNTO));
  // El centro vertical de cada parada, acumulando tramos. La última entrada es
  // LA META (+1 parada visual: no es una lección — es el lugar al que se llega,
  // y verla desde el arranque es lo que convierte la lista en un recorrido).
  const ys: number[] = [MARGEN_V + NODO / 2];
  for (const p of paradas) {
    ys.push(ys[ys.length - 1]! + largoTramo(p.tipo === "leccion" ? (p.item.lecciones?.length ?? 0) : 0));
  }
  const alto = ys[ys.length - 1]! + NODO / 2 + MARGEN_V;
  const centro = (k: number) => ({ x: posX(k, amp), y: ys[k] ?? 0 });
  // El avance se cuenta en NODOS del camino, no en marcas sueltas. Cuando el
  // nodo es una unidad con lecciones adentro, está hecho cuando lo están todas:
  // contar `done.length` contra `items.length` mezclaba lecciones hechas con
  // unidades totales y decía "4 de 6 lecciones · 67%" con dos unidades a medias.
  const hechos = items.filter(nodoHecho).length;
  // `lecciones` definido —aunque venga vacío— significa que el nodo es una
  // UNIDAD. Vacío es el caso legítimo del libro sin índice: la unidad no se
  // desglosa, pero sigue siendo una unidad y llamarla "lección" es mentir.
  const hayUnidades = items.some((it) => it.lecciones !== undefined);
  const unidad = hayUnidades ? (items.length === 1 ? "unidad" : "unidades") : (items.length === 1 ? "lección" : "lecciones");
  const completo = items.length > 0 && hechos >= items.length;
  // La BARRA cuenta fracciones de unidad; el "X de N" cuenta unidades enteras.
  // Con dos lecciones hechas de cuatro, la unidad no está terminada —y decir que
  // sí sería mentira— pero poner 0% le borra al chico un trabajo que hizo.
  const avance = items.reduce((a, it) => {
    const ls = it.lecciones ?? [];
    if (ls.length === 0) return a + (done.includes(it.key) ? 1 : 0);
    return a + ls.filter((l) => done.includes(l.key)).length / ls.length;
  }, 0);
  const pct = items.length ? Math.round((avance / items.length) * 100) : 0;

  /**
   * Dónde cae la moneda `j` de un tramo con `nL` monedas (t de 0 a 1 sobre la
   * Bézier del tramo `k`). La usan el DIBUJO de las monedas y el PINTADO del
   * sendero hecho: si cada uno calculara el margen por su cuenta, el día que
   * uno cambie el sendero pintado dejaría de pasar por las monedas.
   * El 1.4 es porque la curva arranca casi vertical (velocidad 1.5·alto en las
   * puntas): a `t` chico ya se recorrió más alto que `t`·alto.
   */
  const tMoneda = (k: number, j: number, nL: number) => {
    const L = (ys[k + 1] ?? (ys[k] ?? 0) + PASO) - (ys[k] ?? 0);
    const m = Math.min(0.3, (NODO / 2 + PUNTO / 2 + AIRE_PUNTO) / (1.4 * L));
    return m + ((j + 1) / (nL + 1)) * (1 - 2 * m);
  };

  /**
   * EL SENDERO PINTADO, que ahora avanza MONEDA A MONEDA.
   *
   * Con unidades, el tramo pintado cubre los tramos de las unidades completas
   * (las monedas de una unidad viven en el tramo que SALE de su nodo, así que
   * completarla es haber caminado ese tramo) y sigue en PARCIAL hasta la última
   * moneda hecha de corrido de la unidad actual. Antes se pintaba por paradas
   * enteras con `done.includes(item.key)` — clave que para una unidad no se
   * marca nunca, así que el sendero se quedaba en cero aunque el chico llevara
   * dos unidades terminadas.
   *
   * El parcial se aproxima con una polilínea muestreada sobre la MISMA Bézier
   * (16 puntos): con puntas redondas y 18-24 px de trazo es indistinguible de
   * la curva, y evita partir la cúbica con De Casteljau.
   */
  const senderoHecho = (): string => {
    if (completo) return sendero(paradas.length + 1, amp, ys);
    const nSeg = hechasSeguidas(paradas, done);
    if (!hayUnidades) return sendero(nSeg, amp, ys);
    let d = sendero(nSeg + 1, amp, ys);
    const prox = paradas[nSeg];
    if (prox?.tipo === "leccion") {
      const ls = prox.item.lecciones ?? [];
      const sinHacer = ls.findIndex((l) => !done.includes(l.key));
      const monedas = sinHacer === -1 ? ls.length : sinHacer;
      if (monedas > 0) {
        const tFin = tMoneda(nSeg, monedas - 1, ls.length);
        for (let s = 1; s <= 16; s++) {
          const q = puntoEnTramo(nSeg, (tFin * s) / 16, amp, ys);
          d += ` L ${q.x.toFixed(1)} ${q.y.toFixed(1)}`;
        }
      }
    }
    return d;
  };

  return (
    <div>
      {/* Animaciones del camino. `prefers-reduced-motion` las apaga enteras. */}
      <style>{`
        @keyframes caminoPulso {
          0%, 100% { box-shadow: 4px 4px 0 0 ${C.ink}, 0 0 0 0 rgba(43,68,255,.35); }
          50%      { box-shadow: 4px 4px 0 0 ${C.ink}, 0 0 0 14px rgba(43,68,255,0); }
        }
        @keyframes caminoFlota { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-5px) } }
        /* El latido de la PRÓXIMA lección: mismo lenguaje que el nodo actual,
           a escala de moneda. El aro blanco va DENTRO del keyframe — la
           animación pisa el box-shadow del estilo, y sin repetirlo acá la
           moneda que late perdía el aro que la despega del sendero. */
        @keyframes caminoPulsoChico {
          0%, 100% { box-shadow: 0 0 0 3px ${C.panel}, 0 0 0 4px rgba(43,68,255,.4); }
          50%      { box-shadow: 0 0 0 3px ${C.panel}, 0 0 0 12px rgba(43,68,255,0); }
        }
        @media (prefers-reduced-motion: reduce) {
          .camino-actual, .camino-meta-viva, .camino-sig { animation: none !important; }
        }
      `}</style>

      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
        <div>
          <div style={{ fontFamily: FONT.round, fontWeight: 800, fontSize: 24, letterSpacing: -0.3 }}>Tu camino</div>
          <div style={{ color: C.dim, fontSize: 13.5 }}>{area} · {hechos} de {items.length} {unidad}</div>
        </div>
        <button onClick={onRegen} disabled={loading} title="Armar otro plan"
          style={{ display: "inline-flex", alignItems: "center", gap: 6, background: C.panel, color: C.text, border: `1.5px solid ${C.ink}`, borderRadius: 999, padding: "7px 13px", cursor: loading ? "default" : "pointer", fontFamily: FONT.round, fontWeight: 600, fontSize: 13, flexShrink: 0 }}>
          {loading ? <Dots /> : <><IconSpark size={15} /> Rehacer</>}
        </button>
      </div>

      {/* EL AVANCE, GRANDE Y PRIMERO (mundo Bloques: borde tinta, sombra dura).
          El número es el protagonista: es lo que el chico vino a mirar. */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 30 }}>
        <div style={{ flex: 1, height: 24, background: C.panel2, border: `2px solid ${C.ink}`, borderRadius: 999, boxShadow: HARD(C.ink), overflow: "hidden" }}>
          <div style={{
            width: `${Math.max(pct, 4)}%`, height: "100%", borderRadius: 999,
            background: completo ? C.sun : `linear-gradient(90deg, ${C.ok}, #35C579)`,
            transition: "width .6s cubic-bezier(.2,.8,.2,1)",
          }} />
        </div>
        <div style={{ fontFamily: FONT.round, fontWeight: 800, fontSize: 22, flexShrink: 0, color: completo ? C.warnTx : C.okTx, fontVariantNumeric: "tabular-nums" }}>
          {pct}%
        </div>
      </div>

      {/* EL TABLERO. Una tarjeta del mundo Bloques —borde tinta, sombra dura,
          papel de puntos— y no puntos sueltos que sangran hasta los bordes: el
          marco es lo que hace que el camino se lea como un objeto y no como
          elementos flotando en la página. */}
      <div ref={lienzo} style={{
        position: "relative", height: alto, width: "100%",
        background: C.panel, border: `2px solid ${C.ink}`,
        boxShadow: HARD(C.ink), borderRadius: 22, overflow: "hidden",
        backgroundImage: `radial-gradient(${C.border} 1.5px, transparent 1.5px)`,
        backgroundSize: "26px 26px",
      }}>
        {/* El sendero, detrás de todo y de una sola pieza: dos tramos sueltos
            entre nodos se ven como escalones, no como un camino.
            LO QUE FALTA va PUNTEADO —huellas por pisar— y lo recorrido lo tapa
            en color sólido: el avance se ve de lejos, sin contar nodos. */}
        <svg width={amp * 2 + NODO} height={alto} viewBox={`${-(amp + NODO / 2)} 0 ${amp * 2 + NODO} ${alto}`}
          style={{ position: "absolute", top: 0, left: "50%", transform: "translateX(-50%)", pointerEvents: "none" }} aria-hidden="true">
          {(() => {
            const todo = sendero(paradas.length + 1, amp, ys);
            const hecho = senderoHecho();
            return (
              <>
                {/* LO QUE FALTA: huellas. Más oscuras que los puntos del papel
                    —eran del mismo `C.border` y se confundían con el fondo—
                    pero CHICAS: medían 10-17 px, lo mismo que los puntos de
                    lección de entonces, y las dos cosas se leían como la misma
                    textura. La huella es piso, no botón; achicarla es lo que le
                    devuelve al punto de lección el lugar de único tocable sobre
                    el sendero. */}
                <path d={todo} fill="none" stroke={C.ink} strokeWidth={11} strokeLinecap="round"
                  strokeDasharray="0.1 22" opacity={0.1} />
                <path d={todo} fill="none" stroke={C.dim} strokeWidth={6} strokeLinecap="round"
                  strokeDasharray="0.1 22" opacity={0.35} />

                {/* LO RECORRIDO: una RUTA. Casco de tinta como todo lo demás del
                    mundo Bloques —el sendero era la única pieza del dibujo sin
                    borde negro y por eso se leía pegada de otro lado—, el verde
                    plano adentro, y la línea discontinua del medio, que es lo
                    que hace que el ojo lea "camino" y no "franja".
                    Probado con una luz diagonal en vez de la línea: daba volumen
                    de TUBO, que es justo lo que este mundo plano no quiere. */}
                <path d={hecho} fill="none" stroke={C.ink} strokeWidth={24}
                  strokeLinecap="round" strokeLinejoin="round" />
                <path d={hecho} fill="none" stroke={C.ok} strokeWidth={18}
                  strokeLinecap="round" strokeLinejoin="round" />
                <path d={hecho} fill="none" stroke="#FFFFFF" strokeWidth={2.5}
                  strokeLinecap="round" strokeDasharray="11 13" opacity={0.62} />
              </>
            );
          })()}
        </svg>

        {paradas.map((p, k) => {
          const { x, y } = centro(k);
          // El nodo va sobre la curva; la ETIQUETA al costado contrario. Debajo
          // no entra: con el paso vertical que pide la curva, un título de dos
          // líneas se mete sobre el nodo siguiente y el trazo lo cruza. Al
          // costado usa el ancho que el serpenteo deja libre.
          // ⚠️ La X del nodo va en `left`, NUNCA adentro del `transform`. Antes
          // era `translate(calc(-50% + Xpx))` y el nodo tiene una transición de
          // transform: cuando la amplitud elástica cambia tras medir el ancho,
          // Chromium no sabe interpolar entre dos calc() con % y px mezclados y
          // DEJA EL VALOR VIEJO para siempre. Resultado real: el sendero y las
          // monedas se estiraban a la amplitud nueva y los nodos de unidad
          // quedaban clavados en la vieja — el camino pasaba lejos de sus
          // propios círculos. `left` no está en la transición y se aplica al
          // instante.
          const nodoPos: React.CSSProperties = {
            position: "absolute", left: `calc(50% + ${x}px)`, top: y,
            transform: "translate(-50%, -50%)",
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
          const aLaIzquierda = x > 0 || (x === 0 && posX(k + 1, amp) >= 0);
          const etiquetaPos: React.CSSProperties = aLaIzquierda
            ? {
                position: "absolute", top: y, transform: "translateY(-50%)",
                right: `calc(50% - ${x - NODO / 2 - 22}px)`,
                width: `calc(50% + ${x - NODO / 2 - 26 - MARGEN_H}px)`,
                textAlign: "right",
                display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 5,
              }
            : {
                position: "absolute", top: y, transform: "translateY(-50%)",
                left: `calc(50% + ${x + NODO / 2 + 22}px)`,
                width: `calc(50% - ${x + NODO / 2 + 26 + MARGEN_H}px)`,
                textAlign: "left",
                display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 5,
              };
          if (p.tipo === "examen") {
            return (
              <div key={`ex-${k}`}>
                <div style={etiquetaPos}>
                  <span style={{ fontFamily: FONT.round, fontWeight: 700, fontSize: 12, color: p.listo ? C.text : C.dim, lineHeight: 1.25 }}>
                    {/* El sustantivo sigue al del camino: los números 1 a 5 de
                        al lado son UNIDADES cuando el plan es por unidades, y
                        el encabezado de arriba ya lo dice así — que el rombo
                        los llame "lecciones" era nombrar mal las mismas
                        paradas que el chico está mirando. */}
                    Prueba · {hayUnidades ? "unidades" : "lecciones"} {p.desde} a {p.hasta}
                  </span>
                </div>
                <button onClick={() => p.listo && onExamen()} disabled={!p.listo || testLoading}
                  title={p.listo ? `Prueba de las ${hayUnidades ? "unidades" : "lecciones"} ${p.desde} a ${p.hasta}` : `Se abre al terminar la ${p.hasta}`}
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
          // PUNTOS DE CONTROL. Cuando el libro tiene índice, la unidad se
          // desglosa en sus lecciones y el avance se cuenta ahí: la unidad está
          // hecha cuando lo están todas. Esto es lo que hace que pasar el camino
          // a unidades NO borre el avance que el chico traía — su marca sigue
          // siendo la de la lección, con la misma clave de siempre.
          const lecciones = p.item.lecciones ?? [];
          const hechas = lecciones.filter((l) => done.includes(l.key)).length;
          const hecho = lecciones.length > 0 ? hechas === lecciones.length : done.includes(p.item.key);
          // La NOTA de una unidad es la suma de las notas de sus lecciones.
          // Buscarla con la clave de la unidad (`scores[p.item.key]`) devolvía
          // siempre undefined —las notas se guardan por lección— y el nodo de
          // toda unidad terminada caía en el ámbar de "le fue mal", aunque el
          // chico hubiera acertado todo.
          const sc = lecciones.length === 0
            ? scores[p.item.key]
            : (() => {
                let s = 0, t = 0;
                for (const l of lecciones) {
                  const v = scores[l.key];
                  if (v) { s += v.score; t += v.total; }
                }
                return t > 0 ? { score: s, total: t } : undefined;
              })();
          const bien = sc ? aprobado(sc.score, sc.total) : false;
          const esActual = p.item.key === actual;
          // TRES PESOS VISUALES, no uno: lo hecho en color pleno, lo ACTUAL más
          // grande y latiendo, y lo por venir en borde fino y tinta apagada —
          // sigue siendo tocable (acá no se bloquea a nadie), pero se lee como
          // "todavía no llegaste" de un vistazo.
          const futuro = !hecho && !esActual;
          const fondo = hecho ? (bien ? C.ok : C.warn) : esActual ? C.accent : C.panel;
          const tinta = hecho || esActual ? "#fff" : C.dim;
          return (
            <div key={p.item.key}>
              <div style={etiquetaPos}>
                <span style={{ fontFamily: FONT.round, fontWeight: esActual ? 800 : 700, fontSize: esActual ? 13.5 : 12.5, lineHeight: 1.25, color: futuro || (hecho && !esActual) ? C.dim : C.text }}>
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

                {/* EL PILAR: lo que el Estado exige en este tramo.
                    Va con el título y no en el nodo porque el nodo ya carga
                    tres estados (hecho / actual / futuro) y un cuarto anillo lo
                    volvía ilegible. Con el color SOL, que en la paleta no lo usa
                    nada más: la exigencia curricular tiene que distinguirse de
                    "te fue bien" (verde) y de "estás acá" (cobalto).

                    Dice el conocimiento, no un rótulo genérico: "Lo pide el
                    currículum" no le enseña nada a nadie; "Productos notables"
                    le dice al alumno QUÉ es lo que le van a exigir. */}
                {(p.item.pilares?.length ?? 0) > 0 && (
                  <span style={{
                    display: "inline-flex", alignItems: "center", gap: 5,
                    fontFamily: FONT.round, fontWeight: 800, fontSize: 10.5, lineHeight: 1.3,
                    color: C.ink, background: C.sun, border: `2px solid ${C.ink}`,
                    borderRadius: 8, padding: "2px 7px", maxWidth: ETIQUETA,
                  }} title={p.item.pilares!.map((x) => x.item).join(" · ")}>
                    <IconStar size={12} />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {p.item.pilares![0]!.item.replace(/\.$/, "")}
                      {p.item.pilares!.length > 1 ? ` +${p.item.pilares!.length - 1}` : ""}
                    </span>
                  </span>
                )}

                {/* Cuántas lecciones lleva hechas. CON LA PALABRA "lecciones":
                    el "0 de 4" pelado no decía de qué eran los cuatro, y los
                    cuatro puntos sobre el sendero quedaban sin nombre — decirlo
                    acá es lo que ata la cuenta con los puntos de abajo. El
                    detalle de cada una vive en su punto, no acá: en una materia
                    de 19 unidades los títulos tapaban el camino entero. */}
                {lecciones.length > 0 && (
                  <span style={{ fontFamily: FONT.round, fontWeight: 700, fontSize: 11, color: hechas === lecciones.length ? C.okTx : C.dim }}>
                    {hechas} de {lecciones.length} {lecciones.length === 1 ? "lección" : "lecciones"}
                  </span>
                )}
              </div>

              <button onClick={() => onAbrir(p.item)} title={p.item.title}
                className={esActual ? "camino-actual" : undefined}
                style={{
                  ...nodoPos,
                  width: NODO, height: NODO, borderRadius: "50%",
                  border: futuro ? `2px solid ${C.border}` : `3px solid ${C.ink}`,
                  background: fondo, color: tinta, fontFamily: FONT.round, fontWeight: 800, fontSize: 21,
                  display: "grid", placeItems: "center", cursor: "pointer",
                  boxShadow: esActual ? HARD(C.ink) : "none",
                  // El latido del actual es la señal de "seguí por acá". Se
                  // compone con el translate del posicionamiento — reemplazarlo
                  // ya movió nodos de lugar una vez.
                  transform: `${nodoPos.transform}${esActual ? " scale(1.12)" : ""}`,
                  animation: esActual ? "caminoPulso 2.2s ease-out infinite" : undefined,
                  transition: "transform .12s, box-shadow .12s",
                }}>
                {hecho ? <IconCheck size={26} /> : p.i + 1}
              </button>

              {/* LAS LECCIONES DE LA UNIDAD, SOBRE EL SENDERO. Repartidas a lo
                  largo del tramo que sale de esta unidad hacia la siguiente: se
                  leen como "lo que falta para completar la unidad" en vez de
                  como una lista al costado.

                  Son MONEDAS, no puntitos: numeradas, con borde de tinta y un
                  aro blanco que las despega de las huellas y del papel de
                  puntos. Con 14 px lisos eran del mismo tamaño que las huellas
                  del sendero y un alumno no tenía forma de saber cuál de todos
                  los círculos se tocaba. El número además las ata al "2 de 4
                  lecciones" de la etiqueta: son ESTAS cuatro. */}
              {lecciones.map((l, j) => {
                const t = tMoneda(k, j, lecciones.length);
                // ⚠️ Índice de PARADA (`k`), no de ítem (`p.i`): con exámenes
                // intercalados los dos se desfasan, y con `p.i` los puntos de
                // toda unidad posterior a una prueba caían en el tramo ANTERIOR
                // al suyo — las lecciones de la unidad 7 aparecían colgadas del
                // tramo que llega a la 6.
                const q = puntoEnTramo(k, t, amp, ys);
                const lh = done.includes(l.key);
                // La PRÓXIMA lección de la unidad actual late en cobalto, igual
                // que el nodo grande: es la respuesta a "¿y ahora qué toco?".
                const sig = esActual && !lh && lecciones.slice(0, j).every((x) => done.includes(x.key));
                return (
                  <button key={l.key} title={l.title} aria-label={`Lección ${j + 1}: ${l.title}`}
                    className={sig ? "camino-sig" : undefined}
                    onClick={() => onAbrir({ ...p.item, key: l.key, title: l.title, p0: l.p0, p1: l.p1, unit: l.unit, lesson: l.lesson, lecciones: undefined })}
                    style={{
                      position: "absolute", top: q.y, left: `calc(50% + ${q.x}px)`,
                      transform: "translate(-50%,-50%)",
                      width: PUNTO, height: PUNTO, borderRadius: "50%", padding: 0,
                      background: lh ? C.ok : sig ? C.accent : C.panel,
                      border: `2.5px solid ${futuro ? C.dim : C.ink}`,
                      color: lh || sig ? "#fff" : futuro ? C.dim : C.text,
                      fontFamily: FONT.round, fontWeight: 800, fontSize: 11.5,
                      display: "grid", placeItems: "center", cursor: "pointer",
                      // El aro: separa la moneda de las huellas que pasan por
                      // debajo. Sin él, punto y huella comparten fondo y borde.
                      boxShadow: `0 0 0 3px ${C.panel}`,
                      animation: sig ? "caminoPulsoChico 2.2s ease-out infinite" : undefined,
                      transition: "transform .12s",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.transform = "translate(-50%,-50%) scale(1.22)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.transform = "translate(-50%,-50%)"; }}>
                    {lh ? <IconCheck size={13} /> : j + 1}
                  </button>
                );
              })}
            </div>
          );
        })}

        {/* LA META. Existe desde el primer día, apagada, al final del sendero
            punteado: el chico ve a dónde va. Al completar el camino se enciende
            en sol, flota, y la etiqueta lo dice con todas las letras. */}
        {(() => {
          const k = paradas.length;
          const { x, y } = centro(k);
          const aLaIzquierda = x > 0 || (x === 0 && posX(k + 1, amp) >= 0);
          const etiquetaMeta: React.CSSProperties = aLaIzquierda
            ? { position: "absolute", top: y, transform: "translateY(-50%)", right: `calc(50% - ${x - NODO / 2 - 22}px)`, width: `calc(50% + ${x - NODO / 2 - 26 - MARGEN_H}px)`, textAlign: "right" }
            : { position: "absolute", top: y, transform: "translateY(-50%)", left: `calc(50% + ${x + NODO / 2 + 22}px)`, width: `calc(50% - ${x + NODO / 2 + 26 + MARGEN_H}px)`, textAlign: "left" };
          return (
            <div>
              <div style={etiquetaMeta}>
                <span style={{ fontFamily: FONT.round, fontWeight: 800, fontSize: completo ? 13.5 : 12, color: completo ? C.warnTx : C.dim, lineHeight: 1.3 }}>
                  {completo ? "¡Completaste el camino!" : "La meta"}
                </span>
              </div>
              <div className={completo ? "camino-meta-viva" : undefined} aria-hidden
                style={{
                  position: "absolute", left: "50%", top: y,
                  width: NODO, height: NODO, borderRadius: "50%",
                  // TODO el posicionamiento por margen, nada por transform: la
                  // animación de flote anima `transform` y pisaría cualquier
                  // translate que pongamos acá (ya pasó con el rombo del examen).
                  marginLeft: -NODO / 2 + x, marginTop: -NODO / 2,
                  border: completo ? `3px solid ${C.ink}` : `2px dashed ${C.border}`,
                  background: completo ? C.sun : C.panel,
                  color: completo ? C.ink : C.border,
                  display: "grid", placeItems: "center",
                  boxShadow: completo ? HARD(C.ink) : "none",
                  animation: completo ? "caminoFlota 2.6s ease-in-out infinite" : undefined,
                }}>
                <IconStar size={28} />
              </div>
            </div>
          );
        })()}
      </div>

      {/* ── LO QUE EL LIBRO NO TRAE ────────────────────────────────────────
          Los pilares solo pueden destacar lo que el tomo sí enseña, así que
          hasta acá el hueco era INVISIBLE: el chico recorría el camino entero
          sin enterarse de que hay algo que le van a exigir y su libro no cubre.
          El dato ya estaba en `curriculum_map`; la pantalla lo escondía.

          Va AL FINAL y no intercalado entre las paradas: no es algo que pueda
          estudiar en este libro, así que meterlo en el sendero prometería una
          lección que no existe.

          En CORAL y no en el SOL de los pilares: son la misma exigencia
          curricular, pero opuestas —una es "acá está", la otra "acá no está"—,
          y pintarlas igual las volvía indistinguibles de un vistazo. */}
      {(pendientes?.length ?? 0) > 0 && !loading && (
        <div style={{
          marginTop: 34, background: C.panel, border: `2px solid ${C.ink}`,
          borderRadius: 16, padding: "16px 18px", boxShadow: HARD(C.coral),
        }}>
          <div style={{
            fontFamily: FONT.round, fontWeight: 900, fontSize: 15, color: C.ink,
            display: "flex", alignItems: "center", gap: 7,
          }}>
            <IconStar size={15} />
            Esto te lo van a exigir y tu libro no lo trae
          </div>
          <div style={{ color: C.dim, fontSize: 12.5, marginTop: 4, lineHeight: 1.45 }}>
            {pendientes!.length === 1 ? "Es un tema del" : `Son ${pendientes!.length} temas del`}{" "}
            programa oficial que tu texto de {area} no desarrolla. No los pierdas de vista.
          </div>
          <ul style={{ listStyle: "none", margin: "12px 0 0", padding: 0, display: "grid", gap: 8 }}>
            {pendientes!.map((p) => (
              <li key={p.item} style={{
                display: "flex", gap: 9, alignItems: "flex-start",
                background: C.panel2, borderRadius: 10, padding: "9px 11px",
              }}>
                <span style={{
                  flex: "0 0 auto", marginTop: 2, width: 8, height: 8, borderRadius: "50%",
                  background: p.enHermana ? C.sun : C.coral,
                }} />
                <span style={{ minWidth: 0 }}>
                  <span style={{ fontSize: 13.5, color: C.text, fontWeight: 600, lineHeight: 1.4 }}>
                    {p.item.replace(/\.$/, "")}
                  </span>
                  {/* DÓNDE SÍ ESTÁ. Es la diferencia entre un reproche y algo
                      accionable: el plan EPJA tiene UN casillero "Ciencias
                      Naturales" y el sistema regular lo parte en tres tomos, así
                      que la mitad de estos huecos están en un libro hermano que
                      el alumno TAMBIÉN tiene. */}
                  <span style={{ display: "block", fontSize: 12, color: C.dim, marginTop: 3, lineHeight: 1.4 }}>
                    {p.enHermana
                      ? <>Está en tu libro de <b style={{ color: C.okTx }}>{p.enHermana.materia}</b>
                          {p.enHermana.paginaDesde ? `, página ${p.enHermana.paginaDesde}` : ""}.</>
                      : p.motivo === "otro_año"
                        ? "Está en tu tomo, pero en la mitad del otro curso."
                        : "No está en ninguno de tus libros: pedile material a tu profe."}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

    </div>
  );
}

/**
 * Diámetro de la MONEDA de lección. 24 y no 14: con 14 medía lo mismo que las
 * huellas del sendero y no se distinguía qué se tocaba. 24 le da lugar al
 * número adentro — y el número es la diferencia más fuerte contra cualquier
 * círculo decorativo, porque la textura no tiene números.
 */
const PUNTO = 24;
/** Aire entre monedas vecinas sobre el tramo. */
const GAP_PUNTO = 8;
/** Aire entre una moneda y el nodo de la punta del tramo. */
const AIRE_PUNTO = 7;

/**
 * Un punto SOBRE el tramo que va de la parada `k` a la `k+1`, con `t` de 0 a 1.
 *
 * Es la misma Bézier cúbica que dibuja `sendero`, evaluada en vez de dibujada.
 * Sirve para poner las monedas de lección ENCIMA del sendero, que es donde el
 * chico las espera: antes eran chips de texto al costado y en una materia con
 * 19 unidades tapaban el camino entero.
 */
function puntoEnTramo(k: number, t: number, amp: number, ys: number[]): { x: number; y: number } {
  const p0 = { x: posX(k, amp), y: ys[k] ?? 0 };
  const p3 = { x: posX(k + 1, amp), y: ys[k + 1] ?? (ys[k] ?? 0) + PASO };
  const h = (p3.y - p0.y) / 2;
  const p1 = { x: p0.x, y: p0.y + h };
  const p2 = { x: p3.x, y: p3.y - h };
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
}

/** Curva que pasa por los centros de las primeras `n` paradas. Los altos vienen
 *  en `ys` porque el paso dejó de ser fijo: cada tramo mide según su carga. */
function sendero(n: number, amp: number, ys: number[]): string {
  if (n <= 0) return "";
  let d = "";
  for (let k = 0; k < n; k++) {
    const x = posX(k, amp), y = ys[k] ?? 0;
    if (k === 0) { d += `M ${x} ${y}`; continue; }
    const xa = posX(k - 1, amp), ya = ys[k - 1] ?? 0;
    // Curva suave: los puntos de control a media altura DEL TRAMO dan la
    // ondulación sin que el trazo se despegue de los nodos.
    const h = (y - ya) / 2;
    d += ` C ${xa} ${ya + h}, ${x} ${y - h}, ${x} ${y}`;
  }
  return d;
}

/** Cuántas paradas seguidas van completas desde el arranque. El tramo en color
 *  llega HASTA ahí: pintar lecciones sueltas más adelante daría la idea de que
 *  el camino ya está recorrido cuando no lo está.
 *  Una UNIDAD está completa cuando lo están todas sus lecciones — la clave de
 *  la unidad misma no se marca nunca en `done` (el progreso se guarda por
 *  lección), y mirarla directo dejaba el sendero pintado en cero para siempre. */
function hechasSeguidas(
  paradas: ({ tipo: "leccion"; item: PlanItem } | { tipo: "examen" })[],
  done: string[],
): number {
  let n = 0;
  for (const p of paradas) {
    if (p.tipo === "examen") { n++; continue; }
    const ls = p.item.lecciones ?? [];
    const hecho = ls.length > 0 ? ls.every((l) => done.includes(l.key)) : done.includes(p.item.key);
    if (!hecho) break;
    n++;
  }
  return n;
}
