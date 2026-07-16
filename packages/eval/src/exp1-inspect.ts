/**
 * EXPERIMENTO #1 (Fase −1, §10) — "Corré un libro real por el pipeline hoy."
 *
 * Toma un PDF (o .txt/.md) real, lo pasa por la ingesta ACTUAL (pdf-parse +
 * chunking naïve) y vuelca los primeros N chunks a un archivo para que los mires
 * con tus ojos. NO toca la base de datos ni genera embeddings — es inspección
 * pura, corre offline.
 *
 * Criterio de éxito: los chunks son legibles, las fórmulas están enteras, no hay
 * headers/footers en medio de los párrafos. El plan predice que vas a tirar
 * `pdf-parse` en 20 minutos — este script es para que lo confirmes con datos.
 *
 * Uso:
 *   pnpm --filter @tutor-ia/eval exp1 ruta/al/libro.pdf [N=50]
 */
import { readFile, writeFile } from "node:fs/promises";
import { basename, extname, isAbsolute, resolve } from "node:path";

/** Resuelve rutas relativas contra el cwd ORIGINAL (pnpm cambia cwd al paquete). */
function resolveInputPath(p: string): string {
  return isAbsolute(p) ? p : resolve(process.env.INIT_CWD ?? process.cwd(), p);
}
import {
  extractPdf,
  extractPlainText,
  chunkPages,
  estimateTokens,
  type PageText,
} from "@tutor-ia/rag";
import { flag, summarizeFlags } from "./lib/signals";

async function extract(path: string): Promise<PageText[]> {
  const ext = extname(path).toLowerCase();
  if (ext === ".pdf") {
    return extractPdf(await readFile(path));
  }
  if (ext === ".txt" || ext === ".md") {
    return extractPlainText(await readFile(path, "utf8"));
  }
  throw new Error(`Extensión no soportada: ${ext} (usá .pdf, .txt o .md)`);
}

async function main() {
  const rawPath = process.argv[2];
  const n = Number(process.argv[3] ?? "50");
  if (!rawPath) {
    console.error("Uso: pnpm --filter @tutor-ia/eval exp1 <archivo.pdf> [N=50]");
    process.exit(2);
  }
  const path = resolveInputPath(rawPath);

  console.log(`\n📖 Inspeccionando: ${path}`);
  const pages = await extract(path);
  console.log(`   Páginas extraídas: ${pages.length}`);
  const totalChars = pages.reduce((s, p) => s + p.text.length, 0);
  console.log(`   Caracteres totales: ${totalChars.toLocaleString()}`);
  if (totalChars < 200) {
    console.log(
      "   ⚠️  Muy poco texto: probablemente es un PDF escaneado (necesita OCR, §2/§3).",
    );
  }

  const chunks = chunkPages(pages);
  console.log(`   Chunks generados: ${chunks.length}`);

  // Estadísticas de calidad
  const flags = chunks.map((c) => flag(c.content));
  const s = summarizeFlags(flags);
  const total = chunks.length || 1;
  const p = (n: number) => `${((n / total) * 100).toFixed(0)}%`;
  const tokens = chunks.map((c) => estimateTokens(c.content));
  const avgTok = Math.round(tokens.reduce((a, b) => a + b, 0) / (tokens.length || 1));
  const avgCharsPage =
    pages.length > 0 ? Math.round(totalChars / pages.length) : 0;

  console.log("\n📊 Señales de calidad (sobre TODOS los chunks):");
  console.log(`   tokens/chunk (prom):         ${avgTok}`);
  console.log(`   chars/página (prom):         ${avgCharsPage}  ${avgCharsPage < 900 ? "← bajo: pág. con imágenes o texto perdido" : ""}`);
  console.log(`   mojibake (codif. rota):      ${s.mojibakeChunks} chunks`);
  console.log(`   caracteres de fórmula:       ${s.formulaChunks} chunks`);
  console.log(
    `   palabra partida "x - y":     ${s.softHyphenChunks} chunks (${p(s.softHyphenChunks)}), ${s.softHyphenCases} casos  ← rompe embeddings y cita literal (A2)`,
  );
  console.log(
    `   encabezado pegado al inicio: ${s.leadingHeaderChunks} chunks (${p(s.leadingHeaderChunks)})  ← header dentro del texto`,
  );
  console.log(
    `   número de página al final:   ${s.trailingPageNumChunks} chunks (${p(s.trailingPageNumChunks)})  ← ruido de footer`,
  );
  console.log(
    `   códigos de recurso (BDA/U_): ${s.assetCodeChunks} chunks, ${s.assetCodeCases} casos`,
  );
  console.log(
    `   letras espaciadas ("B Á"):   ${s.letterSpacingChunks} chunks, ${s.letterSpacingCases} casos`,
  );
  console.log(
    `   idea cortada (sin punto):    ${s.sentenceCutChunks} chunks (${p(s.sentenceCutChunks)})  ← oración partida entre chunks`,
  );
  console.log(`   muy cortos (<40 chars):      ${s.veryShortChunks} chunks`);

  // Volcado legible de los primeros N
  const out = chunks.slice(0, n).map((c, i) => {
    const f = flag(c.content);
    const marks = [
      f.hasMojibake ? "MOJIBAKE" : "",
      f.hasFormulaChars ? "FÓRMULA" : "",
      f.softHyphenation ? `PALABRA-PARTIDA×${f.softHyphenation}` : "",
      f.leadingHeader ? "HEADER-PEGADO" : "",
      f.trailingPageNum ? "PÁG-AL-FINAL" : "",
      f.assetCodes ? `CÓDIGOS×${f.assetCodes}` : "",
      f.letterSpacing ? `LETRAS-ESPACIADAS×${f.letterSpacing}` : "",
      f.sentenceCut ? "IDEA-CORTADA" : "",
      f.veryShort ? "CORTO" : "",
    ].filter(Boolean);
    return (
      `${"═".repeat(72)}\n` +
      `CHUNK ${i} · pág ${c.page ?? "?"} · ${estimateTokens(c.content)} tok` +
      (marks.length ? ` · ⚠ ${marks.join(" ")}` : "") +
      `\n${"─".repeat(72)}\n${c.content}\n`
    );
  });

  const outPath = `exp1-${basename(path)}.chunks.txt`;
  await writeFile(outPath, out.join("\n"), "utf8");
  console.log(`\n📝 Primeros ${Math.min(n, chunks.length)} chunks volcados en: ${outPath}`);
  console.log(
    "\n👉 Abrilo y revisá con tus ojos. Buscá: fórmulas partidas, headers en medio\n" +
      "   del párrafo, mojibake, cortes a mitad de idea. Si ves basura → confirmás\n" +
      "   que hay que reemplazar la ingesta (Fase 0.5, §3).\n",
  );
}

main().catch((err) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
