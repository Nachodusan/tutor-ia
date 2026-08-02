/**
 * Calibración de la condición de DERIVA de verify.ts — sin LLM y sin NLI.
 *
 * La condición actual (`supportedCount === 0 && strong.length >= 3`) disparó
 * 0/77 veces: es un detector apagado, y es el que corre en PRODUCCIÓN sobre lo
 * que ve el alumno. Este script barre la grilla de la condición parametrizada
 *
 *     drift = checked >= minChecked
 *          && supportedFrac <= maxSupportedFrac
 *          && strong(contraMin) >= minStrong
 *
 * sobre los veredictos POR ORACIÓN que eval.ts persiste desde la Fase 0.a
 * (`prodVerdicts`), usando como referencia la TASA de claims sin respaldo del
 * juez calibrado (87% de accuracy contra a3-set):
 *
 *   - "buenas" = tasa 0 (ninguna claim sin respaldo)  → NO deberían marcarse
 *   - "malas"  = tasa >= TASA_MALA (default 0.5)      → deberían marcarse
 *
 * Criterio de aceptación del plan: dispara en los casos malos y en <=2% de las
 * respuestas buenas.
 *
 * Uso:
 *   pnpm --filter @tutor-ia/eval drift-sweep <eval-results.json> [eval-results2.json ...]
 */
import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

const TASA_MALA = Number(process.env.DRIFT_TASA_MALA ?? "0.5");

interface Verdict {
  entailment: number;
  contradiction: number;
  supported: boolean;
  contradicted: boolean;
}
interface Result {
  abstained: boolean;
  claimsTotal: number;
  claimsSinRespaldo: number;
  prodVerdicts?: Verdict[];
}

function resolvePath(p: string): string {
  return isAbsolute(p) ? p : resolve(process.env.INIT_CWD ?? process.cwd(), p);
}

function drift(
  vs: Verdict[],
  minChecked: number,
  maxSupportedFrac: number,
  minStrong: number,
  contraMin: number,
): boolean {
  if (vs.length < minChecked) return false;
  const supportedFrac = vs.filter((v) => v.supported).length / vs.length;
  const strong = vs.filter((v) => v.contradicted && !v.supported && v.contradiction >= contraMin).length;
  return supportedFrac <= maxSupportedFrac && strong >= minStrong;
}

async function main() {
  const paths = process.argv.slice(2).map(resolvePath);
  if (paths.length === 0) {
    console.error("uso: drift-sweep <eval-results.json> [...]");
    process.exit(1);
  }
  const casos: { vs: Verdict[]; tasa: number }[] = [];
  for (const p of paths) {
    const d = JSON.parse(await readFile(p, "utf8")) as {
      perQuestion: { result?: Result | null }[];
    };
    for (const q of d.perQuestion) {
      const r = q.result;
      if (!r || r.abstained || !r.prodVerdicts?.length || r.claimsTotal === 0) continue;
      casos.push({ vs: r.prodVerdicts, tasa: r.claimsSinRespaldo / r.claimsTotal });
    }
  }
  const buenas = casos.filter((c) => c.tasa === 0);
  const malas = casos.filter((c) => c.tasa >= TASA_MALA);
  console.log(
    `\n🧮 drift-sweep — ${casos.length} respuestas con veredictos` +
      ` · buenas (tasa=0): ${buenas.length} · malas (tasa≥${TASA_MALA}): ${malas.length}` +
      ` · intermedias: ${casos.length - buenas.length - malas.length}\n`,
  );
  if (buenas.length === 0 || malas.length === 0) {
    console.log("⚠️ Falta al menos una población (buenas o malas): el barrido no puede calibrar.");
  }

  interface Fila {
    minChecked: number; maxSup: number; minStrong: number; contraMin: number;
    fpBuenas: number; tpMalas: number; total: number;
  }
  const filas: Fila[] = [];
  for (const minChecked of [2, 3, 4]) {
    for (const maxSup of [0, 0.1, 0.2, 0.3]) {
      for (const minStrong of [1, 2, 3]) {
        for (const contraMin of [0.5, 0.6, 0.7]) {
          const f = (cs: typeof casos) =>
            cs.filter((c) => drift(c.vs, minChecked, maxSup, minStrong, contraMin)).length;
          filas.push({
            minChecked, maxSup, minStrong, contraMin,
            fpBuenas: f(buenas), tpMalas: f(malas), total: f(casos),
          });
        }
      }
    }
  }
  // Condición actual de producción como referencia (supFrac=0, strong>=3, contra 0.6):
  const actual = filas.find((x) => x.maxSup === 0 && x.minStrong === 3 && x.contraMin === 0.6 && x.minChecked === 2);
  if (actual) {
    console.log(
      `condición ACTUAL (sup=0, strong≥3@0.6): marca ${actual.total}/${casos.length} · malas ${actual.tpMalas}/${malas.length} · buenas ${actual.fpBuenas}/${buenas.length}\n`,
    );
  }
  const aceptables = filas
    .filter((x) => buenas.length > 0 && x.fpBuenas / buenas.length <= 0.02)
    .sort((a, b) => b.tpMalas - a.tpMalas || a.fpBuenas - b.fpBuenas || a.total - b.total);
  console.log(`combos con ≤2% de falsos positivos en buenas, por detección de malas:`);
  console.log(
    `${"minChecked".padStart(10)} ${"maxSupFrac".padStart(10)} ${"minStrong".padStart(9)} ${"contraMin".padStart(9)}` +
      ` │ ${"malas✓".padStart(8)} ${"buenas✗".padStart(8)} ${"marca".padStart(6)}`,
  );
  for (const x of aceptables.slice(0, 15)) {
    console.log(
      `${String(x.minChecked).padStart(10)} ${String(x.maxSup).padStart(10)} ${String(x.minStrong).padStart(9)} ${String(x.contraMin).padStart(9)}` +
        ` │ ${`${x.tpMalas}/${malas.length}`.padStart(8)} ${`${x.fpBuenas}/${buenas.length}`.padStart(8)} ${String(x.total).padStart(6)}`,
    );
  }
  if (aceptables.length === 0) {
    console.log("  (ninguno — con estos veredictos no hay condición que separe; reportarlo así)");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
