-- LOS MÓDULOS EPJA DE CIENCIAS NATURALES, A LA MATERIA QUE LES CORRESPONDE.
--
-- El alumno de Física 1º Medio abría la prueba y le ofrecían "Estructura celular
-- eucariota" y "Cromosomas y herencia ligada al sexo". No era un bug del código:
-- esos módulos estaban COLGADOS de Física.
--
-- LA CAUSA: la ingesta asignó los módulos EPJA de Ciencias Naturales por NIVEL y
-- no por disciplina. Todo I Ciclo Media (1º-2º Medio) fue a Física 1º + Química
-- 2º, y todo II Ciclo a Ciencias para la Ciudadanía. El delator es que Biología
-- no tenía NI UNO, aunque "La célula" y "La reproducción y la herencia" son
-- biología pura.
--
-- LA CLASIFICACIÓN sale del subtítulo que trae cada módulo en su portada, no de
-- adivinar por el título corto:
--   Módulo 4  "Materia y entorno: la materia orgánica y los combustibles
--             fósiles"                                          → QUÍMICA
--   Módulo 5  "La célula"                                       → BIOLOGÍA
--   Módulo 6  "La reproducción y la herencia"                   → BIOLOGÍA
--   Módulo 7  "Bases de la vida: fuentes de energía y materia
--             prima EN LOS SERES VIVOS"                         → BIOLOGÍA
-- Ninguno de los cuatro es de Física. Por eso el camino de Física venía lleno de
-- biología: no era una unidad de más, eran cuatro de siete.
--
-- ⚠️ POR QUÉ ESTO NO ROMPE EL PROGRESO DEL ALUMNO. `topic_key` es
-- hash(documentId|ord|title) y el documentId NO CAMBIA: la parada sigue teniendo
-- la misma clave, solo que ahora cuelga de otra materia. Y `chunks` no guarda
-- subject_id —lo resuelve por el join con documents—, así que los 402 chunks se
-- mudan solos. Estos documentos además no tienen `book_sections` (entran al
-- camino por la vía de "tomo sin índice"), así que no hay secciones que migrar.

begin;

-- Los que estaban en FÍSICA 1º MEDIO.
update documents set subject_id = 'f23158ec-a561-4e4b-9e2d-4578001fe711'  -- Química 1º Medio
 where id = '41b90b68-f980-4139-aae5-16aa2d804ac9';                       -- Módulo 4
update documents set subject_id = 'c891f80d-6fb3-4b20-ba4c-db3f266dc06b'  -- Biología 1º Medio
 where id in ('3b8c0756-2113-406d-b0b8-9a3f820fa87c',                     -- Módulo 5
              '838ad51b-b65b-4397-bf31-ca979fa9b115',                     -- Módulo 6
              '5172e658-c8d1-4619-b45b-bd869f0071dd');                    -- Módulo 7

-- Los que estaban en QUÍMICA 2º MEDIO. El Módulo 4 se queda: ES química.
update documents set subject_id = '3de32118-495f-4383-a4f9-a3a90e29247b'  -- Biología 2º Medio
 where id in ('e0bf701e-0234-4e4d-b0b1-9ae6ded08715',                     -- Módulo 5
              '023bc52b-b6ef-4fa4-a749-f24626c6168e',                     -- Módulo 6
              '5705f3e0-e611-4615-8286-81483bfbcdf2');                    -- Módulo 7

-- ⚠️ EL MAPA CURRICULAR NO SE MUEVE DE MATERIA, Y ES A PROPÓSITO.
--
-- El primer intento hacía `update curriculum_map set subject_id = ...` y reventó
-- contra el índice único (subject_id, corpus_role, metodo, item). El choque
-- enseñó algo: esos items YA están en las seis materias de ciencias, porque el
-- currículum EPJA trata Biología, Física y Química como una sola "Ciencias
-- Naturales" y el mapa replica cada conocimiento esencial en todas. O sea que
-- las filas no están mal — es el diseño.
--
-- Lo que SÍ queda mal es el PUNTERO: tres filas dicen "este conocimiento está
-- cubierto, mirá el documento Z", y Z se acaba de mudar a otra materia. Una fila
-- de Física que apunta a un módulo de Biología manda al alumno a material que ya
-- no es suyo. Se le saca el puntero y las herramientas del mapa lo recalculan;
-- el veredicto de cobertura se deja como está, que es lo que esas herramientas
-- miden y no lo que arregla esta migración.
update curriculum_map cm set document_id = null, pagina_desde = null, pagina_hasta = null
 where cm.document_id in ('41b90b68-f980-4139-aae5-16aa2d804ac9','3b8c0756-2113-406d-b0b8-9a3f820fa87c',
                          '838ad51b-b65b-4397-bf31-ca979fa9b115','5172e658-c8d1-4619-b45b-bd869f0071dd',
                          'e0bf701e-0234-4e4d-b0b1-9ae6ded08715','023bc52b-b6ef-4fa4-a749-f24626c6168e',
                          '5705f3e0-e611-4615-8286-81483bfbcdf2')
   and cm.subject_id <> (select subject_id from documents d where d.id = cm.document_id);

commit;
