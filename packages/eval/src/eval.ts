/**
 * Runner del eval harness — Fase 1 (§9). `pnpm eval`.
 *
 * Corre el golden set (golden/questions.jsonl, o el path por argv, o el
 * .example por defecto) por el PIPELINE REAL de core y reporta las métricas del
 * §9.2 contra sus objetivos.
 *
 * ⚠️  REQUIERE ENTORNO COMPLETO, no corre en seco:
 *   - Postgres (DATABASE_URL) con los PDFs del golden YA INGESTADOS. El retrieval
 *     real consulta la base; sin ella, falla con mensaje claro (no se puede
 *     evaluar contra un corpus que no existe).
 *   - Ollama corriendo (OLLAMA_BASE_URL) con el modelo de tareas disponible.
 *   - EVAL_USER_ID: uuid del usuario dueño de los PDFs ingestados (el retrieval
 *     filtra por usuario). EVAL_SUBJECT_ID es opcional.
 *
 * Cada pregunta produce un PerQuestionResult:
 *   - retrievedIds = ctx.chunks.map(c => c.chunkId)
 *   - abstained    = !ctx.grounded  (o texto == ABSTENTION)
 *   - hallucinated = si NO se abstuvo, se re-pide la respuesta descompuesta en
 *     afirmaciones (CLAIMS_SCHEMA) y se verifica cada cita literal contra los
 *     chunks (verifyClaims). hallucinated = report.hasUnsupported.
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CLAIMS_JUDGE_SYSTEM,
  CLAIMS_SCHEMA,
  chatJSON,
  config,
  describeActiveLLM,
  formatUsageTotals,
  getTeachingContext,
  getUsageTotals,
  isStruggling,
  logDecision,
  looksLikeSelfAbstention,
  streamTeaching,
  verifyClaims,
  verifyAnswerA3,
  derivarModo,
  type DecisionCause,
  type RawClaim,
} from "@tutor-ia/core";
import {
  entails,
  nliVerify,
  poolPerSideFromEnv,
  candidatePoolFromEnv,
  contentKFromEnv,
  rankStrategyFromEnv,
  describeStrategy,
} from "@tutor-ia/rag";
import { getSql } from "@tutor-ia/db";
import { createHash } from "node:crypto";
import { listModels } from "./ollama";
import {
  aggregate,
  type EvalMetrics,
  type PerQuestionResult,
} from "./lib/metrics";

/** Una línea del golden set (§9.1). */
interface GoldenQuestion {
  id: string;
  type: string;
  q: string;
  expect_chunks?: string[];
  expect_answer?: string;
  /** Modo esperado del tutor. Las `must_abstain` lo declaran "general": el libro
   *  no lo cubre, así que la respuesta correcta ya NO es negarse sino responder
   *  con conocimiento general Y AVISARLO. */
  expect_mode?: string;
  note?: string;
}

/** Objetivos del §9.2 (nombre legible, valor, comparador). */
interface Target {
  key: keyof EvalMetrics;
  label: string;
  goal: number;
  /** ">=" => métrica debe ser >= goal; "<=" => debe ser <= goal. */
  cmp: ">=" | "<=";
}

const TARGETS: Target[] = [
  { key: "recallAt5", label: "recall@5", goal: 0.9, cmp: ">=" },
  // precision@|gold| (proxy de ranking: ¿el reranker pone el gold arriba?). La
  // citation_precision "real" (¿el modelo citó la fuente correcta?) necesita las
  // citas verificadas del modelo → Fase 2 (A3 con el cross-encoder).
  { key: "citationPrecision", label: "precision@gold", goal: 0.8, cmp: ">=" },
  { key: "hallucinationRate", label: "hallucination_rate", goal: 0.02, cmp: "<=" },
  { key: "falseAbstentionRate", label: "false_abstention", goal: 0.1, cmp: "<=" },
  // true_abstention se retira: el tutor ya no se abstiene por falta de material,
  // así que por diseño va a ~0 y dejó de significar algo. Se sigue calculando
  // para poder releer las corridas viejas, pero no es un objetivo.
  { key: "falseBookClaim", label: "false_book_claim", goal: 0.02, cmp: "<=" },
  { key: "correctModeRate", label: "correct_mode", goal: 0.9, cmp: ">=" },
];

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN_DIR = resolve(HERE, "../golden");

/** Resuelve el path del golden: argv > questions.jsonl > questions.example.jsonl. */
async function resolveGoldenPath(): Promise<string> {
  const arg = process.argv[2];
  if (arg) {
    return isAbsolute(arg)
      ? arg
      : resolve(process.env.INIT_CWD ?? process.cwd(), arg);
  }
  const real = resolve(GOLDEN_DIR, "questions.jsonl");
  if (await exists(real)) return real;
  return resolve(GOLDEN_DIR, "questions.example.jsonl");
}

async function exists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}

/** Parsea JSONL a mano (sin dependencias): una pregunta por línea no vacía. */
function parseJsonl(raw: string): GoldenQuestion[] {
  const out: GoldenQuestion[] = [];
  const lines = raw.split("\n");
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    out.push(JSON.parse(t) as GoldenQuestion);
  }
  return out;
}

/**
 * Prompt de descomposición en afirmaciones (para la variante CLAIMS_SCHEMA).
 * Le pedimos que parta la respuesta en afirmaciones atómicas, cada una con su
 * cita LITERAL (substring exacto) del fragmento que la respalda y el número de
 * fragmento. verifyClaims luego confirma esa cita por string-match.
 */
function buildClaimsPrompt(
  context: string,
  question: string,
  answer: string,
): string {
  return `Descompón la RESPUESTA en afirmaciones atómicas. Para cada afirmación:
- "text": la afirmación en una frase.
- "quote": si HAY un tramo del fragmento que dice lo mismo, copialo tal cual como evidencia. Es OPCIONAL: si la afirmación está sostenida por el sentido del fragmento pero con otras palabras, dejá "quote" vacío. NO fuerces una cita literal que no exista, y NO marques como sin respaldo algo que el fragmento sí implica.
- "chunkIndex": el número de fragmento (1-based) que la sostiene.

Parafrasear bien NO es inventar: la cita literal es evidencia cómoda cuando aparece, no el criterio.

=== FRAGMENTOS ===
${context}
=== PREGUNTA ===
${question}
=== RESPUESTA A DESCOMPONER ===
${answer}
=== FIN ===`;
}

/** ¿Correr la verificación de alucinación (necesita el LLM)? EVAL_HALLUCINATION=0 la apaga. */
const DO_HALLUCINATION = (process.env.EVAL_HALLUCINATION ?? "1") !== "0";

/** Umbral de entailment (A3) para rescatar paráfrasis que el string-match perdió. */
const ENTAIL_MIN = Number(process.env.EVAL_ENTAIL_MIN ?? "0.5");

export interface QResult extends PerQuestionResult {
  /** el LLM falló/timeout al verificar (no cuenta para hallucinationRate). */
  errored: boolean;
  /** Causa del corte (decision-log): "gate" | "answered" | "reranker_down"… */
  cause: DecisionCause;
  /** Score del reranker del mejor citable (el que se compara con el umbral). */
  topScore: number;
  /** "content" | "pedagogy" | "none" — de dónde salió el material citable. */
  citableSource: string;
  /** El modelo TUVO material y aun así se abstuvo solo (culpa del prompt). */
  selfAbstained: boolean;
  /** ms de la pregunta completa (retrieval + generación + verificación del eval). */
  ms: number;
  /** ms COMPARABLES con producción: retrieval + generación, sin el verificador. */
  msProd: number;
  /** Texto generado. Se persiste para poder RE-JUZGAR sin volver a generar:
   *  la primera corrida no lo guardaba y re-evaluar el juez obligaba a pagar
   *  toda la generación de nuevo. */
  answer: string;
  /** El retrieval se cayó por timeout. En producción el alumno recibe una
   *  no-respuesta, así que cuenta como abstención; se marca para poder reportar
   *  también la vista "solo evaluables". */
  retrievalTimeout: boolean;
  /** Cuántas afirmaciones se extrajeron de la respuesta. */
  claimsTotal: number;
  /** Cuántas de esas quedaron SIN respaldo según el NLI direccional. */
  claimsSinRespaldo: number;
  /** Baseline A2-solo (string-match): alucinación ANTES del entailment A3. */
  hallucinatedA2Only: boolean;
  /** Veredicto del verificador de PRODUCCIÓN (verify.ts) sobre esta respuesta. */
  hallucinatedProd: boolean;
  /** false si el verificador prod no pudo correr para esta pregunta. */
  prodKnown: boolean;
  /** Veredictos POR ORACIÓN del verificador de producción. Se persisten para
   *  poder calibrar la condición de deriva (drift-sweep) sobre respuestas ya
   *  generadas, sin volver a pagar LLM ni NLI: verifyAnswerA3 ya los calcula y
   *  hasta ahora se colapsaban al booleano `hallucinatedProd` y se tiraban. */
  prodVerdicts: {
    entailment: number;
    contradiction: number;
    supported: boolean;
    contradicted: boolean;
  }[];
}

async function runQuestion(
  gq: GoldenQuestion,
  userId: string,
  subjectId: string | null,
): Promise<QResult> {
  const t0 = Date.now();
  // 1) RETRIEVAL + GATE — el MISMO de producción (`getTeachingContext`, corpus
  //    dual TE+GDD con fallback), no el legacy `getTutorContext` de un solo
  //    corpus. Antes el golden set medía un pipeline que el alumno no toca.
  // `struggling` se calcula con el MISMO criterio que la route (isStruggling,
  // exportado por core). Sin esto el eval nunca ejercía la rama adaptativa del
  // prompt —la que TEACHING_SYSTEM declara "lo más importante"— y medía un turno
  // distinto del que recibe el alumno.
  const teachReq = {
    userId,
    subjectId,
    question: gq.q,
    history: [],
    struggling: isStruggling(gq.q),
  };
  const res = await getTeachingContext(teachReq);
  const ctx = res.ctx;
  // ⚠️ `retrieved`, NO `citable`. Acá había un artefacto que invalidaba toda
  // comparación de gate: se hacía `res.grounded ? ctx.citable.map(…) : []`, o sea
  // recall@5 contaba CERO cada vez que el gate cortaba. Consecuencia: aflojar el
  // gate subía el recall SOLO, sin que el ranking hubiera mejorado en nada, y el
  // número se leía como "mejoró el retrieval".
  //
  // `retrieved` es lo que el ranking trajo, independiente del gate. Ahora
  // recall@5 mide el RANKING y la abstención se mide aparte (`abstained`), que
  // es la única forma de saber cuál de los dos se movió.
  //
  // ⛔ Los baselines anteriores al 2026-08-03 NO son comparables con este número.
  const retrievedIds = (ctx?.retrieved ?? []).map((c) => c.chunkId);
  // ⚠️ `abstained` YA NO ES `!res.grounded`. Producción dejó de negarse por falta
  // de material: /api/chat genera igual y marca la respuesta como "general". Si
  // el eval siguiera cortando acá, mediría un tutor que ya no existe — y las 24
  // preguntas que el libro no cubre nunca llegarían a generar, así que su
  // alucinación quedaría sin medir justo donde más importa.
  //
  // La única abstención que queda es la de INFRAESTRUCTURA, igual que en la ruta.
  const abstained = !!res.rerankerDown;
  const expectedIds = gq.expect_chunks ?? [];
  const topScore = ctx?.topScore ?? 0;
  const citableSource = ctx?.citableSource ?? "none";

  // 2) ALUCINACIÓN (opcional, con LLM): solo si respondió. Guardada por try/catch:
  //    un timeout del 7B marca la pregunta como no-evaluable, NO tira toda la corrida.
  let hallucinated = false;
  let hallucinatedA2Only = false;
  let hallucinatedProd = false;
  let prodKnown = false;
  let hallucinationKnown = false;
  let errored = false;
  let selfAbstained = false;
  let msProd = 0;
  let answer = "";
  let claimsTotal = 0;
  let claimsSinRespaldo = 0;
  let prodVerdicts: QResult["prodVerdicts"] = [];
  // Se genera SIEMPRE (salvo infra caída), como en producción.
  if (!abstained && DO_HALLUCINATION) {
    try {
      const chunks = ctx.citable;
      const context = chunks
        .map((c, i) => `[Fragmento ${i + 1}]\n${c.content}`)
        .join("\n\n");
      // 2) GENERACIÓN — se consume el MISMO generador que usa /api/chat, así que
      //    el system prompt (TEACHING_SYSTEM), el armado del turno user
      //    (buildTeachingTurn con MATERIAL + GUÍA) y los parámetros de generación
      //    salen de la función real. Nada duplicado acá.
      //    OJO: ya NO se corre checkFalsePremise. /api/chat tampoco lo corre
      //    (está solo en el camino legacy tutor.ts), así que ejecutarlo hacía que
      //    el eval midiera un flujo que el alumno no recibe.
      for await (const chunk of streamTeaching(teachReq, ctx)) answer += chunk;
      // Corte de latencia COMPARABLE con producción: retrieval + stream. Lo que
      // sigue (claims + entailment) es instrumentación del eval que el chat no
      // hace; incluirlo inflaba la "latencia media" del reporte.
      msProd = Date.now() - t0;
      // ¿Tuvo material y aun así dijo "no puedo"? Eso NO es el gate: es el prompt.
      selfAbstained = looksLikeSelfAbstention(answer);
      const raw = await chatJSON<{ claims: RawClaim[] }>(
        [
          // Juez con prompt PROPIO. Antes heredaba TUTOR_SYSTEM (el tutor
          // estricto deprecado) y castigaba la paráfrasis fiel como invento.
          { role: "system", content: CLAIMS_JUDGE_SYSTEM },
          { role: "user", content: buildClaimsPrompt(context, gq.q, answer) },
        ],
        CLAIMS_SCHEMA,
        { temperature: 0 },
      );
      const chunkTexts = chunks.map((c) => c.content);
      const report = verifyClaims(raw.claims ?? [], chunkTexts);
      hallucinatedA2Only = report.hasUnsupported; // baseline string-match (antes de A3)
      // A3 (Fase 2): verificación híbrida. Una afirmación se considera respaldada
      // si la cita literal matchea (A2) O si el cross-encoder dice que algún chunk
      // la implica (entailment >= umbral). Esto rescata las paráfrasis fieles que
      // el string-match perdía (la causa del hallucination_rate 30% inflado).
      // Las "inferida" (sin cita) TAMBIÉN pasan por entailment: antes se saltaban
      // toda verificación y un invento declarado como inferencia pasaba limpio
      // (subestimaba la métrica — hallazgo de la auditoría).
      // ─── DOS CORRECCIONES AL INSTRUMENTO, cada una medida ───────────────
      //
      // (a) EL DISCRIMINADOR. Se usaba `entails()`, que es el cross-encoder de
      //     RELEVANCIA. Medido contra `golden/a3-set.jsonl` (60 claims
      //     etiquetados a mano): accuracy 60%, y deja pasar como respaldada el
      //     **80% de las contradicciones** — o sea, es casi ciego a "on-topic
      //     pero falso", que es justo lo que una métrica de alucinación tiene
      //     que atrapar. El NLI direccional da 87% de accuracy sobre el mismo
      //     set y detecta el 80% de las contradicciones, con 5% de falso
      //     entailment. Para esta métrica el NLI es estrictamente mejor.
      //
      // (b) LA AGREGACIÓN. Era `any()`: bastaba UNA claim sin respaldo para
      //     marcar la respuesta. Como el largo de la lista lo decide el LLM en
      //     cada pasada, una claim espuria daba vuelta la pregunta entera.
      //     Medido con la entrada FIJA (misma respuesta, 3 pasadas del juez):
      //     el booleano oscila 45,5 / 44,2 / 49,4 (5,2 puntos de dispersión) y
      //     la TASA oscila 14,2 / 13,9 / 14,4 (0,5 puntos). 10× más estable.
      //     Se conservan las dos: la tasa para seguir la evolución, el booleano
      //     para no romper la comparación con las corridas históricas.
      let sinRespaldo = 0;
      for (const c of report.claims) {
        if (c.label === "respaldada") continue; // cita literal ya verificada
        // Chunk citado si el modelo lo indicó y es válido; si no, todos.
        const candidates =
          c.chunkIndex && chunkTexts[c.chunkIndex - 1] != null
            ? [chunkTexts[c.chunkIndex - 1] as string]
            : chunkTexts;
        const v = await nliVerify(c.text, candidates);
        if (!v.supported) sinRespaldo++;
      }
      claimsTotal = report.claims.length;
      claimsSinRespaldo = sinRespaldo;
      hallucinated = sinRespaldo > 0;
      hallucinationKnown = true;

      // Métrica PROD: el MISMO verificador que corre en producción (verify.ts,
      // oraciones + entailment, sin claims del LLM), aplicado a la respuesta ya
      // generada. Mide lo que un estudiante recibiría — la brecha eval-vs-prod
      // se mide acá en vez de asumirse cerrada.
      const prodV = await verifyAnswerA3(answer, chunkTexts);
      if (!prodV.unavailable) {
        hallucinatedProd = !prodV.grounded;
        prodKnown = true;
        // Solo los números por oración, sin el texto: el drift-sweep necesita
        // (entailment, contradiction, supported, contradicted) y nada más.
        prodVerdicts = prodV.verdicts.map((v) => ({
          entailment: v.entailment,
          contradiction: v.contradiction,
          supported: v.supported,
          contradicted: v.contradicted,
        }));
      }
    } catch {
      errored = true; // timeout/fallo del LLM: no contamos esta para alucinación
    }
  }

  const cause: DecisionCause = abstained
    ? res.rerankerDown
      ? "reranker_down"
      : "gate"
    : errored
      ? "model_error"
      : "answered";
  const ms = Date.now() - t0;
  if (msProd === 0) msProd = ms; // abstuvo: no hubo generación, el corte es el mismo
  // Misma línea [decision] que emite /api/chat: permite atribuir cada abstención
  // a su causa y comparar corridas con distinto umbral sin parsear este JSON.
  logDecision({
    route: "eval",
    abstained,
    cause,
    topScore,
    threshold: config.rerankMinScore,
    citableSource,
    nCitable: retrievedIds.length,
    directed: false,
    gateBypassed: ctx?.gateBypassed,
    nDense: ctx?.stats?.nDense ?? null,
    nLexical: ctx?.stats?.nLexical ?? null,
    lexEmpty: ctx?.stats?.lexEmpty,
    nCand: ctx?.stats?.nFused ?? null,
    pool: ctx?.stats?.poolPerSide ?? null,
    ranker: ctx?.stats?.ranker ?? null,
    winnerDenseRank: ctx?.stats?.winnerDenseRank ?? null,
    qNorm: res.qNorm,
    qNormMs: res.qNormMs ?? null,
    gateVia: ctx?.stats?.gateVia ?? null,
    gapMed: ctx?.stats?.gapMed ?? null,
    selfAbstain: abstained ? undefined : selfAbstained,
    ms,
  });

  // El MISMO derivador que usa /api/chat: lo que se mide es lo que se sirve.
  const { mode } = derivarModo(
    (prodVerdicts ?? []).map((v) => ({ text: "", ...v })),
    (ctx?.citable.length ?? 0) > 0,
    // `hallucinatedProd` viene de `!prodV.grounded`, que es exactamente la
    // señal de DERIVA de verify.ts. Si no se pudo verificar, no hay deriva.
    prodKnown && hallucinatedProd,
  );

  return {
    type: gq.type,
    expectMode: gq.expect_mode,
    mode,
    scope: ctx?.scope,
    retrievedIds,
    expectedIds,
    abstained,
    hallucinated,
    hallucinationKnown,
    errored,
    hallucinatedA2Only,
    hallucinatedProd,
    prodKnown,
    cause,
    topScore,
    citableSource,
    selfAbstained,
    ms,
    msProd,
    answer,
    claimsTotal,
    claimsSinRespaldo,
    prodVerdicts,
    retrievalTimeout: false,
  };
}

/** ¿Parece un fallo por falta de base de datos? Mensaje claro en ese caso. */
function looksLikeDbFailure(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    /DATABASE_URL/i.test(msg) ||
    /ECONNREFUSED|ENOTFOUND|connect|password|pg|postgres|match_chunks|relation|vector/i.test(
      msg,
    )
  );
}

function fmtPct(x: number): string {
  return `${(x * 100).toFixed(1).padStart(5)}%`;
}

function passes(t: Target, value: number): boolean {
  return t.cmp === ">=" ? value >= t.goal : value <= t.goal;
}

async function main() {
  console.log("\n🧪 Eval harness — camino de PRODUCCIÓN (TEACHING_SYSTEM)");
  console.log("   Requiere Postgres (golden ingestado) + Ollama (embeddings) + sidecar rerank.");
  console.log(`   motor:   ${describeActiveLLM()}`);
  console.log(`   umbral:  RERANK_MIN_SCORE=${config.rerankMinScore}`);
  console.log(
    `   tope:    LLM_MAX_TOKENS_PER_RUN=${config.maxTokensPerRun || "SIN TOPE"}\n`,
  );

  const userId = process.env.EVAL_USER_ID;
  if (!userId) {
    console.error(
      "❌ Falta EVAL_USER_ID: el uuid del usuario dueño de los PDFs ingestados.\n" +
        "   El retrieval filtra por usuario; sin esto no hay contra qué medir.\n" +
        "   Ej: EVAL_USER_ID=xxxx-xxxx pnpm --filter @tutor-ia/eval eval",
    );
    process.exit(2);
  }
  // ⚠️ SIN ALCANCE DE MATERIA EL GOLDEN SET NO MIDE NADA.
  // El golden se etiquetó contra UN libro (todos sus expect_chunks son de
  // "Lengua 8vo"); las must_abstain dicen cosas como "esto es matemática, no
  // aparece en un libro de Lengua". Con subjectId=null el retrieval barre las 73
  // materias del corpus y ENCUENTRA el área del triángulo en Matemática: la
  // pregunta se responde, true_abstention se desploma y cualquier barrido de
  // umbral queda sin sentido. Producción SIEMPRE manda subjectId (el chat solo
  // se abre dentro de una materia), así que acotarlo también acerca el eval al
  // camino real. Fallar ruidoso > medir en silencio contra el corpus equivocado.
  const subjectId = process.env.EVAL_SUBJECT_ID ?? null;
  if (!subjectId && process.env.EVAL_ALLOW_ALL_SUBJECTS !== "1") {
    console.error(
      "❌ Falta EVAL_SUBJECT_ID: el uuid de la materia contra la que se etiquetó\n" +
        "   el golden set. Sin esto el retrieval busca en TODO el corpus (73\n" +
        "   materias) y las preguntas 'must_abstain' encuentran material en otra\n" +
        "   materia → true_abstention deja de medir lo que dice medir.\n\n" +
        "   Para correr igual, a sabiendas: EVAL_ALLOW_ALL_SUBJECTS=1",
    );
    process.exit(2);
  }
  if (!subjectId) {
    console.log(
      "⚠️  EVAL_ALLOW_ALL_SUBJECTS=1 — corriendo SIN acotar materia.\n" +
        "   must_abstain y adversarial NO son interpretables en esta corrida.\n",
    );
  }

  // Chequeo de vida de Ollama antes de gastar tiempo.
  const models = await listModels();
  if (models.length === 0) {
    console.error(
      `❌ Ollama no responde en ${process.env.OLLAMA_BASE_URL ?? "http://localhost:11434"}.\n` +
        "   Arrancá Ollama (ollama serve) y descargá el modelo de tareas antes de evaluar.",
    );
    process.exit(1);
  }

  const goldenPath = await resolveGoldenPath();
  const raw = await readFile(goldenPath, "utf8").catch(() => null);
  if (raw == null) {
    console.error(`❌ No pude leer el golden set en: ${goldenPath}`);
    process.exit(1);
  }
  const questions = parseJsonl(raw);
  // PROCEDENCIA: sha del golden + huella del corpus en el momento de la corrida.
  // Dos corridas con goldenSha256 o corpus distintos NO son comparables; sin
  // estos campos esa comparación inválida pasaba desapercibida (y hay 5
  // documentos pendientes de ingestar esperando exactamente ese descuido).
  const goldenSha256 = createHash("sha256").update(raw).digest("hex");
  let corpusChunkCount = -1;
  let corpusMaxCreatedAt: string | null = null;
  try {
    const sql = getSql();
    const [prov] = await sql<{ n: string; max_created: string | null }[]>`
      select count(*)::text as n, max(created_at)::text as max_created from chunks`;
    if (prov) {
      corpusChunkCount = Number(prov.n);
      corpusMaxCreatedAt = prov.max_created;
    }
  } catch {
    // sin DB acá el preflight de retrieval va a fallar igual, con mejor mensaje
  }
  console.log(`📋 Golden: ${goldenPath}`);
  console.log(`   Preguntas: ${questions.length} · sha ${goldenSha256.slice(0, 12)}`);
  console.log(`   Corpus: ${corpusChunkCount} chunks · última ingesta ${corpusMaxCreatedAt ?? "?"}\n`);
  if (goldenPath.endsWith(".example.jsonl")) {
    console.log(
      "⚠️  Estás usando questions.example.jsonl (ids de chunk PLACEHOLDER).\n" +
        "   El recall/precisión no serán reales hasta que armes tu golden con\n" +
        "   chunk ids de TU corpus. Ver golden/README.md.\n",
    );
  }

  let timeoutsRetrieval = 0;
  const results: QResult[] = [];
  // id → resultado, para no emparejar por índice al serializar (ver perQuestion).
  const byId = new Map<string, QResult>();
  for (const gq of questions) {
    process.stdout.write(`  · ${gq.id} [${gq.type}] ... `);
    let r: QResult;
    try {
      r = await runQuestion(gq, userId, subjectId);
    } catch (err) {
      if (looksLikeDbFailure(err)) {
        console.log("");
        console.error(
          "\n❌ Falló el retrieval contra Postgres.\n" +
            `   ${err instanceof Error ? err.message : String(err)}\n\n` +
            "   Este runner NO puede correr sin base de datos: necesita Postgres\n" +
            "   con los PDFs del golden ya ingestados. Configurá DATABASE_URL y\n" +
            "   asegurate de haber ingestado el corpus (ver golden/README.md).",
        );
        process.exit(1);
      }
      // Timeout transitorio del retrieval/gate (rerank u Ollama bajo carga): NO
      // debe tumbar toda la corrida (mismo criterio que el bloque de alucinación).
      // Se saltea la pregunta y se excluye del cómputo; se avisa.
      const msg = err instanceof Error ? err.message : String(err);
      const name = err instanceof Error ? err.name : "";
      if (
        name === "TimeoutError" ||
        name === "AbortError" ||
        /timeout|aborted/i.test(msg)
      ) {
        timeoutsRetrieval++;
        console.log(`⏱ timeout en retrieval — ${gq.id} → cuenta como ABSTENCIÓN`);
        // En producción esto es una no-respuesta que el alumno sí sufre
        // (route.ts responde "tuve un problemita"). Antes salía del denominador
        // y las métricas quedaban optimistas.
        const t: QResult = {
          type: gq.type, expectMode: gq.expect_mode,
          // Un timeout NO es un modo: no hubo respuesta que encuadrar. Se deja
          // sin `mode` para que no contamine correct_mode ni false_book_claim.
          retrievedIds: [], expectedIds: gq.expect_chunks ?? [],
          abstained: true, hallucinated: false, hallucinationKnown: false,
          errored: false, cause: "retrieval_error", topScore: 0,
          citableSource: "none", selfAbstained: false, ms: 0, msProd: 0,
          answer: "", claimsTotal: 0, claimsSinRespaldo: 0, retrievalTimeout: true,
          hallucinatedA2Only: false, hallucinatedProd: false, prodKnown: false,
          prodVerdicts: [],
        };
        results.push(t); byId.set(gq.id, t);
        continue;
      }
      throw err;
    }
    console.log(
      `${r.abstained ? "abstuvo" : "respondió"}` +
        `${!r.abstained && r.hallucinated ? " · ⚠ ALUCINÓ" : ""}` +
        `${r.errored ? " · ⏱ LLM error (no evaluada)" : ""}` +
        ` · ${r.retrievedIds.length} chunks`,
    );
    results.push(r);
    byId.set(gq.id, r);
  }

  const erroredCount = results.filter((r) => r.errored).length;
  if (erroredCount > 0) {
    console.log(
      `\n⏱  ${erroredCount}/${results.length} preguntas no se pudieron verificar por` +
        " timeout/fallo del LLM (excluidas de hallucination_rate).",
    );
  }

  // DOS VISTAS de las mismas métricas:
  //  · "totales"    incluye los timeouts de retrieval como abstención — es lo
  //                 que el alumno vive: pregunta y no recibe explicación.
  //  · "evaluables" los excluye — es lo comparable con corridas viejas y aísla
  //                 la calidad del sistema de la salud del sidecar.
  const metrics = aggregate(results);
  const evaluables = results.filter((r) => !r.retrievalTimeout);
  const metricsEval = aggregate(evaluables);

  // A/B del entailment A3 sobre las MISMAS generaciones del LLM: comparamos la
  // tasa de alucinación con verificación A2-solo (string-match) vs híbrida A2+A3.
  const evaluable = results.filter(
    (r) => !r.abstained && r.hallucinationKnown !== false && !r.errored,
  );
  const rateOf = (pick: (r: QResult) => boolean) =>
    evaluable.length === 0
      ? 0
      : evaluable.filter(pick).length / evaluable.length;
  const hallA2 = rateOf((r) => r.hallucinatedA2Only);
  const hallHybrid = rateOf((r) => r.hallucinated);
  const prodEvaluable = evaluable.filter((r) => r.prodKnown);
  const hallProd =
    prodEvaluable.length === 0
      ? 0
      : prodEvaluable.filter((r) => r.hallucinatedProd).length /
        prodEvaluable.length;
  console.log(
    `\n🔬 A3 entailment (umbral ${ENTAIL_MIN}) — mismas generaciones:\n` +
      `   hallucination_rate  A2-solo (string-match):   ${fmtPct(hallA2)}\n` +
      `   hallucination_rate  A2+A3 (claims, +inferida): ${fmtPct(hallHybrid)}\n` +
      `   hallucination_rate  PROD (verify.ts, oraciones): ${fmtPct(hallProd)} (n=${prodEvaluable.length})\n` +
      `   Δ claims = ${fmtPct(hallHybrid - hallA2)}  (sobre ${evaluable.length} respuestas evaluables)\n` +
      `   La fila PROD es el verificador que corre en el chat real — lo que un\n` +
      `   estudiante recibiría marcado. Divergencia claims-vs-prod = brecha a vigilar.`,
  );

  // Tabla final contra objetivos §9.2.
  console.log(
    `\n📐 ${results.length} preguntas · ${evaluables.length} evaluables · ` +
      `${results.length - evaluables.length} timeouts de retrieval (cuentan como abstención en "totales")`,
  );
  console.log("\n📊 Métricas vs. objetivos (§9.2):");
  console.log("   ┌──────────────────────┬─────────┬─────────────┬──────────┬──────┐");
  console.log("   │ métrica              │ TOTALES │ evaluables  │ objetivo │  ok  │");
  console.log("   ├──────────────────────┼─────────┼─────────────┼──────────┼──────┤");
  let allOk = true;
  for (const t of TARGETS) {
    const value = metrics[t.key];
    const ok = passes(t, value);
    if (!ok) allOk = false;
    const label = t.label.padEnd(20);
    const goal = `${t.cmp}${(t.goal * 100).toFixed(0)}%`.padStart(8);
    console.log(
      `   │ ${label} │ ${fmtPct(value)}  │ ${fmtPct(metricsEval[t.key])}      │ ${goal} │  ${ok ? "✅" : "❌"}  │`,
    );
  }
  console.log("   └──────────────────────┴─────────┴─────────────┴──────────┴──────┘");
  console.log("   (el ✅/❌ se juzga sobre TOTALES: es lo que recibe el alumno)");
  console.log(
    `\n${allOk ? "✅ Todos los objetivos cumplidos." : "❌ Hay objetivos sin cumplir (calibrá RERANK_MIN_SCORE)."}\n`,
  );

  // Atribución por causa: cuántas cortó el gate y cuántas cortó otra cosa.
  const byCause = new Map<string, number>();
  for (const r of results) byCause.set(r.cause, (byCause.get(r.cause) ?? 0) + 1);
  const absc = results.filter((r) => r.abstained);
  const selfAbs = results.filter((r) => !r.abstained && r.selfAbstained);
  const scores = absc.map((r) => r.topScore).sort((a, b) => b - a);
  const lat = results.map((r) => r.msProd).sort((a, b) => a - b);
  // percentil por interpolación de rango inferior sobre el array YA ordenado
  const pct = (xs: number[], p: number) => xs[Math.min(xs.length - 1, Math.max(0, Math.ceil(p * xs.length) - 1))] ?? 0;
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  console.log(`🔎 Atribución (umbral ${config.rerankMinScore}):`);
  for (const [c, n] of [...byCause].sort((a, b) => b[1] - a[1])) {
    console.log(`   ${c.padEnd(16)} ${String(n).padStart(3)}  ${fmtPct(n / results.length)}`);
  }
  console.log(
    `   ── de las ${absc.length} abstenciones, TODAS por gate salvo las marcadas arriba.\n` +
      `   auto-abstención del modelo (tuvo material y no enseñó): ${selfAbs.length}\n` +
      `   topScore de las abstenidas (desc): ${scores.map((s) => s.toFixed(3)).join(", ") || "—"}\n` +
      `   latencia (retrieval+generación, comparable a prod):\n` +
      `      p50 ${(pct(lat, 0.5) / 1000).toFixed(1)}s · p90 ${(pct(lat, 0.9) / 1000).toFixed(1)}s · ` +
      `max ${((lat[lat.length - 1] ?? 0) / 1000).toFixed(1)}s · media ${(mean(lat) / 1000).toFixed(1)}s\n` +
      `   timeouts del reranker (preguntas EXCLUIDAS del cómputo): ${timeoutsRetrieval}\n`,
  );
  // TASA de afirmaciones sin respaldo — la métrica estable. El booleano de la
  // tabla se conserva para comparar con lo histórico, pero para SEGUIR la
  // evolución hay que mirar esta: con la entrada fija oscila 0,5 puntos contra
  // los 5,2 del booleano.
  const conClaims = results.filter((r) => r.claimsTotal > 0);
  const totClaims = conClaims.reduce((a, r) => a + r.claimsTotal, 0);
  const totSin = conClaims.reduce((a, r) => a + r.claimsSinRespaldo, 0);
  console.log(
    `🔬 Afirmaciones (discriminador: NLI direccional, no el cross-encoder de relevancia):\n` +
      `   ${totSin} sin respaldo de ${totClaims} en ${conClaims.length} respuestas\n` +
      `   TASA = ${fmtPct(totClaims ? totSin / totClaims : 0)}   ← métrica estable (±0,5 pts)\n` +
      `   booleano (≥1 sin respaldo) = ${fmtPct(metrics.hallucinationRate)}   ← histórica, ±5,2 pts\n`,
  );
  console.log(`💰 ${formatUsageTotals()}\n`);

  const outPath = resolve(process.env.INIT_CWD ?? process.cwd(), "eval-results.json");
  await writeFile(
    outPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        golden: goldenPath,
        // El prompt que se midió. Las corridas <= 2026-07-30 usaban TUTOR_SYSTEM
        // (deprecado) y NO son comparables punto a punto con estas.
        promptPath: "TEACHING_SYSTEM + buildTeachingTurn (camino de /api/chat)",
        engine: describeActiveLLM(),
        rerankMinScore: config.rerankMinScore,
        maxTokensPerRun: config.maxTokensPerRun,
        // Procedencia: si alguno de estos difiere entre dos corridas, la
        // comparación de métricas es inválida. goldenSha256 ata el set exacto;
        // corpus* atan el estado de la base; el resto ata la config de retrieval.
        goldenSha256,
        corpusChunkCount,
        corpusMaxCreatedAt,
        // Leídos de las MISMAS funciones que usa el pipeline (rag/*FromEnv):
        // lo que queda estampado acá es lo que efectivamente corrió.
        retrieval: {
          poolPerSide: poolPerSideFromEnv(),
          candidatePool: candidatePoolFromEnv(),
          contentK: contentKFromEnv(),
          ranker: describeStrategy(rankStrategyFromEnv()),
        },
        usage: getUsageTotals(),
        claims: { total: totClaims, sinRespaldo: totSin, tasa: totClaims ? totSin / totClaims : 0 },
        userId,
        subjectId,
        metrics,
        metricsEvaluables: metricsEval,
        nTotales: results.length,
        nEvaluables: evaluables.length,
        targets: TARGETS.map((t) => ({
          key: t.key,
          goal: t.goal,
          cmp: t.cmp,
          value: metrics[t.key],
          ok: passes(t, metrics[t.key]),
        })),
        allOk,
        // Emparejado por ID, NO por índice: el loop puede saltear preguntas con
        // `continue` (timeout de retrieval) y `results` queda más corto. Con el
        // índice, una sola pregunta salteada corría TODO el bloque y cada ítem
        // aparecía con el resultado de otro.
        perQuestion: questions.map((gq) => ({
          ...gq,
          result: byId.get(gq.id) ?? null,
        })),
      },
      null,
      2,
    ),
    "utf8",
  );
  console.log(`💾 Resultados guardados en: ${outPath}\n`);
}

main()
  .then(() => {
    // Salida EXPLÍCITA: el pool de Postgres (sin idle_timeout) mantiene vivo el
    // event loop y el proceso quedaba colgado con todo el trabajo ya hecho —
    // medido 2026-08-01: 40 min zombi tras escribir el JSON. El writeFile del
    // resultado ya está await-eado, así que acá no queda nada pendiente.
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
