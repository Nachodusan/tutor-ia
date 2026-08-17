"use client";
/**
 * LA TARJETA DEL MODO EJERCICIO — el desglose, estilo Photomath.
 *
 * No es una burbuja de chat: es una ficha. El enunciado arriba, el resultado
 * destacado, los pasos plegables y el plano cartesiano abajo. Se pliega porque un
 * chico que solo quiere chequear su respuesta no necesita leer seis renglones, y
 * el que se trabó sí — el mismo componente sirve a los dos.
 *
 * El gráfico es SVG inline: sin librerías ni CDN, que es la restricción de la red
 * del colegio, y además así hereda los colores del sistema de diseño.
 */
import { useState } from "react";
import { C, FONT, HARD, IconCheck, IconAlert, IconChevron } from "./ui";

export type Punto = [number, number | null];

export interface PasoExplicado {
  expr: string;
  porque: string;
  veredicto?: "ok" | "pierde" | "agrega" | "mal" | "indeciso";
}

export interface Tarjeta {
  enunciado: string;
  operacion: string;
  resultado: string;
  pasos: PasoExplicado[];
  raices?: number[];
  aviso?: string;
  titulo?: string;
  sinSolucionReal?: boolean;
  /** Qué función se dibuja. NO siempre es el resultado: al derivar se grafica la
   *  función ORIGINAL, y sin decirlo el chico puede leer el dibujo como la
   *  respuesta. */
  grafico?: { expr: string; variable: string };
  curva?: { puntos: Punto[]; desde: number; hasta: number };
}

const TITULO: Record<string, string> = {
  solve: "Resolver la ecuación",
  diff: "Derivar",
  integrate: "Integrar",
  factor: "Factorizar",
  expand: "Desarrollar",
  simplify: "Simplificar",
};

/** `20*x**3 - 3` es sintaxis de máquina; el chico lee `20x³ - 3`. */
const ALTO: Record<string, string> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴",
  "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
};

export function comoSeLee(s: string): string {
  return s
    .replace(/\*\*(\d+)/g, (_m, d: string) => [...d].map((c) => ALTO[c]!).join(""))
    .replace(/\^(\d+)/g, (_m, d: string) => [...d].map((c) => ALTO[c]!).join(""))
    .replace(/sqrt\(/g, "√(")
    // El punto de multiplicar solo va donde un libro lo pone. Entre un número y
    // su variable no se escribe: es "2x²", no "2·x²".
    .replace(/(\d)\s*\*\s*(?=[a-zA-Z(√])/g, "$1")
    .replace(/\*/g, " · ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** El plano cartesiano. Ejes con números, la curva, y las raíces marcadas. */
function Plano({ curva, raices }: { curva: NonNullable<Tarjeta["curva"]>; raices?: number[] }) {
  const W = 320, H = 200, M = 18;
  const ys = curva.puntos.map((p) => p[1]).filter((y): y is number => y != null);
  if (ys.length < 2) return null;

  // El eje Y se recorta a un rango razonable: una asíntota llevaría la escala a
  // millones y la curva quedaría pegada al eje, sin mostrar nada.
  const orden = [...ys].sort((a, b) => a - b);
  const p05 = orden[Math.floor(orden.length * 0.05)]!;
  const p95 = orden[Math.floor(orden.length * 0.95)]!;
  const yMin = Math.min(p05, 0) - 1;
  const yMax = Math.max(p95, 0) + 1;

  const px = (x: number) => M + ((x - curva.desde) / (curva.hasta - curva.desde)) * (W - 2 * M);
  const py = (y: number) => H - M - ((y - yMin) / (yMax - yMin)) * (H - 2 * M);

  // Un `null` CORTA el trazo en vez de unir los extremos: así una división por
  // cero se ve como el hueco que es y no como una recta vertical inventada.
  const tramos: string[] = [];
  let d = "";
  for (const [x, y] of curva.puntos) {
    if (y == null || y < yMin - 50 || y > yMax + 50) { if (d) { tramos.push(d); d = ""; } continue; }
    d += `${d ? "L" : "M"}${px(x).toFixed(1)} ${py(y).toFixed(1)}`;
  }
  if (d) tramos.push(d);

  const marcas = (desde: number, hasta: number) => {
    const paso = Math.max(1, Math.round((hasta - desde) / 8));
    const out: number[] = [];
    for (let v = Math.ceil(desde); v <= hasta; v += paso) out.push(v);
    return out;
  };

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Gráfico de la función"
      style={{ width: "100%", height: "auto", display: "block" }}>
      {marcas(curva.desde, curva.hasta).map((v) => (
        <line key={`vx${v}`} x1={px(v)} y1={M} x2={px(v)} y2={H - M} stroke={C.border} strokeWidth={0.5} />
      ))}
      {marcas(yMin, yMax).map((v) => (
        <line key={`hy${v}`} x1={M} y1={py(v)} x2={W - M} y2={py(v)} stroke={C.border} strokeWidth={0.5} />
      ))}
      {yMin <= 0 && yMax >= 0 && (
        <line x1={M} y1={py(0)} x2={W - M} y2={py(0)} stroke={C.dim} strokeWidth={1.2} />
      )}
      {curva.desde <= 0 && curva.hasta >= 0 && (
        <line x1={px(0)} y1={M} x2={px(0)} y2={H - M} stroke={C.dim} strokeWidth={1.2} />
      )}
      {marcas(curva.desde, curva.hasta).filter((v) => v !== 0).map((v) => (
        <text key={`tx${v}`} x={px(v)} y={Math.min(H - 4, py(0) + 11)} textAnchor="middle"
          fontSize={8} fill={C.dim} fontFamily={FONT.mono}>{v}</text>
      ))}
      {tramos.map((t, i) => (
        <path key={i} d={t} fill="none" stroke={C.accent} strokeWidth={2} strokeLinecap="round" />
      ))}
      {/* Las raíces son el punto del ejercicio: dónde la curva cruza el eje. */}
      {(raices ?? [])
        .filter((r) => r >= curva.desde && r <= curva.hasta)
        .map((r, i) => (
          <g key={i}>
            <circle cx={px(r)} cy={py(0)} r={4.5} fill={C.panel} stroke={C.coral} strokeWidth={2.5} />
            <text x={px(r)} y={py(0) - 9} textAnchor="middle" fontSize={9} fontWeight={700}
              fill={C.warnTx} fontFamily={FONT.mono}>{Number(r.toFixed(3))}</text>
          </g>
        ))}
    </svg>
  );
}

export function TarjetaEjercicioView({ t }: { t: Tarjeta }) {
  // Arranca ABIERTA: el chico que mandó un ejercicio quiere ver cómo se hace. El
  // que solo quería el resultado lo tiene arriba y pliega.
  const [abierto, setAbierto] = useState(true);

  return (
    <div style={{ alignSelf: "flex-start", maxWidth: "94%", width: "100%", background: C.panel,
      border: `2px solid ${C.ink}`, borderRadius: 16, boxShadow: HARD(C.ink), overflow: "hidden" }}>
      <div style={{ padding: "12px 15px", borderBottom: `1.5px solid ${C.border}` }}>
        <div style={{ fontFamily: FONT.round, fontWeight: 700, fontSize: 11, letterSpacing: 0.5,
          textTransform: "uppercase", color: C.dim, marginBottom: 5 }}>
          {t.titulo ?? TITULO[t.operacion] ?? "Ejercicio"}
        </div>
        <div style={{ fontFamily: FONT.mono, fontSize: 17, color: C.text, wordBreak: "break-word" }}>
          {comoSeLee(t.enunciado)}
        </div>
      </div>

      <div style={{ padding: "13px 15px", background: C.okBg, display: "flex",
        alignItems: "center", gap: 9 }}>
        <span style={{ display: "flex", flexShrink: 0, color: C.okTx }}><IconCheck size={16} /></span>
        <div>
          <div style={{ fontSize: 11, color: C.dim, fontFamily: FONT.round, fontWeight: 700 }}>Resultado</div>
          <div style={{ fontFamily: FONT.mono, fontSize: 19, fontWeight: 700, color: C.okTx }}>
            {comoSeLee(t.resultado)}
          </div>
        </div>
      </div>

      {t.sinSolucionReal && (
        <div style={{ padding: "11px 15px", borderTop: `1.5px solid ${C.border}`,
          fontSize: 13.5, color: C.text, lineHeight: 1.55 }}>
          Su gráfica <strong>nunca cruza el eje x</strong>: no hay ningún número real
          que haga cero esta expresión. Mirá el dibujo de abajo y vas a ver que la
          curva pasa entera por arriba (o entera por abajo) del eje.
        </div>
      )}

      {t.pasos.length > 0 && (
        <>
          <button onClick={() => setAbierto((a) => !a)}
            style={{ width: "100%", display: "flex", alignItems: "center", gap: 7, padding: "10px 15px",
              background: "none", border: "none", borderTop: `1.5px solid ${C.border}`, cursor: "pointer",
              fontFamily: FONT.round, fontWeight: 700, fontSize: 12, color: C.dim, textAlign: "left" }}>
            <span style={{ display: "flex", transform: abierto ? "rotate(90deg)" : "none", transition: "transform .18s" }}>
              <IconChevron size={13} />
            </span>
            {abierto ? "Ocultar los pasos" : `Ver cómo se hace (${t.pasos.length} pasos)`}
          </button>
          {abierto && (
            <ol style={{ margin: 0, padding: "0 15px 13px 15px", listStyle: "none", display: "grid", gap: 11 }}>
              {t.pasos.map((p, i) => (
                <li key={i} style={{ display: "grid", gridTemplateColumns: "22px 1fr", gap: 9, alignItems: "start" }}>
                  <span style={{ display: "grid", placeItems: "center", width: 22, height: 22, borderRadius: "50%",
                    background: C.panel2, color: C.dim, fontFamily: FONT.round, fontWeight: 700, fontSize: 11 }}>
                    {i + 1}
                  </span>
                  <div>
                    <div style={{ fontFamily: FONT.mono, fontSize: 15.5, color: C.text, wordBreak: "break-word" }}>
                      {comoSeLee(p.expr)}
                    </div>
                    <div style={{ fontSize: 13, color: C.dim, lineHeight: 1.45, marginTop: 2 }}>{p.porque}</div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </>
      )}

      {t.aviso && (
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "10px 15px",
          background: C.warnBg, color: C.warnTx, fontSize: 12.5, lineHeight: 1.5,
          borderTop: `1.5px solid ${C.border}` }}>
          <span style={{ display: "flex", flexShrink: 0, marginTop: 1 }}><IconAlert size={14} /></span>
          <span>{t.aviso}</span>
        </div>
      )}

      {t.curva && (
        <div style={{ borderTop: `1.5px solid ${C.border}`, padding: "10px 12px 6px", background: C.panel2 }}>
          <div style={{ fontFamily: FONT.round, fontWeight: 700, fontSize: 11, letterSpacing: 0.5,
            textTransform: "uppercase", color: C.dim, marginBottom: 4 }}>
            {t.grafico ? `En el plano · y = ${comoSeLee(t.grafico.expr)}` : "En el plano"}
          </div>
          <Plano curva={t.curva} raices={t.raices} />
        </div>
      )}
    </div>
  );
}
