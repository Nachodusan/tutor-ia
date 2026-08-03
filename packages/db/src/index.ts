import postgres from "postgres";

/**
 * Cliente Postgres compartido. Usa la connection string de DATABASE_URL
 * (por ejemplo, la de tu proyecto Supabase). Registra el tipo `vector` de
 * pgvector como texto en el lado del cliente: los embeddings se envían como
 * literal `'[0.1,0.2,...]'` y se castean a vector en SQL.
 */
let _sql: postgres.Sql | null = null;

export function getSql(): postgres.Sql {
  if (_sql) return _sql;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("Falta DATABASE_URL en el entorno.");
  }
  _sql = postgres(url, {
    // Supabase requiere SSL; en local puede no. `prepare: false` funciona mejor
    // con el pooler de Supabase (pgbouncer en modo transaction).
    prepare: false,
    max: 10,
  });
  return _sql;
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
