/**
 * EXPERIMENTO #1b (Fase 0.5, §3) — Comparador antes/después de la ingesta.
 *
 * Corre el MISMO libro por los dos pipelines y compara las señales de calidad
 * (docs/exp1-hallazgos.md) lado a lado:
 *
 *   VIEJO: pdf-parse (extractPdf) + chunking naïve (chunkPages)     — el de exp1
 *   NUEVO: sidecar pymupdf4llm (extract.py) → cleanPages → chunkStructural
 *
 * No toca la base ni genera embeddings; es inspección pura. Guarda ambos
 * resúmenes en exp1b-compare.json para dejar registro del antes/después.
 *
 * Uso:
 *   pnpm --filter @tutor-ia/eval exp1b <libro.pdf> [sidecar.json]
 *
 * Si pasás un sidecar.json (salida ya generada de extract.py --json) se saltea
 * el spawn de Python (útil porque el OCR de páginas imagen es lento).
 */
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import {
  extractPdf,
  chunkPages,
  estimateTokens,
  cleanPages,
  chunkStructural,
  type StructuredChunk,
} from "@tutor-ia/rag";
import { flag, summarizeFlags, type FlagSummary } from "./lib/signals";

/**
 * Las dos rutas están DENTRO del repo, así que se anclan al módulo y no al
 * cwd: pnpm corre los scripts con el cwd en `packages/eval`. Antes eran rutas
 * absolutas del escritorio de quien las escribió, o sea que este archivo no
 * corría en ninguna otra máquina.
 */
const RAIZ = new URL("../../../", import.meta.url).pathname;
const PYTHON = process.env.INGEST_PYTHON ?? `${RAIZ}packages/ingest-py/.venv/bin/python`;
const EXTRACT_PY = `${RAIZ}packages/ingest-py/extract.py`;

/** Contrato (1): salida de extract.py --json — UN objeto JSON por stdout. */
interface SidecarDoc {
  sourcePath: string;
  pageCount: number;
  title: string | null;
  pages: { page: number; md: string }[]; // page 1-based, md = markdown pymupdf4llm
}

/** Resuelve rutas relativas contra el cwd ORIGINAL (pnpm cambia cwd al paquete). */
function resolveInputPath(p: string): string {
  return isAbsolute(p) ? p : resolve(process.env.INIT_CWD ?? process.cwd(), p);
}

/** Spawnea el sidecar Python; stdout = JSON del doc, stderr pasa como progreso. */
function runSidecar(pdfPath: string): Promise<SidecarDoc> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(PYTHON, [EXTRACT_PY, pdfPath, "--json"], {
      stdio: ["ignore", "pipe", "inherit"], // stderr directo a consola (OCR/progreso)
    });
    const out: Buffer[] = [];
    child.stdout.on("data", (d: Buffer) => out.push(d));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`extract.py terminó con código ${code}`));
        return;
      }
      try {
        resolvePromise(JSON.parse(Buffer.concat(out).toString("utf8")) as SidecarDoc);
      } catch (err) {
        reject(
          new Error(
            `stdout de extract.py no es JSON válido: ${err instanceof Error ? err.message : err}`,
          ),
        );
      }
    });
  });
}

interface PipelineSummary {
  chunks: number;
  avgTokens: number;
  signals: FlagSummary;
}

function summarizePipeline(contents: string[], tokens: number[]): PipelineSummary {
  const signals = summarizeFlags(contents.map((c) => flag(c)));
  const avgTokens = Math.round(
    tokens.reduce((a, b) => a + b, 0) / (tokens.length || 1),
  );
  return { chunks: contents.length, avgTokens, signals };
}

/** Formatea una fila "viejo → nuevo (Δ)" con porcentajes opcionales sobre el total. */
function row(
  label: string,
  oldVal: number,
  newVal: number,
  oldTotal?: number,
  newTotal?: number,
): string {
  const pct = (v: number, t: number | undefined) =>
    t !== undefined && t > 0 ? ` (${((v / t) * 100).toFixed(0)}%)` : "";
  const delta = newVal - oldVal;
  const deltaStr = delta === 0 ? "±0" : delta > 0 ? `+${delta}` : `${delta}`;
  return `   ${label.padEnd(29)}${oldVal}${pct(oldVal, oldTotal)} → ${newVal}${pct(newVal, newTotal)}  (Δ ${deltaStr})`;
}

async function main() {
  const rawPdf = process.argv[2];
  const rawSidecar = process.argv[3];
  if (!rawPdf) {
    console.error(
      "Uso: pnpm --filter @tutor-ia/eval exp1b <libro.pdf> [sidecar.json]",
    );
    process.exit(2);
  }
  const pdfPath = resolveInputPath(rawPdf);

  // ── PIPELINE VIEJO: pdf-parse + chunking naïve ─────────────────────────────
  console.log(`\n📖 Libro: ${pdfPath}`);
  console.log("\n⏳ Pipeline VIEJO (pdf-parse + chunkPages)...");
  const oldPages = await extractPdf(await readFile(pdfPath));
  const oldChunks = chunkPages(oldPages);
  const oldSummary = summarizePipeline(
    oldChunks.map((c) => c.content),
    oldChunks.map((c) => estimateTokens(c.content)),
  );
  console.log(`   ${oldPages.length} páginas → ${oldChunks.length} chunks`);

  // ── PIPELINE NUEVO: sidecar pymupdf4llm → cleanPages → chunkStructural ────
  let doc: SidecarDoc;
  if (rawSidecar) {
    const sidecarPath = resolveInputPath(rawSidecar);
    console.log(`\n⏳ Pipeline NUEVO (sidecar ya generado: ${sidecarPath})...`);
    doc = JSON.parse(await readFile(sidecarPath, "utf8")) as SidecarDoc;
  } else {
    console.log(
      "\n⏳ Pipeline NUEVO (spawneando extract.py — el OCR puede tardar)...",
    );
    doc = await runSidecar(pdfPath);
  }
  const cleaned = cleanPages(doc.pages);
  const newChunks: StructuredChunk[] = chunkStructural(cleaned);
  const newSummary = summarizePipeline(
    newChunks.map((c) => c.content),
    newChunks.map((c) => c.tokenCount),
  );
  console.log(`   ${doc.pages.length} páginas → ${newChunks.length} chunks`);

  // ── Tabla lado a lado ──────────────────────────────────────────────────────
  const o = oldSummary.signals;
  const n = newSummary.signals;
  console.log("\n📊 Señales de calidad — viejo → nuevo (Δ):");
  console.log(row("chunks totales:", oldSummary.chunks, newSummary.chunks));
  console.log(row("tokens/chunk (prom):", oldSummary.avgTokens, newSummary.avgTokens));
  console.log(row("mojibake (codif. rota):", o.mojibakeChunks, n.mojibakeChunks, o.total, n.total));
  console.log(row("caracteres de fórmula:", o.formulaChunks, n.formulaChunks, o.total, n.total));
  console.log(row('palabra partida "x - y":', o.softHyphenChunks, n.softHyphenChunks, o.total, n.total));
  console.log(row("  └ casos:", o.softHyphenCases, n.softHyphenCases));
  console.log(row("encabezado pegado al inicio:", o.leadingHeaderChunks, n.leadingHeaderChunks, o.total, n.total));
  console.log(row("número de página al final:", o.trailingPageNumChunks, n.trailingPageNumChunks, o.total, n.total));
  console.log(row("códigos de recurso (BDA/U_):", o.assetCodeChunks, n.assetCodeChunks, o.total, n.total));
  console.log(row("  └ casos:", o.assetCodeCases, n.assetCodeCases));
  console.log(row('letras espaciadas ("B Á"):', o.letterSpacingChunks, n.letterSpacingChunks, o.total, n.total));
  console.log(row("  └ casos:", o.letterSpacingCases, n.letterSpacingCases));
  console.log(row("idea cortada (sin punto):", o.sentenceCutChunks, n.sentenceCutChunks, o.total, n.total));
  console.log(row("muy cortos (<40 chars):", o.veryShortChunks, n.veryShortChunks, o.total, n.total));

  // ── Muestra de 3 chunks del pipeline nuevo (al menos uno con headingPath) ──
  const withPath = newChunks.find((c) => c.headingPath !== null);
  const sample: StructuredChunk[] = [];
  if (withPath) sample.push(withPath);
  for (const c of newChunks) {
    if (sample.length >= 3) break;
    if (!sample.includes(c)) sample.push(c);
  }
  console.log("\n🔎 Muestra del pipeline NUEVO:");
  for (const c of sample) {
    console.log("═".repeat(72));
    console.log(
      `CHUNK ${c.index} · pág ${c.pageStart}${c.pageEnd !== c.pageStart ? `-${c.pageEnd}` : ""} · ${c.tokenCount} tok · ${c.contentType}` +
        (c.headingPath ? `\n  📍 ${c.headingPath}` : ""),
    );
    console.log("─".repeat(72));
    console.log(c.content);
  }

  // ── Registro JSON ──────────────────────────────────────────────────────────
  const outPath = "exp1b-compare.json";
  await writeFile(
    outPath,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        input: pdfPath,
        sidecar: rawSidecar ? resolveInputPath(rawSidecar) : "spawn extract.py",
        old: oldSummary,
        new: newSummary,
      },
      null,
      2,
    ),
    "utf8",
  );
  console.log(`\n📝 Resúmenes guardados en: ${outPath}\n`);
}

main().catch((err) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
