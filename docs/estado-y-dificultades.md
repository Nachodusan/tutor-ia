# Estado del proyecto y qué falta para llegar

> **2026-08-06.** Todos los números de este documento están verificados contra la
> base de datos o contra una corrida de medición del mismo día. Los que vienen de
> una estimación o de una muestra chica están marcados como tales.
>
> Documentos hermanos: `HANDOFF.md` (cómo operarlo, decisiones técnicas),
> `docs/anti-alucinaciones.md` (el diseño de la capa de verificación).

---

## 1. Qué se quiere que sea

Un tutor que le explique a un chico **el material oficial de su propio curso** —el
libro que tiene sobre la mesa y con el que lo van a evaluar— con estas promesas:

1. **Enseña, no responde.** Explica con sus palabras, da ejemplos, verifica que
   entendió y cambia de estrategia si no.
2. **No inventa.** Lo que afirma sale del libro, y cuando no, lo dice.
3. **Dice de dónde salió.** El chico puede ir a la página y comprobarlo.
4. **Es del alumno, no del colegio.** El docente ve avance y temas difíciles,
   nunca las conversaciones.

Fuera de alcance por decisión medida: resolver ejercicios y hacer cálculo.

---

## 2. Dónde está hoy

### Lo que funciona

| | |
|---|---|
| Corpus | 218 documentos · 16.548 chunks de contenido + 12.438 de pedagogía |
| Materias | 67 cargadas, **39 activas**, 51 con guía docente |
| Alucinación real | **~2,6%** (auditada a mano sobre 14 afirmaciones con 8 jueces) |
| Alucinación que reporta el instrumento | 13,3% — el 79% es ruido del NLI |
| Abstención indebida | 0,0% — el tutor ya no se niega |
| Encuadre correcto (`correct_mode`) | **21/24 (87,5%)** — reproducible desde el 2026-08-23 |

El núcleo pedagógico está sano: el tutor explica bien, cita bien, y **casi no
inventa**. La brecha entre el 13,3% que reporta la métrica y el ~2,6% real es del
instrumento, no del producto — está documentada y auditada.

### La guarda ERA irreproducible — arreglado el 2026-08-23

**Síntoma:** el mismo código sobre la misma base daba 19, 20 o 21 sobre 24, y no
siempre fallaba la misma pregunta. Con la máquina quieta seguía variando, así que
no era contención.

**Causa:** el **puente de vocabulario** (`puenteDeVocabulario`) es una tarea
GENERATIVA de salida larga, y eso no es determinista aunque `temperature` sea 0 —
el proveedor sirve un MoE y el ruteo de expertos hace que dos llamadas idénticas
devuelvan listas de distinto largo. Medido: **cinco llamadas iguales, tres
resultados distintos**, uno de ellos `null` (la salida no pasó
`esListaDeTerminos`).

Eso basta para mover todo, porque **el puente solo corre cuando el gate corta**:
su resultado cambia la consulta → el material → el encuadre. En una comparación
q028 saltó de 0,0018 a 0,485 entre dos corridas seguidas.

**Arreglo:** caché de fixtures (`QUERY_NORMALIZE_CACHE`). La primera corrida
graba lo que el modelo devolvió y las siguientes lo reproducen; el retrieval
sigue siendo el real y lo único congelado es la pieza que no se puede repetir.
`retrieval-guard` lo activa solo, contra `golden/puente-fixture.json`. Verificado:
**tres corridas idénticas hasta el `topScore` de cada pregunta.** En producción no
hay caché. Con `--sin-fixture` se mide en vivo.

**Para re-grabar** —tras cambiar el prompt del puente, el modelo o el corpus—
se borra el archivo y se corre una vez.

⚠️ **21/24 es el valor real.** Las corridas de 19 y 20 del 2026-08-22/23 eran el
artefacto, no el ruido de fondo: no hace falta correr tres veces ni sacar
medianas. Y una lectura que el ruido tapaba: en el fixture se ve que a "¿en qué
año ganó Chile la Copa América?" el puente le devuelve *"Historia de Chile: La
Independencia y la República"*, o sea que le inventa contexto de historia a una
pregunta de fútbol y por eso engancha material del libro. Es un defecto real, y
ahora es reproducible.

### ⚠️ El baseline de `correct_mode` se rehizo el 2026-08-22

El 87,5% (21/24) que figuraba acá era **anterior al 2026-08-11**, cuando la etapa
`otra_materia` se apagó por decisión de producto. Desde entonces dos preguntas
(q030, q034) esperaban un alcance que el código ya no puede producir, y otras
cuatro esperaban "ningún libro cubre esto" sobre temas que el corpus **sí**
trata. Con el baseline viejo era imposible distinguir una regresión de una
expectativa vencida — pasó de verdad al ingerir el corpus EPJA.

Se revisaron las 24 **leyendo el material**, no mirando el scope devuelto (eso
sería circular). Resultado: 4 expectativas corregidas, 3 revisadas y confirmadas.
El porqué de cada una vive en el campo `rebaseline` de `golden/questions.jsonl`;
el archivo anterior quedó en `questions.jsonl.bak-20260822`.

**q034 ya se arregló** (misma fecha): a "¿qué es la fotosíntesis?" desde Lengua 8º
entraba Lengua 7º pág. 134 —"los restos nudosos de un antiquísimo tocón"— con
topScore **0,1598, por debajo del gate de 0,18**, rescatado por el margen
distribucional; después el NLI le daba 0,981 (el texto menciona células, azúcares
y respiración) y salía como respuesta respaldada.

La causa no era el margen sino DÓNDE se aplicaba: existe para rescatar registro
coloquial dentro del material del alumno, donde el contexto de materia respalda un
score bajo. Fuera de su libro ese respaldo no existe. La etapa `otra_materia` ya
pasaba `gateMargin: 0`; la de `otro_curso` había quedado sin él. Apagarlo ahí subió
de 20/24 a 21/24 sin mover ninguna otra pregunta.

**Las 3 fallas que quedan son defectos reales, no ruido del instrumento:**

| id | qué pasa | qué falla |
|---|---|---|
| q120 | a "¿de qué trata Cien años de soledad?" le da 0,9876 a un texto sobre el "mundo maravilloso" y 0,996 de entailment | el discriminador de answerability |
| q123 | a "¿qué se cuenta sobre Sherlock Holmes?" responde con un policial de Karen McManus, 0,5052 | el ranking |
| q126 | "Minotauro" está en el texto de 8º, en el de 7º y en el de 2º Medio, y no lo encuentra | recall |

### Lo que no

| | valor | objetivo |
|---|---|---|
| recall@5 | 88,0% | ≥90% |
| precision@gold | 71,1% | ≥80% |
| **Latencia por turno** | **p50 26 s · p90 49 s** | — |
| **Sesiones de un solo turno** | **31 de 34** | — |

---

## 3. Las dificultades, por cuánto pesan

### 3.1 🔴 No es un tutor todavía: es un contestador de preguntas sueltas

**El dato más elocuente del proyecto: 31 de las 34 conversaciones que existen
tienen UN solo turno de usuario. La mediana de turnos por sesión es 1.**

Un tutor de verdad vive en el segundo, tercer y cuarto turno: ahí es donde
verifica, se da cuenta de que el chico no entendió, y cambia de estrategia. Hoy
eso casi no pasa, y hay tres causas concretas:

- **No se puede retomar una conversación.** El endpoint existe; la UI nunca lo
  llama. Cada vez que el chico vuelve, empieza de cero.
- **El tutor no sabe nada del alumno entre sesiones.** `student_weak_topics`
  guarda lo que falló en las pruebas (29 filas hoy) y el plan de estudio sabe qué
  temas lleva (94 filas), pero **el chat no lee ninguna de las dos**. Son islas.
- **La adaptatividad depende de que el chico se queje explícitamente.** El
  "cambiá de estrategia" se dispara con un regex sobre su mensaje ("no entendí").
  Si contesta mal la pregunta de comprensión pero no se queja, el tutor sigue
  como si nada.

Es la dificultad que más separa lo que hay de lo que se quiere, y **no depende de
ningún modelo, ni de la ingesta, ni del retrieval**. Es trabajo de producto.

### 3.2 🔴 Veintiséis segundos es mucho para un chico

`p50 26 s, p90 49 s` medidos sobre los turnos reales guardados en la base. Un
adolescente esperando medio minuto frente a una pantalla en blanco abandona, y
eso explica parte del punto anterior.

El costo está repartido: embeddings remotos (ida y vuelta por cada búsqueda, hasta
4 por turno sin caché), el reranker local, la generación, y la verificación NLI.
**No hay instrumentación por etapa**, así que hoy no se sabe cuál domina — y ese
es el primer paso, no optimizar a ciegas.

### 3.3 🟠 El recall tiene un techo, y ya sabemos dónde está

De cada 100 preguntas, el material correcto no llega al top-5 en 12. Medido:

```
recall@5              88,0%   ← lo que le llega al alumno
recall@TODO (k=25)    95,3%   ← lo que el retrieval sí trae
────────────────────────────
~7,3 pts se pierden por ORDEN · ~4,7 pts porque nunca llega
```

**La mayoría es problema de orden, no de recuperación.** El material correcto está
entre los candidatos y el cross-encoder lo hunde. Y eso ya no se arregla ajustando:
las tres perillas que quedaban están medidas y descartadas (§4).

Queda como límite del componente: `bge-reranker-v2-m3` no ordena bien las
preguntas parafraseadas, que es exactamente cómo pregunta un chico. Mejorarlo
significa **cambiar el reranker, expandir la consulta (HyDE) o afinarlo con el
golden** — un proyecto con su propia hipótesis, no un barrido.

### 3.4 🟠 El corpus tiene agujeros estructurales que ningún ajuste cierra

- **47 de 93 libros de contenido no tienen índice parseado** (Inglés, Leo Primero,
  Sumo Primero). En esos el texto directamente **no está en el PDF** — son libros
  de imágenes. A un chico de 1º con Leo Primero, nada de lo que se haga en
  retrieval le cambia algo. Hay que decirlo en vez de prometer cobertura.
- **0 de 16.548 chunks de contenido tienen OA.** El "link por objetivo de
  aprendizaje entre libro y guía docente" que el diseño describe como arquitectura
  central **nunca se ejecutó**: es un `else {}` en el extractor. Y aunque
  funcionara, no puede mover recall ni precisión (solo afecta a la pedagogía).
- **5 documentos en `status='error'`** desde siempre: 4 guías docentes de inglés y
  una de Leo Primero. Material que se compró/consiguió y no está indexado.
- **16 materias sin guía docente** (51 de 67 la tienen): ahí el tutor no sabe qué
  se evalúa ni qué errores anticipar.

### 3.5 🟡 El instrumento midió mal cuatro veces, y esa es su propia dificultad

Este proyecto tiene una historia repetida: métricas que describían un motor que no
existía. Los cuatro casos, todos reales y todos ya corregidos:

1. `recall@5` calculado post-gate → aflojar el gate lo subía solo.
2. `EVAL_HALLUCINATION=0` apagaba la generación entera y reportaba `0,0% ✅`.
3. El eval nunca pasaba `familyIds` → una etapa de la cascada jamás corría.
4. Una deriva de retrieval por cambio de proveedor de embeddings pasó invisible
   porque las métricas se promedian sobre un subconjunto que no la incluía.

**La lección operativa: antes de creerle a un número, verificar que mida el motor
que atiende al alumno.** Hoy hay instrumentos para eso (§5), pero la disciplina
hay que sostenerla — el patrón se repitió cuatro veces.

Y quedan dos huecos de medición abiertos:
- **El golden es de UNA materia** (Lengua 8º, unidades 1-2). Todo lo que sabemos
  del motor está calibrado contra medio libro de 39 activas.
- **El modo `general` no tiene juez.** Son las respuestas que salen del
  conocimiento del modelo, y nadie mide si son ciertas.

### 3.6 🟡 Depende de internet para todo, y de un modelo chico

- **Sin red no hay ni búsqueda.** Los embeddings son remotos. Un corte no degrada
  el servicio: lo corta. (Mitigado en parte: ahora reintenta ante fallas
  transitorias, porque en una sola noche de trabajo la red tumbó dos corridas.)
- **Un solo modelo para todo**: la voz del tutor, la generación de pruebas y el
  juez que mide alucinaciones corren en el mismo Qwen3.6-35B-A3B (~3B parámetros
  activos) a temperatura 0,1. Es la gama de precio mínimo. El juez es el mismo
  modelo que genera, lo que invalida parte de la medición.
- **Sin control de gasto real** en el servidor: el contador existe pero no
  funciona en la web.

---

## 4. Lo que ya se descartó midiendo (no repetir)

Cinco caminos que parecían la solución y **no lo son**, cada uno con su medición:

| Hipótesis | Resultado |
|---|---|
| Re-chunkear por bloques visuales del PDF | Cobertura 90,5% → **72,4%**. Empeora. Revertido. |
| Agrandar el pool de candidatos (25 → 60) | **Idéntico al decimal.** No compra nada. |
| Otra estrategia de ordenamiento (5 barridas) | La actual (`ce`) **es la mejor**. |
| Extraer con `pymupdf4llm` | 100× más lento, 30% menos texto, headings inservibles. |
| Recuperar el OA y el link libro↔guía | No puede mover recall ni precisión ni en principio. |

Y las tres hipótesis con las que arrancó la auditoría, todas descartadas:

- **"Liberar más la información"** — el tutor ya no se abstiene nunca
  (false_abstention 0,0%). El problema era el contrario: servía ruido con sello de
  confianza.
- **"Agregar más materias"** — hay 67 cargadas y 39 activas. Ninguna métrica floja
  mejora con más corpus; el problema es de orden sobre material que ya está.
- **"Conectarlo a internet"** — son libros escolares, no noticias. Rompería la
  promesa central ("esto sale de TU libro"), agrandaría el único modo sin
  instrumento y metería contenido no curado frente a menores. Lo que sí faltaba
  era que el tutor **supiera en qué año vive**, y eso ya está arreglado.

---

## 5. Lo que hay para trabajar bien

Herramientas construidas que hacen que el próximo intento sea barato y honesto:

- **`retrieval-guard`** — recall, precisión y encuadre **sin generación**: 13
  minutos en vez de 2,5 horas, y reproduce el eval completo al decimal. Permite
  probar una hipótesis por tarde en vez de una por semana.
- **`recallPorCobertura`** — mide qué fracción del *pasaje* quedó dentro de lo
  recuperado. **Invariante al chunking**: sin esta métrica se habría concluido mal
  dos veces, porque `recall@5` cae al partir más fino aunque el retrieval mejore.
- **Golden anclado por texto** — sobrevive a cualquier re-chunk. El set anterior
  (`a3-set.jsonl`, 60 claims etiquetados a mano) murió exactamente así y con él la
  capacidad de calibrar el verificador.
- **Ingesta no destructiva** — re-ingestar ya no borra el progreso de los alumnos.
- **Registro de huecos de material** — anota qué preguntan los chicos que su libro
  no cubre, para decidir qué conseguir con demanda real en vez de a ojo.
- **Eval multiturno** — el único instrumento que mide una conversación y no una
  pregunta suelta.

---

## 6. Qué haría falta para llegar

En orden de cuánto acerca el producto a lo que se quiere:

**1. Que sea una conversación (§3.1).** Retomar sesiones, que el chat lea lo que
el alumno ya falló, y detectar que no entendió por su *respuesta* al chequeo y no
por un regex. Es lo que más cambia la experiencia y no depende de nada externo.

**2. Bajar la latencia (§3.2).** Primero instrumentar por etapa: hoy no se sabe
qué domina de los 26 segundos. Después atacar lo que salga (caché de embeddings,
paralelizar, o un modelo más rápido).

**3. Un golden que represente el corpus (§3.5).** 4-6 materias con 15-25 preguntas
cada una, incluyendo una sin guía docente y una de básica temprana. Sin eso, todo
lo que sabemos vale para medio libro de Lengua 8º y no se puede afirmar del resto.

**4. Un piloto con un curso real.** Ningún eval dice cómo pregunta un chico de
verdad, qué abandona, ni qué le sirve. El registro de huecos y el panel del docente
ya están para capturarlo. Conviene hacerlo *después* de 1 y 2, porque la latencia y
la falta de continuidad arruinarían la primera impresión.

**5. Subir el techo del recall (§3.3) y del modelo (§3.6).** Cambiar el reranker y
usar un modelo mejor para la voz del tutor. Son los más caros y los más inciertos:
importantes, pero no antes de los cuatro anteriores.

---

## 7. La lectura honesta

**El motor no está tan mal como parecía.** La alucinación real ronda el 2,6%, el
encuadre está arreglado, y las explicaciones son buenas. Lo que estaba mal era
otra cosa: el producto alrededor del motor (no hay conversación), la latencia, y
sobre todo la **instrumentación** — cuatro bugs de medición que mostraban problemas
donde no había y escondían los que sí.

La distancia que falta para "un tutor que acompaña a un chico a estudiar" **no es
principalmente de IA**. Es de producto: memoria, continuidad y velocidad. La parte
de IA que sí falta —el techo del reranker y el modelo chico— está identificada,
acotada y es la más cara; conviene atacarla cuando lo otro esté, no antes.
