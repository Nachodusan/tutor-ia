/**
 * AUDITORÍA DE LAS AFIRMACIONES SIN RESPALDO.
 *
 * `hallucinationRateLibro` dice CUÁNTAS afirmaciones quedaron sin respaldo, pero
 * no si eso es invento del tutor o un fallo del verificador. La diferencia
 * decide cosas opuestas: si el tutor inventa, hay que tocar el prompt; si el NLI
 * no reconoce la paráfrasis fiel, hay que tocar el instrumento y el número no
 * significa lo que parece.
 *
 * Normalmente esto se contestaría con `golden/a3-set.jsonl` (60 claims
 * etiquetados a mano), pero ese set quedó INSERVIBLE: sus `chunk_id` no
 * sobrevivieron a la reingesta del corpus y `a3-validate` evalúa 0 triples.
 * Hasta que se re-ancle, esta auditoría es la única forma de saberlo.
 *
 * NO REGENERA NADA: reusa las respuestas ya guardadas en `eval-results.json`
 * (por eso se persisten). Solo rehace retrieval + extracción de claims + NLI, y
 * vuelca a JSON cada afirmación sin respaldo junto con el material contra el que
 * se la juzgó, para que la decisión "¿inventó?" se pueda tomar leyendo.
 *
 *   pnpm --filter @tutor-ia/eval claims-audit [eval-results.json] [n]
 */
import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import {
  CLAIMS_JUDGE_SYSTEM,
  CLAIMS_SCHEMA,
  chatJSON,
  getTeachingContext,
  isStruggling,
  verifyClaims,
  type RawClaim,
} from "@tutor-ia/core";
import { nliVerify } from "@tutor-ia/rag";
import { getSql } from "@tutor-ia/db";

/** Cuántas preguntas auditar por defecto. Cada una cuesta un retrieval + una
 *  llamada de extracción + un NLI por claim no citada. */
const N_DEFAULT = 12;

interface Guardado {
  id: string;
  type: string;
  q: string;
  result: {
    answer?: string;
    mode?: string;
    scope?: string;
    claimsTotal?: number;
    claimsSinRespaldo?: number;
  };
}

function abs(p: string): string {
  return isAbsolute(p) ? p : resolve(process.env.INIT_CWD ?? process.cwd(), p);
}

async function main(): Promise<void> {
  const inPath = abs(process.argv[2] ?? "eval-results.json");
  const n = Number(process.argv[3] ?? N_DEFAULT);
  const data = JSON.parse(await readFile(inPath, "utf8")) as {
    userId: string;
    subjectId: string | null;
    perQuestion: Guardado[];
  };

  // Solo las que se PRESENTARON como respaldadas por el libro y traen al menos
  // una afirmación sin respaldo: en modo `general` el 100% sin respaldo es la
  // definición, no un hallazgo, y auditarlo no informa nada.
  const candidatas = data.perQuestion
    .filter(
      (r) =>
        (r.result.mode === "libro" || r.result.mode === "apoyado") &&
        (r.result.claimsSinRespaldo ?? 0) > 0 &&
        (r.result.answer ?? "").trim().length > 0,
    )
    .slice(0, n);

  console.log(
    `🔍 Auditando ${candidatas.length} respuestas en modo libro/apoyado con afirmaciones sin respaldo.\n` +
      `   Fuente: ${inPath} (respuestas reusadas, sin regenerar)\n`,
  );

  // La familia y el curso del alumno, con LA MISMA consulta que /api/chat y que
  // eval.ts. Sin esto el retrieval de acá corría con una etapa menos que el que
  // generó las respuestas, y las claims se juzgaban contra OTRO material.
  const sqlCtx = getSql();
  const [perfilFilas, familiaFilas] = await Promise.all([
    sqlCtx<{ grade: string | null }[]>`
      select grade from student_profiles where user_id = ${data.userId}::uuid`,
    data.subjectId
      ? sqlCtx<{ id: string }[]>`
          select s2.id
          from subjects s1
          join subjects s2 on s2.family = s1.family
          where s1.id = ${data.subjectId}::uuid
            and s1.family is not null
            and s2.disabled_at is null
            and (s2.user_id is null or s2.user_id = ${data.userId}::uuid)`
      : Promise.resolve([] as { id: string }[]),
  ]);
  const studentGrade = perfilFilas[0]?.grade ?? null;
  const familyIds = familiaFilas.length ? familiaFilas.map((r) => r.id) : null;

  const salida: unknown[] = [];
  for (const r of candidatas) {
    const answer = r.result.answer!;
    // Mismo retrieval que la corrida: sin esto se juzgaría contra otro material.
    const res = await getTeachingContext({
      userId: data.userId,
      subjectId: data.subjectId,
      question: r.q,
      history: [],
      struggling: isStruggling(r.q),
      familyIds,
      studentGrade,
    });
    const chunkTexts = (res.ctx?.citable ?? []).map((c) => c.content);
    if (chunkTexts.length === 0) continue;

    const context = chunkTexts
      .map((c, i) => `[Fragmento ${i + 1}]\n${c}`)
      .join("\n\n");
    const raw = await chatJSON<{ claims: RawClaim[] }>(
      [
        { role: "system", content: CLAIMS_JUDGE_SYSTEM },
        {
          role: "user",
          content: `=== MATERIAL ===\n${context}\n\n=== PREGUNTA ===\n${r.q}\n\n=== RESPUESTA A DESCOMPONER ===\n${answer}\n=== FIN ===`,
        },
      ],
      CLAIMS_SCHEMA,
      { temperature: 0 },
    );
    const report = verifyClaims(raw.claims ?? [], chunkTexts);

    const sinRespaldo: unknown[] = [];
    for (const c of report.claims) {
      if (c.label === "respaldada") continue;
      const candidates =
        c.chunkIndex && chunkTexts[c.chunkIndex - 1] != null
          ? [chunkTexts[c.chunkIndex - 1] as string]
          : chunkTexts;
      const v = await nliVerify(c.text, candidates);
      if (!v.supported) {
        sinRespaldo.push({
          claim: c.text,
          label: c.label,
          entailment: v.entailment,
          // El material contra el que se la juzgó, COMPLETO y sin recortar.
          // Recortarlo (estaba a 1200 chars) invalidaba la auditoría entera: 36
          // de 37 fragmentos llegaban al tope, así que quien leyera esto vería
          // material incompleto y marcaría como inventado algo que sí estaba en
          // el libro, tres párrafos más abajo. Un archivo más grande es barato;
          // un veredicto equivocado sobre si el tutor inventa, no.
          material: candidates,
        });
      }
    }
    if (sinRespaldo.length === 0) continue;

    salida.push({
      id: r.id,
      pregunta: r.q,
      mode: r.result.mode,
      scope: r.result.scope,
      respuesta: answer,
      claimsTotal: report.claims.length,
      sinRespaldo,
    });
    console.log(
      `   ${r.id}  ${sinRespaldo.length}/${report.claims.length} sin respaldo  ·  ${r.q.slice(0, 56)}`,
    );
  }

  const outPath = abs("claims-audit.json");
  await writeFile(outPath, JSON.stringify(salida, null, 2), "utf8");
  const total = salida.reduce<number>(
    (a, s) => a + (s as { sinRespaldo: unknown[] }).sinRespaldo.length,
    0,
  );
  console.log(
    `\n💾 ${total} afirmaciones sin respaldo de ${salida.length} respuestas → ${outPath}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
