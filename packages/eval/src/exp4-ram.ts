/**
 * EXPERIMENTO #4 (Fase −1, §8.3) — "Presupuesto de RAM: ¿entra todo sin swapear?"
 *
 * Reporta la memoria del sistema (node:os), consulta qué modelos tiene cargados Ollama
 * ahora mismo (GET /api/ps) y contrasta el presupuesto objetivo del §8.3 contra la RAM
 * real disponible. El criterio de éxito es simple: NO SWAPEA. Si el 3B y el 7B cargados
 * juntos no entran, avisa y recuerda keep_alive:0 + matar Docker.
 *
 * NO requiere modelos cargados: si /api/ps falla, sigue con la parte de os.
 *
 * Uso:
 *   pnpm --filter @tutor-ia/eval exp4
 */
import { writeFile } from "node:fs/promises";
import { freemem, totalmem } from "node:os";

const BASE = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";

const GB = 1024 ** 3;
const toGb = (bytes: number) => bytes / GB;
const fmtGb = (gb: number) => `${gb.toFixed(2)} GB`;

/** Presupuesto objetivo del §8.3 (RAM/VRAM aproximada por componente). */
interface BudgetItem {
  name: string;
  gb: number;
  /** Si es un modelo de LLM alternable (3B vs 7B) o infra siempre-presente. */
  note?: string;
}

const BUDGET: BudgetItem[] = [
  { name: "LLM 3B (voz)", gb: 2.2, note: "alternable con el 7B" },
  { name: "LLM 7B (tareas)", gb: 5.2, note: "alternable con el 3B" },
  { name: "bge-m3 (embeddings)", gb: 0.6 },
  { name: "reranker", gb: 0.6 },
  { name: "whisper (STT)", gb: 0.5 },
  { name: "piper (TTS)", gb: 0.1 },
  { name: "postgres", gb: 0.3 },
  { name: "next + browser", gb: 2.0 },
];

interface LoadedModel {
  name: string;
  /** RAM/VRAM que ocupa según Ollama, en bytes. */
  sizeBytes: number;
  sizeVramBytes: number;
}

/** Consulta /api/ps. Devuelve null si Ollama no responde (seguimos igual). */
async function fetchLoadedModels(): Promise<LoadedModel[] | null> {
  const res = await fetch(`${BASE}/api/ps`).catch(() => null);
  if (!res || !res.ok) return null;
  const j = (await res.json().catch(() => null)) as {
    models?: { name?: string; size?: number; size_vram?: number }[];
  } | null;
  if (!j || !j.models) return [];
  return j.models.map((m) => ({
    name: m.name ?? "(sin nombre)",
    sizeBytes: m.size ?? 0,
    sizeVramBytes: m.size_vram ?? 0,
  }));
}

function printSystemMemory(total: number, free: number): void {
  console.log("\n🖥️  Memoria del sistema (node:os):");
  console.log(`   Total:      ${fmtGb(toGb(total))}`);
  console.log(`   Libre:      ${fmtGb(toGb(free))}`);
  console.log(`   En uso:     ${fmtGb(toGb(total - free))}`);
}

function printLoadedModels(loaded: LoadedModel[] | null): number {
  console.log("\n📦 Modelos cargados en Ollama (GET /api/ps):");
  if (loaded === null) {
    console.log(
      `   ⚠️  Ollama no respondió en ${BASE}. Salteando esta parte (¿'ollama serve' está corriendo?).`,
    );
    return 0;
  }
  if (loaded.length === 0) {
    console.log("   (ninguno cargado ahora mismo)");
    return 0;
  }
  let totalLoadedBytes = 0;
  for (const m of loaded) {
    // size = RAM total del modelo; size_vram = parte en GPU. RAM ≈ size - size_vram.
    const ramBytes = Math.max(0, m.sizeBytes - m.sizeVramBytes);
    totalLoadedBytes += m.sizeBytes;
    console.log(
      `   • ${m.name.padEnd(26)} total ${fmtGb(toGb(m.sizeBytes))}` +
        `  (VRAM ${fmtGb(toGb(m.sizeVramBytes))} · RAM ${fmtGb(toGb(ramBytes))})`,
    );
  }
  console.log(`   ── Total cargado: ${fmtGb(toGb(totalLoadedBytes))}`);
  return totalLoadedBytes;
}

function printBudgetTable(total: number): void {
  console.log("\n📋 Presupuesto objetivo (§8.3):");
  console.log("─".repeat(54));
  console.log(`   ${"componente".padEnd(28)}${"RAM".padStart(9)}`);
  console.log("─".repeat(54));
  let sumAll = 0;
  let sumWith7B = 0; // infra + 7B (sin el 3B a la vez, ideal)
  let sumBoth = 0; // infra + 3B + 7B (el peor caso)
  for (const item of BUDGET) {
    sumAll += item.gb;
    const isLlm = item.name.startsWith("LLM");
    const is3B = item.name.includes("3B");
    if (!isLlm || !is3B) sumWith7B += item.gb;
    sumBoth += item.gb;
    console.log(
      `   ${item.name.padEnd(28)}${fmtGb(item.gb).padStart(9)}` +
        (item.note ? `   (${item.note})` : ""),
    );
  }
  console.log("─".repeat(54));
  console.log(`   ${"infra + 7B (sin 3B)".padEnd(28)}${fmtGb(sumWith7B).padStart(9)}`);
  console.log(`   ${"infra + 3B + 7B (peor caso)".padEnd(28)}${fmtGb(sumBoth).padStart(9)}`);
  console.log(`   ${"RAM física del sistema".padEnd(28)}${fmtGb(toGb(total)).padStart(9)}`);
  console.log("─".repeat(54));

  const totalGb = toGb(total);
  console.log("\n🧮 Contraste contra la RAM real:");
  const headroomWith7B = totalGb - sumWith7B;
  const headroomBoth = totalGb - sumBoth;
  console.log(
    `   infra + 7B:        ${fmtGb(sumWith7B)}  → margen ${fmtGb(headroomWith7B)}` +
      (headroomWith7B >= 0 ? "  ✅ entra" : "  ❌ NO entra"),
  );
  console.log(
    `   infra + 3B + 7B:   ${fmtGb(sumBoth)}  → margen ${fmtGb(headroomBoth)}` +
      (headroomBoth >= 0 ? "  ✅ entra" : "  ❌ NO entra"),
  );

  console.log("\n⚠️  Avisos:");
  if (headroomBoth < 0) {
    console.log(
      "   El 3B y el 7B cargados JUNTOS no entran en RAM: vas a swapear (lo que mata la latencia).\n" +
        "   → Cargá uno a la vez: pasá keep_alive:0 en las requests para que Ollama descargue\n" +
        "     el modelo apenas termina, y no dejes ambos residentes.",
    );
  } else {
    console.log(
      "   El 3B y el 7B entran juntos en el papel, pero el margen es ajustado: igual conviene\n" +
        "   keep_alive:0 para no acumular modelos residentes.",
    );
  }
  console.log(
    "   → Matá Docker si no lo estás usando: postgres+otros contenedores comen RAM que necesitás.",
  );
  console.log("   → Criterio de éxito: el sistema NO SWAPEA bajo carga (mirá la presión de memoria).");
}

async function main() {
  console.log("\n🔬 EXPERIMENTO #4 — Presupuesto de RAM (§8.3)");
  console.log(`   Ollama: ${BASE}`);

  const total = totalmem();
  const free = freemem();
  printSystemMemory(total, free);

  const loaded = await fetchLoadedModels();
  const totalLoadedBytes = printLoadedModels(loaded);

  printBudgetTable(total);

  const outPath = "exp4-ram.json";
  await writeFile(
    outPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        base: BASE,
        system: {
          totalGb: toGb(total),
          freeGb: toGb(free),
          usedGb: toGb(total - free),
        },
        loadedModels:
          loaded === null
            ? null
            : loaded.map((m) => ({
                name: m.name,
                totalGb: toGb(m.sizeBytes),
                vramGb: toGb(m.sizeVramBytes),
                ramGb: toGb(Math.max(0, m.sizeBytes - m.sizeVramBytes)),
              })),
        totalLoadedGb: toGb(totalLoadedBytes),
        budget: BUDGET,
      },
      null,
      2,
    ),
    "utf8",
  );
  console.log(`\n💾 Resultados guardados en: ${outPath}\n`);
}

main().catch((err) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
