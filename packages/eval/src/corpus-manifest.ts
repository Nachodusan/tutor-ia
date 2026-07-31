/**
 * MANIFIESTO DEL CORPUS — la fuente de verdad de qué es cada PDF.
 *
 * Reemplaza la clasificación por regex sobre el nombre de archivo. Los regex
 * fallaban en silencio de las dos formas posibles: los `teacher´s_book` de
 * inglés de 1º y 2º medio no matcheaban `teacher.?s_guide` y desaparecían sin
 * un warning, y `leo_primero_cuaderno_de_actividades` matcheaba `leo_primero` y
 * entraba como contenido citable, metiendo ejercicios sin resolver en el
 * retrieval del alumno.
 *
 * REGLA DE ORO: disco y manifiesto tienen que coincidir EXACTAMENTE. Cualquier
 * diferencia —un PDF que no figura, una fila que apunta a un archivo que no
 * existe— aborta la corrida antes de tocar la base. No se saltea, no se
 * clasifica por defecto, no se loguea y sigue.
 */
import { readFile } from "node:fs/promises";
import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

/** Qué ES el archivo. Independiente de si entra o no a la búsqueda. */
export type CorpusTipo = "contenido" | "pedagogia" | "ejercicios";

export interface ManifestRow {
  ruta: string;
  nivel: string;
  curso: string;
  materiaCanonica: string;
  materiaCarpeta: string;
  tipo: CorpusTipo;
  tomo: number | null;
  /** Si entra al índice de búsqueda. Los ejercicios se guardan con `false`:
   *  no se borran porque se van a necesitar para generar pruebas; cuando llegue
   *  ese momento es cambiar este flag, no volver a ingerir. */
  indexado: boolean;
  verificar: boolean;
  nota: string;
}

const TIPOS = new Set<string>(["contenido", "pedagogia", "ejercicios"]);

/** Error de consistencia del corpus. Siempre aborta: nunca se degrada. */
export class ManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManifestError";
  }
}

/**
 * Parser de CSV con comillas dobles (el manifiesto las usa en `nota`).
 * A mano y sin dependencias: el formato es fijo y conocido.
 */
function parseCsv(raw: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (quoted) {
      if (c === '"') {
        if (raw[i + 1] === '"') { field += '"'; i++; } // "" escapada
        else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ",") { row.push(field); field = ""; continue; }
    if (c === "\n" || c === "\r") {
      if (c === "\r" && raw[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
      continue;
    }
    field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

/**
 * macOS guarda los nombres de archivo en NFD (á = a + ´) y los editores de
 * planilla escriben NFC. Sin normalizar, `1_básico` del CSV no matchea
 * `1_básico` del disco y TODO el corpus parece faltante.
 */
const norm = (s: string) => s.normalize("NFC");

const SI = new Set(["si", "sí", "yes", "true", "1"]);

export async function loadManifest(csvPath: string): Promise<ManifestRow[]> {
  const raw = await readFile(csvPath, "utf8");
  const table = parseCsv(raw);
  if (table.length < 2) throw new ManifestError(`El manifiesto ${csvPath} está vacío.`);

  const header = table[0]!.map((h) => h.trim());
  const need = ["ruta", "nivel", "curso", "materia_canonica", "materia_carpeta", "tipo", "tomo", "indexado", "verificar", "nota"];
  const missing = need.filter((c) => !header.includes(c));
  if (missing.length) {
    throw new ManifestError(`Al manifiesto le faltan columnas: ${missing.join(", ")}.\nEncontradas: ${header.join(", ")}`);
  }
  const idx = Object.fromEntries(header.map((h, i) => [h, i])) as Record<string, number>;

  const rows: ManifestRow[] = [];
  const seen = new Map<string, number>();
  for (let i = 1; i < table.length; i++) {
    const r = table[i]!;
    const ln = i + 1;
    const get = (c: string) => (r[idx[c]!] ?? "").trim();
    const ruta = norm(get("ruta"));
    if (!ruta) throw new ManifestError(`Manifiesto línea ${ln}: 'ruta' vacía.`);
    if (seen.has(ruta)) {
      throw new ManifestError(`Manifiesto: la ruta aparece dos veces (líneas ${seen.get(ruta)} y ${ln}):\n  ${ruta}`);
    }
    seen.set(ruta, ln);

    const tipo = get("tipo");
    if (!TIPOS.has(tipo)) {
      throw new ManifestError(`Manifiesto línea ${ln}: tipo="${tipo}" no es válido (contenido | pedagogia | ejercicios).\n  ${ruta}`);
    }
    const tomoRaw = get("tomo");
    if (tomoRaw && !/^\d+$/.test(tomoRaw)) {
      throw new ManifestError(`Manifiesto línea ${ln}: tomo="${tomoRaw}" no es un número.\n  ${ruta}`);
    }
    for (const col of ["materia_canonica", "curso", "nivel"]) {
      if (!get(col)) throw new ManifestError(`Manifiesto línea ${ln}: '${col}' vacía.\n  ${ruta}`);
    }
    rows.push({
      ruta,
      nivel: get("nivel"),
      curso: get("curso"),
      materiaCanonica: get("materia_canonica"),
      materiaCarpeta: get("materia_carpeta"),
      tipo: tipo as CorpusTipo,
      tomo: tomoRaw ? Number(tomoRaw) : null,
      indexado: SI.has(get("indexado").toLowerCase()),
      verificar: SI.has(get("verificar").toLowerCase()),
      nota: get("nota"),
    });
  }
  return rows;
}

/** Todos los PDFs bajo `root`, como rutas relativas normalizadas. */
async function walkPdfs(root: string, rel = ""): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(join(root, rel), { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await walkPdfs(root, r)));
    else if (e.name.toLowerCase().endsWith(".pdf")) out.push(norm(r));
  }
  return out;
}

/**
 * LA REGLA DE ORO. Compara disco contra manifiesto y ABORTA a la primera
 * diferencia, en cualquiera de las dos direcciones.
 *
 * Se corre ANTES de abrir la base: si el corpus no está descrito por completo,
 * la corrida no empieza. Un PDF nuevo sin fila de manifiesto no se ingiere "por
 * las dudas" ni se saltea en silencio — frena todo hasta que alguien decida qué
 * es. Ese es el punto: el modo de falla que costó los últimos tres bugs fue
 * siempre "el sistema siguió andando cuando debía parar".
 */
export async function assertCorpusMatchesManifest(
  rootDir: string,
  rows: ManifestRow[],
): Promise<void> {
  const root = resolve(rootDir);
  const disk = new Set(await walkPdfs(root));
  const manifest = new Set(rows.map((r) => r.ruta));

  const sinFila = [...disk].filter((p) => !manifest.has(p)).sort();
  const sinArchivo = [...manifest].filter((p) => !disk.has(p)).sort();
  if (sinFila.length === 0 && sinArchivo.length === 0) return;

  const partes: string[] = [
    `El corpus en disco NO coincide con el manifiesto. La ingesta se aborta.`,
    `  raíz:       ${root}`,
    `  en disco:   ${disk.size} PDFs`,
    `  manifiesto: ${manifest.size} filas`,
  ];
  if (sinFila.length) {
    partes.push(
      ``,
      `▶ ${sinFila.length} PDF(s) EN DISCO SIN FILA EN EL MANIFIESTO.`,
      `  Agregá una fila (con su tipo e indexado) o sacá el archivo de la carpeta.`,
      ...sinFila.map((p) => `    + ${p}`),
    );
  }
  if (sinArchivo.length) {
    partes.push(
      ``,
      `▶ ${sinArchivo.length} fila(s) DEL MANIFIESTO SIN ARCHIVO EN DISCO.`,
      `  Corregí la ruta o borrá la fila.`,
      ...sinArchivo.map((p) => `    - ${p}`),
    );
  }
  throw new ManifestError(partes.join("\n"));
}

/**
 * Nombre visible de la materia. `materia_canonica` es ASCII a propósito (sirve
 * de clave), así que hace falta este mapa para no mostrarle al alumno
 * "Matematica 3º" ni "Biologia 1º Medio". Además mantiene los nombres IDÉNTICOS
 * a los que ya están en la base, que es de lo que depende que la re-ingesta sea
 * incremental: el modo resumable empareja por título, y un acento perdido
 * obligaría a re-ingerir las 218 fuentes.
 */
const NOMBRE_VISIBLE: Record<string, string> = {
  biologia: "Biología",
  ciencias_naturales: "Ciencias Naturales",
  ciencias_para_la_ciudadania: "Ciencias Para La Ciudadanía",
  educacion_ciudadana: "Educación Ciudadana",
  filosofia: "Filosofía",
  fisica: "Física",
  historia_geografia_y_ciencias_sociales: "Historia Geografía Y Ciencias Sociales",
  ingles: "Inglés",
  lenguaje_y_comunicacion: "Lenguaje Y Comunicación",
  lengua_y_literatura: "Lengua Y Literatura",
  matematica: "Matemática",
  quimica: "Química",
  // Serie propia, NO se colapsa en matemática (decisión 2026-07-31): es el mismo
  // currículo por otra editorial, y mezclarlas pondría dos explicaciones del
  // mismo tema compitiendo por el top-5 del retrieval.
  //
  // ⚠️ Dice "Sumo Primero" a secas y NO "Sumo Primero (Matemática)" a propósito:
  // este nombre entra en el título del documento, y los 24 que ya están en la
  // base se llaman "Sumo Primero Nº — …". Agregarle el paréntesis cambia los 24
  // títulos y dispara una re-ingesta completa de la serie por un cambio
  // cosmético. Si se quiere el paréntesis en la UI, conviene cambiar
  // `subjects.name` con un UPDATE y desacoplarlo del título, no por acá.
  sumo_primero: "Sumo Primero",
};

/** Nombre de materia para la UI: "Matemática 3º" / "Biología 1º Medio". */
export function subjectNameFor(row: ManifestRow): string {
  const pretty =
    NOMBRE_VISIBLE[row.materiaCanonica] ??
    row.materiaCanonica
      .split(/[_\s]+/)
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  const n = /^(\d+)_/.exec(row.curso)?.[1] ?? row.curso;
  return `${pretty} ${n}º${row.nivel === "media" ? " Medio" : ""}`;
}

/** Toda `materia_canonica` del manifiesto tiene que tener nombre visible.
 *  Si aparece una nueva, frena acá y no en la UI del alumno. */
export function assertNombresVisibles(rows: ManifestRow[]): void {
  const faltan = [...new Set(rows.map((r) => r.materiaCanonica))]
    .filter((m) => !(m in NOMBRE_VISIBLE))
    .sort();
  if (faltan.length) {
    throw new ManifestError(
      `Estas materia_canonica no tienen nombre visible en NOMBRE_VISIBLE ` +
        `(corpus-manifest.ts). Agregalas antes de ingerir:\n` +
        faltan.map((m) => `    · ${m}`).join("\n"),
    );
  }
}

/**
 * Título estable del documento (de esto depende la idempotencia del resumable).
 *
 * Cuando la carpeta de origen NO es la materia canónica —el caso de
 * `sumo_primero`, que colapsa dentro de matemática— se antepone la carpeta.
 * Sin eso, `matemática/guía_didáctica_del_docente_–_tomo_1.pdf` y
 * `sumo_primero/guía_didáctica_del_docente_–_tomo_1.pdf` producen EL MISMO
 * título y el segundo se pierde en silencio (6 casos reales en 3º, 4º y 5º).
 */
export function titleFor(row: ManifestRow): string {
  const file = row.ruta.split("/").pop()!.replace(/\.pdf$/i, "").replace(/_/g, " ");
  const origen =
    row.materiaCarpeta && row.materiaCarpeta !== row.materiaCanonica
      ? `[${row.materiaCarpeta.replace(/_/g, " ")}] `
      : "";
  return `${subjectNameFor(row)} — ${origen}${file}`;
}

/** Grado canónico: "3B" / "1M". */
export function gradeFor(row: ManifestRow): string {
  const n = /^(\d+)_/.exec(row.curso)?.[1] ?? "";
  return `${n}${row.nivel === "media" ? "M" : "B"}`;
}
