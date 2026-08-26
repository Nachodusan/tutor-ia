-- RANGOS DE PÁGINA CORREGIDOS A MANO — las paradas que estudiaban otra cosa.
--
-- Un barrido comparó el título de cada parada con las palabras que aparecen en
-- los chunks de su rango. Ocho de 1.614 tenían mucho material y casi nada del
-- título: sus páginas hablaban de otro tema, y el alumno estudiaba eso creyendo
-- que estudiaba lo que había elegido.
--
-- LA CAUSA es una sola y está en el parser de índices: `page_end` sale de "hasta
-- donde empieza la que sigue", así que toda entrada del índice que el parser no
-- detecta se la come la parada anterior, en silencio y con confidence = 1.
--
-- ⚠️ POR QUÉ A MANO Y NO ARREGLANDO EL PARSER. El arreglo completo del parser
-- recupera las entradas perdidas, y eso REESCRIBE LOS `ord` de todo lo que viene
-- después en cada libro. `topic_key = hash(documentId|ord|title)` es la identidad
-- del alumno en SIETE tablas más un jsonb (lesson_notes, lesson_classes,
-- lesson_quizzes, lesson_quiz_attempts, student_plan_progress, student_weak_topics,
-- student_review_day, y las claves adentro de subject_plans.items). Medido: el
-- arreglo completo deja 371 claves huérfanas de verdad.
--
-- `page_start` y `page_end` NO entran en la clave. Corregirlos a mano no
-- huerfaniza una sola fila. Es la jugada barata y es la correcta mientras el
-- arreglo del parser se revisa en una rama aparte.
--
-- Cada rango de abajo se verificó contando cuántos chunks del rango nuevo hablan
-- del tema del título.

begin;

-- Matemática 8º · "Funciones Concepto y re" · 60 páginas que cubrían funciones,
-- reflexiones geométricas y diagramas de árbol juntos.
-- Verificado: 14 de 14 chunks de 66-83 mencionan función o variable
-- (in)dependiente; en el rango viejo era 1 de 50.
update book_sections set page_start = 66, page_end = 83
 where document_id = 'e69b096f-d26e-4dd2-a3f5-328cb50b0fbd' and ord = 2 and level = 2;

-- Química 1º y 2º Medio (el MISMO libro colgado de dos materias) ·
-- "¿Qué es la estereoisomería?" · el rango traía propiedades coligativas.
-- Verificado: 10 de 13 chunks de 169-179 mencionan estereoisomería, Newman o
-- quiral; en el rango viejo era 1 de 33.
update book_sections set page_start = 169, page_end = 179
 where document_id in ('abd39c77-fdfc-48e7-9fea-26baf4219b0d',
                       '9d24c3f3-73f5-4bc2-aec9-3501dd33eb0c')
   and ord = 6 and level = 2;

-- Lenguaje y Comunicación 5º · "Reseñas de audiovisuales" · 61 páginas.
-- El título se repite una vez por unidad y el parser lo ubicó en la PRIMERA
-- aparición; el folio guardado (122) corresponde a la de la unidad 2.
update book_sections set page_start = 124, page_end = 124
 where document_id = '255c84f3-2091-4a08-967c-53e25c0e0ce2' and ord = 4 and level = 2;

-- Lengua y Literatura 8º · "Lección 4. Saberes ancestrales" · 34 páginas.
update book_sections set page_start = 121, page_end = 125
 where document_id = '7dc59e0d-3419-41d0-932e-1f5272eaa731' and ord = 15 and level = 2;

-- EPJA Lenguaje (dos documentos idénticos) · "Representemos un texto dramático".
update book_sections set page_start = 85, page_end = 85
 where document_id in ('bbb9e64c-670c-49f5-a9c5-6b0345c4c7d5',
                       'c3837697-488a-493b-81dd-a05e463cab9c')
   and ord = 19 and level = 2;

-- Ciencias Naturales 7º · "¿amigos o enemigos?" · el rango estaba casi bien.
--
-- ⚠️ ACÁ EL TÍTULO TAMBIÉN ESTÁ ROTO y NO se corrige acá. El parser toma la
-- ÚLTIMA ancla del tramo, y en "Lección 6: Microorganismos y virus, ¿amigos o
-- enemigos?" la última es el signo de apertura: guarda el título decapitado. El
-- título SÍ entra en la clave de tema, así que corregirlo exige migrar las siete
-- tablas en la misma transacción. Queda para el arreglo del parser.
update book_sections set page_end = 99
 where document_id = 'd917cbfb-2023-45fd-8ab6-0ac9c04d8c0c' and ord = 12 and level = 2;

commit;
