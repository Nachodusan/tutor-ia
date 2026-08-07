/**
 * SNAPSHOT DE LA AUDITORÍA (§5 del plan) — congela la muestra en un archivo
 * inmutable, con el material adentro.
 *
 * ── Por qué un archivo y no consultar la base ───────────────────────────────
 * El etiquetado lo hacen dos personas a mano y lleva días. Si en el medio se
 * re-ingesta cualquier cosa, los `chunkId` cambian y el trabajo humano se pierde
 * (ya pasó: 6 de 200 vínculos rotos se llevaron las 2 únicas respuestas de fuera
 * de 1º Medio). El snapshot lleva el TEXTO del material adentro, así que se puede
 * etiquetar con la base apagada.
 *
 * ── La unidad de muestreo es la oración del `content`, NO del `verification` ──
 * Decisión deliberada y medida: el NLI solo mira **134 de 303 oraciones (44%)** —
 * `isCheckable()` saltea preguntas, andamiaje, analogías y oraciones cortas. Si la
 * muestra saliera del verificador, las alucinaciones que el instrumento nunca
 * miró quedarían fuera POR CONSTRUCCIÓN, y su RECALL sería imposible de medir.
 * Que es justo el hallazgo más incómodo que esta auditoría busca.
 *
 * Se usa el MISMO `splitSentences` que corre en producción (`verify.ts`), así las
 * oraciones del snapshot son exactamente las que vio —o no vio— el verificador.
 *
 * ── Dos bloques con consignas distintas ─────────────────────────────────────
 *  · `respaldo`   — la respuesta trajo material. Se etiqueta cada afirmación:
 *                   ¿está respaldada por el material que va al lado?
 *  · `sin_material` — la respuesta cayó a modo general (12 de 60, las preguntas
 *                   que el libro no cubre). No hay material contra el cual
 *                   juzgar, así que la regla de respaldo NO APLICA. Se etiqueta
 *                   la RESPUESTA COMPLETA con otra consigna: ¿avisó que esto no
 *                   estaba en su libro? Es el caso más caro —el tutor sin red— y
 *                   dejarlo afuera sería no auditar justo lo que más importa.
 *
 *   pnpm --filter @tutor-ia/eval auditoria-snapshot
 */
import { readFile, writeFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import { getSql } from "@tutor-ia/db";
import { splitSentences } from "@tutor-ia/rag";

interface Trafico {
  id: string; materia: string; pregunta: string;
  registro: string; tipo: string;
  message_id: string | null; tuvo_citas: boolean;
}

interface Cita { chunkId: string; page: number | null; label: string; text?: string }
interface Verdict { text: string; entailment: number; contradiction: number; supported: boolean; contradicted: boolean }

/** Normaliza para emparejar una oración del content con su veredicto del NLI:
 *  `cleanForVerification` le saca markdown antes de partir, así que comparar
 *  crudo contra crudo no matchea. */
const norm = (s: string) => s.toLowerCase().replace(/[^\wáéíóúñü ]/gi, "").replace(/\s+/g, " ").trim();

async function main(): Promise<void> {
  const sql = getSql();
  const trafico = (await readFile(
    new URL("../golden/trafico-generado.jsonl", import.meta.url), "utf8",
  )).split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as Trafico);

  const ids = trafico.map((t) => t.message_id).filter((x): x is string => !!x);
  const filas = await sql<{
    id: string; content: string; citations: Cita[] | null;
    verification: { verdicts?: Verdict[] } | null; meta: Record<string, unknown> | null;
  }[]>`
    select id, content, citations, verification, meta
    from messages where id::text = any(${ids}) and role = 'assistant'`;
  const porId = new Map(filas.map((f) => [f.id, f]));

  const afirmaciones: unknown[] = [];
  const respuestasSinMaterial: unknown[] = [];
  let descartadasPorChunkRoto = 0;
  let n = 0;

  let descartadasPorMensajeDeSistema = 0;

  for (const t of trafico) {
    const m = t.message_id ? porId.get(t.message_id) : null;
    if (!m) continue;

    // ⚠️ NO TODO `role='assistant'` ES UNA RESPUESTA DEL TUTOR.
    //
    // La ruta persiste con ese rol los mensajes de SISTEMA —"se me trabó la
    // respuesta", "tuve un problemita para traer tu material", el saludo del
    // enrutador social— para que el historial del alumno no quede con huecos.
    // Pero no los escribió el modelo a partir del material, así que auditarlos
    // como si fueran afirmaciones del tutor mide otra cosa.
    //
    // Pasó de verdad en esta tanda: t017 se trabó a mitad de generación y el
    // alumno recibió el mensaje amable. Ese texto no es una alucinación ni una
    // afirmación fundamentada: es la app avisando que falló.
    const causa = (m.meta?.cause as string) ?? null;
    if (causa && causa !== "answered") {
      descartadasPorMensajeDeSistema++;
      continue;
    }

    const citas = (m.citations ?? []).map((c) => ({
      chunk_id: c.chunkId,
      pagina: c.page,
      etiqueta: c.label,
      texto: c.text ?? null,
    }));

    // ⚠️ REGLA DURA del plan: sin material no se puede etiquetar respaldo. Una
    // cita cuyo texto no quedó guardado (tráfico anterior al blindaje) es un
    // chunk que quizá ya no exista: se descarta y se cuenta.
    const sinTexto = citas.filter((c) => !c.texto).length;
    if (citas.length > 0 && sinTexto === citas.length) {
      descartadasPorChunkRoto++;
      continue;
    }

    if (!t.tuvo_citas || citas.length === 0) {
      // BLOQUE 2 — la respuesta salió sin material (modo general).
      respuestasSinMaterial.push({
        respuesta_id: `g${String(respuestasSinMaterial.length + 1).padStart(3, "0")}`,
        message_id: m.id,
        materia: t.materia,
        tipo_pregunta: t.tipo,
        registro: t.registro,
        pregunta_alumno: t.pregunta,
        respuesta_completa: m.content,
        consigna: "¿Le avisó al alumno que esto NO está en su libro?",
      });
      continue;
    }

    // BLOQUE 1 — una fila por afirmación.
    const verdicts = m.verification?.verdicts ?? [];
    const porTexto = new Map(verdicts.map((v) => [norm(v.text), v]));
    for (const oracion of splitSentences(m.content)) {
      const txt = oracion.trim();
      if (!txt) continue;
      const v = porTexto.get(norm(txt));
      afirmaciones.push({
        afirmacion_id: `a${String(++n).padStart(3, "0")}`,
        message_id: m.id,
        cuenta: (t as unknown as { cuenta?: string }).cuenta ?? null,
        materia: t.materia,
        tipo_pregunta: t.tipo,
        registro: t.registro,
        modo: (m.meta?.mode as string) ?? null,
        pregunta_alumno: t.pregunta,
        afirmacion: txt,
        respuesta_completa: m.content,
        material: citas,
        // Para la LLAVE, nunca para la planilla. Tres valores, no dos: que el NLI
        // ni siquiera la haya mirado es información distinta de que la haya
        // aprobado, y es la que permite medir su recall.
        nli_veredicto: !v
          ? "no_evaluada"
          : v.contradicted ? "contradicha" : v.supported ? "respaldada" : "sin_respaldo",
        nli_entailment: v?.entailment ?? null,
        meta: m.meta ?? null,
      });
    }
  }

  const commit = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  const fecha = execSync("date -u +%Y-%m-%dT%H:%M:%SZ", { encoding: "utf8" }).trim();
  const cabecera = {
    _snapshot: true, generado: fecha, commit,
    afirmaciones: afirmaciones.length,
    respuestas_sin_material: respuestasSinMaterial.length,
    descartadas_por_chunk_roto: descartadasPorChunkRoto,
    descartadas_por_mensaje_de_sistema: descartadasPorMensajeDeSistema,
    nota: "Unidad = oración del content (NO de verification): el NLI solo mira ~44%.",
  };

  const out = new URL("../golden/auditoria-snapshot.jsonl", import.meta.url).pathname;
  await writeFile(
    out,
    [cabecera, ...afirmaciones, ...respuestasSinMaterial].map((x) => JSON.stringify(x)).join("\n") + "\n",
    "utf8",
  );

  // Desglose, que es lo que dice si la muestra sirve.
  const porMateria = new Map<string, number>();
  const porVeredicto = new Map<string, number>();
  for (const a of afirmaciones as { materia: string; nli_veredicto: string }[]) {
    porMateria.set(a.materia, (porMateria.get(a.materia) ?? 0) + 1);
    porVeredicto.set(a.nli_veredicto, (porVeredicto.get(a.nli_veredicto) ?? 0) + 1);
  }
  console.log(
    `📸 Snapshot congelado — commit ${commit}\n\n` +
      `   afirmaciones (bloque respaldo):  ${afirmaciones.length}\n` +
      `   respuestas sin material:         ${respuestasSinMaterial.length}\n` +
      `   descartadas por chunk roto:      ${descartadasPorChunkRoto}\n` +
      `   descartadas por ser mensaje de sistema: ${descartadasPorMensajeDeSistema}\n`,
  );
  console.log("   por materia:");
  for (const [m, c] of [...porMateria].sort((a, b) => b[1] - a[1])) console.log(`      ${m.slice(0, 40).padEnd(42)} ${c}`);
  console.log("\n   por veredicto del NLI (esto va en la LLAVE, no en la planilla):");
  for (const [v, c] of [...porVeredicto].sort((a, b) => b[1] - a[1])) {
    console.log(`      ${v.padEnd(14)} ${String(c).padStart(4)}  ${((100 * c) / afirmaciones.length).toFixed(1)}%`);
  }
  console.log(`\n💾 ${out}`);
  await sql.end();
}

await main();
process.exit(0);
