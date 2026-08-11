import postgres from "postgres";

/**
 * Cliente Postgres compartido. Usa la connection string de DATABASE_URL
 * (por ejemplo, la de tu proyecto Supabase). Registra el tipo `vector` de
 * pgvector como texto en el lado del cliente: los embeddings se envían como
 * literal `'[0.1,0.2,...]'` y se castean a vector en SQL.
 */
/**
 * ⚠️ EL POOL VIVE EN `globalThis`, NO EN UNA VARIABLE DE MÓDULO.
 *
 * Un `let _sql` de módulo parece un singleton y no lo es: en Next dev cada
 * bundle de ruta recibe SU copia del módulo, y cada hot reload crea otra. Con
 * `max: 10` por pool y ~10 rutas de API, eso son 100 conexiones — exactamente el
 * `max_connections` por defecto de Postgres. Medido: el dev server sostenía 97
 * de 103 backends él solo, y el login empezó a responder 500 con "sorry, too
 * many clients already". No es un problema de carga: es un pool por copia.
 *
 * Es el mismo fenómeno que ya está documentado para el contador de gasto
 * (`budget.ts`), donde el acumulado se reiniciaba al recompilar.
 */
const CLAVE = Symbol.for("tutor-ia.sql");
type Global = typeof globalThis & { [CLAVE]?: postgres.Sql };

export function getSql(): postgres.Sql {
  const g = globalThis as Global;
  if (g[CLAVE]) return g[CLAVE]!;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("Falta DATABASE_URL en el entorno.");
  }
  g[CLAVE] = postgres(url, {
    // Supabase requiere SSL; en local puede no. `prepare: false` funciona mejor
    // con el pooler de Supabase (pgbouncer en modo transaction).
    prepare: false,
    max: 10,
    // Una conexión ociosa se devuelve al sistema en vez de quedarse tomada. Sin
    // esto, un pico deja el pool lleno para siempre.
    idle_timeout: 30,
  });
  return g[CLAVE]!;
}

/**
 * Valor para una columna `jsonb`. USAR SIEMPRE ESTO, nunca `JSON.stringify(x)`.
 *
 * `${JSON.stringify(x)}::jsonb` parece correcto y no lo es: con esta conexión el
 * valor llega ya codificado y el cast lo envuelve de nuevo, así que en la columna
 * queda el TEXTO del json entre comillas. `jsonb_typeof` devuelve 'string' en vez
 * de 'array', y cualquier consulta que trate la columna como estructura falla con
 * "cannot get array length of a scalar" — que es como se rompió el panel del
 * alumno apenas rindió su primera prueba.
 *
 * Existe como envoltorio y no se llama `sql.json()` directo porque el tipo
 * `JSONValue` de postgres.js exige una firma de índice que ninguna interfaz
 * nuestra tiene: sin esto, cada sitio de llamada necesitaría su propio cast.
 *
 * Reparación de lo ya escrito: packages/db/repair_jsonb_double_encoded.sql
 */
export function toJson(
  // Estructural y no `postgres.Sql`: dentro de `sql.begin()` el handle es
  // `TransactionSql`, que no es asignable a `Sql` pero sí tiene `.json()`.
  sql: Pick<postgres.Sql, "json">,
  value: unknown,
) {
  return sql.json(value as Parameters<postgres.Sql["json"]>[0]);
}

/** Serializa un array de números al literal de pgvector: `[0.1,0.2,...]`. */
export function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

export type { Sql } from "postgres";
