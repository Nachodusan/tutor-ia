"use client";
import { useEffect, useRef, useState } from "react";
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
        listo: bloque.every((b) => done.includes(b.key)),
      });
    }
  });

  // +1 parada visual: LA META. No es una lección — es el lugar al que se llega,
  // y verla desde el arranque es lo que convierte la lista en un recorrido.
  const alto = (paradas.length + 1) * PASO + NODO + MARGEN_V * 2;
  const centro = (k: number) => ({ x: posX(k, amp), y: MARGEN_V + k * PASO + NODO / 2 });
  // El avance se cuenta en NODOS del camino, no en marcas sueltas. Cuando el
  // nodo es una unidad con lecciones adentro, está hecho cuando lo están todas:
  // contar `done.length` contra `items.length` mezclaba lecciones hechas con
  // unidades totales y decía "4 de 6 lecciones · 67%" con dos unidades a medias.
  const nodoHecho = (it: PlanItem) => {
    const ls = it.lecciones ?? [];
    return ls.length > 0 ? ls.every((l) => done.includes(l.key)) : done.includes(it.key);
  };
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

  return (
    <div>
      {/* Animaciones del camino. `prefers-reduced-motion` las apaga enteras. */}
      <style>{`
        @keyframes caminoPulso {
          0%, 100% { box-shadow: 4px 4px 0 0 ${C.ink}, 0 0 0 0 rgba(43,68,255,.35); }
          50%      { box-shadow: 4px 4px 0 0 ${C.ink}, 0 0 0 14px rgba(43,68,255,0); }
        }
        @keyframes caminoFlota { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-5px) } }
        @media (prefers-reduced-motion: reduce) {
          .camino-actual, .camino-meta-viva { animation: none !important; }
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
            const todo = sendero(paradas.length + 1, amp);
            const hecho = sendero(completo ? paradas.length + 1 : hechasSeguidas(paradas, done), amp);
            return (
              <>
                {/* LO QUE FALTA: huellas. Van MÁS OSCURAS que los puntos del
                    papel —eran del mismo `C.border` y se confundían con el
                    fondo— y con contorno propio, para que se lean como camino
                    por pisar y no como textura. */}
                <path d={todo} fill="none" stroke={C.ink} strokeWidth={17} strokeLinecap="round"
                  strokeDasharray="0.1 27" opacity={0.12} />
                <path d={todo} fill="none" stroke={C.dim} strokeWidth={10} strokeLinecap="round"
                  strokeDasharray="0.1 27" opacity={0.38} />

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
          // PUNTOS DE CONTROL. Cuando el libro tiene índice, la unidad se
          // desglosa en sus lecciones y el avance se cuenta ahí: la unidad está
          // hecha cuando lo están todas. Esto es lo que hace que pasar el camino
          // a unidades NO borre el avance que el chico traía — su marca sigue
          // siendo la de la lección, con la misma clave de siempre.
          const lecciones = p.item.lecciones ?? [];
          const hechas = lecciones.filter((l) => done.includes(l.key)).length;
          const hecho = lecciones.length > 0 ? hechas === lecciones.length : done.includes(p.item.key);
          const sc = scores[p.item.key];
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

                {/* Cuántos puntos de control lleva hechos. El detalle de cada uno
                    vive en el circulito sobre el sendero, no acá: en una materia
                    de 19 unidades los títulos tapaban el camino entero. */}
                {lecciones.length > 0 && (
                  <span style={{ fontFamily: FONT.round, fontWeight: 700, fontSize: 11, color: hechas === lecciones.length ? C.okTx : C.dim }}>
                    {hechas} de {lecciones.length}
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

              {/* LOS PUNTOS DE CONTROL, SOBRE EL SENDERO. Repartidos a lo largo
                  del tramo que sale de esta unidad hacia la siguiente: se leen
                  como "lo que falta para completar la unidad" en vez de como una
                  lista al costado. Chicos a propósito — el protagonista sigue
                  siendo el nodo grande. */}
              {lecciones.map((l, j) => {
                // Los puntos se reparten en el TRAMO LIBRE, no de nodo a nodo:
                // el nodo mide 64 y el punto 20, así que hace falta apartarse
                // ~42px de cada centro para no pisarlo. Sobre un paso de 164 eso
                // es 0,26 — con 0,28 queda aire.
                const MARGEN_NODO = 0.25;
                const t = MARGEN_NODO + ((j + 1) / (lecciones.length + 1)) * (1 - 2 * MARGEN_NODO);
                const q = puntoEnTramo(p.i, t, amp);
                const lh = done.includes(l.key);
                return (
                  <button key={l.key} title={l.title}
                    onClick={() => onAbrir({ ...p.item, key: l.key, title: l.title, p0: l.p0, p1: l.p1, unit: l.unit, lesson: l.lesson, lecciones: undefined })}
                    style={{
                      position: "absolute", top: q.y, left: `calc(50% + ${q.x}px)`,
                      transform: "translate(-50%,-50%)",
                      width: PUNTO, height: PUNTO, borderRadius: "50%", padding: 0,
                      background: lh ? C.ok : C.panel,
                      border: `2px solid ${lh ? C.ink : C.dim}`,
                      color: "#fff", display: "grid", placeItems: "center", cursor: "pointer",
                      boxShadow: lh ? HARD_CHICO(C.ink) : "none",
                      transition: "transform .12s",
                    }}>
                    {lh && <IconCheck size={10} />}
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

    </div>
  );
}

/** Curva que pasa por los centros de las primeras `n` paradas. */
/**
 * Un punto SOBRE el tramo que va del nodo `k` al `k+1`, con `t` de 0 a 1.
 *
 * Es la misma Bézier cúbica que dibuja `sendero`, evaluada en vez de dibujada.
 * Sirve para poner los puntos de control de una unidad ENCIMA del sendero, que
 * es donde el chico los espera: antes eran chips de texto al costado y en una
 * materia con 19 unidades tapaban el camino entero.
 */
/** Diámetro del punto de control. Chico frente a los 64 del nodo: es un hito
 *  dentro de la unidad, no una parada del camino. */
const PUNTO = 14;
/** La sombra dura del mundo Bloques, a escala del punto. */
const HARD_CHICO = (c: string) => `2px 2px 0 0 ${c}`;

function puntoEnTramo(k: number, t: number, amp: number): { x: number; y: number } {
  const pt = (i: number) => ({ x: posX(i, amp), y: MARGEN_V + i * PASO + NODO / 2 });
  const p0 = pt(k), p3 = pt(k + 1);
  const p1 = { x: p0.x, y: p0.y + PASO / 2 };
  const p2 = { x: p3.x, y: p3.y - PASO / 2 };
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
}

function sendero(n: number, amp: number): string {
  if (n <= 0) return "";
  const pt = (k: number) => ({ x: posX(k, amp), y: MARGEN_V + k * PASO + NODO / 2 });
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
