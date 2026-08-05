/**
 * ¿QUÉ SEÑAL DISTINGUE "EL FRAGMENTO CONTESTA" DE "HABLA DEL TEMA"?
 *
 * El `rerankScore` no puede: medido sobre las 13 preguntas que la cascada
 * respondió con material de fuera del libro del curso, los que SÍ contestan
 * puntúan 0.99 0.99 0.81 0.80 0.69 0.63 y los que son ruido on-topic puntúan
 * 0.89 0.85 0.83 0.75 0.57 0.51 0.16. Se solapan por completo — ningún umbral
 * los separa, porque el cross-encoder mide RELEVANCIA, no si hay respuesta. Una
 * ficha catalográfica que nombra "Cien años de soledad" es máximamente relevante
 * a una pregunta sobre esa novela y no responde nada.
 *
 * Esto NO propone una solución: compara candidatos contra el veredicto ya
 * establecido y reporta cuál separa. Elegir a ojo el discriminador sería repetir
 * el error que puso el 0.5 donde no servía.
 *
 * Verdad de referencia: `expect_scope` del golden, decidido leyendo el material
 * con 13 jueces y un escéptico por cada "sí" (packages/eval/baselines/
 * 2026-08-04-alcance-veredictos.json). `ninguno` = el corpus no la cubre.
 *
 *   pnpm --filter @tutor-ia/eval answerability
 */
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chatJSON } from "@tutor-ia/core";
import { nliVerify } from "@tutor-ia/rag";

const HERE = dirname(fileURLToPath(import.meta.url));

interface Fragmento {
  de: string;
  texto: string;
}
interface Caso {
  id: string;
  tipo?: string;
  pregunta: string;
  scopeQueDioElTutor?: string | null;
  topScore: number;
  fragmentos: Fragmento[];
}

/** ¿Corre el juez LLM? Cuesta una llamada por pregunta; sobre las 101 es caro y
 *  ya quedó medido peor que el NLI. `ANSW_JUEZ=1` lo vuelve a encender. */
const CON_JUEZ = process.env.ANSW_JUEZ === "1";

/** Juez de ANSWERABILITY: una sola pregunta, sin pedirle que resuma ni razone
 *  de más. Lo que se está comprando es un booleano barato y estable. */
const JUEZ_SISTEMA =
  "Sos un evaluador. Te doy la pregunta de un alumno y fragmentos de libros escolares. " +
  "Decidís UNA sola cosa: si un alumno que lee SOLO esos fragmentos podría contestar la pregunta.\n" +
  "responde=true  → los fragmentos contienen la respuesta, aunque esté con otras palabras.\n" +
  "responde=false → los fragmentos hablan del tema, comparten vocabulario o área, pero NO contestan.\n" +
  "No importa si la respuesta es correcta en el mundo: importa si ESTÁ ACÁ. " +
  "Ante la duda, false: servirle a un chico material que no contesta es peor que no servirle nada.";

const JUEZ_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["responde"],
  properties: { responde: { type: "boolean" } },
};

/** La pregunta como HIPÓTESIS declarativa, sin LLM. El NLI espera una
 *  afirmación; pasarle "¿qué es la fotosíntesis?" es preguntarle si el
 *  fragmento implica una pregunta, que no significa nada. Esto la convierte en
 *  "el texto explica/indica <tema>", que sí es evaluable como afirmación. */
function comoAfirmacion(pregunta: string): string {
  const limpia = pregunta
    .replace(/^[¿¡\s]+/, "")
    .replace(/[?¿!¡\s]+$/, "")
    .trim();
  return `El texto explica ${limpia.charAt(0).toLowerCase()}${limpia.slice(1)}.`;
}

interface Fila {
  id: string;
  cubre: boolean;
  rerank: number;
  nliCruda: number;
  nliDecl: number;
  juez: boolean | null;
}

/** Mejor umbral por accuracy para una señal continua, y su matriz. */
function barrer(filas: Fila[], señal: (f: Fila) => number) {
  let mejor = { th: 0, acc: 0, vp: 0, fp: 0, vn: 0, fn: 0 };
  for (let th = 0; th <= 1.0001; th += 0.01) {
    let vp = 0, fp = 0, vn = 0, fn = 0;
    for (const f of filas) {
      const dice = señal(f) >= th;
      if (f.cubre && dice) vp++;
      else if (!f.cubre && dice) fp++;
      else if (!f.cubre && !dice) vn++;
      else fn++;
    }
    const acc = (vp + vn) / filas.length;
    if (acc > mejor.acc) mejor = { th, acc, vp, fp, vn, fn };
  }
  return mejor;
}

async function main(): Promise<void> {
  const casos: Caso[] = JSON.parse(
    await readFile(
      resolve(HERE, "../baselines/2026-08-05-scope-audit-todas.json"),
      "utf8",
    ),
  );
  const golden = (
    await readFile(resolve(HERE, "../golden/questions.jsonl"), "utf8")
  )
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as { id: string; expect_scope?: string });
  const esperado = new Map(golden.map((g) => [g.id, g.expect_scope]));

  const conMaterial = casos.filter((c) => c.fragmentos.length > 0);
  console.log(
    `🧪 ${conMaterial.length} preguntas con material recuperado.\n` +
      `   Positivas: answerable/multi_hop/adversarial (el material SÍ las cubre)\n` +
      `   + las must_abstain cuyo expect_scope no es "ninguno".\n` +
      `   Negativas: must_abstain con expect_scope "ninguno" — ruido on-topic.\n`,
  );

  const filas: Fila[] = [];
  for (const c of conMaterial) {
    const scope = esperado.get(c.id);
    // Las `must_abstain` traen veredicto explícito en `expect_scope`. El resto
    // del golden son preguntas que el material SÍ responde — es lo que las hace
    // `answerable` — y entran como positivas: son la mitad del problema que las
    // 13 solas no podían ver. Un umbral que las tumbe deja al tutor mudo.
    const cubre = c.tipo === "must_abstain" ? scope != null && scope !== "ninguno" : true;
    const textos = c.fragmentos.map((f) => f.texto);

    const cruda = await nliVerify(c.pregunta, textos);
    const decl = await nliVerify(comoAfirmacion(c.pregunta), textos);

    let juez: boolean | null = null;
    if (CON_JUEZ) try {
      const r = await chatJSON<{ responde: boolean }>(
        [
          { role: "system", content: JUEZ_SISTEMA },
          {
            role: "user",
            content:
              `=== PREGUNTA ===\n${c.pregunta}\n\n=== FRAGMENTOS ===\n` +
              textos.map((t, i) => `[${i + 1}]\n${t}`).join("\n\n"),
          },
        ],
        JUEZ_SCHEMA,
        { temperature: 0 },
      );
      juez = r.responde;
    } catch {
      /* el juez falló: se reporta como hueco, no como "no contesta" */
    }

    filas.push({
      id: c.id,
      cubre,
      rerank: c.topScore,
      nliCruda: cruda.entailment,
      nliDecl: decl.entailment,
      juez,
    });
    // Solo se listan las negativas y las positivas que quedarían por DEBAJO del
    // umbral candidato: son las dos formas de equivocarse. Listar las 90 que
    // pasan holgadas no informa nada y esconde las que importan.
    if (!cubre || decl.entailment < 0.91) {
      console.log(
        `   ${c.id} ${(c.tipo ?? "").padEnd(13)} ${cubre ? "CUBRE" : "ruido"}  ` +
          `rerank ${c.topScore.toFixed(2)}  nli(decl) ${decl.entailment.toFixed(2)}` +
          (juez === null ? "" : `  juez ${juez ? "sí" : "no"}`),
      );
    }
  }

  console.log("\n══ SEPARACIÓN ══");
  for (const [nombre, sel] of [
    ["rerankScore (lo que hay hoy)", (f: Fila) => f.rerank],
    ["NLI, pregunta cruda", (f: Fila) => f.nliCruda],
    ["NLI, pregunta como afirmación", (f: Fila) => f.nliDecl],
  ] as const) {
    const m = barrer(filas, sel);
    console.log(
      `   ${nombre.padEnd(32)} mejor umbral ${m.th.toFixed(2)} → ` +
        `accuracy ${(m.acc * 100).toFixed(0)}%  (vp ${m.vp} fp ${m.fp} vn ${m.vn} fn ${m.fn})`,
    );
  }
  const conJuez = filas.filter((f) => f.juez !== null);
  if (conJuez.length) {
    const vp = conJuez.filter((f) => f.cubre && f.juez).length;
    const fp = conJuez.filter((f) => !f.cubre && f.juez).length;
    const vn = conJuez.filter((f) => !f.cubre && !f.juez).length;
    const fn = conJuez.filter((f) => f.cubre && !f.juez).length;
    console.log(
      `   ${"juez de answerability (LLM)".padEnd(32)} binario         → ` +
        `accuracy ${(((vp + vn) / conJuez.length) * 100).toFixed(0)}%  (vp ${vp} fp ${fp} vn ${vn} fn ${fn})` +
        (conJuez.length < filas.length
          ? `  ⚠️ ${filas.length - conJuez.length} sin veredicto`
          : ""),
    );
  }
  console.log(
    "\n   vp = la cubre y dijo que sí · fp = es ruido y dijo que sí (el daño)\n" +
      "   fn = la cubre y dijo que no (pierde material bueno)\n",
  );

  // ── EL COSTO DEL UMBRAL, EN LAS DOS DIRECCIONES ──────────────────────────
  // La accuracy sola engaña con clases desbalanceadas: con 7 negativas y 90
  // positivas, decir "sí" siempre da 93%. Lo que decide es cuánto ruido frena
  // contra cuánto material bueno tira, y eso hay que verlo umbral por umbral.
  const pos = filas.filter((f) => f.cubre);
  const neg = filas.filter((f) => !f.cubre);
  console.log(
    `══ COSTO POR UMBRAL (${pos.length} positivas · ${neg.length} negativas) ══`,
  );
  console.log("   umbral   ruido frenado      material bueno perdido");
  for (const th of [0.5, 0.6, 0.7, 0.8, 0.85, 0.9, 0.91, 0.93, 0.95, 0.97]) {
    const frenado = neg.filter((f) => f.nliDecl < th).length;
    const perdido = pos.filter((f) => f.nliDecl < th).length;
    console.log(
      `   ${th.toFixed(2)}     ${String(frenado).padStart(2)}/${neg.length}` +
        ` (${((frenado / Math.max(1, neg.length)) * 100).toFixed(0)}%)`.padEnd(12) +
        `${String(perdido).padStart(3)}/${pos.length}` +
        ` (${((perdido / Math.max(1, pos.length)) * 100).toFixed(0)}%)`,
    );
  }
  console.log(
    "\n   ⚠️ Un umbral solo sirve si frena mucho ruido y pierde poco material.\n" +
      "      Si las dos columnas suben juntas, la señal no separa y no hay número que salve.\n",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
