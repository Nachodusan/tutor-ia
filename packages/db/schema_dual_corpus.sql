-- =============================================================================
-- Plan v3 — RAG de DOBLE CORPUS TIPADO (contenido + pedagogía)
-- =============================================================================
-- Idempotente. Aplicar DESPUÉS de schema.sql / schema_student_model.sql / schema_hybrid.sql.
--   psql "$DATABASE_URL" -f packages/db/schema_dual_corpus.sql
--
-- El material oficial viene en pares por materia/grado:
--   TEXTO DEL ESTUDIANTE (TE) -> corpus CONTENIDO = el "qué" (fuente de verdad citable)
--   GUÍA DIDÁCTICA DEL DOCENTE (GDD) -> corpus PEDAGOGÍA = el "cómo" (estrategia de enseñanza)
-- Se linkean por (unit, lesson, oa): al enseñar un tema, se traen los chunks de
-- contenido + los de pedagogía que matchean su lección/OA.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- documents: rol del documento + coordenadas curriculares para armar el par.
--   kind         = 'content' (TE) | 'pedagogy' (GDD)
--   grade        = "1B", "2B", ... (grado)
--   subject_area = "ciencias_naturales", "lenguaje", ... (materia oficial)
-- El "par" es implícito por (grade, subject_area): un TE + sus GDD comparten ambos.
-- -----------------------------------------------------------------------------
alter table documents add column if not exists kind         text not null default 'content';
alter table documents add column if not exists grade        text;
alter table documents add column if not exists subject_area text;
create index if not exists idx_documents_pair on documents(grade, subject_area, kind);

-- -----------------------------------------------------------------------------
-- chunks: rol + tipo pedagógico + coordenadas curriculares (por chunk, porque un
-- libro cubre muchas unidades/lecciones).
--   corpus_role   = 'content' | 'pedagogy'
--   pedagogy_type = ideas_previas | ambiente_aprendizaje | habilidad | evaluacion
--                 | solucionario | otro   (TEXTO flexible, no enum: la GDD tiene
--                   ~16 "instancias" y varían entre series; se normalizan los 5
--                   canónicos y el resto cae en su header crudo)
--   unit, lesson  = número de unidad/lección (de "Unidad N • Lección M")
--   oa            = objetivo de aprendizaje ("OA6"), del cuadro de planificación
--   topic         = tema legible de la lección
-- -----------------------------------------------------------------------------
alter table chunks add column if not exists corpus_role   text not null default 'content';
alter table chunks add column if not exists pedagogy_type text;   -- NULL en contenido
alter table chunks add column if not exists unit          int;
alter table chunks add column if not exists lesson        int;
alter table chunks add column if not exists oa            text;
alter table chunks add column if not exists topic         text;

-- Índices para el LINK contenido<->pedagogía (join por lección/OA) y para filtrar
-- por rol/tipo en el retrieval tipado.
create index if not exists idx_chunks_curriculum on chunks(corpus_role, unit, lesson);
create index if not exists idx_chunks_oa on chunks(oa) where oa is not null;
create index if not exists idx_chunks_pedagogy_type on chunks(pedagogy_type) where pedagogy_type is not null;
