"use client";
/**
 * EL TECLADO DE MATEMÁTICA — solo en el chat de esa materia.
 *
 * QUÉ RESUELVE: escribir matemática en un teclado de teléfono es un castigo. Un
 * chico que quiere preguntar por √(x²+9) tipea "raiz de x al cuadrado mas 9",
 * el retrieval recibe eso, y la respuesta sale peor por culpa de la entrada.
 *
 * TIENE VISOR, y no es decoración: sin ver la expresión armada no se sabe si los
 * paréntesis cierran donde uno cree, y sin poder mover el cursor un "elevado a
 * 2" mal puesto no se arregla — hay que borrar todo y empezar de nuevo. El visor
 * muestra lo que se está armando con los exponentes en alto y el cursor a la
 * vista; las flechas y el borrar lo hacen editable de verdad.
 *
 * ⚠️ NO CALCULA, Y ESO SIGUE SIENDO A PROPÓSITO — pero por UNA razón, no dos.
 * Acá decía que el tutor no resuelve ejercicios; desde 2026-08-16 SÍ los
 * resuelve, paso a paso y terminando la cuenta (ver `TEACHING_SYSTEM`). Esa
 * razón ya no vale y se fue.
 *
 * La que queda es la buena: un número que aparece solo acá arriba, sin
 * procedimiento y sin nadie que lo explique, es exactamente lo que el chico no
 * necesita. El resultado se lo da el TUTOR, al final de una explicación que le
 * mostró el camino. Esto es un teclado para escribir el ejercicio; enseñar es
 * del otro lado.
 */
import { C, FONT, FLOAT, IconX } from "./ui";

interface Tecla {
  ver: string;
  pone: string;
  /** Cuántos caracteres retroceder el cursor: para dejarlo ADENTRO del
   *  paréntesis o de la raíz, que es donde sigue escribiendo. */
  cursor?: number;
  titulo?: string;
}

const FILAS: Tecla[][] = [
  [
    { ver: "x", pone: "x" },
    { ver: "y", pone: "y" },
    { ver: "(", pone: "(" },
    { ver: ")", pone: ")" },
    { ver: "÷", pone: " ÷ ", titulo: "Dividir" },
    { ver: "×", pone: " × ", titulo: "Multiplicar" },
  ],
  [
    // ⚠️ DOS PARÉNTESIS, UNO POR TÉRMINO. Antes ponía `( / )`, un solo grupo con
    // la barra adentro, y eso produce una fracción AMBIGUA que nadie puede
    // desambiguar después: "(2x − 1)/5" se escribía "(2x − 1 / 5)", que por
    // precedencia es "2x − 1/5". Medido: la intención da x = 8 y la lectura
    // literal da x = 8/5 — dos números plausibles y ningún síntoma. Con
    // "()/()" el numerador y el denominador quedan cerrados por separado y la
    // expresión significa una sola cosa.
    { ver: "a/b", pone: "()/()", cursor: 5, titulo: "Fracción — el de arriba, y tocá abajo para el denominador" },
    { ver: "x²", pone: "²", titulo: "Al cuadrado" },
    { ver: "xⁿ", pone: "^", titulo: "Elevado a — lo que escribas después queda arriba" },
    { ver: "√", pone: "√()", cursor: 1, titulo: "Raíz cuadrada" },
    { ver: "−", pone: " − " },
    { ver: "+", pone: " + " },
  ],
  [
    { ver: "π", pone: "π" },
    { ver: "≤", pone: " ≤ " },
    { ver: "≥", pone: " ≥ " },
    { ver: "≠", pone: " ≠ " },
    { ver: "%", pone: "%" },
    { ver: "=", pone: " = ", titulo: "Igual — para escribir la ecuación, no para resolverla" },
  ],
];

// Acá vivía una pestaña "Cómo preguntar" con arranques de pregunta ("No
// entiendo cómo se hace…"). Se fue: el teclado es para ESCRIBIR el ejercicio, y
// una pestaña que escribe la oración por el chico convertía un teclado en un
// formulario. Lo que tenga que decir lo escribe él.

/** Marca invisible del cursor: se mete en el texto para saber dónde dibujar la
 *  barrita, y se saca al tokenizar. */
const CARET = "";

type Parte = { tipo: "txt" | "sup" | "caret"; v: string };

/**
 * Parte la expresión en pedazos para dibujarla: lo que va después de `^` sube
 * como exponente, y la marca del cursor se convierte en la barrita.
 *
 * Es DIBUJO, no interpretación: no evalúa, no valida y no reordena nada. El
 * texto que se manda es exactamente el que se ve escrito.
 */
export function partirExpresion(texto: string): Parte[] {
  const partes: Parte[] = [];
  let buf = "";
  const cerrar = () => { if (buf) { partes.push({ tipo: "txt", v: buf }); buf = ""; } };

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i]!;
    if (c === CARET) { cerrar(); partes.push({ tipo: "caret", v: "" }); continue; }
    if (c === "^") {
      // El exponente es lo que sigue: dígitos y letras. Un `^` suelto al final
      // (recién tecleado) no rompe nada: se dibuja el sombrero y listo.
      let j = i + 1;
      let exp = "";
      while (j < texto.length && /[0-9a-zA-Zπ]/.test(texto[j]!)) { exp += texto[j]!; j++; }
      cerrar();
      partes.push({ tipo: "sup", v: exp || "^" });
      i = j - 1;
      continue;
    }
    buf += c;
  }
  cerrar();
  return partes;
}

/** El visor. Arriba el arranque en chico, abajo la expresión grande. */
function Visor({ texto, cursor }: { texto: string; cursor: number }) {
  // El arranque ("No entiendo cómo se hace este ejercicio: ") se separa de la
  // expresión: mezclados, la parte matemática se lee como el final de una
  // oración y se pierde justo lo que hay que revisar.
  const corte = texto.lastIndexOf(": ");
  const hayArranque = corte >= 0 && corte + 2 <= cursor;
  const arranque = hayArranque ? texto.slice(0, corte + 1) : "";
  const desde = hayArranque ? corte + 2 : 0;
  const expr = texto.slice(desde);
  const conCaret = expr.slice(0, cursor - desde) + CARET + expr.slice(cursor - desde);

  return (
    <div style={{
      background: C.panel2, border: `1.5px solid ${C.border}`, borderRadius: 13,
      padding: "10px 13px", marginBottom: 10, minHeight: 58,
      display: "flex", flexDirection: "column", justifyContent: "center", gap: 4,
    }}>
      {arranque && (
        <span style={{ color: C.dim, fontSize: 11.5, lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {arranque}
        </span>
      )}
      <span style={{ fontFamily: FONT.mono, fontSize: 20, lineHeight: 1.35, color: C.text, wordBreak: "break-word" }}>
        {expr.trim() === "" && cursor <= desde ? (
          <span style={{ color: C.dim, fontSize: 14, fontFamily: FONT.sans }}>Escribí el ejercicio con las teclas de abajo</span>
        ) : (
          partirExpresion(conCaret).map((p, i) =>
            p.tipo === "caret" ? (
              <span key={i} className="mate-caret" style={{ display: "inline-block", width: 2, height: "1.05em", background: C.accent, verticalAlign: "text-bottom", margin: "0 1px" }} />
            ) : p.tipo === "sup" ? (
              <sup key={i} style={{ fontSize: "0.62em", color: C.accent }}>{p.v}</sup>
            ) : (
              <span key={i}>{p.v}</span>
            ),
          )
        )}
      </span>
      <style>{`
        @keyframes mateParpadeo { 0%, 45% { opacity: 1 } 55%, 100% { opacity: .15 } }
        .mate-caret { animation: mateParpadeo 1.1s steps(1, end) infinite; }
        @media (prefers-reduced-motion: reduce) { .mate-caret { animation: none } }
      `}</style>
    </div>
  );
}

export function TecladoMate({ valor, cursor, onCambiar, onCerrar }: {
  valor: string;
  cursor: number;
  onCambiar: (texto: string, cursor: number) => void;
  onCerrar: () => void;
}) {
  /** Todo se inserta EN EL CURSOR, no al final: es lo que permite corregir en el
   *  medio —tocar entre dos caracteres del campo y seguir— en vez de tener que
   *  borrar hasta el error. */
  const insertar = (t: Tecla) => {
    const texto = valor.slice(0, cursor) + t.pone + valor.slice(cursor);
    onCambiar(texto, cursor + t.pone.length - (t.cursor ?? 0));
  };

  return (
    <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 20, boxShadow: FLOAT, padding: 12, marginBottom: 9 }}>
      {/* Sin pestañas ni fila de controles: el panel es el visor y las teclas.
          Mover el cursor y borrar los hace el campo de abajo con el teclado del
          aparato, que el chico ya sabe usar. */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span style={{ fontFamily: FONT.round, fontWeight: 700, fontSize: 12.5, color: C.dim, paddingLeft: 2 }}>
          Símbolos
        </span>
        <button onClick={onCerrar} title="Cerrar el teclado"
          style={{ marginLeft: "auto", display: "grid", placeItems: "center", width: 28, height: 28, borderRadius: "50%", background: C.panel2, color: C.dim, border: "none", cursor: "pointer" }}>
          <IconX size={14} />
        </button>
      </div>

      <Visor texto={valor} cursor={cursor} />

      <div style={{ display: "grid", gap: 6 }}>
        {FILAS.map((fila, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 6 }}>
            {fila.map((t) => (
              <button key={t.ver} onClick={() => insertar(t)} title={t.titulo ?? t.ver}
                style={{ padding: "10px 4px", background: C.panel2, color: C.text, border: `1.5px solid ${C.border}`, borderRadius: 11, cursor: "pointer", fontFamily: FONT.mono, fontSize: 15, lineHeight: 1 }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.accent; e.currentTarget.style.color = C.accent; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.text; }}>
                {t.ver}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * ¿Esta materia lleva teclado? Solo Matemática.
 *
 * Por NOMBRE y no por un id fijo: hay una materia de matemática por curso (doce
 * en total) y la lista cambia cuando el colegio sube material. El mismo criterio
 * que ya usa `subjectColor` para pintarlas a todas de cobalto.
 */
export const esMatematica = (nombre?: string | null): boolean =>
  /matem|c[aá]lculo|[áa]lgebra/i.test(nombre ?? "");
