/**
 * EL TEXTO DE LOS LIBROS NO SE VERSIONA — pelar y rehidratar los golden.
 *
 * ── POR QUÉ EXISTE ──────────────────────────────────────────────────────────
 *
 * El corpus (205 MB de textos del Mineduc) está deliberadamente FUERA de git:
 * va como asset de release. Pero los fixtures de evaluación traían el mismo
 * material copiado adentro — medido el 2026-11-06, **6,2 millones de caracteres
 * de texto literal** repartidos en golden/, baselines/ y las planillas. Se
 * protegió la puerta y quedó la ventana abierta.
 *
 * Publicar el repo con eso adentro es redistribuir los libros. Y el propio plan
 * de empresa lo dice: "los derechos son de sus autores y editoriales".
 *
 * ── LA IDEA: ANCLA + HASH, NO TEXTO ─────────────────────────────────────────
 *
 * Al pelar, cada campo de texto se reemplaza por "" y al lado queda
 * `<campo>Hash`: los primeros 16 hex del sha256 del texto normalizado. Con eso:
 *
 *   · el repo deja de contener una sola línea de los libros;
 *   · la evidencia sigue siendo VERIFICABLE — quien tenga el corpus rehidrata y
 *     obtiene exactamente el mismo fixture, y el hash prueba que es el mismo
 *     fragmento y no otro parecido;
 *   · el diff de un golden deja de ser un muro de texto y pasa a leerse.
 *
 * ⚠️ POR QUÉ HASH Y NO EL chunk_id, que sería lo obvio: `answerability-banco`
 * NO guarda chunk_id — sus fragmentos tienen `libro` y `pag` y nada más. Y los
 * UUID de `chunks` cambian con cada re-ingesta (es la misma falla de §16), así
 * que un id tampoco sobrevive. El hash del contenido sí: identifica el texto,
 * no la fila.
 *
 *   pnpm --filter @tutor-ia/eval golden-texto --pelar
 *   pnpm --filter @tutor-ia/eval golden-texto --rehidratar
 *   pnpm --filter @tutor-ia/eval golden-texto --verificar   (no escribe nada)
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { getSql } from "@tutor-ia/db";

/** Los campos que alguna vez guardaron texto del libro. */
const CAMPOS = new Set(["texto", "content", "text", "contenido", "sample", "passage", "chunk"]);

/**
 * La raíz del repo, desde la ubicación de ESTE archivo y no desde `cwd`.
 * pnpm corre los scripts con el cwd en `packages/eval`, así que una ruta
 * relativa a la raíz no resuelve. Anclando al módulo, el comando funciona
 * igual desde la raíz, desde el paquete o desde cualquier lado.
 */
const RAIZ = new URL("../../../", import.meta.url).pathname;

/** Los archivos que se pelan. `questions.jsonl` NO entra: sus preguntas son
 *  autoría del proyecto y `expect_chunks` son ids, no texto. */
const OBJETIVOS = [
  "packages/eval/golden/gold-anchors.jsonl",
  "packages/eval/golden/answerability-banco.jsonl",
  "packages/eval/baselines/2026-08-05-scope-audit-todas.json",
  "packages/eval/baselines/2026-08-04-scope-audit.json",
].map((p) => RAIZ + p);

/**
 * El hash del fragmento. Se normaliza el espacio ANTES de hashear: el mismo
 * chunk sale con saltos de línea distintos según por qué camino se leyó, y sin
 * normalizar el hash no coincidiría al rehidratar.
 */
const hash = (s: string) =>
  createHash("sha256").update(s.replace(/\s+/g, " ").trim(), "utf8").digest("hex").slice(0, 16);

type Json = unknown;

function pelar(o: Json): Json {
  if (Array.isArray(o)) return o.map(pelar);
  if (o && typeof o === "object") {
    const out: Record<string, Json> = {};
    for (const [k, v] of Object.entries(o as Record<string, Json>)) {
      if (CAMPOS.has(k) && typeof v === "string" && v.length > 0) {
        out[k] = "";
        out[`${k}Hash`] = hash(v);
      } else {
        out[k] = pelar(v);
      }
    }
    return out;
  }
  return o;
}

function rehidratar(o: Json, porHash: Map<string, string>, stats: { ok: number; falta: number }): Json {
  if (Array.isArray(o)) return o.map((x) => rehidratar(x, porHash, stats));
  if (o && typeof o === "object") {
    const src = o as Record<string, Json>;
    const out: Record<string, Json> = {};
    for (const [k, v] of Object.entries(src)) {
      if (CAMPOS.has(k) && typeof v === "string") {
        const h = src[`${k}Hash`];
        const texto = typeof h === "string" ? porHash.get(h) : undefined;
        if (texto) { out[k] = texto; stats.ok++; } else { out[k] = v; if (typeof h === "string") stats.falta++; }
      } else if (k.endsWith("Hash") && CAMPOS.has(k.slice(0, -4))) {
        out[k] = v;   // el ancla se conserva: rehidratar no la consume
      } else {
        out[k] = rehidratar(v, porHash, stats);
      }
    }
    return out;
  }
  return o;
}

/** Cuenta cuánto texto de libro queda en un objeto. Es la medición que decide
 *  si el repo se puede publicar: tiene que dar 0. */
function cuantoTexto(o: Json): number {
  if (Array.isArray(o)) return o.reduce<number>((n, x) => n + cuantoTexto(x), 0);
  if (o && typeof o === "object") {
    let n = 0;
    for (const [k, v] of Object.entries(o as Record<string, Json>)) {
      if (CAMPOS.has(k) && typeof v === "string") n += v.length;
      else n += cuantoTexto(v);
    }
    return n;
  }
  return 0;
}

const esJsonl = (f: string) => f.endsWith(".jsonl");
const leer = (f: string): Json[] =>
  esJsonl(f)
    ? readFileSync(f, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l))
    : [JSON.parse(readFileSync(f, "utf8"))];
const escribir = (f: string, docs: Json[]) =>
  writeFileSync(
    f,
    esJsonl(f)
      ? docs.map((d) => JSON.stringify(d)).join("\n") + "\n"
      : JSON.stringify(docs[0], null, 2) + "\n",
    "utf8",
  );

async function indicePorHash(): Promise<Map<string, string>> {
  const sql = getSql();
  const filas = await sql<{ content: string }[]>`select content from chunks where content is not null`;
  const m = new Map<string, string>();
  for (const f of filas) m.set(hash(f.content), f.content);
  return m;
}

async function main() {
  const modo = process.argv.find((a) => ["--pelar", "--rehidratar", "--verificar"].includes(a));
  if (!modo) { console.error("Usá --pelar, --rehidratar o --verificar"); process.exit(1); }

  const archivos = OBJETIVOS.filter(existsSync);
  if (archivos.length === 0) { console.error("No encontré ninguno de los archivos objetivo."); process.exit(1); }

  if (modo === "--verificar") {
    let total = 0;
    for (const f of archivos) {
      const n = leer(f).reduce<number>((s, d) => s + cuantoTexto(d), 0);
      console.log(`  ${n === 0 ? "✓" : "✗"} ${f.padEnd(56)} ${n.toLocaleString("es-CL").padStart(10)} chars`);
      total += n;
    }
    console.log(`\n  ${total === 0 ? "✓ limpio: se puede publicar" : `✗ quedan ${total.toLocaleString("es-CL")} caracteres de los libros`}`);
    process.exit(total === 0 ? 0 : 1);
  }

  if (modo === "--pelar") {
    let antes = 0;
    for (const f of archivos) {
      const docs = leer(f);
      antes += docs.reduce<number>((s, d) => s + cuantoTexto(d), 0);
      escribir(f, docs.map(pelar));
      console.log(`  pelado  ${f}`);
    }
    console.log(`\n  ${antes.toLocaleString("es-CL")} caracteres de los libros fuera del repo.`);
    console.log(`  Para volver a tenerlos localmente: pnpm --filter @tutor-ia/eval golden-texto --rehidratar`);
    return;
  }

  const sql = getSql();
  const porHash = await indicePorHash();
  console.log(`  índice: ${porHash.size.toLocaleString("es-CL")} fragmentos del corpus local\n`);
  const stats = { ok: 0, falta: 0 };
  for (const f of archivos) {
    escribir(f, leer(f).map((d) => rehidratar(d, porHash, stats)));
    console.log(`  rehidratado  ${f}`);
  }
  console.log(`\n  ${stats.ok} fragmentos repuestos · ${stats.falta} sin encontrar en el corpus local`);
  if (stats.falta > 0) {
    console.log(`  Los que faltan son de un corpus distinto al que tenés cargado: el hash no coincide.`);
    console.log(`  No es un error del script — es que ese fragmento no está en esta base.`);
  }
  await sql.end?.();
}

void main();
