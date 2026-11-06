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
import { execSync } from "node:child_process";
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

/**
 * ⚠️ `--auditar` BUSCA POR CONTENIDO, NO POR NOMBRE DE CAMPO. Es la corrección
 * del error que hizo falsa la primera auditoría (2026-11-06).
 *
 * Buscar campos llamados `texto`/`content`/`sample` encontró 3 archivos con
 * texto de los libros. Cotejando 8-gramas contra el corpus real aparecieron
 * **25**: el resto lo guardaba bajo `note`, `respuesta`, `afirmacion`, o
 * embebido en markdown. Una lista incompleta es peor que ninguna cuando lo que
 * se decide con ella es reescribir el historial: se reescribe dos veces.
 *
 * El índice son 8-gramas de palabras normalizadas, con paso 4 en el corpus
 * (solapado, para no perder un corte a mitad de frase) y paso 8 en el archivo
 * revisado (basta para detectar). Un acierto suelto puede ser casualidad; tres
 * en un archivo ya no lo son.
 *
 * Necesita el corpus cargado en la base. Sin él no puede decidir, y lo dice en
 * vez de devolver "limpio", que sería la respuesta cómoda y falsa.
 */
async function indiceDeGramas(): Promise<Set<string>> {
  const sql = getSql();
  const chunks = await sql<{ content: string }[]>`
    select content from chunks where content is not null and length(content) > 150`;
  if (chunks.length === 0) throw new Error("El corpus no está cargado: sin él esta auditoría no puede concluir nada.");
  const idx = new Set<string>();
  for (const { content } of chunks) {
    const w = content.replace(/\s+/g, " ").trim().split(" ");
    for (let i = 0; i + 8 <= w.length; i += 4) idx.add(gram(w, i));
  }
  return idx;
}

const gram = (w: string[], i: number) =>
  createHash("md5").update(w.slice(i, i + 8).join(" ")).digest("hex").slice(0, 16);

/**
 * ⚠️ EL UMBRAL ES UNA DECISIÓN, NO UN DETALLE — y por eso vive acá, en un solo
 * lugar que usan el detector y el pelador. Si cada uno usara el suyo dirían
 * cosas distintas del mismo archivo.
 *
 * Ocho palabras seguidas en común NO prueban una reproducción. Coinciden los
 * títulos de las lecciones ("Lección 1 Bases de la organización política en
 * Chile"), que son el dato que hace útil al mapa curricular, y las
 * definiciones canónicas, que se escriben igual en todas partes. Reproducir el
 * libro es otra cosa: tramos largos y continuos.
 *
 * 12 es donde se separan los dos casos en ESTE corpus, mirando los tramos a
 * mano y no eligiendo el número que daba el resultado cómodo. Lo que queda
 * bajo el umbral se informa igual, aparte, para que la decisión se pueda
 * revisar en vez de quedar escondida en una constante.
 */
const MIN_CITA = 12;

/**
 * Los tramos CONTINUOS del texto que están en el corpus, con los bordes reales.
 *
 * Mide con paso 1, no 8: una ventana alineada cada 8 palabras sirve para
 * detectar, pero corta a mitad de frase y no da los bordes. Y juntar la
 * cobertura antes de contar es lo que distingue un párrafo copiado de tres
 * coincidencias sueltas — contar ventanas no los distingue.
 */
function tramosDeCorpus(
  tok: { s: number; e: number; w: string }[],
  idx: Set<string>,
): [number, number][] {
  if (tok.length < 8) return [];
  const palabras = tok.map((x) => x.w);
  const cubierta = new Array<boolean>(tok.length).fill(false);
  for (let i = 0; i + 8 <= tok.length; i++) {
    if (idx.has(gram(palabras, i))) for (let j = i; j < i + 8; j++) cubierta[j] = true;
  }
  const tramos: [number, number][] = [];
  for (let i = 0; i < cubierta.length; i++) {
    if (!cubierta[i]) continue;
    let j = i;
    while (j + 1 < cubierta.length && cubierta[j + 1]) j++;
    tramos.push([i, j]);
    i = j;
  }
  return tramos;
}

const tokenizar = (t: string) =>
  [...t.matchAll(/\S+/g)].map((m) => ({ s: m.index!, e: m.index! + m[0].length, w: m[0] }));

/**
 * ⚠️ UN CONTEO NO DECIDE NADA POR SÍ SOLO. Ocho palabras seguidas pueden
 * coincidir por casualidad en español ("de los seres vivos que habitan en el"),
 * y tres casualidades en un archivo grande no son raras. Antes de borrar un
 * archivo del historial hay que LEER lo que coincidió: por eso `--auditar
 * <ruta>` imprime los tramos, no solo el número. Es el mismo criterio del mapa
 * curricular (§: el score del reranker no prueba nada, hay que leer la página).
 */
async function mostrarCoincidencias(rel: string): Promise<void> {
  const idx = await indiceDeGramas();
  const t = readFileSync(RAIZ + rel, "utf8");
  const tok = tokenizar(t);
  const tramos = tramosDeCorpus(tok, idx);
  const largos = tramos.filter(([a, b]) => b - a + 1 >= MIN_CITA);
  console.log(`  ${rel}`);
  console.log(`  ${largos.length} citas de ${MIN_CITA}+ palabras · ${tramos.length - largos.length} tramos cortos\n`);
  for (const [n, [a, b]] of tramos.entries()) {
    const txt = t.slice(tok[a]!.s, tok[b]!.e).replace(/\s+/g, " ");
    const pal = b - a + 1;
    console.log(`  [${String(n + 1).padStart(3)}] ${String(pal).padStart(3)} palabras  ${pal >= MIN_CITA ? "✂ se pela" : "· queda"}`);
    console.log(`        ${txt.slice(0, 300)}${txt.length > 300 ? " …" : ""}\n`);
  }
}

/**
 * ⚠️ `--auditar` BUSCA POR CONTENIDO, NO POR NOMBRE DE CAMPO. Es la corrección
 * del error que hizo falsa la primera auditoría (2026-11-06).
 *
 * Buscar campos llamados `texto`/`content`/`sample` encontró 3 archivos con
 * texto de los libros. Cotejando contra el corpus real aparecieron 24: el
 * resto lo guardaba bajo `note`, `respuesta`, `afirmacion`, o embebido en
 * markdown. Una lista incompleta es peor que ninguna cuando lo que se decide
 * con ella es reescribir el historial: se reescribe dos veces.
 *
 * Va en dos pasadas porque medir bien es caro: ventanas cada 8 palabras sobre
 * todos los archivos para descartar (barato), y recién sobre los que pasan,
 * paso 1 para juntar los tramos continuos y medir su largo real (caro, pero
 * son pocos). Lo que decide es el largo del tramo, no cuántas ventanas
 * pegaron: tres coincidencias sueltas de 8 palabras son casualidad, un tramo
 * de 30 no.
 *
 * Necesita el corpus cargado en la base. Sin él no puede decidir, y lo dice en
 * vez de devolver "limpio", que sería la respuesta cómoda y falsa.
 */
async function auditarPorContenido(): Promise<
  { archivo: string; citas: number; rotulos: number; cortos: number; palabras: number }[]
> {
  const idx = await indiceDeGramas();

  const rastreados = execSync("git ls-files", { cwd: RAIZ, encoding: "utf8" }).split("\n").filter(Boolean);
  const salida: { archivo: string; citas: number; rotulos: number; cortos: number; palabras: number }[] = [];
  for (const rel of rastreados) {
    if (!/\.(json|jsonl|md|txt|csv|html|tsx?|mjs)$/.test(rel)) continue;
    let t: string;
    try { t = readFileSync(RAIZ + rel, "utf8"); } catch { continue; }

    // Pasada 1, barata: ¿vale la pena mirar este archivo de cerca?
    const w = t.replace(/\s+/g, " ").trim().split(" ");
    if (w.length < 40) continue;
    let pegues = 0;
    for (let i = 0; i + 8 <= w.length; i += 8) if (idx.has(gram(w, i))) pegues++;
    if (pegues === 0) continue;

    // Pasada 2, cara: los bordes reales y el largo de cada tramo.
    const tok = tokenizar(t);
    const tramos = tramosDeCorpus(tok, idx);
    const largos = tramos.filter(([a, b]) => b - a + 1 >= MIN_CITA);
    if (largos.length === 0) continue;

    // La auditoría NO perdona las celdas de tabla, las separa. El pelador sí
    // las perdona (ver `enFilaDeTabla`), así que sin esta columna el auditor
    // marcaría para siempre lo que el pelador decidió dejar, y nunca podría
    // decir "limpio". Separarlas deja la excepción a la vista en vez de
    // esconderla, que es lo que haría aplicar el mismo perdón acá.
    const citas = largos.filter(([a]) => !enFilaDeTabla(t, tok[a]!.s));
    salida.push({
      archivo: rel,
      citas: citas.length,
      rotulos: largos.length - citas.length,
      cortos: tramos.length - largos.length,
      palabras: citas.reduce((n, [a, b]) => n + (b - a + 1), 0),
    });
  }
  salida.sort((a, b) => b.palabras - a.palabras);
  return salida;
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

/**
 * Los archivos que SE CONSERVAN y por eso se pelan cita por cita, en vez de
 * borrarse del historial: tienen autoría del proyecto adentro.
 *
 *   · `mapa-curricular.md` es documentación propia —en qué página de qué libro
 *     está cada exigencia del currículum—, y cita el libro para justificar cada
 *     emparejamiento. Lo que vale es el emparejamiento, no la cita.
 *   · los golden son preguntas escritas a mano; el texto del libro entró por la
 *     puerta de atrás, en el campo `note` de las notas de verificación.
 *
 * El resto de lo que detecta `--auditar` (el sidecar y los baselines) es salida
 * pura de corridas viejas: eso se borra del historial y no vuelve.
 */
const CON_CITAS = [
  "docs/mapa-curricular.md",
  "packages/eval/golden/questions.jsonl",
  "packages/eval/golden/questions-norm.jsonl",
  "packages/eval/golden/questions-parafraseadas.jsonl",
  "packages/eval/golden/questions-parafraseadas-norm.jsonl",
  "packages/eval/golden/golden-macrotipo.jsonl",
  "packages/eval/golden/a3-set.jsonl",
  "packages/eval/golden/subset-fidelidad.jsonl",

  // Las corridas congeladas. Lo que vale acá son las métricas y los veredictos
  // —se usan para comparar contra una corrida nueva—, no la prosa: el libro
  // entró en `note` (copiado del golden) y en `result.answer` (el tutor citando
  // la página). Pelarlas deja las respuestas con huecos, y eso es una pérdida
  // real: ya no se puede volver a juzgar una respuesta vieja palabra por
  // palabra. Se acepta porque el original entero vive en el espejo privado y
  // publicar el repo con los libros adentro no se puede deshacer.
  "packages/eval/baselines/2026-08-04-claims-audit.json",
  "packages/eval/baselines/2026-08-04-claims-veredictos.json",
  "packages/eval/baselines/2026-08-01-A-golden.json",
  "packages/eval/baselines/2026-08-02-N1-golden-qnorm.json",
  "packages/eval/baselines/2026-08-04-cascada-arreglada.json",
  "packages/eval/baselines/2026-08-01-F-golden-OR.json",
  "packages/eval/baselines/2026-08-01-N-neutralidad.json",
  "packages/eval/baselines/2026-08-03-baseline-cascada.json",
  "packages/eval/baselines/2026-08-05-fase0-answerability.json",
  "packages/eval/baselines/2026-08-12-golden101-t0.json",
  "packages/eval/baselines/2026-08-05-scope-audit-todas.json",
  "packages/eval/baselines/2026-08-01-B-parafraseadas.json",
  "packages/eval/baselines/2026-08-01-F-parafraseadas-OR.json",
  "packages/eval/baselines/2026-08-02-FINAL-parafraseadas-stack.json",
  "packages/eval/baselines/2026-08-02-N1-parafraseadas-qnorm.json",
];

/**
 * El único que NO se pela sino que se borra: `sidecar-libro.json` es el OCR
 * completo de *Lengua y Literatura 8vo*, 344 páginas. No hay nada propio
 * adentro que rescatar, y de paso lleva la ruta del escritorio de quien lo
 * generó. Se va del historial y no vuelve.
 */
const SE_BORRA = ["packages/eval/sidecar-libro.json"];

/**
 * ⚠️ ESTO ES DE IDA Y NO VUELVE, a diferencia de `--pelar`.
 *
 * `--pelar` reemplaza un campo entero por su hash, y `--rehidratar` lo
 * recupera buscando ese hash entre los chunks. Acá no se puede: lo que se
 * reemplaza es un TRAMO ADENTRO de un chunk, y el hash de un tramo no está en
 * ningún índice. Recuperarlo exigiría guardar también en qué chunk y en qué
 * posición, que es justo el dato que estorba.
 *
 * Se asume la pérdida porque lo que vale en estos archivos no es la cita: en
 * el mapa es "la exigencia X está en la página N" y en los golden es la
 * pregunta. Igual quedan el largo y el hash, así que la cita sigue siendo
 * VERIFICABLE contra el corpus por quien lo tenga. Y el original completo vive
 * en el espejo del repo privado.
 */
/**
 * ⚠️ UNA CELDA DE TABLA NO SE PELA, por larga que sea.
 *
 * En `mapa-curricular.md` la columna del medio guarda el TÍTULO de la lección
 * — "Lección 2 Las revoluciones del siglo XVIII y los inicios…" —, que es un
 * rótulo para ubicarse, igual que el número de página de la columna de al
 * lado. Pelarlo deja la fila diciendo "esta exigencia está en alguna parte",
 * que es justo lo que el mapa existe para no decir.
 *
 * No es una excepción cómoda: medido sobre el archivo, 167 de los 173 tramos
 * caen en los blockquotes (las citas de verdad) y 6 en filas de tabla, el más
 * largo de 17 palabras. Un párrafo del libro no se escribe adentro de una
 * celda. Si algún día aparece uno, lo va a marcar `--auditar`, que no hace
 * esta excepción.
 */
const enFilaDeTabla = (t: string, pos: number): boolean => {
  const ini = t.lastIndexOf("\n", pos) + 1;
  let fin = t.indexOf("\n", pos);
  if (fin < 0) fin = t.length;
  return t.slice(ini, fin).trimStart().startsWith("|");
};

function redactarTexto(t: string, idx: Set<string>): { out: string; n: number; cortos: number } {
  const tok = tokenizar(t);
  const tramos = tramosDeCorpus(tok, idx);
  const largos = tramos.filter(
    ([a, b]) => b - a + 1 >= MIN_CITA && !enFilaDeTabla(t, tok[a]!.s),
  );
  const cortos = tramos.length - largos.length;
  if (largos.length === 0) return { out: t, n: 0, cortos };

  // De atrás hacia adelante: si no, cada reemplazo corre los offsets siguientes.
  let out = t;
  for (const [a, b] of [...largos].reverse()) {
    const desde = tok[a]!.s, hasta = tok[b]!.e;
    const marca = `[cita del libro: ${b - a + 1} palabras · ${hash(t.slice(desde, hasta))}]`;
    out = out.slice(0, desde) + marca + out.slice(hasta);
  }
  return { out, n: largos.length, cortos };
}

/** En JSON se redacta VALOR POR VALOR, nunca sobre el archivo crudo: un
 *  reemplazo a nivel de bytes puede caer encima de una comilla y dejar el
 *  archivo ilegible. */
function redactarJson(o: Json, idx: Set<string>, c: { n: number; cortos: number }): Json {
  if (typeof o === "string") { const r = redactarTexto(o, idx); c.n += r.n; c.cortos += r.cortos; return r.out; }
  if (Array.isArray(o)) return o.map((x) => redactarJson(x, idx, c));
  if (o && typeof o === "object") {
    const out: Record<string, Json> = {};
    for (const [k, v] of Object.entries(o as Record<string, Json>)) out[k] = redactarJson(v, idx, c);
    return out;
  }
  return o;
}

async function pelarCitas(): Promise<void> {
  const idx = await indiceDeGramas();
  let total = 0, totalCortos = 0;
  for (const rel of CON_CITAS) {
    const f = RAIZ + rel;
    if (!existsSync(f)) { console.log(`  —  ${rel} (no está)`); continue; }
    let n = 0, cortos = 0;
    if (rel.endsWith(".json") || rel.endsWith(".jsonl")) {
      const c = { n: 0, cortos: 0 };
      escribir(f, leer(f).map((d) => redactarJson(d, idx, c)));
      n = c.n; cortos = c.cortos;
    } else {
      const res = redactarTexto(readFileSync(f, "utf8"), idx);
      writeFileSync(f, res.out, "utf8");
      n = res.n; cortos = res.cortos;
    }
    total += n; totalCortos += cortos;
    console.log(`  ${n > 0 ? "✂" : "·"}  ${String(n).padStart(4)} citas  ${String(cortos).padStart(4)} cortas  ${rel}`);
  }
  console.log(`\n  ${total} tramos de ${MIN_CITA}+ palabras reemplazados por su largo y su hash.`);
  console.log(`  ${totalCortos} tramos más cortos quedaron: títulos de lección y definiciones`);
  console.log(`  canónicas, no reproducciones. Leelos con --auditar <ruta>.`);
}

async function indicePorHash(): Promise<Map<string, string>> {
  const sql = getSql();
  const filas = await sql<{ content: string }[]>`select content from chunks where content is not null`;
  const m = new Map<string, string>();
  for (const f of filas) m.set(hash(f.content), f.content);
  return m;
}

async function main() {
  const modo = process.argv.find((a) =>
    ["--pelar", "--pelar-citas", "--rehidratar", "--verificar", "--auditar"].includes(a));
  if (!modo) { console.error("Usá --pelar, --pelar-citas, --rehidratar, --verificar o --auditar"); process.exit(1); }

  if (modo === "--pelar-citas") { await pelarCitas(); process.exit(0); }

  if (modo === "--auditar") {
    const ruta = process.argv[process.argv.indexOf(modo) + 1];
    if (ruta && !ruta.startsWith("--")) { await mostrarCoincidencias(ruta); process.exit(0); }
    const r = await auditarPorContenido();
    const sucios = r.filter((x) => x.citas > 0);
    if (r.length === 0) { console.log(`  ✓ ningún archivo rastreado reproduce el libro en tramos de ${MIN_CITA}+ palabras`); process.exit(0); }
    console.log(`  ${r.length} archivos con tramos del libro (${sucios.length} con reproducción de verdad):\n`);
    console.log("   citas  palabras  rótulos  cortos  archivo");
    for (const x of r)
      console.log(
        `  ${String(x.citas).padStart(6)}  ${String(x.palabras).padStart(8)}  ` +
        `${String(x.rotulos).padStart(7)}  ${String(x.cortos).padStart(6)}  ${x.archivo}`,
      );
    console.log(`\n  citas   = tramos de ${MIN_CITA}+ palabras: ESTO es reproducir el libro.`);
    console.log(`  rótulos = tramos de ${MIN_CITA}+ dentro de una celda de tabla: títulos de lección,`);
    console.log(`            que son referencias igual que el número de página. Se dejan a propósito.`);
    console.log(`  cortos  = menos de ${MIN_CITA} palabras: definiciones canónicas y frases hechas.`);
    console.log(`  Para leer los tramos de un archivo: golden-texto --auditar <ruta>\n`);
    if (sucios.length === 0) {
      console.log(`  ✓ ningún archivo REPRODUCE el libro: lo que queda son rótulos y frases cortas.`);
      process.exit(0);
    }
    console.log("  Rutas para git filter-repo:\n");
    console.log(sucios.map((x) => `    --path ${x.archivo}`).join(" \\\n"));
    process.exit(1);
  }

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
