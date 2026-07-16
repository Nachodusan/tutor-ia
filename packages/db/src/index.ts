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

/** Serializa un array de números al literal de pgvector: `[0.1,0.2,...]`. */
export function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

export type { Sql } from "postgres";
