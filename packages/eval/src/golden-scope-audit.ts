/**
 * ¿QUÉ ALCANCE LE CORRESPONDE A CADA PREGUNTA DEL GOLDEN?
 *
 * Las 24 preguntas `must_abstain` se escribieron cuando la búsqueda no cruzaba
 * materias: todas dicen `expect_mode: "general"` porque, en ese mundo, cualquier
 * cosa fuera del libro de Lengua era conocimiento del modelo. Ahora el tutor
 * busca en todo el corpus, y responder "esto no está en Lengua, lo saqué de
 * Ciencias Naturales 6º" es la conducta CORRECTA, no un fallo.
 *
 * Pero reetiquetar según lo que el tutor hace hoy sería fabricar el ground truth
 * para que dé bien. La pregunta correcta es otra: ¿el corpus contiene material
 * que GENUINAMENTE responde esto, en el libro de otra materia? Si sí, el
 * esperado es (libro, otra_materia). Si lo recuperado es ruido on-topic que no
 * contesta nada, el esperado sigue siendo `general`.
 *
 * Esto vuelca lo necesario para decidirlo leyendo: la pregunta, la nota original
 * del golden, de qué libro y página salió cada fragmento, y el texto completo.
 *
 *   pnpm --filter @tutor-ia/eval scope-audit [golden.jsonl]
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getTeachingContext, isStruggling } from "@tutor-ia/core";
import { getSql } from "@tutor-ia/db";

const HERE = dirname(fileURLToPath(import.meta.url));

interface GQ {
  id: string;
  type: string;
  q: string;
  note?: string;
  expect_mode?: string;
}

function abs(p: string): string {
  return isAbsolute(p) ? p : resolve(process.env.INIT_CWD ?? process.cwd(), p);
}

async function main(): Promise<void> {
  const goldenPath = process.argv[2]
    ? abs(process.argv[2])
    : resolve(HERE, "../golden/questions.jsonl");
  const raw = await readFile(goldenPath, "utf8");
  const todas: GQ[] = raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  const preguntas = todas.filter((q) => q.type === "must_abstain");

  // El mismo usuario/materia que usa el eval, para que el alcance del retrieval
  // sea el mismo: desde otra materia el corpus visible cambia.
  const sql = getSql();
  const [u] = await sql<{ id: string }[]>`
    select id from users order by created_at asc limit 1`;
  const [s] = await sql<{ id: string }[]>`
    select s.id from subjects s
    where s.disabled_at is null order by s.created_at asc limit 1`;
  const userId = u!.id;
  const subjectId = s?.id ?? null;

  console.log(
    `🔭 Auditando el alcance de ${preguntas.length} preguntas must_abstain.\n` +
      `   Golden: ${goldenPath}\n`,
  );

  const salida: unknown[] = [];
  for (const q of preguntas) {
    const res = await getTeachingContext({
      userId,
      subjectId,
      question: q.q,
      history: [],
      struggling: isStruggling(q.q),
    });
    const citable = res.ctx?.citable ?? [];
    salida.push({
      id: q.id,
      pregunta: q.q,
      notaDelGolden: q.note ?? null,
      expectModeActual: q.expect_mode ?? null,
      scopeQueDioElTutor: res.ctx?.scope ?? null,
      topScore: res.ctx?.topScore ?? 0,
      // De qué libro y página salió cada fragmento. Es la mitad de la decisión:
      // "Biología · 2º Medio · pág. 102" respondiendo sobre fotosíntesis es
      // material legítimo de otra materia; el mismo texto respondiendo sobre
      // cuánto hervir un huevo es ruido.
      fragmentos: citable.map((c) => ({
        de: `${c.documentTitle ?? "?"}${c.grade ? ` · ${c.grade}` : ""} · pág. ${c.pageStart ?? "?"}`,
        texto: c.content,
      })),
    });
    console.log(
      `   ${q.id}  ${res.ctx?.scope ?? "—"}  ${citable.length} frag.  ${q.q.slice(0, 58)}`,
    );
  }

  const outPath = abs("scope-audit.json");
  await writeFile(outPath, JSON.stringify(salida, null, 2), "utf8");
  console.log(`\n💾 ${salida.length} preguntas → ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
