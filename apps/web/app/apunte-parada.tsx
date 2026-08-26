"use client";
/**
 * EL APUNTE DE UNA PARADA — de acá se estudia.
 *
 * ── POR QUÉ ESTA PANTALLA EXISTE ────────────────────────────────────────────
 *
 * Casi nadie enseña a tomar apuntes. El apunte típico de un alumno es una
 * transcripción del pizarrón —sin jerarquía, sin el porqué, sin palabras
 * propias— y a la semana siguiente no sirve para nada.
 *
 * Así que esto no es un resumen: es una FORMA. Idea principal arriba, puntos
 * numerados con su página, palabras aparte, cómo acordarse, el error típico, qué
 * se evalúa y tres líneas para la noche anterior. Esa forma es imitable, y el
 * pie de página se lo dice al alumno en la cara: copiala en tu cuaderno.
 *
 * ── LA PROCEDENCIA, QUE ACÁ ES DISTINTA DE LA CLASE ─────────────────────────
 *
 * La clase muestra PASAJES LITERALES del libro. El apunte NO puede: un apunte
 * hecho de citas textuales es exactamente la transcripción que venimos a
 * reemplazar. Entonces lo que sostiene cada punto es otra cosa y se ve:
 *
 *   · cada punto lleva SU PÁGINA — el alumno puede ir a verificarlo;
 *   · "Cómo acordarse" es la analogía del tutor y va aparte, sin página,
 *     porque no sale del libro y no la respalda nada;
 *   · "Ojo con esto" dice de dónde viene: el libro del profesor.
 *
 * Y antes de guardarse, cada punto pasó un gate de NLI contra las oraciones de
 * las que dijo salir. No es la garantía determinística del pasaje literal, y no
 * se presenta como si lo fuera.
 */
import { C, FONT, HARD } from "./ui";
import type { Apunte } from "./tipos";

function Seccion({ titulo, nota, children }: { titulo: string; nota?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", marginBottom: 7 }}>
        <span style={{ fontFamily: FONT.round, fontWeight: 800, fontSize: 11.5, letterSpacing: .8, textTransform: "uppercase", color: C.accent }}>{titulo}</span>
        {nota && <span style={{ fontFamily: FONT.mono, fontSize: 10.5, color: C.dim }}>{nota}</span>}
      </div>
      {children}
    </div>
  );
}

/** El apunte en texto plano, para bajarlo. Espeja `apunteATexto` del servidor. */
function aTexto(a: Apunte, titulo: string, materia: string, paginas: string): string {
  const L: string[] = [titulo.toUpperCase(), `${materia}${paginas ? ` · ${paginas}` : ""}`, "=".repeat(50), ""];
  if (a.idea) L.push("LA IDEA PRINCIPAL", a.idea, "");
  if (a.puntos.length) {
    L.push("PARA ENTENDER");
    a.puntos.forEach((p, i) => {
      L.push(`${i + 1}. ${p.titulo}${p.pagina != null ? `  (pág. ${p.pagina})` : ""}`, `   ${p.texto}`, "");
    });
  }
  if (a.palabras.length) {
    L.push("PALABRAS QUE HAY QUE SABER");
    a.palabras.forEach((w) => L.push(`· ${w.palabra}: ${w.definicion}${w.pagina != null ? ` (pág. ${w.pagina})` : ""}`));
    L.push("");
  }
  if (a.comoAcordarse) L.push("CÓMO ACORDARSE  (no está en el libro)", a.comoAcordarse, "");
  if (a.ojo) L.push("OJO CON ESTO  (del libro del profesor)", a.ojo, "");
  if (a.seEvalua.length) { L.push("TE LO PUEDEN PREGUNTAR ASÍ"); a.seEvalua.forEach((s) => L.push(`· ${s}`)); L.push(""); }
  if (a.tresLineas.length) {
    L.push("EN TRES LÍNEAS  (para la noche anterior)");
    a.tresLineas.forEach((s, i) => L.push(`${i + 1}. ${s}`));
    L.push("");
  }
  L.push("-".repeat(50));
  L.push("Este apunte tiene la forma de un buen apunte: la idea primero, los puntos");
  L.push("numerados con su página, las palabras aparte y el resumen al final.");
  L.push("Copiá esa forma en tu cuaderno y vas a estudiar mucho mejor.");
  return L.join("\n");
}

export function ApunteParada({ apunte, titulo, materia, paginas }: { apunte: Apunte; titulo: string; materia: string; paginas: string }) {
  /**
   * BAJARLO COMO ARCHIVO. El apunte se estudia fuera de la app —en el colectivo,
   * en el trabajo, con el teléfono en modo avión— y ahí no hay app que valga.
   * Texto plano y no PDF a propósito: se abre en el bloc de notas de cualquier
   * teléfono, se puede pegar en WhatsApp y se imprime igual.
   */
  function bajar() {
    const txt = aTexto(apunte, titulo, materia, paginas);
    const url = URL.createObjectURL(new Blob([txt], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `apunte - ${titulo.replace(/[\\/:*?"<>|]/g, "")}.txt`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ background: C.panel, border: `2px solid ${C.ink}`, borderRadius: 16, boxShadow: HARD(C.sun), padding: "16px 17px 20px" }}>
        <div style={{ fontFamily: FONT.round, fontWeight: 800, fontSize: 11.5, letterSpacing: .8, textTransform: "uppercase", color: C.dim }}>
          Apunte para estudiar
        </div>

        {apunte.idea && (
          <div style={{ marginTop: 9, fontFamily: FONT.round, fontWeight: 700, fontSize: 16.5, lineHeight: 1.4 }}>
            {apunte.idea}
          </div>
        )}

        {apunte.puntos.length > 0 && (
          <Seccion titulo="Para entender">
            <div style={{ display: "grid", gap: 12 }}>
              {apunte.puntos.map((p, i) => (
                <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <span style={{ width: 22, height: 22, flexShrink: 0, borderRadius: 7, display: "grid", placeItems: "center", background: C.accent, color: "#fff", fontFamily: FONT.round, fontWeight: 800, fontSize: 12 }}>{i + 1}</span>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: "block", fontFamily: FONT.round, fontWeight: 700, fontSize: 14.5 }}>
                      {p.titulo}
                      {/* LA PÁGINA ES LA GARANTÍA. Acá no hay pasaje literal que
                          mostrar, así que lo que le permite al alumno verificar
                          —y volver al libro cuando algo no le cierra— es esto. */}
                      {p.pagina != null && (
                        <span style={{ fontFamily: FONT.mono, fontWeight: 400, fontSize: 11, color: C.dim, marginLeft: 7 }}>pág. {p.pagina}</span>
                      )}
                    </span>
                    <span style={{ display: "block", fontSize: 14, lineHeight: 1.55, marginTop: 2 }}>{p.texto}</span>
                  </span>
                </div>
              ))}
            </div>
          </Seccion>
        )}

        {apunte.palabras.length > 0 && (
          <Seccion titulo="Palabras que hay que saber">
            <div style={{ background: C.userBubble, borderLeft: `4px solid ${C.accentSoft}`, borderRadius: 10, padding: "10px 13px" }}>
              {apunte.palabras.map((w, i) => (
                <div key={i} style={{ fontSize: 13.5, lineHeight: 1.5, marginTop: i === 0 ? 0 : 6 }}>
                  <b>{w.palabra}</b> <span style={{ color: C.dim }}>— {w.definicion}</span>
                  {w.pagina != null && <span style={{ fontFamily: FONT.mono, fontSize: 10.5, color: C.dim }}> (p.{w.pagina})</span>}
                </div>
              ))}
            </div>
          </Seccion>
        )}

        {apunte.comoAcordarse && (
          <Seccion titulo="Cómo acordarse" nota="no está en el libro">
            <div style={{ background: C.panel, border: `1.5px dashed ${C.dim}`, borderRadius: 10, padding: "10px 13px", fontSize: 13.5, lineHeight: 1.55 }}>
              {apunte.comoAcordarse}
            </div>
          </Seccion>
        )}

        {apunte.ojo && (
          <Seccion titulo="Ojo con esto" nota="del libro del profesor">
            <div style={{ background: C.warnBg, borderLeft: `4px solid ${C.warn}`, borderRadius: 10, padding: "10px 13px", fontSize: 13.5, lineHeight: 1.55, color: C.warnTx }}>
              {apunte.ojo}
            </div>
          </Seccion>
        )}

        {apunte.seEvalua.length > 0 && (
          <Seccion titulo="Te lo pueden preguntar así" nota="lo que se evalúa">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {apunte.seEvalua.map((s, i) => (
                <span key={i} style={{ background: C.panel2, border: `1px solid ${C.border}`, borderRadius: 999, padding: "5px 11px", fontSize: 12.5 }}>{s}</span>
              ))}
            </div>
          </Seccion>
        )}

        {apunte.tresLineas.length > 0 && (
          <Seccion titulo="En tres líneas" nota="para la noche anterior">
            <div style={{ background: C.okBg, borderLeft: `4px solid ${C.ok}`, borderRadius: 10, padding: "10px 13px" }}>
              {apunte.tresLineas.map((s, i) => (
                <div key={i} style={{ fontSize: 13.5, lineHeight: 1.5, color: C.okTx, marginTop: i === 0 ? 0 : 5 }}>
                  <b>{i + 1}.</b> {s}
                </div>
              ))}
            </div>
          </Seccion>
        )}
      </div>

      <button onClick={bajar}
        style={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 11, background: C.panel, color: C.text, border: `2px solid ${C.ink}`, borderRadius: 12, padding: "12px 15px", fontFamily: FONT.round, fontWeight: 700, fontSize: 14, cursor: "pointer" }}>
        Bajar el apunte para estudiar sin internet
      </button>

      {/* LA PARTE QUE SE LLEVA PUESTA. Esto no es un pie de página decorativo:
          es lo único de la pantalla que le queda al alumno cuando no tenga la
          app delante, y es la razón por la que el apunte tiene esta forma. */}
      <div style={{ marginTop: 12, fontSize: 12.5, color: C.dim, lineHeight: 1.55, background: C.panel2, borderRadius: 10, padding: "10px 12px" }}>
        <b style={{ color: C.text, fontFamily: FONT.round }}>Fijate en la forma.</b> La idea primero, después los
        puntos numerados con su página, las palabras aparte y el resumen al final. Copiá esa forma en tu
        cuaderno y vas a estudiar mucho mejor que copiando el pizarrón entero.
      </div>
    </div>
  );
}
