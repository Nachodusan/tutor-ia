/**
 * CLI: prueba el retrieval híbrido (denso + léxico + RRF) contra lo indexado.
 *
 *   pnpm --filter @tutor-ia/eval retrieve "¿qué es la interpretación?"
 *   pnpm --filter @tutor-ia/eval retrieve            (corre una batería de queries)
 *
 * Muestra, por query, el top-k con score RRF, de qué lado vino (denso/léxico),
 * la cita legible (pág + heading_path) y un fragmento del contenido.
 */
import { getSql } from "@tutor-ia/db";
import { retrieveHybrid, citationLabel, type HybridChunk } from "@tutor-ia/rag";

const DEV_USER_ID =
  process.env.DEV_USER_ID ?? "00000000-0000-0000-0000-000000000001";

/** Batería por defecto: mezcla answerable, léxica pura (nombre propio) y fuera-de-material. */
const DEFAULT_QUERIES = [
  "¿Qué significa interpretar una obra literaria?",
  "¿Quiénes son Tristán e Isolda?",
  "el filtro de amor que beben en el barco",
  "¿Qué es el amor cortés y los trovadores provenzales?",
  "¿Quién ganó el mundial de fútbol 2022?", // fuera del material → debería dar poco/nada
];

function fmt(c: HybridChunk): string {
  const side =
    c.denseRank && c.lexicalRank
      ? `denso#${c.denseRank}+léx#${c.lexicalRank}`
      : c.denseRank
        ? `denso#${c.denseRank}`
        : `léx#${c.lexicalRank}`;
  const snippet = c.content.replace(/\s+/g, " ").slice(0, 120);
  return (
    `   rrf=${c.rrf.toFixed(4)} [${side}]  ${citationLabel(c)}\n` +
    `      ${snippet}${c.content.length > 120 ? "…" : ""}`
  );
}

async function run(query: string): Promise<void> {
  const results = await retrieveHybrid(query, { userId: DEV_USER_ID, k: 5 });
  console.log(`\n❓ ${query}`);
  if (results.length === 0) {
    console.log("   (sin resultados — si es una pregunta fuera del material, es lo esperado)");
    return;
  }
  for (const c of results) console.log(fmt(c));
}

async function main() {
  const sql = getSql();
  // Aviso si no hay nada indexado.
  const cnt = await sql<{ n: number }[]>`select count(*)::int as n from chunks`;
  const n = cnt[0]?.n ?? 0;
  if (n === 0) {
    console.error("No hay chunks indexados. Corré antes: pnpm --filter @tutor-ia/eval index-book <pdf>");
    await sql.end();
    process.exit(1);
  }
  console.log(`🔎 Retrieval híbrido sobre ${n} chunks indexados.`);

  const arg = process.argv.slice(2).filter((a) => !a.startsWith("--")).join(" ").trim();
  const queries = arg ? [arg] : DEFAULT_QUERIES;
  for (const q of queries) await run(q);

  await sql.end();
}

main().catch(async (err) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
