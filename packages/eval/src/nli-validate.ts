/**
 * A3 (relevancia) vs NLI direccional, sobre el MISMO set etiquetado
 * (golden/a3-set.jsonl). Responde la pregunta que motivó el cambio: ¿el NLI
 * baja el ~80% de leak de contradicciones que tenía el cross-encoder de
 * relevancia? Reporta, por etiqueta, qué hace cada método.
 *
 * Uso: pnpm --filter @tutor-ia/eval nli-validate   (requiere DB + sidecar con /nli)
 */
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getSql } from "@tutor-ia/db";
import { entails, nliVerify } from "@tutor-ia/rag";

const HERE = dirname(fileURLToPath(import.meta.url));
const SET_PATH = resolve(HERE, "../golden/a3-set.jsonl");
const A3_MIN = Number(process.env.ENTAIL_MIN_SCORE ?? "0.5");
const NLI_ENTAIL = Number(process.env.NLI_MIN_ENTAIL ?? "0.5");
const NLI_CONTRA = Number(process.env.NLI_MIN_CONTRA ?? "0.5");

type Label = "supported" | "contradiction" | "neutral";
interface Triple { claim: string; chunk_id: string; label: Label }

const pct = (x: number, n: number) => (n ? `${((100 * x) / n).toFixed(0)}%` : "-");

async function main() {
  const raw = await readFile(SET_PATH, "utf8").catch(() => null);
  if (!raw) {
    console.error(`❌ No existe ${SET_PATH}.`);
    process.exit(1);
  }
  const triples: Triple[] = raw.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l));
  const sql = getSql();

  interface Row { label: Label; a3: number; ent: number; con: number }
  const rows: Row[] = [];
  let missing = 0;
  for (const t of triples) {
    const r = await sql<{ content: string }[]>`select content from chunks where id = ${t.chunk_id}`;
    if (r.length === 0) { missing++; continue; }
    const chunk = r[0]!.content;
    const a3 = await entails(t.claim, [chunk]);
    const v = await nliVerify(t.claim, [chunk], NLI_ENTAIL, NLI_CONTRA);
    rows.push({ label: t.label, a3, ent: v.entailment, con: v.contradiction });
  }
  if (missing) console.log(`⚠ ${missing} triples con chunk_id inexistente (excluidos).`);

  const by = (l: Label) => rows.filter((r) => r.label === l);
  console.log(`\n🧪 A3 (relevancia, umbral ${A3_MIN}) vs NLI (ent≥${NLI_ENTAIL} / contra≥${NLI_CONTRA})`);
  console.log(`   ${rows.length} triples\n`);

  // supported: ambos deberían ACEPTAR (recall del verificador).
  const sup = by("supported");
  const a3SupOk = sup.filter((r) => r.a3 >= A3_MIN).length;
  const nliSupOk = sup.filter((r) => r.ent >= NLI_ENTAIL).length;
  console.log("SUPPORTED (deberían aceptarse — recall):");
  console.log(`   A3  acepta: ${pct(a3SupOk, sup.length)} (${a3SupOk}/${sup.length})`);
  console.log(`   NLI acepta (entailment): ${pct(nliSupOk, sup.length)} (${nliSupOk}/${sup.length})`);

  // contradiction: el número clave. A3 las deja pasar como "respaldadas".
  const con = by("contradiction");
  const a3Leak = con.filter((r) => r.a3 >= A3_MIN).length;          // A3 las cree respaldadas
  const nliLeak = con.filter((r) => r.ent >= NLI_ENTAIL).length;    // NLI las cree entailment
  const nliCaught = con.filter((r) => r.con >= NLI_CONTRA).length;  // NLI las marca contradiction
  console.log("\nCONTRADICTION (el caso 'relevante pero falso'):");
  console.log(`   A3  las deja pasar como respaldada:   ${pct(a3Leak, con.length)} (${a3Leak}/${con.length})  ← el leak del 80%`);
  console.log(`   NLI las marca (falsamente) entailment: ${pct(nliLeak, con.length)} (${nliLeak}/${con.length})`);
  console.log(`   NLI las DETECTA como contradiction:    ${pct(nliCaught, con.length)} (${nliCaught}/${con.length})  ← la señal nueva`);

  // neutral: no afirmadas; no deberían contar como respaldadas.
  const neu = by("neutral");
  const a3NeuLeak = neu.filter((r) => r.a3 >= A3_MIN).length;
  const nliNeuLeak = neu.filter((r) => r.ent >= NLI_ENTAIL).length;
  console.log("\nNEUTRAL (no afirmadas — no deberían aceptarse):");
  console.log(`   A3  las acepta igual: ${pct(a3NeuLeak, neu.length)} (${a3NeuLeak}/${neu.length})`);
  console.log(`   NLI las acepta igual: ${pct(nliNeuLeak, neu.length)} (${nliNeuLeak}/${neu.length})`);

  // Accuracy global de cada método (3 clases → decisión binaria "respaldada").
  // "correcto" = supported aceptada; contradiction/neutral NO aceptadas.
  const a3Acc = (a3SupOk + (con.length - a3Leak) + (neu.length - a3NeuLeak)) / rows.length;
  const nliAcc = (nliSupOk + (con.length - nliLeak) + (neu.length - nliNeuLeak)) / rows.length;
  console.log(`\nAccuracy 'respaldada vs no' →  A3: ${pct(a3Acc * rows.length, rows.length)}   NLI: ${pct(nliAcc * rows.length, rows.length)}`);

  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
