# Mapa curricular — dónde está en el libro lo que exige el Estado

Cada **conocimiento esencial** de las *Bases Curriculares EPJA* (DS 10/2022), ubicado en
el **texto del estudiante** de la materia que le corresponde, con la página y una cita
textual como prueba. Generado desde la tabla `curriculum_map`.

> **Las citas están pisadas en este repo.** Donde dice
> `[cita del libro: 20 palabras · 5c2a047…]` había un tramo textual del texto escolar.
> Este repositorio es público y los textos del Mineduc no se redistribuyen acá, así que
> cada cita quedó reducida a su largo y al hash de su contenido. El hash alcanza para
> **verificarla**: quien tenga el corpus la recupera y comprueba que es ese fragmento y
> no otro parecido. Lo que el mapa afirma —qué exigencia está en qué página— no depende
> de la cita, y se puede chequear abriendo la página.
>
> Quien tenga los libros puede ver el archivo completo con
> `pnpm --filter @tutor-ia/eval golden-texto --auditar docs/mapa-curricular.md`.

Fuente del currículum: [`docs/epja-objetivos-por-nivel.md`](epja-objetivos-por-nivel.md).
Alcance: [`docs/materias-por-nivel.md`](materias-por-nivel.md) — Formación General + Filosofía.
**Inglés queda fuera de esta pasada.** Los libros del profesor, también: son la segunda.

## Cómo leer cada punto

| | |
|---|---|
| ✅ | El libro lo enseña completo en ese tramo. |
| 🟡 | El libro enseña una parte. La nota dice qué falta o dónde está el resto. |
| 🔁 | El contenido existe, pero en la mitad del OTRO curso del tomo combinado. No es material de este alumno. |
| ❌ | Se buscó con al menos tres formulaciones y no está en el libro. |

Cada ubicación fue producida por un lector que abrió esas páginas, y **sin cita textual no
se aceptó ninguna**. Una muestra pasó además por un auditor independiente que intentó
refutarla: de 33 auditadas, las 33 citas existían en la página indicada.

**Los 🟡 son la mayoría, y no es un defecto del mapa.** El currículum agrupa varios temas
por línea — *"Operaciones con números racionales, potencias, raíces y sus propiedades"* son
cuatro temas en cuatro páginas distintas. Por eso cada punto trae, además del tramo
principal, la columna **También en** con las otras páginas y qué parte cubre cada una.
Cuando algo falta de verdad, la nota lo dice con las palabras *LO QUE FALTA DE VERDAD*.

| Estado | Puntos |
|---|---|
| ✅ cubierto | 66 |
| 🟡 parcial | 110 |
| 🔁 otro curso | 14 |
| ❌ sin cubrir | 47 |
| **Total** | **237** |

---

## Nivel 2 Educación Básica

**Cursos:** 6º Básico (5º está cerrado)

### Ciencias Naturales 6º

✅ 3 · 🟡 2 · 🔁 0 · ❌ 2

| | Punto a trabajar | Dónde se enseña | Págs. | También en |
|---|---|---|---|---|
| ✅ | Características de las capas de la Tierra (atmósfera, litósfera e hidrósfera) y prevención de la contaminación. | La Tierra y los seres vivos | 51–70 | — |
| ✅ | Energía: propiedades y manifestaciones de la energía y efectos en los objetos y seres vivos. Recursos energéticos en Chile. | Energía y recursos energéticos | 117–148 | — |
| ✅ | Flujos al interior del ecosistema (cadenas y tramas tróficas), considerando medidas de prevención y mitigación frente a posibles deterioros. | La Tierra y los seres vivos | 93–103 | — |
| 🟡 | Materia: características y cambios de estado; clasificación de la materia; mezclas (homogéneas y heterogéneas); propiedades de la materia (masa, volumen, densidad, temperatura). | La materia que nos rodea | 160–188 | 124–128 |
| 🟡 | Sistemas del cuerpo humano: funciones, estructuras básicas (sistemas digestivo, respiratorio, circulatorio y reproductor; tubo digestivo, pulmones y bronquios, vasos sanguíneos y corazón, y gónadas), considerando medidas de prevención y autocuidado. | Reproducción y pubertad | 13–18 | 28–40 |

**Características de las capas de la Tierra (atmósfera, litósfera e hidrósfera) y prevención**
> «está rodeado [cita del libro: 20 palabras · 5c2a047324e0d977] litósfera.» — pág. 51
> 
> Es la Lección 1 'Las capas de la Tierra'. Presentación conjunta de las tres capas en p.53; atmósfera con su composición, sus cinco capas y su importancia en pp.56-59; hidrósfera y la distribución del agua en pp.61-63; litósfera, placas tectónicas, suelo y sus horizontes en pp.66-72. La…

**Energía: propiedades y manifestaciones de la energía y efectos en los objetos y seres vivo**
> «Entendemos [cita del libro: 16 palabras · a92143a9887bdd75] provocar cambios.» — pág. 117
> 
> Se enseña completo en las dos lecciones de la unidad. Lección 1 (pp.117-132): concepto de energía y sus manifestaciones (p.117), las tres propiedades —se conserva, se transfiere, se transforma— (pp.118-120), el Sol como principal fuente de energía del planeta y de los seres vivos (pp.120-123), y…

**Flujos al interior del ecosistema (cadenas y tramas tróficas), considerando medidas de pre**
> «Para representar [cita del libro: 12 palabras · e9ba51dcfa3c8f9e] o alimentarias.» — pág. 93
> 
> Tramo exacto dentro de la Lección 2 'Los seres vivos y sus interacciones': productores y consumidores y los cuatro niveles tróficos en pp.93-95, cadena alimentaria en p.95, trama trófica del sur de Chile en p.97, y el deterioro por acción humana con sus medidas en pp.100-103 (especies introducidas…

**Materia: características y cambios de estado; clasificación de la materia; mezclas (homogé**
> «Recordemos que [cita del libro: 20 palabras · fbd4a253b8c8e02e] el aire que respiras.» — pág. 160
> 
> · **págs. 124–128** — la propiedad temperatura: diferencia entre calor y temperatura y equilibrio térmico
> 
> Cubierto: características de la materia y modelo corpuscular (pp.160-163), los tres estados más el plasma (pp.163-166), y los cambios de estado progresivos y regresivos con las curvas de calentamiento y enfriamiento del agua (pp.175-188: fusión, vaporización, sublimación, condensación,…

**Sistemas del cuerpo humano: funciones, estructuras básicas (sistemas digestivo, respirator**
> «La función [cita del libro: 24 palabras · d1750b26649f92fe] forman.» — pág. 13
> 
> · **págs. 28–40** — medidas de prevención y autocuidado: actividad física (29), higiene personal (34-37), salud bucal (38) y prevención de alcohol y drogas (40)
> 
> Solo está el sistema REPRODUCTOR: femenino con sus estructuras y función (pp.13-14: ovarios, oviductos, útero, vagina) y masculino (pp.16-18: testículos, epidídimo, conductos deferentes, vesículas seminales, próstata). La palabra 'gónada' no aparece, aunque sí ovarios y testículos como productores…

**❌ No están en este libro**

- **Movimientos de la Tierra y la Luna, y sus efectos en los objetos y seres vivos.**
  HUECO CONFIRMADO por un segundo lector. Términos probados: rotaci, traslaci, luna, lunar, eclipse, estaciones del año, satélite, satélite natural, día y la noche, marea, eje terrestre, órbita, astro, sistema solar, universo, planeta, girar/gira, solsticio, equinoccio, verano, invierno, otoño, primavera, constelación, estrella, cosmos, espacial, galaxia, telescopio, NASA, cometa, meteor, vuelta al…
- **Niveles de organización de los seres vivos, incluyendo célula, tejido, órgano y sistema.**
  HUECO CONFIRMADO por un segundo lector. Términos probados: nivel(es) de organización, organización de los seres, jerarq, unidad básica, unidad estructural, unidad fundamental, unidad más pequeña, conjunto de célul, se agrupan, están formados por, célul, célula animal, célula vegetal, célula eucari, unicelular, pluricelular, microscopi, membrana, núcleo, citoplasma, cloroplasto, tejid, tejido…

### Historia Geografía Y Ciencias Sociales 6º

✅ 2 · 🟡 4 · 🔁 0 · ❌ 0

| | Punto a trabajar | Dónde se enseña | Págs. | También en |
|---|---|---|---|---|
| 🟡 | Características del conocimiento de la Historia, la Geografía y las Ciencias Sociales. | Taller de habilidades: aplicar conceptos temporales e interpretar periodizaciones | 54–55 | 110–111, 118–119, 132–133, 156–157 |
| ✅ | Deberes del Estado y derechos y responsabilidades de las personas; derechos humanos y actitudes cívicas en el Chile actual. | Lección 2 Derechos y deberes de las personas | 28–43 | — |
| ✅ | Funcionamiento de la democracia, formas de participación y representación y la organización político-administrativa en Chile. | Lección 1 Bases de la organización política en Chile | 12–27 | — |
| 🟡 | Macrozonas y sus paisajes de Chile; principales zonas naturales, recursos significativos y trabajo humano que le da valor. Riesgos socio-naturales. | Ambientes naturales de Chile | 160–167 | 150, 175–177, 178–179, 182–183 |
| 🟡 | Principales hitos y periodos de la historia de la humanidad y de Chile. | Taller de habilidades: aplicar conceptos temporales e interpretar periodizaciones | 54–55 | 50–51, 96–97, 144–145 |
| 🟡 | Pueblos originarios en Chile: ubicación geográfica, uso y dominio de recursos naturales. | Pueblos originarios en las regiones de Chile | 180–181 | 92–93 |

**Características del conocimiento de la Historia, la Geografía y las Ciencias Sociales.**
> «la historia como [cita del libro: 16 palabras · 06c1579fdb533843] y su pasado» — pág. 54
> 
> · **págs. 110–111** — cómo se construye el conocimiento histórico: las fuentes como materia prima de la Historia
> · **págs. 118–119** — el conocimiento histórico se valida contrastando fuentes distintas
> · **págs. 132–133** — fuente primaria y secundaria; el conocimiento histórico depende del punto de vista de quien lo produce
> · **págs. 156–157** — el mapa como herramienta propia de la Geografía, y también de la Historia y las Ciencias Sociales
> 
> El libro no tiene una sección dedicada a caracterizar las tres disciplinas juntas; lo enseña repartido. Aquí (54-55) define la Historia como disciplina y sus categorías (proceso histórico, acontecimiento, duración, sucesión, simultaneidad, periodización). Falta un tratamiento propio de las Ciencias…

**Deberes del Estado y derechos y responsabilidades de las personas; derechos humanos y acti**
> «Los derechos humanos generan [cita del libro: 16 palabras · 9044ba68d96c4d93] sociedad en su conjunto.» — pág. 28
> 
> La lección entera es exactamente este conocimiento. Si se quiere el tramo más corto y exacto: 34-37, donde 34-35 'Protección de los derechos de las personas en Chile' enseña el deber del Estado como garante (instituciones como el Servicio Mejor Niñez y el SERNAC, y los recursos de protección y de…

**Funcionamiento de la democracia, formas de participación y representación y la organizació**
> «La Constitución Política de [cita del libro: 16 palabras · 12b189cf540417b0] sus habitantes.» — pág. 12
> 
> Está completo y bien repartido dentro de la lección: 16-17 'Constitución Política y organización democrática' (Chile como república democrática); 18-19 'División de poderes del Estado' ('Un objetivo [cita del libro: 16 palabras · 0a1d5439c4bcbc27] poder', con…

**Macrozonas y sus paisajes de Chile; principales zonas naturales, recursos significativos y**
> «El territorio chileno [cita del libro: 30 palabras · 7b1772c6c2f4325d] y desarrollarse.» — pág. 160
> 
> · **págs. 150** — la división de Chile en macrozonas (cinco zonas naturales) y la noción de paisaje con sus elementos naturales y culturales; aparece como repaso de conocimientos previos, no se enseña
> · **págs. 175–177** — características físicas de las regiones de Chile, base del paisaje regional
> · **págs. 178–179** — población de las regiones: el componente humano del paisaje
> · **págs. 182–183** — los recursos significativos de cada región y el trabajo humano que les da valor (actividades económicas)
> 
> El tramo 160-167 es donde el libro ENSEÑA las zonas naturales, aunque las llama 'ambientes naturales' (desértico, altiplánico, mediterráneo, lluvioso, patagónico, polar, andino, costero) con su ubicación, clima, relieve, vegetación y las oportunidades/dificultades para las personas. La división en…

**Principales hitos y periodos de la historia de la humanidad y de Chile.**
> «En este caso, la [cita del libro: 20 palabras · 91f31d1608446bfe] América.» — pág. 54
> 
> · **págs. 50–51** — los antecedentes coloniales (periodos de Chile anteriores al siglo XIX), solo como repaso de conocimientos previos
> · **págs. 96–97** — síntesis cronológica de los hitos y periodos del siglo XIX chileno: fin de la colonia, independencia de América y de Chile, periodo conservador
> · **págs. 144–145** — síntesis cronológica de los hitos del siglo XX chileno: democratización, quiebre de la democracia, golpe y dictadura, recuperación de la democracia
> 
> Es el único lugar donde el libro presenta explícitamente periodos e hitos: la línea de tiempo de la página 55 ordena 'Historia del mundo occidental: Edad Antigua, Edad Media, Edad Moderna, Edad Contemporánea' con sus hitos (primer registro escrito 3200 a. C., caída del Imperio romano, llegada de…

**Pueblos originarios en Chile: ubicación geográfica, uso y dominio de recursos naturales.**
> «Pueblos indígenas con mayor presencia por región Región [cita del libro: 16 palabras · 4859761a21a5953f] (15,6%), Diaguita (7,9%)» — pág. 180
> 
> · **págs. 92–93** — lo más cercano a la relación con el medio: territorio ancestral, vida trashumante de aymaras y quechuas frente a las fronteras políticas y demandas del pueblo Chango en las costas del norte grande
> 
> La UBICACIÓN GEOGRÁFICA sí está y bien: 180-181 trae el mapa 'Población originaria de Chile por región' y la tabla de los tres pueblos con mayor presencia en cada una de las 16 regiones, con datos del Censo 2017. FALTA el 'uso y dominio de recursos naturales': busqué 'recursos naturales' (solo…

### Lenguaje Y Comunicación 6º

✅ 2 · 🟡 6 · 🔁 0 · ❌ 1

| | Punto a trabajar | Dónde se enseña | Págs. | También en |
|---|---|---|---|---|
| 🟡 | Contenido de textos: distinción entre hechos y opiniones, información relevante y accesoria. | Respetar las diferencias y la igualdad de derechos | 210 | 19, 146–147 |
| ✅ | Estrategias de comprensión lectora y de comprensión oral. | El medioambiente y su protección | 96–99 | — |
| 🟡 | Géneros literarios; poesía, narrativa y textos dramáticos. | El medioambiente y su protección | 102–112 | 19–20, 38, 51–52, 81–82, 86–87, 118, 206–209, 228 |
| 🟡 | Normas ortográficas literal, acentual y puntual. | Unidad 3 · Lección 9 — «Escribir un cuento», cápsula lateral «Herramientas de escritura» sobre el texto modelo «La caja de Luz» | 176 | 134, 172, 179 |
| 🟡 | Registro de habla formal e informal. | El medioambiente y su protección | 99–101 | 54–56, 115, 162 |
| 🟡 | Textos no literarios: informativos, explicativos y argumentativos. | El medioambiente y su protección | 115–118 | 24–33, 89–99, 148–159, 211–222, 223–227, 228 |
| 🟡 | Textos orales cotidianos y sus características: tono, volumen, inflexión, ritmo y gestos. | El medioambiente y su protección | 99–101 | 37, 102, 172 |
| ✅ | Vocabulario: uso de nuevas palabras relacionadas con ámbitos científicos, históricos, sociales y de actualidad; relaciones de sinonimia | El medioambiente y su protección | 94–95 | — |

**Contenido de textos: distinción entre hechos y opiniones, información relevante y accesori**
> «Identificar la [cita del libro: 12 palabras · 84c178e70ac1facc] descripciones complementarias.» — pág. 210
> 
> · **págs. 19** — Distinción entre lo principal y lo accesorio aplicada al relato: acciones principales y secundarias
> · **págs. 146–147** — Jerarquizar la información: tema, idea principal e ideas secundarias en organizadores gráficos (lo relevante frente al detalle)
> 
> La mitad de "información relevante y accesoria" SÍ se enseña: p. 210 (estrategia de resumen, Lección 10) manda subrayar lo relevante y omitir detalles; se refuerza en pp. 146-147 ("¿Cómo organizar la información en esquemas o mapas conceptuales?": tema, idea principal, ideas secundarias,…

**Estrategias de comprensión lectora y de comprensión oral.**
> «Disponte a ver activamente. Evita distracciones, mantén el silencio y la concentración.» — pág. 96
> 
> Es el contenido mejor cubierto del libro. Elegí pp. 96-99 porque en cuatro páginas contiguas conviven las dos mitades: p. 96 "¿Cómo hacer inferencias a partir de información del texto?" (lectora) y p. 99 "Comprender un video sobre el cambio climático y los Pueblos Originarios" con la secuencia…

**Géneros literarios; poesía, narrativa y textos dramáticos.**
> «Identifica versos o estrofas en los que encuentres una figura literaria.» — pág. 102
> 
> · **págs. 19–20** — Narrativa: estructura del relato (situación inicial, desarrollo, desenlace) y acciones principales y secundarias
> · **págs. 38** — Definición del género narrativo: la novela y el cuento
> · **págs. 51–52** — Narrativa: el ambiente y las costumbres en el relato
> · **págs. 81–82** — Narrativa: la actitud del personaje
> · **págs. 86–87** — Lenguaje figurado, base de la lectura de poesía
> · **págs. 118** — Resumen de lo aprendido en poesía: figuras literarias (hipérbole, etc.)
> · **págs. 206–209** — Narrativa: sacar conclusiones y el narrador
> · **págs. 228** — Síntesis: estrategias para analizar textos narrativos
> 
> Poesía: Lección 6, pp. 102-112 (cinco poemas, lectura en voz alta, verso y estrofa, y las cápsulas "¿Cómo interpretar distintas figuras literarias?" en pp. 111-112: aliteración, onomatopeya, personificación, comparación, hipérbole; resumen en p. 118); lenguaje figurado en pp. 86-87. Narrativa:…

**Normas ortográficas literal, acentual y puntual.**
> «Ortografía: en [cita del libro: 16 palabras · 8eb9b418d9b2dbd2] indicar sorpresa.» — pág. 176
> 
> · **págs. 134** — Ortografía puntual dispersa: uso de las comillas
> · **págs. 172** — Ortografía literal dispersa: la mayúscula en sustantivos comunes y su intención
> · **págs. 179** — Se cobra la norma puntual en la lista de cotejo del cuento: pausas, exclamaciones e intervenciones de los personajes
> 
> RESCATADO por el auditor de huecos: el lector lo había dado por ausente y SÍ está. EL HUECO ES FALSO, al menos en su parte «puntual». En la p. 176 hay una cápsula rotulada literalmente «Ortografía:» que enseña dos normas de puntuación (la raya de diálogo para la intervención de los personajes y los…

**Registro de habla formal e informal.**
> «Incorporen un vocabulario variado y lenguaje formal, adecuado a la situación.» — pág. 99
> 
> · **págs. 54–56** — Actividad de reconocimiento sobre el relato de experiencia modelo: identificar si usa lenguaje formal o informal y justificar
> · **págs. 115** — La misma pregunta aplicada al texto modelo del artículo informativo
> · **págs. 162** — Se exige el registro formal en la comparación o contraste oral
> 
> El libro NUNCA define ni contrasta el registro formal frente al informal: solo lo exige y lo pregunta. En pp. 99-101 ("Realizar una exposición oral", Lección 5) se prescribe el registro formal y su adecuación a la situación, y en la lista de cotejo de p. 101 se evalúa "Usamos un vocabulario variado…

**Textos no literarios: informativos, explicativos y argumentativos.**
> «Los textos informativos suelen [cita del libro: 16 palabras · c6ba2a49d289dc70] del tema.» — pág. 115
> 
> · **págs. 24–33** — Lectura y análisis de textos informativos
> · **págs. 89–99** — Lectura y análisis de textos informativos
> · **págs. 148–159** — Textos informativos de divulgación científica e infografía
> · **págs. 211–222** — Lectura de textos no literarios, comparación de información entre dos textos del mismo tema (pp. 221-222) y el debate (p. 221)
> · **págs. 223–227** — El texto argumentativo: situación comunicativa y estructura tesis-argumentos-conclusión
> · **págs. 228** — Síntesis del debate y de la escritura del texto argumentativo
> 
> Informativo: se enseña a fondo en pp. 115-118 ("Escribir un artículo informativo", Lección 6: situación comunicativa, estructura introducción-desarrollo-conclusión, recursos visuales); se leen y analizan textos informativos en pp. 24-33 (Lección 2), 89-99 (Lección 5), 148-159 (Lección 8,…

**Textos orales cotidianos y sus características: tono, volumen, inflexión, ritmo y gestos.**
> «Usamos volumen, [cita del libro: 12 palabras · 3390ff303ec653a1] innecesarios.» — pág. 99
> 
> · **págs. 37** — Tono y ritmo de la voz como recurso expresivo, junto con el turno de habla
> · **págs. 102** — Leer poemas en voz alta: pronunciación, respeto de los signos de puntuación, énfasis y velocidad
> · **págs. 172** — La escucha activa: acciones del que escucha
> 
> En pp. 100-101 ("Realizar una exposición oral", Lección 5) se enseñan volumen, articulación, entonación, postura corporal y gestos ("Procuren que sus gestos acompañen sus palabras y no distraigan a la audiencia", "Utilicen un volumen apropiado... No hablen muy rápido y articulen bien las…

**Vocabulario: uso de nuevas palabras relacionadas con ámbitos científicos, históricos, soci**
> «Para inferir [cita del libro: 33 palabras · 3991d525ae655048] diccionario.» — pág. 94
> 
> El tramo exacto de la sinonimia es pp. 94-95 (cápsula de estrategia + actividad "Palabras nuevas" con elección de sinónimos sobre un texto ambiental: "amenazan", "mitigar"). La sinonimia y antonimia se retoman en p. 142 ("apoyarte del diccionario, en especial de sinónimos y antónimos"). El trabajo…

**❌ No están en este libro**

- **Normas gramaticales básicas: conjugaciones de verbos.**
  HUECO CONFIRMADO por un segundo lector. Términos probados: verbo, verbos (con límite de palabra), verbal, conjug, conjugar, conjugación, tiempo verbal, tiempos verbales, modo verbal, presente, pasado, pretérito, pretérito imperfecto, infinitivo, gerundio, participio, imperativo, subjuntivo, indicativo, desinencia, persona gramatical, primera persona, segunda persona, tercera persona, pronombre,…

### Matemática 6º

✅ 2 · 🟡 3 · 🔁 0 · ❌ 0

| | Punto a trabajar | Dónde se enseña | Págs. | También en |
|---|---|---|---|---|
| ✅ | Adición, sustracción, multiplicación, división y combinaciones de ellas. | Operatoria con números naturales | 18–20 | — |
| 🟡 | Fracciones, decimales y transformación de unidades de medidas. | Números y operaciones | 37–66 | — |
| 🟡 | Medidas de tendencia central (mediana, media, moda). | Glosario (Matemática 6º — texto del estudiante); y Capítulo 14: Datos (Sumo Primero 6º — texto del estudiante, tomo 2) | 307–310 | — |
| 🟡 | Rotaciones, reflexiones y traslaciones de figuras 2D, medida de ángulos, perímetro y área. | Transformaciones isométricas | 187–190 | 146–149, 149–152 |
| ✅ | Sucesiones numéricas con patrones de crecimiento aditivo. | Patrones en tablas | 94–96 | — |

**Adición, sustracción, multiplicación, división y combinaciones de ellas.**
> «Para resolver ejercicios con operatoria combinada, debes considerar la prioridad de las operaciones:» — pág. 18
> 
> El 'Aprendo' con la prioridad de las operaciones está en la pág. 19 (paréntesis, luego multiplicación/división, luego adición/sustracción), con Exploro en 18 y Practico en 19-20; el índice da la lección como 17-20. Las cuatro operaciones también se trabajan aplicadas: con fracciones y números…

**Fracciones, decimales y transformación de unidades de medidas.**
> «Para [cita del libro: 16 palabras · b9e9120fb24a08f6] resuelve.» — pág. 37
> 
> Falta la transformación de unidades de medida: NO está en 'Matemática 6º — texto del estudiante' (busqué 'unidades de medida', 'transformar/transformación unidad', 'convertir/conversión', '1 m = / 100 cm', 'expresar en metros': cero resultados). Sí está en el OTRO libro del nivel, 'Sumo Primero 6º…

**Medidas de tendencia central (mediana, media, moda).**
> «Promedio: cociente entre la suma de un grupo de valores y la cantidad de sumandos.» — pág. 307
> 
> RESCATADO por el auditor de huecos: el lector lo había dado por ausente y SÍ está. ‖ Hueco PARCIAL: el lector se equivocó en la parte de la MEDIA. Su razón textual —'Promedio aparece únicamente como conocimiento previo... sin enseñar cómo se calcula ni definirlo'— es falsa: el Glosario del texto…

**Rotaciones, reflexiones y traslaciones de figuras 2D, medida de ángulos, perímetro y área.**
> «Las transformaciones [cita del libro: 16 palabras · 4f1acd3da05c3a4c] ni su tamaño.» — pág. 187
> 
> · **págs. 146–149** — medida de ángulos: qué es un ángulo y cómo medirlo con el transportador
> · **págs. 149–152** — medida de ángulos: construir un ángulo dada su medida, con regla, compás y transportador
> 
> AVISO: el índice registra esta lección en 183-184, pero leyendo el libro el 'Aprendo' está en 187-188 y el 'Practico' (trasladar, rotar con centro I, dibujar la figura imagen según el eje de reflexión L) en 188-190; el índice está corrido ~4 páginas en este tramo (igual pasa con 'Teselaciones', que…

**Sucesiones numéricas con patrones de crecimiento aditivo.**
> «Un patrón es sumar 9 o, simbólicamente, + 9.» — pág. 94
> 
> Objetivo declarado: 'Identificar el patrón de formación que relaciona los valores de una tabla'. Crecimiento aditivo explícito en el Practico: 'El [cita del libro: 12 palabras · d3d8605f334d4b8d] 6'. Se continúa en 'Cálculo de términos en tablas' 97-100, donde se pasa al término…

---

## Nivel 3 Educación Básica

**Cursos:** 7º y 8º Básico

### Ciencias Naturales 7º

✅ 3 · 🟡 3 · 🔁 0 · ❌ 4

| | Punto a trabajar | Dónde se enseña | Págs. | También en |
|---|---|---|---|---|
| ✅ | Aspectos biológicos, afectivos y sociales en la sexualidad. Paternidad y maternidad responsable. Control de natalidad. ITS, mecanismos de transmisión y medidas de prevención. | Lección 8: Sexualidad y autocuidado | 118–139 | — |
| ✅ | Características de microorganismos y virus, sus efectos en el ambiente y la salud, considerando medidas de autocuidado. | ¿amigos o enemigos? | 90–98 | — |
| 🟡 | Circuito eléctrico, fuerzas y tipos de fuerzas, fuerza eléctrica y energía eléctrica. Medidas de seguridad y buen uso energético. | Lección 3: Las fuerzas en nuestro entorno | 44–52 | — |
| 🟡 | El átomo, estructura e historia de los modelos atómicos. Sustancias puras, elementos y compuestos químicos. | Lección 1: Sustancias puras y mezclas | 13–14 | — |
| ✅ | Modelo de la tectónica de placas y su impacto en la naturaleza | Lección 4: Movimiento de la Tierra | 56–64 | — |
| 🟡 | Teoría celular. Estructura celular básica (procariontes y eucariontes), reproducción (sexual y asexual), transporte a nivel celular y mecanismos de interacción entre la célula y el entorno (difusión y osmosis). | ¿amigos o enemigos? | 86–87 | 90–91 |

**Aspectos biológicos, afectivos y sociales en la sexualidad. Paternidad y maternidad respon**
> «Ser padre [cita del libro: 24 palabras · dc494c294a956c04] de vida.» — pág. 118
> 
> Único conocimiento que el libro cubre entero. Reparto: dimensiones de la sexualidad (física, emocional, social, intelectual, espiritual) pp. 118-119 y 123-124; estereotipos y género pp. 122-123; ciclo menstrual, gametos y fecundación pp. 124-133; paternidad/maternidad responsable y derechos…

**Características de microorganismos y virus, sus efectos en el ambiente y la salud, conside**
> «hoy sabemos [cita del libro: 16 palabras · c36a14b12e4cb217] simple vista» — pág. 90
> 
> El buscador acertó esta vez. Reparto: fichas de características de bacterias (tipo de célula, hábitat, nutrición, reproducción, formas: cocos, bacilos, espiroquetas) p. 90 y de hongos microscópicos p. 91; virus pp. 94-95 (por qué no son células, cápside, ciclo de replicación en cinco fases);…

**Circuito eléctrico, fuerzas y tipos de fuerzas, fuerza eléctrica y energía eléctrica. Medi**
> «La fuerza de roce [cita del libro: 24 palabras · 2d541b37ff9d32ab] al deslizamiento o movimiento.» — pág. 44
> 
> Solo el bloque de fuerzas mecánicas. Sí está: '¿Qué es la fuerza?' p. 44, representación con vectores (módulo, dirección, sentido, punto de aplicación) pp. 45-46, efectos de las fuerzas y suma de fuerzas pp. 46-47, y '¿Qué tipos de fuerzas podemos encontrar cotidianamente?' pp. 48-52 (peso y…

**El átomo, estructura e historia de los modelos atómicos. Sustancias puras, elementos y com**
> «Las sustancias [cita del libro: 20 palabras · 719f80086a964432] compuestos.» — pág. 13
> 
> Está la segunda mitad, no la primera. Sí está, y bien acotado: 'Sustancias puras' y 'Elementos químicos o sustancias puras simples' en p. 13, y 'Compuestos químicos' en p. 14 (con el ejemplo del carbonato de litio, Li2CO3, formado por átomos de litio, carbono y oxígeno). FALTA por completo el átomo…

**Modelo de la tectónica de placas y su impacto en la naturaleza**
> «La [cita del libro: 28 palabras · 40bbcf8e2a4d40f7] islas» — pág. 56
> 
> El buscador acertó. Acoté el tramo: la lección abre en la p. 53 con la entrada motivacional (alfarería diaguita, historia de terremotos en Chile pp. 54-55); la enseñanza empieza en la p. 56 con 'Teoría de la tectónica de placas' y el mapa de placas (Nazca, Sudamericana, Antártica...). Reparto:…

**Teoría celular. Estructura celular básica (procariontes y eucariontes), reproducción (sexu**
> «Ante este [cita del libro: 12 palabras · 5254e0eee7d1f511] de los seres vivos.» — pág. 86
> 
> · **págs. 90–91** — Reproducción asexual, solo como ficha de microorganismos: bipartición en bacterias (p. 90) y gemación y esporas en hongos (p. 91)
> 
> Solo la primera mitad del conocimiento. Sí está: teoría celular con su historia (Hooke, Leeuwenhoek, Schleiden, Schwann) en p. 86, y estructura celular básica procarionte/eucarionte en p. 87 ('Según [cita del libro: 12 palabras · 3584e09f28770dd6] comunidad científica en…

**❌ No están en este libro**

- **Biodiversidad en Chile y su preservación.**
  HUECO CONFIRMADO por un segundo lector. Términos probados: biodiversidad, endémic, nativ, especies nativas, extinción, extinguir, amenazad, conservación, preservación, área protegida, parque nacional, reserva, santuario, monumento natural, CONAF, SNASPE, reino, taxonom, clasificación de los seres vivos, especie, flora y fauna, hábitat, ecosistema, humedal, bosque, alerce, huemul, puma, cóndor,…
- **Interacción entre los sistemas del cuerpo humano: digestivo, circulatorio, respiratorio, excretor. Nutrición, nutrientes y salud.**
  HUECO CONFIRMADO por un segundo lector. Términos probados: digesti, sistema digestivo, sistema circulatorio, sistema respiratorio, sistema excretor, estómag, intestin, esófago, hígado, páncreas, corazón, sangre, sanguíne, arteria, vena, pulmon, pulmón, respiratori, riñón, riñones, orina, urinar, excre, vejiga, alvéol, circulator, torrente, nutrient, nutrición, aliment, órgano, tejido, 'sistema…
- **Sistema periódico de clasificación de los elementos y elementos constituyentes de la Tierra y los seres vivos (carbono, hidrógeno, oxígeno y nitrógeno).**
  HUECO CONFIRMADO por un segundo lector. Términos probados: periódic, periodic, tabla periódica, sistema periódico, elemento químic, elementos químic, número atómico, masa atómica, símbolo químico, símbolo, gas noble, gases nobles, Mendel, Dmitri, halógen, alcalino, metaloide, no metal, semimetal, grupo químic, familia, período, protón, electrón, neutrón, orbital, configuración electr, tabla,…
- **Sistema solar y estructuras cósmicas.**
  HUECO CONFIRMADO por un segundo lector. Términos probados: sistema solar, planeta, galax, Vía Láctea, estrella, universo, cósmic, astron, astronóm, órbita, satélite, nebulosa, Big Bang, cuerpo celeste, cuerpos celestes, asteroid, cometa, Luna, Sol, solar, Mercurio, Venus, Marte, Júpiter, Saturno, espacio exterior, eclipse, telescopio, rotación, traslación ‖ Hueco confirmado. Revisé además el…

### Ciencias Naturales 8º

✅ 1 · 🟡 4 · 🔁 0 · ❌ 5

| | Punto a trabajar | Dónde se enseña | Págs. | También en |
|---|---|---|---|---|
| 🟡 | Circuito eléctrico, fuerzas y tipos de fuerzas, fuerza eléctrica y energía eléctrica. Medidas de seguridad y buen uso energético. | LA ENERGÍA EN NUESTRO PLANETA | 90–103 | — |
| 🟡 | El átomo, estructura e historia de los modelos atómicos. Sustancias puras, elementos y compuestos químicos. | LA MATERIA MÁS ALLÁ DE LO VISIBLE | 124–139 | 140, 152–153 |
| ✅ | Interacción entre los sistemas del cuerpo humano: digestivo, circulatorio, respiratorio, excretor. Nutrición, nutrientes y salud. | NUTRICIÓN Y SALUD | 13–29 | — |
| 🟡 | Sistema periódico de clasificación de los elementos y elementos constituyentes de la Tierra y los seres vivos (carbono, hidrógeno, oxígeno y nitrógeno). | LA MATERIA MÁS ALLÁ DE LO VISIBLE | 144–152 | — |
| 🟡 | Teoría celular. Estructura celular básica (procariontes y eucariontes), reproducción (sexual y asexual), transporte a nivel celular y mecanismos de interacción entre la célula y el entorno (difusión y osmosis). | CÉLULA: UNIDAD DE VIDA | 56–62 | 20–21, 55, 70–71, 76–77 |

**Circuito eléctrico, fuerzas y tipos de fuerzas, fuerza eléctrica y energía eléctrica. Medi**
> «El [cita del libro: 16 palabras · 7e80229d60e79421] eléctricas.» — pág. 90
> 
> Lección 5 'La corriente eléctrica'. Cubierto: corriente eléctrica, conductores y aislantes p.90; qué es un circuito, sus componentes y el diagrama p.91-92; intensidad de corriente, voltaje, resistencia y amperímetro p.92-93; pila de Volta p.94; circuitos en serie y en paralelo p.95-97; actividad…

**El átomo, estructura e historia de los modelos atómicos. Sustancias puras, elementos y com**
> «Los principales [cita del libro: 20 palabras · 24883f5f8938df58] al núcleo» — pág. 124
> 
> · **págs. 140** — estructura del átomo: los isótopos (mismo número de protones, distinta cantidad de neutrones)
> · **págs. 152–153** — compuestos químicos: compuestos iónicos y covalentes y sus propiedades (única presentación de 'compuesto' fuera del postulado de Dalton)
> 
> La historia y la estructura del átomo están completas y muy bien tratadas en la Lección 7 'La composición de la materia': Leucipo y Demócrito y los cuatro elementos de Empédocles p.124-126, Dalton p.127-129, naturaleza eléctrica de la materia y tubo de Crookes p.129-130, Thomson ('budín de pasas')…

**Interacción entre los sistemas del cuerpo humano: digestivo, circulatorio, respiratorio, e**
> «Los sistemas digestivo, respiratorio, [cita del libro: 16 palabras · 7b467769827c9133] la molécula energética.» — pág. 13
> 
> Es el corazón de la Unidad 1, Lección 1 'Nuestro cuerpo, un todo organizado'. Desglose exacto: sistema digestivo p.13-17 (digestión mecánica y química, enzimas, intestino delgado y grueso); sistema respiratorio p.18-21 (vías, mecánica ventilatoria, intercambio gaseoso alveolar); sistema…

**Sistema periódico de clasificación de los elementos y elementos constituyentes de la Tierr**
> «La [cita del libro: 20 palabras · 8cecb42a434f9539] sus propiedades.» — pág. 144
> 
> El sistema periódico está cubierto entero en la Lección 8 'Organización de la materia': historia del ordenamiento con las tríadas de Döbereiner, las octavas de Newlands, Mendeleiev y Moseley en p.144-147; regiones de la tabla (metales, no metales, metaloides) en p.148-149; propiedades periódicas…

**Teoría celular. Estructura celular básica (procariontes y eucariontes), reproducción (sexu**
> «La célula es la [cita del libro: 24 palabras · 6413f657c66e1b56] estas.» — pág. 56
> 
> · **págs. 20–21** — la difusión, pero solo como intercambio gaseoso alveolar
> · **págs. 55** — inicio de la historia de la teoría celular (Leeuwenhoek y las primeras observaciones), antes de los postulados
> · **págs. 70–71** — transporte a nivel celular, pero solo como transporte vesicular / vía secretora
> · **págs. 76–77** — la osmosis como mecanismo de interacción de la célula con el entorno, en la absorción de agua y sales por la raíz
> 
> Sí está y bien enseñado: los postulados de la teoría celular (Hooke, Schleiden, Schwann, Virchow) en p.55-57, las células procariontes en p.57, las eucariontes animal y vegetal con todos sus organelos en p.58-61, y la teoría endosimbiótica en p.61-62. FALTA la reproducción celular: busqué…

**❌ No están en este libro**

- **Aspectos biológicos, afectivos y sociales en la sexualidad. Paternidad y maternidad responsable. Control de natalidad. ITS, mecanismos de transmisión y medidas de prevención.**
  HUECO CONFIRMADO por un segundo lector. Términos probados: sexualidad, sexual, sexo, espermatozoi, óvulo, ovocito, ovari, testícul, útero, uterin, gestaci, embarazo, placenta, paternidad, maternidad, fecundaci, menstrua, pubertad, adolescen, anticoncep, natalidad, preservativo, condón, VIH, sida, gonorrea, sífilis, clamidia, herpes, infección de transmisión, transmisión sexual, aparato…
- **Biodiversidad en Chile y su preservación.**
  HUECO CONFIRMADO por un segundo lector. Términos probados: biodivers, diversidad biológica, diversidad de especies, endémic, endemic, nativa, nativo, autóctona, extinción, extinguir, en peligro, conservación, preservación, preservar, ecosistem, hábitat, nicho, bioma, especie, trófic, cadena alimentaria, red alimentaria, productores y consumidores, herbívoro, carnívoro, depredador, parque…
- **Características de microorganismos y virus, sus efectos en el ambiente y la salud, considerando medidas de autocuidado.**
  HUECO CONFIRMADO por un segundo lector. Términos probados: virus, viral, virale, microorganismo, bacteri, hongo, hongos, levadur, micorriza, simbió, protozoo, protista, ameba, paramecio, patógen, infecci, contagio, contagia, vacuna, antibiótic, antimicrobian, higiene, autocuidado, pandemia, COVID, epidemi, enfermedad infecciosa, transmisible, cólera, Vibrio, sistema inmune, anticuerpo, defensa…
- **Modelo de la tectónica de placas y su impacto en la naturaleza**
  HUECO CONFIRMADO por un segundo lector. Términos probados: tectón, tecton, placa, litosfer, astenosfer, manto terrestre, corteza, sismo, sísmi, terremoto, volcá, volcan, magma, lava, epicentro, hipocentro, falla geológica, deriva contin, Wegener, Pangea, subducc, dorsal, geolog, Nazca, Sudamerican, temblor, maremoto, tsunami, erupci, cordillera, Andes, geoterm, calor interno, interior de la…
- **Sistema solar y estructuras cósmicas.**
  HUECO CONFIRMADO por un segundo lector. Términos probados: sistema solar, galax, astronom, astro, cósmic, cosmic, universo, Vía Láctea, telescopio, satélite, Luna, lunar, Marte, Júpiter, Saturno, Venus, Mercurio, Neptuno, Urano, cometa, asteroide, nebulosa, Big Bang, agujero negro, eclipse, constelaci, \y(estrella|estrellas|planetas|planeta|órbita)\y, sol, solar, espacio exterior, atmósfera,…

### Historia Geografía Y Ciencias Sociales 7º

✅ 3 · 🟡 1 · 🔁 0 · ❌ 1

| | Punto a trabajar | Dónde se enseña | Págs. | También en |
|---|---|---|---|---|
| 🟡 | Complejización de las primeras sociedades, su dispersión por el planeta y la interacción del ser humano con el medio. | Las sociedades del Paleolítico / La revolución neolítica | 16–21 | 28–29 |
| ✅ | Formación y consolidación de la cultura occidental durante la Edad Media (por ejemplo: confluencia del mundo clásico, judeocristiano y germano; fragmentación territorial y ruralización; cristianismo y conformación del poder político). | ¿Cómo se articularon las distintas tradiciones que confluyeron en la Europa medieval? / Fragmentación de la unidad imperial y tradiciones que confluyeron en Europa | 92–105 | — |
| ✅ | Formas de organización política en la Antigüedad clásica y sus proyecciones en la cultura occidental y latinoamericana, considerando ejemplos del pasado y del presente de Chile. | Politología y formas de gobierno / Formas de gobierno predominantes en el mundo griego | 52–55 | — |
| ✅ | Surgimiento de las primeras civilizaciones, incluyendo un ejemplo de América (procesos característicos, por ejemplo: centralización político-administrativa, urbanización, unidad religiosa, estratificación social, etcétera.). | ¿Qué es lo propio de las civilizaciones? | 30–43 | — |

**Complejización de las primeras sociedades, su dispersión por el planeta y la interacción d**
> «en la [cita del libro: 16 palabras · 3d489c156fd417de] y grupos» — pág. 16
> 
> · **págs. 28–29** — interacción del ser humano con el medio: el impacto de la agricultura proyectado al presente (biodiversidad, especies domesticadas)
> 
> La complejización (Paleolítico igualitario y nómade → aldea neolítica sedentaria y jerarquizada) y la interacción con el medio están muy bien tratadas: p. 16 "Las sociedades paleolíticas dependían de su entorno... lograron modificarlos al adaptarse y explotar sus recursos"; fuentes de Kolbert y…

**Formación y consolidación de la cultura occidental durante la Edad Media (por ejemplo: con**
> «Este fue el escenario [cita del libro: 16 palabras · b7c547c22f534a9f] judeocristiana y la germana.» — pág. 92
> 
> Los tres ejemplos del currículum están, cada uno con su tramo: CONFLUENCIA de tradiciones en 92-95 (la grecorromana "mediante aspectos como el arte, la lengua y la escritura", la germana con su sistema de gobierno y relaciones de reciprocidad, la judeocristiana) y se agregan el mundo bizantino y el…

**Formas de organización política en la Antigüedad clásica y sus proyecciones en la cultura **
> «Uno de los aportes [cita del libro: 24 palabras · a338df503a7f98b3] entre otras.» — pág. 52
> 
> Tramo principal: 52-55 enseña el aparato conceptual (política, forma de gobierno, la fuente de Polibio) y las formas concretas del mundo griego (monarquías, gobiernos aristocráticos, tiranías, oligarquía militar de Esparta). El resto de la Unidad 2 completa el conocimiento: democracia ateniense…

**Surgimiento de las primeras civilizaciones, incluyendo un ejemplo de América (procesos car**
> «compartieron ciertos [cita del libro: 16 palabras · 8f518a94e16c7b9d] registro» — pág. 30
> 
> Es la Lección 2 completa de la Unidad 1 y cubre uno por uno los procesos del currículum: urbanización en "La ciudad, centro de la civilización" (36-37); centralización político-administrativa y estratificación social en "Organización social y política de las civilizaciones" (38-39: "las primeras…

**❌ No están en este libro**

- **Transformaciones durante la Época Moderna (por ejemplo, encuentro de dos mundos, surgimiento del Estado moderno, difusión del conocimiento, fin de la unidad religiosa).**
  HUECO CONFIRMADO por un segundo lector. Términos probados: Edad Moderna, Época Moderna, Modernidad, moderna, moderno, Estado moderno, Estado-nación, monarquía nacional, absolutismo, absolut, Rey Sol, ejército permanente, mercantilismo, burocracia real, Reforma, Reforma protestante, protestante, Lutero, calvin, anglican, 95 tesis, indulgencia, Contrarreforma, Trento, Inquisición, herejía, cisma,…

### Historia Geografía Y Ciencias Sociales 8º

✅ 1 · 🟡 3 · 🔁 0 · ❌ 1

| | Punto a trabajar | Dónde se enseña | Págs. | También en |
|---|---|---|---|---|
| 🟡 | Complejización de las primeras sociedades, su dispersión por el planeta y la interacción del ser humano con el medio. | Geografía y conceptos geográficos | 138–139 | 148–149 |
| 🟡 | Formación y consolidación de la cultura occidental durante la Edad Media (por ejemplo: confluencia del mundo clásico, judeocristiano y germano; fragmentación territorial y ruralización; cristianismo y conformación del poder político). | La centralización del poder | 34–35 | 22, 40 |
| 🟡 | Formas de organización política en la Antigüedad clásica y sus proyecciones en la cultura occidental y latinoamericana, considerando ejemplos del pasado y del presente de Chile. | Un modelo republicano | 124–125 | 100–101, 110–113 |
| ✅ | Transformaciones durante la Época Moderna (por ejemplo, encuentro de dos mundos, surgimiento del Estado moderno, difusión del conocimiento, fin de la unidad religiosa). | Lección 1 Bases de la Edad Moderna | 10–55 | — |

**Complejización de las primeras sociedades, su dispersión por el planeta y la interacción d**
> «El [cita del libro: 20 palabras · f7a9f1f891ced4cd] humano y su medio.» — pág. 138
> 
> · **págs. 148–149** — Aplicación de la interacción del ser humano con el medio: cómo el Tahuantinsuyo, el Meli Witxan Mapu mapuche, los pisos ecológicos aymara y las dos regiones kawésqar organizan el territorio según el medio
> 
> Solo se cubre la tercera parte del conocimiento: la interacción ser humano-medio, y como concepto geográfico (espacio geográfico, paisaje, territorio, lugar), no como proceso histórico. Se aplica bien en "Regiones y pueblos originarios" (pp. 148-149), donde se enseña cómo el Tahuantinsuyo, el Meli…

**Formación y consolidación de la cultura occidental durante la Edad Media (por ejemplo: con**
> «Entre los [cita del libro: 24 palabras · 885597d5d2037eab] de su monarca.» — pág. 34
> 
> · **págs. 22** — La producción manuscrita del mundo medieval (los libros antes de la imprenta), como complemento de la cultura medieval
> · **págs. 40** — El vasallaje medieval, como complemento de la conformación del poder político
> 
> Estas dos páginas sí enseñan dos de los tres ejes del conocimiento, aunque como antecedente del Estado moderno y no como unidad propia: (a) fragmentación territorial y ruralización — "Los feudos eran esencialmente [cita del libro: 12 palabras · b37e82bd019ff8d5] a la tierra…

**Formas de organización política en la Antigüedad clásica y sus proyecciones en la cultura **
> «consagrarían [cita del libro: 25 palabras · fc071ef671b1f094] conjunto de derechos» — pág. 124
> 
> · **págs. 100–101** — Proyección republicana en Chile: los poderes del Estado (con Locke y Montesquieu) y el proceso constitucional chileno de 2019-2022
> · **págs. 110–113** — Proyección republicana: la ampliación de derechos, desde la Declaración de los Derechos del Hombre y del Ciudadano hasta la Declaración Universal de Derechos Humanos y los derechos de las mujeres en la actualidad
> 
> Se enseña solo la segunda mitad: las proyecciones republicanas en Chile y América Latina (pp. 124-125, con los artículos 1, 6 y 12 de la Constitución chilena de 1822 como fuente), más los poderes del Estado y el proceso constitucional chileno de 2019-2022 en pp. 100-101, y la ampliación de derechos…

**Transformaciones durante la Época Moderna (por ejemplo, encuentro de dos mundos, surgimien**
> «Entre los siglos XIV y XVI, la sociedad europea experimentó cambios en diversos ámbitos.» — pág. 10
> 
> Es el conocimiento que el libro enseña de punta a punta: la Unidad 1 completa está dedicada a él. Los cuatro ejemplos del currículum tienen su tramo propio: fin de la unidad religiosa en pp. 20-21 ("La ruptura de la unidad religiosa", Reforma protestante y quiebre del catolicismo); difusión del…

**❌ No están en este libro**

- **Surgimiento de las primeras civilizaciones, incluyendo un ejemplo de América (procesos característicos, por ejemplo: centralización político-administrativa, urbanización, unidad religiosa, estratificación social, etcétera.).**
  HUECO CONFIRMADO por un segundo lector. Términos probados: civilizaci, primeras civilizaci, civilizaciones americanas, surgimiento de.{0,40}civiliza, origen de.{0,40}civiliza, Mesopotam, Egipto, egipci, Sumer, cuneiforme, jerogl, Nilo, faraón, Babilon, Fenici, Creciente Fértil, neolít, azteca, mexica, maya, inca, inka, quechua, Tenochtitl, Tahuantinsuyo, Cusco, Cuzco, Machu, Andes, andin,…

### Lengua Y Literatura 7º

✅ 3 · 🟡 5 · 🔁 0 · ❌ 1

| | Punto a trabajar | Dónde se enseña | Págs. | También en |
|---|---|---|---|---|
| ✅ | Coherencia y cohesión del texto. | Trabajo con el texto | 40–41 | — |
| 🟡 | Contexto de producción y recepción de las obras literarias. | Lección 1. Con el océano y sus habitantes | 104–105 | 122–123, 131 |
| ✅ | Estereotipos y prejuicios en los medios de comunicación. | Lección 3. Mentiras y verdades | 170 | — |
| 🟡 | Estrategias de comprensión lectora y de comprensión oral. | Defino mi estrategia | 21 | 19–20, 50–51, 61, 94–95, 107, 141, 159, 170–171 |
| 🟡 | Gramática: sustantivos, adjetivos, adverbios y pronombres; preposiciones y conjunciones, y conjugaciones verbales. | Lección 2. En nuevos territorios | 129–130 | 38, 40, 84, 114, 172 |
| ✅ | Imágenes, gráficos, tablas, mapas o diagramas. | Lección 2. En nuevos territorios | 128 | — |
| 🟡 | Textos literarios: narrativa, poesía, obras dramáticas. | Lección 1. Tener un amigo | 18–19 | 26, 68–69, 85, 114–115, 116–123, 150–151, 152–157 |
| 🟡 | Vocabulario: sinónimos, hipónimos, hiperónimos locuciones y comparaciones. | Lección 2. En nuevos territorios | 129–130 | 21, 51, 107, 131, 141, 159 |

**Coherencia y cohesión del texto.**
> «Cuando [cita del libro: 20 palabras · 82d447e566f58822] tratado.» — pág. 40
> 
> La candidata 'Sistematizo lo aprendido' (84-93, score 0.99) apuntaba a la síntesis de la Unidad 2, no al lugar donde se enseña. El tramo exacto es el 'Ojo con el lenguaje' de la Unidad 1: p. 40 enseña coherencia temática (con los cinco párrafos del reportaje como ejemplo) y concordancia…

**Contexto de producción y recepción de las obras literarias.**
> «El [cita del libro: 16 palabras · 0b6622922ad7effe] como contexto de producción.» — pág. 104
> 
> · **págs. 122–123** — Lo más cercano al contexto de recepción: cómo cada época representa el paisaje
> · **págs. 131** — Síntesis del contexto de producción: momento histórico y visión de mundo
> 
> La candidata de 0.998 acertó esta vez. El recuadro 'Trabajo con el texto: Contexto de producción y visión de mundo' (p. 104) distingue contexto biográfico y contexto histórico y añade la 'visión de mundo'; se sintetiza en p. 131 ('La obra literaria se relaciona con un contexto. Este implica el…

**Estereotipos y prejuicios en los medios de comunicación.**
> «Los estereotipos corresponden [cita del libro: 12 palabras · d975cc249e3a7e91] ciertas características en común.» — pág. 170
> 
> El recuadro se titula 'Trabajo con el texto: Estereotipos y prejuicios en la publicidad' y clasifica los estereotipos en etario, étnico, de género y económico; define prejuicio como 'opiniones previas [cita del libro: 12 palabras · 967c01a22f15eb90] conoce bien'. Se apoya en la…

**Estrategias de comprensión lectora y de comprensión oral.**
> «Para reconocer [cita del libro: 12 palabras · fb0fafca53430dc3] a continuación» — pág. 21
> 
> · **págs. 19–20** — Lo más cercano a la comprensión oral: pautas para participar en una conversación (mantener el foco, respetar los turnos de habla)
> · **págs. 50–51** — Comprensión lectora: elaborar un resumen (reconocer el tema, la idea principal de cada párrafo, subrayar, omitir detalles)
> · **págs. 61** — Comprensión lectora: enfrentar la dificultad de un poema (lenguaje literal vs. figurado)
> · **págs. 94–95** — Comprensión lectora: recontar lo leído
> · **págs. 107** — Comprensión lectora: formular preguntas durante la lectura
> · **págs. 141** — Comprensión lectora: leer con un propósito (preguntas antes y después de leer)
> · **págs. 159** — Comprensión lectora: formular inferencias
> · **págs. 170–171** — Lo más cercano a la comprensión oral: escuchar y analizar los argumentos en un debate
> 
> La comprensión LECTORA está muy bien cubierta: el libro trae siete recuadros 'Defino mi estrategia', uno por lección de lectura, cada uno con una estrategia distinta — p. 21 caracterizar personajes (lo que se dice de él, lo que dice, lo que hace); pp. 50-51 elaborar un resumen (tema, idea principal…

**Gramática: sustantivos, adjetivos, adverbios y pronombres; preposiciones y conjunciones, y**
> «Pronombres: [cita del libro: 12 palabras · 53adaa7c1a4cf661] en el texto.» — pág. 129
> 
> · **págs. 38** — Adjetivos y adverbios como marcas de valoración
> · **págs. 40** — Conjugación verbal: concordancia de número y persona entre sujeto y verbo
> · **págs. 84** — Conjunciones, solo de forma funcional como conectores causales y adversativos
> · **págs. 114** — Conjugación verbal: los verbos en pretérito marcan el salto al pasado
> · **págs. 172** — Adjetivos y adverbios: modalizadores valorativos y adverbios cuantificadores
> 
> No hay ninguna unidad de gramática sistemática; las categorías aparecen dispersas y siempre al servicio de la escritura, en los recuadros 'Ojo con el lenguaje'. PRONOMBRES: pp. 129-130, con personales, demostrativos y relativos. ADJETIVOS y ADVERBIOS: p. 172 (modalizadores: 'Adjetivos y adverbios…

**Imágenes, gráficos, tablas, mapas o diagramas.**
> «Algunos de los [cita del libro: 20 palabras · e5e103145ce3b63e] texto central.» — pág. 128
> 
> El recuadro 'Trabajo con los textos: Análisis e interpretación de elementos gráficos' (p. 128) define imágenes, cápsulas o recuadros de información y gráficos ('Recursos que [cita del libro: 13 palabras · 42dc52479dc8960f] comparar e interpretar'), enseña a…

**Textos literarios: narrativa, poesía, obras dramáticas.**
> «Todo [cita del libro: 20 palabras · 142e9799196a16cd] cambio o transformación» — pág. 18
> 
> · **págs. 26** — Narrativa: personaje principal y secundario, y sus motivaciones
> · **págs. 68–69** — Poesía: el lenguaje poético
> · **págs. 85** — Narrativa: la voz del narrador y las voces de los personajes (forma directa e indirecta)
> · **págs. 114–115** — Narrativa: disposición temporal de los acontecimientos y saltos temporales
> · **págs. 116–123** — Poesía: interpretación de poemas y hablante lírico
> · **págs. 150–151** — Poesía: sílabas, sinalefa, rima consonante y rima libre
> · **págs. 152–157** — Poesía: lira popular y décima
> 
> Falta por completo el género dramático: busqué 'dramático', 'obra dramática', 'teatral', 'dramaturgo', 'acto', 'escena', 'acotación', 'parlamento' y no hay ninguna lección ni recuadro que lo enseñe (solo menciones de paso: 'un resumen de una obra de teatro' en p. 51 y 'Teatro Municipal de La…

**Vocabulario: sinónimos, hipónimos, hiperónimos locuciones y comparaciones.**
> «Hiperónimos: [cita del libro: 16 palabras · e4831acb6389f4c6] específicos llamadas hipónimos.» — pág. 129
> 
> · **págs. 21** — Trabajo léxico complementario: raíces, prefijos y sufijos
> · **págs. 51** — Trabajo léxico complementario: raíces, prefijos y sufijos
> · **págs. 107** — Trabajo léxico complementario: raíces, prefijos y sufijos
> · **págs. 131** — Síntesis de los recursos de correferencia: sinónimos, hiperónimos e hipónimos, pronombres
> · **págs. 141** — Trabajo léxico complementario: raíces, prefijos y sufijos
> · **págs. 159** — Sinónimos y antónimos (a partir de la palabra 'veraz')
> 
> El recuadro 'Ojo con el lenguaje: Recursos de correferencia' (pp. 129-130) enseña los tres primeros: sinónimos ('son palabras con un significado similar'), hiperónimos e hipónimos (con el ejemplo bandurria/ave y ecosistemas/bosques) y pronombres. FALTAN LOCUCIONES: busqué 'locución', 'expresión…

**❌ No están en este libro**

- **Ortografía literal, acentual y puntual**
  HUECO CONFIRMADO por un segundo lector. Términos probados: ortograf, ortogr (sin acento, para atrapar 'ortográfico'), ortográfico, acent, acentua, acentuación, acentuada, tild, tilde, se tilda, lleva tilde, sílaba tónica, vocal tónica, palabras agudas, palabras graves, esdrújula, diptongo, hiato, sílab/silab, puntuac, puntuación, signo, signos de interrogación, signos de exclamación, coma, uso de…

### Lengua Y Literatura 8º

✅ 3 · 🟡 6 · 🔁 0 · ❌ 0

| | Punto a trabajar | Dónde se enseña | Págs. | También en |
|---|---|---|---|---|
| 🟡 | Coherencia y cohesión del texto. | Lección 4. Saberes ancestrales – Ojo con el lenguaje | 127–128 | 41–43, 72, 162 |
| ✅ | Contexto de producción y recepción de las obras literarias. | Lección 3. En distintos lugares y de diversas formas | 29–30 | — |
| ✅ | Estereotipos y prejuicios en los medios de comunicación. | Lección 4. Saberes ancestrales – Trabajo con el texto | 126–127 | — |
| 🟡 | Estrategias de comprensión lectora y de comprensión oral. | Lección 1. Lo que no queremos ver – Defino mi estrategia | 53–54 | 13, 21, 29, 65–66, 95, 139, 155–156 |
| 🟡 | Gramática: sustantivos, adjetivos, adverbios y pronombres; preposiciones y conjunciones, y conjugaciones verbales. | Lección 4. Lo que nos quieren hacer creer – Ojo con el lenguaje | 83–84 | 41–42, 53, 72, 86, 95, 128, 167–168 |
| 🟡 | Imágenes, gráficos, tablas, mapas o diagramas. | Lección 4. Saberes ancestrales | 120–121 | 12–13, 19, 77, 126, 127 |
| 🟡 | Ortografía literal, acentual y puntual | Lección 4. Saberes ancestrales – Ojo con el lenguaje | 128 | 95, 127, 167–168 |
| ✅ | Textos literarios: narrativa, poesía, obras dramáticas. | Lección 3. A donde anhelamos llegar – Trabajo con los textos | 160–161 | — |
| 🟡 | Vocabulario: sinónimos, hipónimos, hiperónimos locuciones y comparaciones. | Lección 4. Lo que nos quieren hacer creer – Amplío mi vocabulario | 78–79 | 13, 38, 41–42, 65, 139 |

**Coherencia y cohesión del texto.**
> «Los ejemplos anteriores son [cita del libro: 12 palabras · fa77631693ce47c0] de un texto.» — pág. 127
> 
> · **págs. 41–43** — cohesión: correferencia (repetición, sustitución léxica, elipsis, pronominalización), con la síntesis en la pág. 43
> · **págs. 72** — coherencia, solo de refilón: la recta temporal del cuento policial
> · **págs. 162** — coherencia, solo de refilón: dentro de la definición de discurso
> 
> Los términos 'coherencia' y 'cohesión' NO aparecen nunca en el libro (busqué 'coherenc' y 'cohesi': 0 resultados); se enseñan los mecanismos, no el nombre. COHESIÓN: conectores de contraste, consecuencia y causa + signos de puntuación como organizadores, págs. 127-128, con la consigna 'Cuando…

**Contexto de producción y recepción de las obras literarias.**
> «podemos [cita del libro: 28 palabras · 91a22c4a438483e0] receptoras.» — pág. 29
> 
> Es el único lugar del libro que nombra los DOS contextos, con un esquema Obra literaria / Contexto de producción / Contexto de recepción y las preguntas '¿Qué ideas predominan en la época?' y '¿Qué valor o significado tienen estas ideas en el presente?'. Se complementa con Lección 1 'En un instante…

**Estereotipos y prejuicios en los medios de comunicación.**
> «Un prejuicio [cita del libro: 28 palabras · 9110ced95224c91b] aceptada por un grupo.» — pág. 126
> 
> El recuadro define los dos conceptos y los aplica a un texto de medios: la pauta de lectura crítica del reportaje incluye '¿Se identifican prejuicios o estereotipos en el texto o en las imágenes?' y cierra con '¿Te parece [cita del libro: 12 palabras · 692a1abd94ef3085] se ofrece…

**Estrategias de comprensión lectora y de comprensión oral.**
> «Detener la [cita del libro: 13 palabras · c99b99a2f85fe90f] la comprensión.» — pág. 53
> 
> · **págs. 13** — estrategia lectora: generar imágenes mentales
> · **págs. 21** — estrategia lectora: mapa de la historia (dónde/cuándo, personajes, acontecimientos, trama, desenlace)
> · **págs. 29** — lo más cercano a lo oral: normas de la conversación (mantener el foco, apoyar con evidencias, escuchar y respetar turnos, preguntar cuando no se entiende)
> · **págs. 65–66** — estrategia lectora: formular hipótesis y hacerse preguntas durante la lectura
> · **págs. 95** — estrategia lectora: inferir el ambiente y el ánimo del personaje a partir de adjetivos y adverbios
> · **págs. 139** — estrategia lectora: registrar información explícita e implícita del narrador
> · **págs. 155–156** — estrategia lectora: la relectura del poema en cuatro pasos (Primera lectura, Relectura, Segunda relectura, Nuevas relecturas)
> 
> Elegí este recuadro porque es el único que organiza la estrategia en ANTES DE LEER / DURANTE LA LECTURA / DESPUÉS DE LA LECTURA y mezcla lo lector con lo oral (lectura dramatizada, escuchar a los demás, 'Explicitar lo que entendieron y concordar cuál es el argumento o trama'). El libro pone un…

**Gramática: sustantivos, adjetivos, adverbios y pronombres; preposiciones y conjunciones, y**
> «Los modos verbales [cita del libro: 16 palabras · bf5ecad77457dbf4] tres modos verbales» — pág. 83
> 
> · **págs. 41–42** — pronombres: pronominalización y pronombres personales
> · **págs. 53** — adjetivos en las acotaciones teatrales
> · **págs. 72** — tiempos verbales como marca temporal del relato
> · **págs. 86** — tiempos verbales como marca temporal del relato
> · **págs. 95** — adjetivos y adverbios, con definición del adverbio
> · **págs. 128** — conjunciones ('pero', 'aunque') y adverbios de enlace ('además')
> · **págs. 167–168** — sustantivo + adjetivo: concordancia de género y número, y participios regulares e irregulares
> 
> FALTAN las preposiciones (busqué 'preposici' en todo el libro: 0 resultados) y el sustantivo como clase de palabra (solo aparece dentro de la concordancia). Lo demás está repartido en los cuatro recuadros 'Ojo con el lenguaje' y en un 'Defino mi estrategia': CONJUGACIONES VERBALES…

**Imágenes, gráficos, tablas, mapas o diagramas.**
> «Leerás un [cita del libro: 12 palabras · 4662977365f475b9] aprender acerca de él» — pág. 120
> 
> · **págs. 12–13** — lectura de imágenes artísticas (pinturas de Tristán e Isolda)
> · **págs. 19** — lectura de imágenes: pintura y meme
> · **págs. 77** — gráficos: representar los datos en gráfico de barras o circular
> · **págs. 126** — interpretar el aporte de las imágenes y los recursos visuales al texto
> · **págs. 127** — incorporar recursos visuales al texto propio
> 
> Acá se enseña a leer el texto junto con lo visual: la pauta indica observar 'Los recursos visuales y su relación con el tema' (pág. 120) y en pág. 121 hay un mapa del territorio Kawésqar que hay que leer. Se continúa en Trabajo con el texto, pág. 126 ('¿Qué información aportan las imágenes?,…

**Ortografía literal, acentual y puntual**
> «Usa [cita del libro: 26 palabras · 6443be731ee40722] pero.» — pág. 128
> 
> · **págs. 95** — ortografía puntual: raya de diálogo en la narración
> · **págs. 127** — ortografía puntual: comillas para citar fuentes
> · **págs. 167–168** — lo más cercano a la ortografía literal: corregir usos inadecuados de palabras, participios irregulares (roto, muerto, abierto, dicho) y consulta al diccionario de la RAE y a Fundéu
> 
> Solo está la ORTOGRAFÍA PUNTUAL, y solo acá: coma, punto y seguido, punto y aparte (pág. 128); comillas para citar fuentes (pág. 127); raya de diálogo en la narración (pág. 95). NO está la ortografía ACENTUAL: busqué 'tilde', 'acentuación', 'acento', 'sílaba tónica', 'aguda', 'grave', 'esdrújula',…

**Textos literarios: narrativa, poesía, obras dramáticas.**
> «El género lírico [cita del libro: 12 palabras · a40f9f2eb8577967] y el dramático).» — pág. 160
> 
> Acá el libro nombra y enmarca los tres géneros, y enseña el lírico (recurrencia, rima, anáfora, aliteración, métrica). Cada género se trabaja además por separado: DRAMÁTICO en Lección 1 'Lo que no queremos ver', págs. 62-63 (comedia, acotaciones, virtualidad teatral) y págs. 53-54; NARRATIVO en…

**Vocabulario: sinónimos, hipónimos, hiperónimos locuciones y comparaciones.**
> «¿qué significa la palabra anecdótico? Observa algunos sinónimos: ocasional puntual sin importancia intrascendente aislado» — pág. 78
> 
> · **págs. 13** — acepciones del diccionario y significado de la palabra por contexto
> · **págs. 38** — familia de palabras: inferir el significado por la raíz
> · **págs. 41–42** — sustitución léxica como recurso de correferencia (hiperonimia en uso, sin nombrarla)
> · **págs. 65** — léxico por campo temático (investigación policial)
> · **págs. 139** — léxico por campo temático (yermo, baldío, erial)
> 
> Solo los SINÓNIMOS están trabajados de forma explícita, y solo acá. Cerca: 'sustitución léxica' como recurso de correferencia (la entrevistada nombrada como 'la cantautora y recopiladora', 'la ganadora', 'la flamante Premio Nacional'), págs. 41-42 — es hiperonimia en uso, pero el libro no la nombra…

### Matemática 7º

✅ 3 · 🟡 3 · 🔁 0 · ❌ 2

| | Punto a trabajar | Dónde se enseña | Págs. | También en |
|---|---|---|---|---|
| 🟡 | Adiciones, sustracciones, multiplicaciones y divisiones de números enteros. | *(el índice del libro no sirvió acá)* | 18–27 | — |
| ✅ | Experimentos aleatorios, frecuencia absoluta, relativa y la probabilidad. | *(el índice del libro no sirvió acá)* | 132–140 | — |
| 🟡 | Expresiones algebraicas, ecuaciones e inecuaciones lineales. | *(el índice del libro no sirvió acá)* | 54–60 | — |
| 🟡 | Funciones lineales y afines. | Unidad 2 · Álgebra y funciones — Lección 5: Relaciones proporcionales (Proporcionalidad directa) | 64–67 | — |
| ✅ | Proporciones directas e indirectas. | *(el índice del libro no sirvió acá)* | 65–72 | — |
| ✅ | Razones y porcentajes. | *(el índice del libro no sirvió acá)* | 42–49 | — |

**Adiciones, sustracciones, multiplicaciones y divisiones de números enteros.**
> «Para sumar números [cita del libro: 20 palabras · e9511dc6fa0eecc3] mayor valor absoluto.» — pág. 18
> 
> Solo se enseñan adición y sustracción en ℤ: adición concreta/recta numérica/algoritmo y propiedades (18-22), sustracción a – b = a + (–b) (22-25) y ejercicios combinados en ℤ (25-27). FALTAN multiplicación y división de enteros: busqué 'multiplicación de números enteros', 'dividir números enteros',…

**Experimentos aleatorios, frecuencia absoluta, relativa y la probabilidad.**
> «En un [cita del libro: 13 palabras · e12b83f9e4657d75] muestral (Ω).» — pág. 132
> 
> Los tres componentes están. Experimentos aleatorios vs. determinísticos, espacio muestral, suceso y eventos equiprobables/no equiprobables en 132-137; cálculo de probabilidad con la regla de Laplace en 137-140 ('P(evento) = casos favorables / casos posibles'). Las frecuencias se enseñan antes, en…

**Expresiones algebraicas, ecuaciones e inecuaciones lineales.**
> «Una [cita del libro: 16 palabras · ec622c75891cf1a4] las operaciones.» — pág. 54
> 
> Cubre solo la primera parte: lenguaje algebraico y representar una variable en función de otra (54-55), definición de expresión algebraica, término, coeficiente numérico y factor literal, clasificación en monomio/binomio/trinomio/polinomio (56-57), valorización (57-58) y reducción de términos…

**Funciones lineales y afines.**
> «La expresión que [cita del libro: 13 palabras · 53a719120705b05b] k > 0.» — pág. 64
> 
> RESCATADO por el auditor de huecos: el lector lo había dado por ausente y SÍ está. El hueco es FALSO en su mitad 'lineal' y VERDADERO en su mitad 'afín'. El libro desarrolla la función lineal completa sin usar la palabra 'función': la nombra 'proporcionalidad directa'. En p. 65 modela con lenguaje…

**Proporciones directas e indirectas.**
> «La expresión que [cita del libro: 13 palabras · 53a719120705b05b] k > 0.» — pág. 65
> 
> Proporcionalidad directa con constante k, tabla y gráfico (semirrecta desde el origen) en 65-68; proporcionalidad inversa (a mayor una, menor la otra; producto constante) y su gráfico en 68-72; aplicaciones y resolución de problemas en 72-74. Antes, en 62-64, están las proporciones y la propiedad…

**Razones y porcentajes.**
> «El porcentaje se [cita del libro: 12 palabras · c87cbbd3901bc156] con cierta característica.» — pág. 42
> 
> Los dos temas están, en unidades distintas. Porcentajes: representación (42-43), cálculo del porcentaje de un número con varias estrategias (44-46), porcentaje que representa una parte del total (47-48) y resolución de problemas (49). Razones: definición como comparación por cociente,…

**❌ No están en este libro**

- **Área y volumen de prismas rectos con diferentes bases y cilindros.**
  HUECO CONFIRMADO por un segundo lector. Términos probados: volum, volumen, prisma, prismas, cilindr, cilindro, cuerpo geométrico, cuerpos geométricos, poliedro, pirámide, esfera, cono, tridimensional, 3D, manto, red del cuerpo, plantilla, desarrollo del cuerpo, arista, aristas, caras, vértice, cubo, cubos, capacidad, litro, mL, área de la superficie, área total, área lateral, metro cúbico,…
- **Teorema de Pitágoras.**
  HUECO CONFIRMADO por un segundo lector. Términos probados: pitág, pitag, Pitágoras, pitagórico, hipotenus, hipotenusa, catet, cateto, catetos, teorema, triángulo rectángulo, raíz cuadrada, al cuadrado, a² + b², a2 + b2, c², diagonal, distancia entre dos puntos, lados del triángulo rectángulo, ángulo recto, relación métrica, glosario completo (pp. 143-145), simbología (p. 145) ‖ Cero apariciones…

### Matemática 8º

✅ 4 · 🟡 4 · 🔁 0 · ❌ 0

| | Punto a trabajar | Dónde se enseña | Págs. | También en |
|---|---|---|---|---|
| 🟡 | Adiciones, sustracciones, multiplicaciones y divisiones de números enteros. | Números enteros (Z) | 11–18 | 25–29 |
| ✅ | Área y volumen de prismas rectos con diferentes bases y cilindros. | Área y volumen de prismas y cilindros | 118–120 | — |
| 🟡 | Experimentos aleatorios, frecuencia absoluta, relativa y la probabilidad. | Probabilidad | 143–151 | 129–131, 137, 153–154 |
| ✅ | Expresiones algebraicas, ecuaciones e inecuaciones lineales. | Expresiones algebraicas, ecuaciones e inecuaciones | 52–66 | — |
| ✅ | Funciones lineales y afines. | Funciones | 73–81 | — |
| 🟡 | Proporciones directas e indirectas. | Funciones | 73–75 | — |
| 🟡 | Razones y porcentajes. | Potencia y raíz cuadrada | 44–48 | 40, 49, 159 |
| ✅ | Teorema de Pitágoras. | Teorema de Pitágoras | 89–96 | — |

**Adiciones, sustracciones, multiplicaciones y divisiones de números enteros.**
> «Para multiplicar números enteros distintos de cero, puedes utilizar la regla de los signos» — pág. 11
> 
> · **págs. 25–29** — el tratamiento completo de la adición y la sustracción, desarrollado sobre racionales, con las mismas reglas de los enteros
> 
> Falta adición y sustracción de enteros como contenido propio. El índice del libro sólo lista dos subsecciones en la Lección 1: «Multiplicación de números enteros» (pp. 11-13) y «División de números enteros» (pp. 13-18), acordes al OA 1, que es sólo multiplicar y dividir. La suma y la resta de…

**Área y volumen de prismas rectos con diferentes bases y cilindros.**
> «Para calcular el área total (AT) [cita del libro: 16 palabras · 18fa5786803cb562] (AB)» — pág. 118
> 
> Tramo corto y exacto: la p. 118 trae las cuatro fórmulas (área total del prisma con AL = PB · h; área total del cilindro AT = 2πr(h + r); volumen del prisma V = AB · h; volumen del cilindro V = πr²h) y las pp. 119-120 las aplican en cuatro ejemplos resueltos: prisma de base hexagonal, cilindro,…

**Experimentos aleatorios, frecuencia absoluta, relativa y la probabilidad.**
> «La regla de [cita del libro: 25 palabras · d9d736882083dc97] posibles» — pág. 143
> 
> · **págs. 129–131** — la frecuencia absoluta usada como f para construir gráficos circulares e histogramas (se usa, nunca se define)
> · **págs. 137** — la frecuencia acumulada F, en el cálculo de cuartiles
> · **págs. 153–154** — probabilidad de sucesos con condiciones combinadas
> 
> Experimento aleatorio y probabilidad SÍ están: diagrama de árbol y espacio muestral (pp. 143-145, «Se realiza el experimento aleatorio de lanzar un dado de seis caras… los cuales corresponden al espacio muestral»), principio multiplicativo y cardinalidad (pp. 145-147), sucesos equiprobables, regla…

**Expresiones algebraicas, ecuaciones e inecuaciones lineales.**
> «Una [cita del libro: 16 palabras · 50b60e8040d7c03b] coeficientes son números racionales.» — pág. 52
> 
> Los tres temas están, en este orden: expresiones algebraicas, término semejante, suma/resta y multiplicación de expresiones (pp. 52-57, con el ejemplo del txapelakucha mapuche); ecuaciones lineales con coeficientes racionales y su resolución por mcm (pp. 58-62); desigualdades e inecuaciones…

**Funciones lineales y afines.**
> «Una función afín [cita del libro: 20 palabras · 87437e5d6e836457] c distintos de cero.» — pág. 73
> 
> Función lineal en pp. 73-78 (definición f(x) = mx, propiedades aditiva y homogénea, gráfica como recta que pasa por (0, 0), pendiente m y cálculo de m con dos puntos, crecimiento/decrecimiento). Función afín en pp. 79-81 (definición, coeficiente de posición c, cómo obtener m y c desde el gráfico, y…

**Proporciones directas e indirectas.**
> «El [cita del libro: 14 palabras · e5b230919fad38cc] la proyección» — pág. 73
> 
> Lo único proporcional que el libro trabaja es la proporcionalidad DIRECTA, y lo hace disfrazada de función lineal: p. 73 define «Una función lineal f [cita del libro: 12 palabras · f6905338f2b12b3b] con m ≠ 0» con sus propiedades aditiva y homogénea, y las pp. 74-75 la aplican a…

**Razones y porcentajes.**
> «El a [cita del libro: 20 palabras · a59b0de1093a3b14] producto.» — pág. 44
> 
> · **págs. 40** — única aplicación de la razón en el texto, usada como conocimiento ya sabido
> · **págs. 49** — resumen de las variaciones porcentuales de la Lección 3
> · **págs. 159** — la única definición de razón que trae el libro
> 
> Los porcentajes SÍ están: la subsección «Variaciones porcentuales» de la Lección 3 (pp. 44-48) enseña porcentaje del total, descuentos y aumentos, interés simple (I = C · i % · t), IVA e IPC; se resume en la Síntesis de la p. 49. Las RAZONES no tienen enseñanza propia: buscando «razón», «razones»,…

**Teorema de Pitágoras.**
> «En [cita del libro: 27 palabras · 283bb47399d5b097] de la hipotenusa.» — pág. 89
> 
> El enunciado y los tríos pitagóricos están en la p. 89; la aplicación a la diagonal de un cuadrado y de un rectángulo (piscina) en pp. 89-90; el cálculo de perímetro y área con el lado que falta y el RECÍPROCO del teorema (para decidir si un triángulo es rectángulo) en la p. 91; la verificación…

---

## Nivel 1 Educación Media

**Cursos:** 1º y 2º Medio

### Biología 1º Medio

✅ 0 · 🟡 3 · 🔁 2 · ❌ 3

| | Punto a trabajar | Dónde se enseña | Págs. | También en |
|---|---|---|---|---|
| 🟡 | Evolución, teorías asociadas y sus evidencias y su impacto en el desarrollo de la vida. Relación entre organismo, población, comunidad y ecosistema. | ¿Cómo evolucionan los seres vivos? | 26–35 | 14–23, 38, 60–63 |
| 🟡 | Leyes de conservación de la materia. Reacciones químicas y formación de compuestos útiles para los seres vivos. | ¿Cómo se relacionan fotosíntesis y respiración celular? | 102–103 | 94–97 |
| 🟡 | Química orgánica y los grupos funcionales (haluros, éteres, alcoholes, entre otros). Propiedades y características del carbono y su relación en la formación de moléculas orgánicas. Fotosíntesis y la respiración celular y ciclo del carbono. | ¿Cómo se relacionan fotosíntesis y respiración celular? | 100–105 | 95–96 |

**Evolución, teorías asociadas y sus evidencias y su impacto en el desarrollo de la vida. Re**
> «La anatomía [cita del libro: 16 palabras · ccef3c81f672f41c] su evolución.» — pág. 26
> 
> · **págs. 14–23** — Evidencias de la evolución en el registro fósil
> · **págs. 38** — La teoría sintética de la evolución
> · **págs. 60–63** — Relación organismo-población-comunidad-ecosistema: los niveles de organización de la ecología y las propiedades emergentes de cada nivel
> 
> refutado por el auditor: la página cubre solo parte del conocimiento ‖ El conocimiento junta dos temas. (1) Evolución, teorías y evidencias: el tramo principal es la Lección 2 «¿Cómo evolucionan los seres vivos?» (26-35): selección natural y viaje de Darwin (28-31), anatomía comparada, estructuras…

**Leyes de conservación de la materia. Reacciones químicas y formación de compuestos útiles **
> «La siguiente ecuación representa la reacción química general de la respiración celular» — pág. 102
> 
> · **págs. 94–97** — El reciclaje de la materia: los ciclos biogeoquímicos entre el medio biótico y el abiótico
> 
> Lo que SÍ está: reacciones químicas con reactantes y productos y la formación de compuestos útiles para los seres vivos. p. 102 enseña la fotosíntesis como reacción anabólica que sintetiza glucosa a partir de CO2 y agua, y p. 103 muestra la ecuación balanceada de la respiración celular (C6H12O6 + 6…

**Química orgánica y los grupos funcionales (haluros, éteres, alcoholes, entre otros). Propi**
> «Fotosíntesis. Proceso [cita del libro: 20 palabras · 064fd073c437a5be] de sustancias inorgánicas.» — pág. 100
> 
> · **págs. 95–96** — El ciclo del carbono y del oxígeno
> 
> Solo está la TERCERA parte del conocimiento. Fotosíntesis (fase dependiente de la luz y ciclo de Calvin, cloroplasto y clorofila) y respiración celular (mitocondria, ecuación, ATP): pp. 102-103, dentro de esta lección (100-105). El ciclo del carbono y del oxígeno está en otra lección, «¿Cómo…

**🔁 Están en el tomo, pero en la mitad del otro curso**

- Principios básicos de herencia genética en plantas y animales propuestos por Mendel. Estructura y función del ADN. — págs. 216–225
- Sistemas del cuerpo humano: características y estructuras básicas del sistema nervioso y endocrino; nervios y cerebro, páncreas y hormonas sexuales y pancreáticas. Efectos del consumo de drogas, medidas de protección y autocuidado. — págs. 130–141

**❌ No están en este libro**

- **Características y propiedades del sonido y la luz, y su impacto en la vida cotidiana.**
  HUECO CONFIRMADO por un segundo lector. Términos probados: sonid, sonor, acúst, decibel, ruido, vibrac, ecolocal, audici, audit, oído, tímpan, cóclea, onda, longitud de onda, frecuenc, espectro, refracc, reflexión de, lente, prisma, ultraviolet, infrarroj, electromagn, fotón, velocidad de la luz, visión, retina, ojo, óptic, luz, lumín, lumin, solar, radiaci, rayos, color de la luz ‖ Confirmado.…
- **La creación y evolución del universo según teorías científicas y cosmovisiones de los pueblos originarios.**
  HUECO CONFIRMADO por un segundo lector. Términos probados: univers, cosmos, cosmolog, cosmovis, big bang, gran explosi, galax, nebulos, constelac, planeta, sistema solar, astro, estelar, origen del mundo, creación del mundo, pueblo, originari, indígena, mapuche, aymara, rapa nui, quechua, atacame, ancestral, mitolog, leyenda, relato de creaci, saberes, tradicion, origen de la, se formó la Tierra,…
- **Movimiento, ley de conservación de la energía mecánica y los conceptos de trabajo y potencia mecánica.**
  HUECO CONFIRMADO por un segundo lector. Términos probados: energía cinét, energía potenc, energía mecán, trabajo mecán, potencia mecán, conservación de la energía, rectilín, movimiento uniforme, movimient, reposo, velocidad, aceleraci, fuerza, newton, joule, watt, inercia, gravedad, gravitac, roce, fricci, palanca, termodinámic, m/s, desplazamiento, trayectoria, calor, masa ‖ Confirmado. CERO…

### Biología 2º Medio

✅ 2 · 🟡 0 · 🔁 3 · ❌ 3

| | Punto a trabajar | Dónde se enseña | Págs. | También en |
|---|---|---|---|---|
| ✅ | Principios básicos de herencia genética en plantas y animales propuestos por Mendel. Estructura y función del ADN. | ¿Cómo se transmiten las características de una generación a la siguiente? | 216–225 | — |
| ✅ | Sistemas del cuerpo humano: características y estructuras básicas del sistema nervioso y endocrino; nervios y cerebro, páncreas y hormonas sexuales y pancreáticas. Efectos del consumo de drogas, medidas de protección y autocuidado. | ¿Qué funciones cumple el sistema nervioso y cómo las realiza? | 130–151 | — |

**Principios básicos de herencia genética en plantas y animales propuestos por Mendel. Estru**
> «Mendel consideró que [cita del libro: 20 palabras · e637279e6d4ab399] durante la reproducción.» — pág. 216
> 
> confirmado por auditoría independiente ‖ Las dos mitades del conocimiento están en la misma lección (212-225). Mendel: pp. 216-219 (arvejas, generación P, F1, F2, monohibridismo, dominante/recesivo, tablero de Punnett, proporción 9:3:3:1 en p.220); herencia no mendeliana y en animales: pp. 220-221…

**Sistemas del cuerpo humano: características y estructuras básicas del sistema nervioso y e**
> «El sistema [cita del libro: 25 palabras · 33c33a63f9ecfc0d] humano.» — pág. 130
> 
> Todas las partes del conocimiento están en esta unidad. Sistema nervioso, nervios, SNC y SNP, arco reflejo, impulso nervioso y sinapsis: pp. 131-137 (lección "¿Qué funciones cumple el sistema nervioso y cómo las realiza?", 130-141). Cerebro: pp. 138-139 ("El cerebro está formado por cerca de 90 mil…

**🔁 Están en el tomo, pero en la mitad del otro curso**

- Evolución, teorías asociadas y sus evidencias y su impacto en el desarrollo de la vida. Relación entre organismo, población, comunidad y ecosistema. — págs. 26–35
- Leyes de conservación de la materia. Reacciones químicas y formación de compuestos útiles para los seres vivos. — págs. 102–103
- Química orgánica y los grupos funcionales (haluros, éteres, alcoholes, entre otros). Propiedades y características del carbono y su relación en la formación de moléculas orgánicas. Fotosíntesis y la respiración celular y ciclo del carbono. — págs. 101–105

**❌ No están en este libro**

- **Características y propiedades del sonido y la luz, y su impacto en la vida cotidiana.**
  HUECO CONFIRMADO por un segundo lector. Términos probados: sonid, sonor, acúst, decibel, timbre, audici, oíd, oreja, tímpan, cócle, ecolocali, ultrasonid, onda, ondas, vibraci, frecuenc, amplitud, hertz, Hz, eco, refracci, reflexión, espectro, longitud de onda, lumínic, luminos, ultravioleta, infrarroj, prisma, lente, espejo, arcoíris, opac, transparen, propagaci, radiaci, rayos, velocidad de la…
- **La creación y evolución del universo según teorías científicas y cosmovisiones de los pueblos originarios.**
  HUECO CONFIRMADO por un segundo lector. Términos probados: universo, big bang, galax, cosmo, cosmovisi, nebulos, sistema solar, planeta, estrell, constelaci, vía láctea, expansión del universo, origen del mundo, origen del universo, mapuch, aimar, aymar, rapa nui, quechua, atacame, selk, kawés, yagán, diaguit, indígen, pueblos originarios, ancestral, saberes, mitolog, leyenda, creencia, Tierra…
- **Movimiento, ley de conservación de la energía mecánica y los conceptos de trabajo y potencia mecánica.**
  HUECO CONFIRMADO por un segundo lector. Términos probados: energía mecánica, energía cinética, energía potencial, potencia, potencia mecánica, trabajo mecánico, joule, julio, newton, watt, vatio, aceleraci, fuerza, fuerza neta, movimiento rectilíneo, rapidez, velocidad, caída libre, inercia, gravitatoria, conservación de la energía, energía se transforma, energía no se crea, formas de energía,…

### Física 1º Medio

✅ 1 · 🟡 0 · 🔁 2 · ❌ 5

| | Punto a trabajar | Dónde se enseña | Págs. | También en |
|---|---|---|---|---|
| ✅ | Características y propiedades del sonido y la luz, y su impacto en la vida cotidiana. | ¿Cuáles son las propiedades de las ondas sonoras? | 25–30 | — |

**Características y propiedades del sonido y la luz, y su impacto en la vida cotidiana.**
> «La difracción del [cita del libro: 20 palabras · 7f579dc58322ca42] nuevo foco emisor» — pág. 25
> 
> confirmado por auditoría independiente ‖ Este es el tramo principal del sonido (reflexión, eco, absorción, resonancia, rapidez de propagación, refracción, difracción y efecto Doppler, con aplicaciones de infra y ultrasonido). Las CARACTERÍSTICAS del sonido (intensidad, tono, timbre) están antes, en…

**🔁 Están en el tomo, pero en la mitad del otro curso**

- La creación y evolución del universo según teorías científicas y cosmovisiones de los pueblos originarios. — págs. 112–115
- Movimiento, ley de conservación de la energía mecánica y los conceptos de trabajo y potencia mecánica. — págs. 191–194

**❌ No están en este libro**

- **Evolución, teorías asociadas y sus evidencias y su impacto en el desarrollo de la vida. Relación entre organismo, población, comunidad y ecosistema.**
  HUECO CONFIRMADO por un segundo lector. Términos probados: evoluci (fragmento), evolución de las especies, evolución biológica, Darwin, Lamarck, selección natural, adaptación, fósil, extinción, especie, especies, población, poblaci (fragmento), comunidad, ecosistema, bioma, hábitat, cadena trófica, depredador, biodiversidad, biodivers (fragmento), organismo, organismos vivos, ser vivo, seres…
- **Leyes de conservación de la materia. Reacciones químicas y formación de compuestos útiles para los seres vivos.**
  HUECO CONFIRMADO por un segundo lector. Términos probados: Lavoisier, conservación de la masa, conservación de la materia, la materia se conserva, se conserva la materia, no se crea ni se destruye, reacción química, reacciones químicas, reactante, reactivo, producto, enlace, enlace iónico, enlace covalente, enlace metálico, molécula, moléculas, átomo, átomos, número atómico, elemento químico,…
- **Principios básicos de herencia genética en plantas y animales propuestos por Mendel. Estructura y función del ADN.**
  HUECO CONFIRMADO por un segundo lector. Términos probados: Mendel, ADN, ácido desoxirribonucleico, desoxi (fragmento), genética, genétic (fragmento), gen, genoma, herencia, hereditario, hereditar (fragmento), cromosoma, cromosom (fragmento), alelo, dominante, recesivo, gameto, mutación, reproducción, célula, células, citoplasma, membrana celular, núcleo celular, tejido, planta, plantas, animal,…
- **Química orgánica y los grupos funcionales (haluros, éteres, alcoholes, entre otros). Propiedades y características del carbono y su relación en la formación de moléculas orgánicas. Fotosíntesis y la respiración celular y ciclo del carbono.**
  HUECO CONFIRMADO por un segundo lector. Términos probados: carbono (con límite de palabra, para evitar falsos positivos), grupo funcional, grupos funcionales, haluro, éter (con límite de palabra: sin él da falsos positivos por 'determinar'), alcohol, hidrocarburo, alcano, alqueno, orgánica, orgánic (fragmento), química orgánica, molécula orgánica, fotosíntesis, fotosínt (fragmento), clorofila,…
- **Sistemas del cuerpo humano: características y estructuras básicas del sistema nervioso y endocrino; nervios y cerebro, páncreas y hormonas sexuales y pancreáticas. Efectos del consumo de drogas, medidas de protección y autocuidado.**
  HUECO CONFIRMADO por un segundo lector. Términos probados: sistema nervioso, neurona, sinapsis, cerebro, médula espinal, nervio, endocrino, endocrin (fragmento), hormona, páncreas, insulina, glucosa, testosterona, estrógeno, tiroides, órgano, sistema digestivo, respiratorio, circulatorio, sangre, corazón, droga, drogas, adicción, consumo de sustancias, alcohol, tabaco, marihuana, autocuidado,…

### Física 2º Medio

✅ 1 · 🟡 1 · 🔁 1 · ❌ 5

| | Punto a trabajar | Dónde se enseña | Págs. | También en |
|---|---|---|---|---|
| 🟡 | La creación y evolución del universo según teorías científicas y cosmovisiones de los pueblos originarios. | La teoría del Big Bang: una cronología del universo | 112–116 | 105–111 |
| ✅ | Movimiento, ley de conservación de la energía mecánica y los conceptos de trabajo y potencia mecánica. | ¿De qué manera se puede determinar el trabajo mecánico? | 179–196 | — |

**La creación y evolución del universo según teorías científicas y cosmovisiones de los pueb**
> «10-35 s después de la Gran Explosión Surgen las fuerzas fundamentales de nuestro universo.» — pág. 112
> 
> · **págs. 105–111** — evolución de los modelos del universo: Aristóteles y el geocentrismo de Ptolomeo (107-108), Copérnico y el heliocentrismo (109) y el camino al modelo actual con Newton y Kant (111)
> 
> Falta por completo la mitad de COSMOVISIONES DE LOS PUEBLOS ORIGINARIOS: busqué 'pueblos originarios|cosmovisión|mapuche|aymara|indígena|rapa nui|selk|inca|ancestral' (0 resultados) y 'originari|cosmovis|etnoastron|ancestr|mito' (0 resultados) en todo el libro. La parte científica sí está y bien:…

**Movimiento, ley de conservación de la energía mecánica y los conceptos de trabajo y potenc**
> «En ausencia [cita del libro: 20 palabras · b41f51020fcf1f4a] la energía mecánica.» — pág. 179
> 
> Tramo principal (Unidad 8): trabajo mecánico pp. 179-182, potencia mecánica p. 183-185 ('La magnitud física [cita del libro: 12 palabras · c98de4509cd6ddd9] mecánica'), energía cinética pp. 186-189, energía potencial gravitatoria p. 190, energía potencial elástica p. 191,…

**🔁 Están en el tomo, pero en la mitad del otro curso**

- Características y propiedades del sonido y la luz, y su impacto en la vida cotidiana. — págs. 22–30

**❌ No están en este libro**

- **Evolución, teorías asociadas y sus evidencias y su impacto en el desarrollo de la vida. Relación entre organismo, población, comunidad y ecosistema.**
  HUECO CONFIRMADO por un segundo lector. Términos probados: evoluci, selección natural, seleccion natural, Darwin, especiación, Lamarck, ecosistema, ecolog, bioma, trófic, trofic, biodiversidad, hábitat, habitat, población, comunidad, fósil, fosil, ancestr, extinción, especie, ser vivo, seres vivos, organismo, biolog, animal, plantas, vegetal, adaptación ‖ Amplié la búsqueda a los 379 chunks de…
- **Leyes de conservación de la materia. Reacciones químicas y formación de compuestos útiles para los seres vivos.**
  HUECO CONFIRMADO por un segundo lector. Términos probados: conservación de la materia, conservación de la masa, masa se conserva, Lavoisier, reactante, reactivo, estequiom, reacción química, combustión, oxidación, tabla periódica, elemento químico, periódic, átomo, atómic, molécul, enlace, hidrógeno, oxígeno, carbono, nitrógeno, helio, compuesto, sustancia, mezcla, disolución, no se crea ni se…
- **Principios básicos de herencia genética en plantas y animales propuestos por Mendel. Estructura y función del ADN.**
  HUECO CONFIRMADO por un segundo lector. Términos probados: Mendel, herencia, hereditar, genétic, genetic, genoma, alelo, cromosom, ADN, ácido desoxirribonucleico, ARN, nucleótid, mitosis, meiosis, célula, celular, reproducción, dominante, recesiv, híbrido, arveja, guisante, proteína, ser vivo, seres vivos, organismo, biolog ‖ Verifiqué uno por uno los aciertos extrayendo el contexto de cada…
- **Química orgánica y los grupos funcionales (haluros, éteres, alcoholes, entre otros). Propiedades y características del carbono y su relación en la formación de moléculas orgánicas. Fotosíntesis y la respiración celular y ciclo del carbono.**
  HUECO CONFIRMADO por un segundo lector. Términos probados: química orgánica, orgánic, grupo funcional, alcohol, éter, haluro, hidrocarbur, alcano, alqueno, cetona, aldehído, fotosíntesis, clorofila, respiración, respiración celular, ciclo del carbono, glucosa, carbono, átomo de carbono, tabla periódica, molécula, enlace, célula, celular, vegetal, plantas ‖ Cero resultados reales en las tres…
- **Sistemas del cuerpo humano: características y estructuras básicas del sistema nervioso y endocrino; nervios y cerebro, páncreas y hormonas sexuales y pancreáticas. Efectos del consumo de drogas, medidas de protección y autocuidado.**
  HUECO CONFIRMADO por un segundo lector. Términos probados: sistema nervioso, nervios, neuron, sinapsis, médula, endocrin, hormon, páncreas, insulina, tiroides, glándula, cerebro, encéfalo, droga, alcoholism, tabaco, cigarr, adicción, autocuidado, pubertad, sexual, testosterona, estrógeno, menstru, salud, cuerpo humano, órgano, nutri, digest, sangre, corazón, pulmón, respiratorio, circulatorio ‖…

### Historia Geografía Y Ciencias Sociales 1º Medio

✅ 1 · 🟡 4 · 🔁 0 · ❌ 1

| | Punto a trabajar | Dónde se enseña | Págs. | También en |
|---|---|---|---|---|
| 🟡 | Conflictos globales y regionales del siglo XX y sus consecuencias (por ejemplo: revoluciones, guerras, totalitarismos y populismos). | Imperialismo y Primera Guerra Mundial: ¿la crisis del progres | 104–113 | — |
| 🟡 | Multiculturalismo, identidades y patrimonio material e inmaterial en Chile. | ¿Como son las relaciones con los pueblos originarios hoy? | 192–193 | 182–185, 188–189, 190–191 |
| ✅ | Procesos políticos y económicos globales y locales durante el siglo XIX (por ejemplo: imperialismo, industrialización, consolidación del Estado-nación). | El mundo industrializado: ¿un mundo mejo | 76–93 | — |
| 🟡 | Revoluciones del siglo XVIII e inicios del siglo XIX en Europa y América, incluyendo la Independencia de Chile. | ¿Cómo se consolidaron las ideas liberales y republicanas en el siglo XIX? | 32–33 | 22–23, 24 |
| 🟡 | Visión general sobre el desarrollo político, económico, social y medioambiental en Chile durante el siglo XIX y primera mitad del siglo XX, incluyendo la perspectiva de los pueblos indígenas y las mujeres. | El Chile liberal | 114–139 | 88–91, 108–109, 154–179 |

**Conflictos globales y regionales del siglo XX y sus consecuencias (por ejemplo: revolucion**
> «En las lecciones [cita del libro: 12 palabras · 164da47badf0e1c6] entre las grandes potencias.» — pág. 104
> 
> El libro solo enseña UN conflicto del siglo XX: la Primera Guerra Mundial (causas y Balcanes p. 104-105; nueva forma de hacer la guerra p. 106-107; impacto social y entrada de las mujeres al trabajo p. 108-109; nuevo orden mundial y Conferencia de París p. 110-111). La Revolución rusa aparece solo…

**Multiculturalismo, identidades y patrimonio material e inmaterial en Chile.**
> «recién [cita del libro: 16 palabras · c725b44159615063] consideradas como una riqueza.» — pág. 192
> 
> · **págs. 182–185** — patrimonio cultural aymara y quechua: iglesias altiplánicas y Educación Intercultural Bilingüe
> · **págs. 188–189** — patrimonio inmaterial vivo: los Tesoros Humanos Vivos, la lengua yagán y la rapanuización
> · **págs. 190–191** — patrimonio inmaterial narrativo: leyendas selk'nam y rapa nui
> 
> El recuadro '¿Cuál es el valor de la diversidad para la sociedad chilena hoy?' (p. 192-193) es el tramo exacto: enseña el paso de la homogeneización cultural al multiculturalismo, la Ley Indígena de 1993 con los diez pueblos reconocidos, la interculturalidad y la Declaración de la Unesco sobre…

**Procesos políticos y económicos globales y locales durante el siglo XIX (por ejemplo: impe**
> «El proceso [cita del libro: 20 palabras · 4ca45241f89097a0] capitalismo.» — pág. 76
> 
> confirmado por auditoría independiente ‖ Tramo principal = industrialización (antecedentes y etapas p. 78-79; impacto económico y social p. 84-85; impacto en la población y cuestión social p. 86-89; industrialización y medioambiente p. 88-91). Los otros temas del conocimiento: IMPERIALISMO en la…

**Revoluciones del siglo XVIII e inicios del siglo XIX en Europa y América, incluyendo la In**
> «Esto provocó [cita del libro: 12 palabras · 24b4d7fb6db5b9bc] de las colonias.» — pág. 32
> 
> · **págs. 22–23** — las revoluciones europeas del período y la difusión de las ideas liberales y republicanas por Europa y América
> · **págs. 24** — la independencia de Estados Unidos, con la fuente primaria de la Declaración de Independencia de 1776
> 
> El tramo 32-33 es el único donde el libro ENSEÑA las independencias americanas (élite criolla, Camilo Henríquez, Bolívar, símbolos de las nuevas naciones). Las revoluciones europeas se enseñan en p. 22-23 ('las oleadas revolucionarias de 1820, 1830 y 1848 en Europa') y la independencia de EE.UU.…

**Visión general sobre el desarrollo político, económico, social y medioambiental en Chile d**
> «En Chile, [cita del libro: 16 palabras · 5ac7dccb296d1a0c] la oligarquía.» — pág. 114
> 
> · **págs. 88–91** — la dimensión medioambiental: contaminación industrial y desarrollo sostenible, tratada a escala global más que chilena
> · **págs. 108–109** — la perspectiva de las mujeres: su entrada al mundo del trabajo durante la Gran Guerra
> · **págs. 154–179** — la perspectiva de los pueblos indígenas en el siglo XIX: ocupación de La Araucanía, reducciones, títulos de merced y pueblos australes
> 
> Tramo principal: político (transición al liberalismo y reformas p. 114-115; secularización y leyes laicas p. 116-117; parlamentarismo y partidos p. 118-119), económico (salitre, obras públicas y educación p. 120-125), social (cuestión social, conventillos, mutuales, huelgas, sectores medios p.…

**❌ No están en este libro**

- **Conflictos internos en Chile en la segunda mitad del siglo XX, incluyendo el quiebre de la democracia y la dictadura militar, la transición política y los derechos humanos.**
  HUECO CONFIRMADO por un segundo lector. Términos probados: dictadur, Pinochet, Allende, Unidad Popular, golpe de estado, junta militar, régimen militar, derechos humanos, detenid, desaparecid, desaparición forzada, plebiscito, transición a la democracia, quiebre, violaciones a los derechos, represión, exilio, tortura, toque de queda, estado de sitio, Amnistía, Rettig, Valech, Vicaría, Museo de la…

### Historia Geografía Y Ciencias Sociales 2º Medio

✅ 2 · 🟡 4 · 🔁 0 · ❌ 0

| | Punto a trabajar | Dónde se enseña | Págs. | También en |
|---|---|---|---|---|
| ✅ | Conflictos globales y regionales del siglo XX y sus consecuencias (por ejemplo: revoluciones, guerras, totalitarismos y populismos). | Lección 3 Segunda Guerra Mundial: un conflicto global | 40–55 | — |
| ✅ | Conflictos internos en Chile en la segunda mitad del siglo XX, incluyendo el quiebre de la democracia y la dictadura militar, la transición política y los derechos humanos. | Lección 1 Estado de Derecho y Derechos Humanos en dictadura | 164–175 | — |
| 🟡 | Multiculturalismo, identidades y patrimonio material e inmaterial en Chile. | Lección 3 Diversidad, inclusión, y no discriminación | 252–257 | 244–245 |
| 🟡 | Procesos políticos y económicos globales y locales durante el siglo XIX (por ejemplo: imperialismo, industrialización, consolidación del Estado-nación). | Del optimismo al desencanto | 14–15 | 26, 80 |
| 🟡 | Revoluciones del siglo XVIII e inicios del siglo XIX en Europa y América, incluyendo la Independencia de Chile. | Unidad 4 — Lección 1 «Derechos Humanos y Estado de Derecho» → «Elementos del Estado de Derecho» | 230–231 | 266 |
| 🟡 | Visión general sobre el desarrollo político, económico, social y medioambiental en Chile durante el siglo XIX y primera mitad del siglo XX, incluyendo la perspectiva de los pueblos indígenas y las mujeres. | Lección 4 Transformaciones políticas, económicas y sociales en Chile | 56–79 | — |

**Conflictos globales y regionales del siglo XX y sus consecuencias (por ejemplo: revolucion**
> «En [cita del libro: 20 palabras · 412a391f4758e9c3] por la humanidad.» — pág. 40
> 
> Éste es el tramo del conflicto global y sus consecuencias (enfrentamiento ideológico 42-45, desarrollo de la guerra 46-47, 'El horror a gran escala' 48-49, la ONU y la Declaración Universal de DD.HH. 52-53). Los otros temas del conocimiento están en: totalitarismos, en 'El surgimiento de los…

**Conflictos internos en Chile en la segunda mitad del siglo XX, incluyendo el quiebre de la**
> «Con el golpe [cita del libro: 28 palabras · e63c805bb3944657] Derechos Humanos.» — pág. 164
> 
> confirmado por auditoría independiente ‖ Éste es el tramo más exacto para la dictadura y los DD.HH.: 'Golpe de Estado y dictadura militar en Chile' (166-167), 'La institucionalidad tras el golpe de Estado' (168), 'La violación de los Derechos Humanos' (169-171, con las cifras del informe de la…

**Multiculturalismo, identidades y patrimonio material e inmaterial en Chile.**
> «Por ello, [cita del libro: 16 palabras · 321514e8eeaa7ef6] las personas.» — pág. 252
> 
> · **págs. 244–245** — las identidades de los pueblos originarios y la asignatura de Lengua y Cultura de Pueblos Originarios Ancestrales
> 
> Lo que sí enseña es la convivencia entre culturas e identidades: la lección abre pidiendo 'rechazar discriminaciones étnicas, de [cita del libro: 12 palabras · 110c51f92994ce33] sexual y de discapacidad' (252), sigue con el 'Ordenamiento jurídico para…

**Procesos políticos y económicos globales y locales durante el siglo XIX (por ejemplo: impe**
> «En [cita del libro: 12 palabras · cca748853d496105] la industrialización y urbanización.» — pág. 14
> 
> · **págs. 26** — párrafo de contexto que nombra los procesos económicos del siglo XIX
> · **págs. 80** — resumen del período que vuelve a nombrar estos procesos
> 
> Falta casi todo. El libro NO enseña el siglo XIX: solo lo usa como telón de fondo en un párrafo de contexto de la p. 14, que en tres líneas nombra los tres procesos ('Los siglos [cita del libro: 16 palabras · 11cd0e1bb0c32c61] de la…

**Revoluciones del siglo XVIII e inicios del siglo XIX en Europa y América, incluyendo la In**
> «Durante el siglo XVIII se desarrolló en Europa el movimiento de la Ilustración. […] Estas ideas [cita del libro: 16 palabras · 8f0c971d9f551806] Francesa (1789-1799).» — pág. 230
> 
> · **págs. 266** — entrada de glosario «Absolutismo», el régimen que las revoluciones del siglo XVIII vinieron a limitar
> 
> RESCATADO por el auditor de huecos: el lector lo había dado por ausente y SÍ está. ‖ REFUTACIÓN PARCIAL. El lector anterior se equivocó en la mitad europea/americana: la p. 230 sí trata explícitamente las revoluciones del siglo XVIII —la Ilustración, la crítica al absolutismo monárquico, la…

**Visión general sobre el desarrollo político, económico, social y medioambiental en Chile d**
> «Tras la Guerra civil [cita del libro: 20 palabras · e8642e80be58bdd0] el Ejecutivo.» — pág. 56
> 
> Cubre bien lo político (crisis del parlamentarismo 58-59, Constitución de 1925 y partidos 62-63), lo económico (nuevo rol del Estado en la economía 66-67) y lo social (nuevo rol social del Estado 68-69, democratización 70-71, clase media y sectores populares 74-75). La perspectiva de las mujeres…

### Lengua Y Literatura 1º Medio

✅ 5 · 🟡 3 · 🔁 0 · ❌ 0

| | Punto a trabajar | Dónde se enseña | Págs. | También en |
|---|---|---|---|---|
| 🟡 | Contexto de producción y recepción de un texto literario. | Antón Chéjov, la literatura como amante | 97–98 | 116, 172–174 |
| ✅ | Estrategias de comprensión lectora y de comprensión oral. | Podemos ayudar a moldear la forma en que nuestros hijos recuerden la pandemia” | 156–157 | — |
| ✅ | Estrategias de persuasión. | Ingkayaiñ taiñ zugun” | 215–216 | — |
| 🟡 | Intertextualidad a través de personajes, temas y símbolos de textos clásicos. | La canción sigue siendo la misma” | 142 | 56–57, 203–204, 220 |
| 🟡 | Normas de citación. | El corazón de la alcachofa” | 30–31 | 131, 204, 220 |
| ✅ | Recursos de coherencia y cohesión del texto. | El corazón de la alcachofa” | 26–27 | — |
| ✅ | Recursos no lingüísticos en los textos: diseño, imágenes, disposición gráfica y efectos de audio. | Cómo escribir un relato de detectives” | 20–21 | — |
| ✅ | Veracidad y consistencia de la información. | Estudios críticos” | 131 | — |

**Contexto de producción y recepción de un texto literario.**
> «Según [cita del libro: 16 palabras · c876314001a7b560] el cual fue escrito.» — pág. 97
> 
> · **págs. 116** — Repaso del contexto de producción como criterio de interpretación literaria
> · **págs. 172–174** — Aplicación del contexto de producción: situar la obra en su movimiento, su época y frente al Neoclasicismo
> 
> Falta el contexto de RECEPCIÓN: la palabra "recepción" no aparece en ninguna página del libro (lo verifiqué buscando "recepci" en todo el texto del estudiante). Lo que sí está, y bien, es el contexto de producción: el recuadro "Claves de lectura: ¿Cómo interpretar una obra literaria?" (pp. 97-98)…

**Estrategias de comprensión lectora y de comprensión oral.**
> «Los [cita del libro: 20 palabras · a4fcb734c6925163] corresponden a hechos comprobables» — pág. 156
> 
> confirmado por auditoría independiente ‖ Esta doble página junta las dos cosas: la comprensión lectora en "Claves de lectura: Estrategias para leer textos argumentativos y de medios de comunicación" (distinguir hechos de opiniones, identificar la tesis, evaluar los argumentos), y la comprensión…

**Estrategias de persuasión.**
> «Para alcanzar tu objetivo [cita del libro: 16 palabras · c39ace8f825e08e0] estos tipos de argumentos.» — pág. 215
> 
> El recuadro "Claves de lectura: Tipos de argumentos" (p. 215) distingue argumentos lógico-racionales y emotivo-afectivos con ejemplos del propio libro, y la p. 216 los pone al servicio de convencer/persuadir en el ensayo. Se complementa en p. 205 ("Manejo de la lengua": los recursos retóricos…

**Intertextualidad a través de personajes, temas y símbolos de textos clásicos.**
> «La [cita del libro: 16 palabras · 35e7c342a224cfd2] otras.» — pág. 142
> 
> · **págs. 56–57** — Primera definición de intertextualidad con personajes y situaciones comunes (Nieve negra / Blancanieves) e investigación sobre pares de textos clásicos (Penélope / La Odisea; Huidobro / Lira)
> · **págs. 203–204** — Personajes y símbolos de textos clásicos: los personajes tipo (el avaro de Molière, Don Juan, el pícaro del Lazarillo, Beatriz de la Divina comedia) y los símbolos
> · **págs. 220** — Resumen: interpretar personajes tipo y símbolos
> 
> refutado por el auditor: la página cubre solo parte del conocimiento ‖ El recuadro "Tipos de relaciones intertextuales en los textos" (p. 142) distingue intertextualidad a nivel local (cita y alusión, con el ejemplo "el título 'Nieve negra' alude a 'Blanca Nieves'") y a nivel global (se reusan…

**Normas de citación.**
> «Estilo directo: [cita del libro: 24 palabras · 9b16ad1213aab73c] comillas o las rayas.» — pág. 30
> 
> · **págs. 131** — Qué datos hay que registrar de una fuente web (link, fecha de acceso, autor, título) y el uso de los dos puntos para escribir citas textuales
> · **págs. 204** — Registro de fuentes durante el trabajo de investigación
> · **págs. 220** — Resumen: registrar y consignar las fuentes utilizadas
> 
> Lo que el libro enseña es cómo incorporar la voz de otro en el propio texto (estilo directo e indirecto, con comillas, dos puntos y raya, más la tabla de correspondencia de tiempos verbales), y él mismo lo llama citar: en p. 143 pide "usar citas y referencias textuales" y remite a "la página 28 de…

**Recursos de coherencia y cohesión del texto.**
> «La [cita del libro: 16 palabras · bd5db08e040f2115] le dan su unidad.» — pág. 26
> 
> Recuadro "Manejo de la lengua: Cohesión", que además ejemplifica dos mecanismos sobre el cuento leído (referirse a lo mismo con "sus hojas"/"las mías", y repetir los términos "mamá", "abuela", "papá" para aclarar quién habla). La COHERENCIA se enseña un poco antes, en la "Estrategia de lectura" de…

**Recursos no lingüísticos en los textos: diseño, imágenes, disposición gráfica y efectos de**
> «El [cita del libro: 20 palabras · 8c353fd92188bddf] elementos no lingüísticos.» — pág. 20
> 
> Es el único lugar donde el libro define "elementos no lingüísticos", y lo hace a propósito de un audiolibro (p. 20: "Interpretar un relato oral", con la consigna de analizar "la velocidad del relato y el volumen de voz" y "la música y el sonido ambiental") — ahí están los efectos de audio. El…

**Veracidad y consistencia de la información.**
> «Cotejar consiste en [cita del libro: 12 palabras · 676d6712a2d44b30] su veracidad.» — pág. 131
> 
> confirmado por auditoría independiente ‖ La p. 131 es el recuadro que enseña a reconocer fuentes de internet confiables con cuatro criterios (responsables del sitio, propósito del sitio, fuentes que cita, actualización) y luego a cotejar. El otro tramo donde se enseña es p. 156, "Claves de lectura:…

### Lengua Y Literatura 2º Medio

✅ 3 · 🟡 5 · 🔁 0 · ❌ 0

| | Punto a trabajar | Dónde se enseña | Págs. | También en |
|---|---|---|---|---|
| 🟡 | Contexto de producción y recepción de un texto literario. | ¿Cuánto es suficiente? | 182–183 | 51, 116, 154 |
| 🟡 | Estrategias de comprensión lectora y de comprensión oral. | El acto libre (cuento). José Edwards | 68 | 5, 14, 42, 76, 92, 134, 145, 171, 196 |
| ✅ | Estrategias de persuasión. | unidad 3. Tema de investigación: valores y modelos en publicidad y propaganda | 86–89 | — |
| 🟡 | Intertextualidad a través de personajes, temas y símbolos de textos clásicos. | unidad 2. Tema de investigación: temas del pasado y el presente | 128–131 | 66–72, 72, 101, 119, 154, 180, 189, 213 |
| 🟡 | Normas de citación. | Buscando un lugar entre no lugares: la literatura y el cine de Alberto Fuguet (artículo académico). Jonatán Martín Gómez | 39 | 152, 207 |
| ✅ | Recursos de coherencia y cohesión del texto. | Las mujeres musulmanas encuentran fuerza y poder en el deporte (reportaje). Juliet Macur | 206–207 | — |
| ✅ | Recursos no lingüísticos en los textos: diseño, imágenes, disposición gráfica y efectos de audio. | unidad 3. Tema de investigación: valores y modelos en publicidad y propaganda | 88–90 | — |
| 🟡 | Veracidad y consistencia de la información. | ¿Cómo son los jóvenes de hoy? | 149–150 | 42, 92 |

**Contexto de producción y recepción de un texto literario.**
> «El contexto [cita del libro: 17 palabras · 0648aeaa889a2901] literaria.» — pág. 182
> 
> · **págs. 51** — aplicación del contexto de producción: cómo la experiencia de vida y el contexto de la autora influyen en su visión
> · **págs. 116** — aplicación del contexto de producción: época y vida del autor en un poema
> · **págs. 154** — aplicación del contexto de producción y lectura de los poemas desde el presente
> 
> El candidato del buscador acertó. El recuadro «Claves para leer» que empieza al pie de p.182 y sigue en p.183 enseña visión de mundo y la distingue en contexto histórico y contexto cultural: «Esta [cita del libro: 16 palabras · e3bd1d1958ea318a] obra». Se aplica…

**Estrategias de comprensión lectora y de comprensión oral.**
> «Cuando formules [cita del libro: 16 palabras · ca3b1fd1cd361c00] se refutan.» — pág. 68
> 
> · **págs. 5** — presentación de las cápsulas CONDUCE TU LECTURA: qué es una estrategia de lectura y cómo elegir la más útil
> · **págs. 14** — estrategia lectora: inferir al personaje por indicios
> · **págs. 42** — estrategia lectora: distinguir hechos de opiniones
> · **págs. 76** — estrategia lectora: sintetizar cada párrafo con tus palabras
> · **págs. 92** — estrategia lectora: seguir y evaluar las fuentes
> · **págs. 134** — estrategia lectora: detectar marcas temporales
> · **págs. 145** — estrategia lectora: identificar postura y respaldos
> · **págs. 171** — estrategia lectora: inferir el conflicto dramático
> · **págs. 196** — estrategia lectora: inferir el punto de vista
> 
> El candidato del buscador (Punto de llegada, pp.49-53) es una batería de ejercicios, no enseñanza de estrategias. Las estrategias lectoras se enseñan en las cápsulas «CONDUCE TU LECTURA», que el propio libro presenta en p.5: «Sugiere una estrategia de lectura para el texto que se presenta. A medida…

**Estrategias de persuasión.**
> «reconocer los [cita del libro: 20 palabras · 4a01efbd2e09bfa5] sus deseos, preferencias» — pág. 86
> 
> El tramo enseña el análisis completo: p.86 define publicidad vs propaganda y el paso «Analizar los recursos persuasivos»; p.87 modela «¿Cómo analizar los recursos verbales?» (eslogan, imperativos, tuteo, letra chica); p.88 «¿Cómo analizar los recursos visuales?»; p.89 «Interpretar y evaluar». El…

**Intertextualidad a través de personajes, temas y símbolos de textos clásicos.**
> «escogerás un [cita del libro: 20 palabras · eb2de139017d03ff] contemporánea» — pág. 128
> 
> · **págs. 66–72** — símbolos
> · **págs. 72** — personajes tipo: el «viejo sabio»
> · **págs. 101** — símbolos (síntesis)
> · **págs. 119** — tópicos clásicos: amor cortés, locus amoenus, vanitas, memento mori, tempus fugit, carpe diem, ubi sunt
> · **págs. 154** — temas: un mismo tópico del Siglo de Oro reconocido en dos sonetos de épocas distintas (Lope de Vega y Leonora Vicuña)
> · **págs. 180** — personajes clásicos: Lady Macbeth
> · **págs. 189** — personajes tipo: el tirano
> · **págs. 213** — personajes tipo: el antihéroe, el soñador, el fracasado, con evidencias de dos cuentos
> 
> El candidato del buscador (p.67, score 0.963) es falso: esa página es solo la portadilla de la subunidad «Libertades cotidianas». Lo real está aquí: la subunidad modela paso a paso la comparación de La vida es sueño de Calderón con la canción «Sueño dorado» de Abel Pintos, y hasta nombra el tópico…

**Normas de citación.**
> «Estilo directo: se reproduce textualmente lo que dice la fuente.» — pág. 39
> 
> · **págs. 152** — recordatorio de la cita en estilo directo o indirecto
> · **págs. 207** — aplicación de la cita de fuentes en la escritura de una crónica
> 
> El candidato del buscador acertó, pero la enseñanza es exactamente la p.39, no las tres páginas: el paso 9 («Apoyen su análisis con citas de las fuentes consultadas») con los ejemplos de estilo directo —incluida la referencia modelada «(Martín 2015)»— y el recuadro RECURSOS del lenguaje sobre la…

**Recursos de coherencia y cohesión del texto.**
> «Un recurso de correferencia usado en el reportaje son los demostrativos.» — pág. 206
> 
> El candidato del buscador (crónica de Greta, pp.196-201) queda corto: la lección está en el reportaje siguiente. P.206 trae el recuadro RECURSOS del lenguaje que enseña la correferencia con demostrativos y frases nominales («este tipo de frases sirven para compactar la información y establecer…

**Recursos no lingüísticos en los textos: diseño, imágenes, disposición gráfica y efectos de**
> «los [cita del libro: 20 palabras · 7c0283688c875897] y gráficos» — pág. 88
> 
> confirmado por auditoría independiente ‖ El buscador no propuso nada y sí está. P.88 enseña el análisis del diseño y la disposición gráfica con preguntas modeladas: «¿Qué tipografía y colores se usan para el texto?», «¿Qué colores se utilizan en la imagen?», «¿Se ocupan logotipos o símbolos…

**Veracidad y consistencia de la información.**
> «Las falacias son argumentos [cita del libro: 16 palabras · 9f46eb887ea21c8e] sino razonamientos erróneos» — pág. 149
> 
> · **págs. 42** — distinguir hechos de opiniones y de quién son (cápsula CONDUCE TU LECTURA)
> · **págs. 92** — registrar y evaluar las fuentes que consulta el periodista
> 
> Lo que SÍ está: evaluar la consistencia/validez de lo que se afirma — el recuadro «Claves para leer» de p.150 sobre falacias (generalización apresurada, «citar una fuente que no tenga autoridad en la materia», inferencia incorrecta, apelar a las emociones) y las actividades de p.149 que piden…

### Matemática 1º Medio

✅ 4 · 🟡 1 · 🔁 0 · ❌ 1

| | Punto a trabajar | Dónde se enseña | Págs. | También en |
|---|---|---|---|---|
| ✅ | Homotecias y teorema de Thales. | Lección 8 Homotecia y teorema de Tales | 108–127 | — |
| 🟡 | Operaciones con números racionales, potencias, raíces y sus propiedades. | Lección 1 Operatoria en los números racionales | 11–25 | 27–43 |
| ✅ | Probabilidades, regla multiplicativa y regla aditiva. | Lección 11 Reglas de la probabilidad | 164–181 | — |
| ✅ | Productos notables. | Lección 3 Productos notables | 44–51 | — |
| ✅ | Sistemas de ecuaciones lineales (2x2). | Sistema de ecuaciones lineales con dos incógnitas | 71–79 | — |

**Homotecias y teorema de Thales.**
> «En esta lección aprenderás el [cita del libro: 12 palabras · f6af992dfa3df72b] de problemas.» — pág. 108
> 
> confirmado por auditoría independiente ‖ OJO: el candidato del buscador ('Medioambiente', 108-146, score 0.949) es el título de la UNIDAD 3 entera, no enseña nada por sí mismo; book_sections no tiene cargadas las subsecciones de las unidades 3 y 4, así que el título que doy sale del índice impreso…

**Operaciones con números racionales, potencias, raíces y sus propiedades.**
> «Un número racional [cita del libro: 20 palabras · f760c298c384e7dc] cero.» — pág. 11
> 
> · **págs. 27–43** — potencias y sus propiedades: base y exponente entero (27-28, incluido exponente negativo y cero), base racional y exponente entero (29-33), multiplicación y división de potencias (34-36) y crecimiento y decrecimiento exponencial (37-41)
> 
> Las RAÍCES NO están: busqué 'raíz', 'raíces', 'radical', 'irracional' en todo el corpus y sólo aparecen de pasada (√2 como ejemplo de decimal no transformable a fracción en el solucionario p. 210, y 'Pi: número irracional' en el glosario p. 205); no hay lección ni propiedades de la radicación. Lo…

**Probabilidades, regla multiplicativa y regla aditiva.**
> «En [cita del libro: 20 palabras · d719b7f8dbd161a0] problemas.» — pág. 164
> 
> El buscador no propuso ningún candidato; lo encontré por full-text ('regla aditiva', 'regla multiplicativa', 'probabilidad'). El título sale del índice impreso (portadilla de la lección, p. 164: 'Lección 11 Reglas de la probabilidad'); book_sections sólo tiene cargada la unidad 4 ('Los deportes',…

**Productos notables.**
> «El cuadrado de binomio [cita del libro: 28 palabras · 089e417dc3b969e7] + b 2» — pág. 44
> 
> confirmado por auditoría independiente ‖ Los tres productos notables están completos y en tramos cortos: 'Cuadrado de un binomio' pp. 44-46, 'Suma por su diferencia' pp. 47-49, 'Producto de binomios con un término en común' pp. 50-51. Evaluación de la lección en '¿Cómo vas?' pp. 52-54 y ejercicios…

**Sistemas de ecuaciones lineales (2x2).**
> «Un sistema de ecuaciones [cita del libro: 33 palabras · dda607713b06e448] = f» — pág. 71
> 
> Tramo exacto: la definición del sistema y los cuatro métodos de resolución — 'Método gráfico' 73-74, 'Método de igualación' 75, 'Método de sustitución' 76, 'Método de reducción' 77-79. La síntesis del propio libro (p. 79) confirma el tramo: 'Sistema de ecuaciones lineales con dos incógnitas Páginas…

**❌ No están en este libro**

- **Función y ecuación cuadrática.**
  HUECO CONFIRMADO por un segundo lector. Términos probados: cuadrátic, cuadratic, parábol, parabol, segundo grado, de segundo, discriminante, concavidad, eje de simetr, vértice de la parábola, v[eé]rtice de la par, fórmula general, forma general de la ecuación, ax2, ax², x² + bx, x 2 + bx, f(x)=x2, trinomio, cuadrado perfecto, factoriza, raíces de la ecuación, grado 2, completar el cuadrado,…

### Matemática 2º Medio

✅ 0 · 🟡 4 · 🔁 0 · ❌ 2

| | Punto a trabajar | Dónde se enseña | Págs. | También en |
|---|---|---|---|---|
| 🟡 | Función y ecuación cuadrática. | La ecuación de segundo grado | 52–62 | 64–65, 66–69, 70–71, 72–75, 88–91 |
| 🟡 | Operaciones con números racionales, potencias, raíces y sus propiedades. | Raíz enésima | 20–22 | 12–14, 15–18, 23–24, 25–27 |
| 🟡 | Probabilidades, regla multiplicativa y regla aditiva. | Principios básicos de conteo | 125–126 | 127–128, 129–130, 131–132, 140–147, 156–157 |
| 🟡 | Productos notables. | Resolución de una ecuación de segundo grado por factorización | 54–56 | 56–59, 71 |

**Función y ecuación cuadrática.**
> «Una ecuación de segundo grado o ecuación cuadrática tiene la forma: ax² + bx + c = 0, con a, b, c ∈ ℝ y a ≠ 0. Donde a, b y c son llamados coeficientes de la ecuación.» — pág. 52
> 
> · **págs. 64–65** — definición de función cuadrática
> · **págs. 66–69** — tabla de valores y gráfico de la parábola
> · **págs. 70–71** — forma canónica y vértice de la parábola
> · **págs. 72–75** — aplicaciones de la función cuadrática
> · **págs. 88–91** — la función inversa de la cuadrática
> 
> refutado por el auditor: la página cubre solo parte del conocimiento ‖ Este tramo (Lección 5) es la ecuación: definición y raíces pp. 52-53, y los tres métodos de resolución — por factorización pp. 54-55, por completación de cuadrados pp. 56-59, por fórmula general pp. 60-62. La FUNCIÓN cuadrática…

**Operaciones con números racionales, potencias, raíces y sus propiedades.**
> «Se llama raíz enésima de un número a, y se escribe ⁿ√a, a un número b que cumple la condición ⁿ√a = b ⇔ bⁿ = a. Donde ⁿ√a se llama radical; a, radicando o cantidad subradical y n, índice de la raíz.» — pág. 20
> 
> · **págs. 12–14** — operaciones con raíces: multiplicar, dividir y descomponer raíces
> · **págs. 15–18** — aproximación y orden de los números irracionales
> · **págs. 23–24** — único lugar donde se unen potencias y raíces (potencia de exponente racional)
> · **págs. 25–27** — racionalización de expresiones con raíces
> 
> FALTA la parte de números racionales y de propiedades de las potencias: el libro NO las enseña, las da por sabidas de cursos anteriores (p. 10, evaluación diagnóstica 'Aplica las propiedades de las potencias para...'; p. 24 pregunta de entrada '¿Qué propiedades tienen las potencias? Elabora un…

**Probabilidades, regla multiplicativa y regla aditiva.**
> «El principio multiplicativo establece [cita del libro: 20 palabras · cb5831d4745c3fb5] m · n casos posibles en total.» — pág. 125
> 
> · **págs. 127–128** — permutaciones
> · **págs. 129–130** — variaciones
> · **págs. 131–132** — combinaciones
> · **págs. 140–147** — probabilidad de una variable aleatoria
> · **págs. 156–157** — la probabilidad propiamente tal: regla de Laplace (probabilidad clásica), probabilidad experimental y subjetiva
> 
> FALTA la regla aditiva: el objetivo de la lección la anuncia ('Objetivo: Aplicar el principio aditivo y multiplicativo para resolver problemas', p. 125) pero el libro nunca la define ni la desarrolla — no hay recuadro de principio aditivo, ni P(A ∪ B) = P(A) + P(B) − P(A ∩ B), ni sucesos…

**Productos notables.**
> «Recuerda las factorizaciones: a² − b² = (a + b)(a − b); a² + (p + q)a + pq = (a + p)(a + q); a² + 2ab + b² = (a + b)(a + b)» — pág. 54
> 
> · **págs. 56–59** — el cuadrado de binomio trabajado de nuevo, con modelo geométrico
> · **págs. 71** — uso del cuadrado de binomio para llegar a la forma canónica de la función cuadrática
> 
> FALTA la enseñanza de los productos notables como contenido propio: el libro los da por conocidos y solo los recuerda en un recuadro para poder factorizar. La pregunta de entrada de la lección lo confirma: '¿Qué es una factorización? ¿Qué son los productos notables y cuáles conoces?' (p. 54-55). Se…

**❌ No están en este libro**

- **Homotecias y teorema de Thales.**
  HUECO CONFIRMADO por un segundo lector. Términos probados: homotec, centro de, razón de, factor de, Thales, Tales, teorema de tales, hall?es, tales de mileto, semejan, semejante, semejanza, congruen, proporcional, segmentos proporcion, misma razón, proporción entre, escala, amplific, amplificar, ampliar, reducir la figura, paralel, transformación, traslación, rotación, reflexión, isométric,…
- **Sistemas de ecuaciones lineales (2x2).**
  HUECO CONFIRMADO por un segundo lector. Términos probados: sistema de ecuaci, sistemas de ecuaci, sistema, dos incógnitas, incógnitas, sustitución, igualación, reducción, simultáne, ecuación lineal, ecuaciones lineales, primer grado, recta, intersección de, se intersecan, corte de, dos ecuaciones, par ordenado, 2x2 / 2 × 2, determinante, Cramer, matriz, matrices, revisión del índice completo…

### Química 1º Medio

✅ 1 · 🟡 0 · 🔁 2 · ❌ 5

| | Punto a trabajar | Dónde se enseña | Págs. | También en |
|---|---|---|---|---|
| ✅ | Leyes de conservación de la materia. Reacciones químicas y formación de compuestos útiles para los seres vivos. | ¿Qué es la ley de conservación de la materia? | 40–48 | — |

**Leyes de conservación de la materia. Reacciones químicas y formación de compuestos útiles **
> «La [cita del libro: 28 palabras · 3fa8ce69805b0637] productos.» — pág. 40
> 
> El tramo principal es la Lección 2 de la Unidad 2 'Reacciones químicas': el enunciado de la ley está en la pág. 45, el balance de ecuaciones que se deriva de ella en las 42-44 ('Una [cita del libro: 16 palabras · 578af0738d58698b] materia', pág. 43), la…

**🔁 Están en el tomo, pero en la mitad del otro curso**

- Principios básicos de herencia genética en plantas y animales propuestos por Mendel. Estructura y función del ADN. — págs. 147–149
- Química orgánica y los grupos funcionales (haluros, éteres, alcoholes, entre otros). Propiedades y características del carbono y su relación en la formación de moléculas orgánicas. Fotosíntesis y la respiración celular y ciclo del carbono. — págs. 146–150

**❌ No están en este libro**

- **Características y propiedades del sonido y la luz, y su impacto en la vida cotidiana.**
  HUECO CONFIRMADO por un segundo lector. Términos probados: sonid, acústic, sonor, onda, ondas, longitud de onda, amplitud de onda, frecuencia, vibraci, timbre, decibel, eco, refracci, reflexión de la luz, espectro, óptic, espejo, lente, lupa, prisma, arcoíris, velocidad de la luz, electromagn, ultraviolet, infrarroj, radiación, fotón, luz polarizada ‖ Refutación fallida. 'Espejo' aparece varias…
- **Evolución, teorías asociadas y sus evidencias y su impacto en el desarrollo de la vida. Relación entre organismo, población, comunidad y ecosistema.**
  HUECO CONFIRMADO por un segundo lector. Términos probados: evoluci, selección natural, darwin, lamarck, adaptaci, ancestro común, ancestr, fósil, especiaci, biodiversidad, ecosistema, población, comunidad, nicho, cadena trófica, hábitat, organismo, niveles de organización, herencia, genétic, ADN, mutaci, seres vivos, flujo de materia y energía ‖ Refutación fallida: verifiqué el índice completo…
- **La creación y evolución del universo según teorías científicas y cosmovisiones de los pueblos originarios.**
  HUECO CONFIRMADO por un segundo lector. Términos probados: universo, big bang, galax, estrella, nebulos, cósmic, agujero negro, telescopio, astro, planeta, sistema solar, expansión del universo, origen de la vida, cosmovis, pueblos originarios, mapuche, aimara, indígena ‖ Refutación fallida. 'Universo' solo aparece en la Gran Idea de la Ciencia de la unidad de isomería (pág. 159): 'Todo material…
- **Movimiento, ley de conservación de la energía mecánica y los conceptos de trabajo y potencia mecánica.**
  HUECO CONFIRMADO por un segundo lector. Términos probados: energía mecánica, energía cinética, energía potencial, trabajo mecánico, potencia mecánica, velocidad, rapidez, movimiento rectilíneo, MRU, aceleraci, fuerza, joule, watt, newton, conservación de la energía, caída libre, colisiones ‖ Refutación fallida. 'Energía cinética' solo aparece dentro de la teoría de las colisiones (guía del…
- **Sistemas del cuerpo humano: características y estructuras básicas del sistema nervioso y endocrino; nervios y cerebro, páncreas y hormonas sexuales y pancreáticas. Efectos del consumo de drogas, medidas de protección y autocuidado.**
  HUECO CONFIRMADO por un segundo lector. Términos probados: sistema nervioso, nervios, neuron, sinapsis, estímulo, cerebro, endocrin, hormon, glándula, páncreas, insulina, testosterona, estrógen, adrenalina, noradrenalina, droga, adicci, dependencia, abstinencia, psicoactiv, estupefac, nicotina, cigarr, cafeína, alcoholismo, tabaco, autocuidado, salud mental, receptor, fármac, medicament, consumo…

### Química 2º Medio

✅ 0 · 🟡 2 · 🔁 1 · ❌ 5

| | Punto a trabajar | Dónde se enseña | Págs. | También en |
|---|---|---|---|---|
| 🟡 | Principios básicos de herencia genética en plantas y animales propuestos por Mendel. Estructura y función del ADN. | ¿Qué son los compuestos orgánicos? | 148–149 | — |
| 🟡 | Química orgánica y los grupos funcionales (haluros, éteres, alcoholes, entre otros). Propiedades y características del carbono y su relación en la formación de moléculas orgánicas. Fotosíntesis y la respiración celular y ciclo del carbono. | ¿Qué son los compuestos orgánicos? | 138–147 | 24–25 |

**Principios básicos de herencia genética en plantas y animales propuestos por Mendel. Estru**
> «El ADN está formado por unidades básicas denominadas nucleótidos.» — pág. 148
> 
> Falta TODO Mendel: cero aciertos para 'Mendel', 'dominante', 'recesivo', 'alelo', 'genotipo', 'fenotipo', 'heredar', 'cromosoma' en el corpus completo. Del ADN el libro solo da la mirada química, dentro del recuadro de biomoléculas de la Lección 2 'Funciones orgánicas en nuestro entorno y en los…

**Química orgánica y los grupos funcionales (haluros, éteres, alcoholes, entre otros). Propi**
> «Los [cita del libro: 16 palabras · 6a91f5b0f39a2e06] formar cuatro enlaces» — pág. 138
> 
> · **págs. 24–25** — fotosíntesis y respiración celular, con sus ecuaciones químicas; además fermentación y respiración anaeróbica
> 
> FALTA el ciclo del carbono: cero aciertos en todo el corpus para 'ciclo del carbono', 'ciclo biogeoquímico', 'ciclos de la materia'. Todo lo demás sí está, en la Unidad 3 'Química orgánica' (pp.135-155). Propiedades del carbono: p.138 (tetravalencia, cadenas carbonadas, enlaces covalentes,…

**🔁 Están en el tomo, pero en la mitad del otro curso**

- Leyes de conservación de la materia. Reacciones químicas y formación de compuestos útiles para los seres vivos. — págs. 42–45

**❌ No están en este libro**

- **Características y propiedades del sonido y la luz, y su impacto en la vida cotidiana.**
  HUECO CONFIRMADO por un segundo lector. Términos probados: sonido, sonid, sonor, acústic, timbre, tono, eco, ultrasonid, decibel, hertz, ruido, vibra, vibración, resonan, audici, oído, oír, amplitud, frecuencia del sonido, propagación, onda, ondas, longitud de onda, frecuencia, espectro, espectro electromagnético, electromagn, fotón, radiación, infrarrojo, ultravioleta, UV, refracción, índice de…
- **Evolución, teorías asociadas y sus evidencias y su impacto en el desarrollo de la vida. Relación entre organismo, población, comunidad y ecosistema.**
  HUECO CONFIRMADO por un segundo lector. Términos probados: evoluc, evolución, evolutiv, Darwin, selección natural, Lamarck, Wallace, origen de las especies, teoría evolutiva, especiaci, ancestr, fósil, adaptación, adaptad, especie, especies, endémic, nativa, extinción, conservación de especies, biodivers, ecosistem, población, comunidad, trófic, nivel trófico, hábitat, bioma, cadena alimentaria,…
- **La creación y evolución del universo según teorías científicas y cosmovisiones de los pueblos originarios.**
  HUECO CONFIRMADO por un segundo lector. Términos probados: universo, creación del universo, origen del universo, expansión del universo, corrimiento al rojo, big bang, galaxia, vía láctea, nebulosa, estrella, sistema solar, cosmo, cosmología, astro, astronomía, astroquímica, meteorito, espacio exterior, origen de la vida, origen de la materia, cosmovisión, pueblos originarios, mapuche, aymara,…
- **Movimiento, ley de conservación de la energía mecánica y los conceptos de trabajo y potencia mecánica.**
  HUECO CONFIRMADO por un segundo lector. Términos probados: energía mecánica, potencia mecánica, trabajo mecánico, conservación de la energía, energía cinética, energía potencial, velocidad media, rapidez, distancia recorrida, desplazamiento, trayectoria, movimiento rectilíneo, caída libre, aceleración, m/s, km/h, joule, julio, watt, kW, newton, ley de Newton, inercia, fuerza, fricción, gravedad,…
- **Sistemas del cuerpo humano: características y estructuras básicas del sistema nervioso y endocrino; nervios y cerebro, páncreas y hormonas sexuales y pancreáticas. Efectos del consumo de drogas, medidas de protección y autocuidado.**
  HUECO CONFIRMADO por un segundo lector. Términos probados: sistema nervioso, sistema endocrino, sistema digestivo, sistema respiratorio, sistema circulatorio, sistema reproductor, aparato digestivo, nervios, nervio, neurona, neurotransmis, sinapsis, cerebro, cerebr, encéfalo, médula espinal, reflejo, estímulo y respuesta, receptor sensorial, endocrin, hormona, glándula, páncreas, insulina,…

---

## Nivel 2 Educación Media

**Cursos:** 3º y 4º Medio

### Ciencias Para La Ciudadanía 3º Medio

✅ 4 · 🟡 4 · 🔁 0 · ❌ 0

| | Punto a trabajar | Dónde se enseña | Págs. | También en |
|---|---|---|---|---|
| 🟡 | Cambio climático, efecto invernadero y sus implicancias. | Unidad 1 Cambio climático local y global — Efectos del cambio climático | 170–173 | 176–179, 180–181, 182–184, 185 |
| ✅ | Desarrollo astronómico en Chile y en el mundo. | Unidad 1 Innovación tecnológica y conocimiento del mundo (Módulo Tecnología y Sociedad) | 249–251 | — |
| 🟡 | Eficiencia energética y medidas para el buen uso de la electricidad. | Unidad 2 Consumo sostenible y conciencia ambiental — Estrategias de consumo sostenible | 226–228 | 142–144 |
| 🟡 | Enlace químico y reactividad en sustancias químicas. Plaguicidas, insecticidas y sustancias químicas de uso común. | Unidad 2 Amenazas y riesgos en mi entorno diario (Módulo Seguridad, Prevención y Autocuidado) | 126–131 | 37–38, 94, 119–130, 132, 133–139 |
| ✅ | Proyectos tecnológicos que permitan resolver problemas relacionados con las ciencias en diversos ámbitos de la vida. | Unidad 2 Desarrollo y aplicación de proyectos tecnológicos (Módulo Tecnología y Sociedad) | 286–310 | — |
| ✅ | Radiación y su efecto en el ser humano y el entorno. | Unidad 2 Amenazas y riesgos en mi entorno diario (Módulo Seguridad, Prevención y Autocuidado) | 149–152 | — |
| 🟡 | Relación entre salud y enfermedad. Sistema inmune, alergias y enfermedades autoinmunes. Medidas de prevención, como el uso de vacunas. | Unidad 2 Prevención y transmisión de infecciones — Agentes patógenos y defensas | 64–75 | 16–18, 76–91 |
| ✅ | Sostenibilidad de recursos naturales y consumo responsable. | Unidad 2 Consumo sostenible y conciencia ambiental | 200–213 | — |

**Cambio climático, efecto invernadero y sus implicancias.**
> «Algunos gases [cita del libro: 20 palabras · 878ebb578813cfdc] fuera.» — pág. 170
> 
> · **págs. 176–179** — implicancias: megasequía y escasez hídrica
> · **págs. 180–181** — implicancias: desertificación
> · **págs. 182–184** — implicancias: aumento del nivel del mar
> · **págs. 185** — implicancias: acidificación del océano
> 
> TOMO COMBINADO 3º+4º medio: el PDF no marca el curso. pp. 170-171 distinguen cambio climático de calentamiento global y listan causas antrópicas y factores; pp. 172-173 enseñan el efecto invernadero con los dos esquemas comparados, natural y amplificado ('Los gases de efecto invernadero impiden que…

**Desarrollo astronómico en Chile y en el mundo.**
> «En Chile están [cita del libro: 28 palabras · 66590210a568ad2b] muchos otros.» — pág. 249
> 
> TOMO COMBINADO 3º+4º medio: el PDF no identifica el curso del tramo. Tramo corto y exacto: pp. 249-251 recorren la evolución de los instrumentos de observación desde el telescopio refractor de Galileo hasta los observatorios espaciales, nombran los telescopios instalados en Chile (E-ELT en cerro…

**Eficiencia energética y medidas para el buen uso de la electricidad.**
> «El concepto de eficiencia energética se relaciona con la optimización de la energía.» — pág. 226
> 
> · **págs. 142–144** — el buen uso de la electricidad como seguridad: modelo del sistema eléctrico domiciliario, automáticos ante cortocircuito y riesgos eléctricos del hogar
> 
> TOMO COMBINADO 3º+4º medio: el PDF no indica el curso de cada tramo. El tramo corto pp. 226-228 es el núcleo: proyecto de evaluar la eficiencia energética del hogar (infografía de usos de la energía, luces y artefactos de bajo consumo, filtraciones en ventanas y puertas) y problemática del colegio,…

**Enlace químico y reactividad en sustancias químicas. Plaguicidas, insecticidas y sustancia**
> «Al usar [cita del libro: 21 palabras · a9937c613fbeba07] del entorno.» — pág. 126
> 
> · **págs. 37–38** — efectos de los plaguicidas en la salud
> · **págs. 94** — sustancias químicas de uso común y su peligrosidad
> · **págs. 119–130** — sustancias químicas de uso común y su peligrosidad: pictogramas, etiquetado, detergentes, cloro doméstico
> · **págs. 132** — desafío del DDT, como cierre de plaguicidas e insecticidas
> · **págs. 133–139** — intoxicaciones domésticas y el peligro de mezclar productos
> 
> TOMO COMBINADO 3º+4º medio: el libro no distingue el curso. Falta ENLACE QUÍMICO: busqué 'enlace', 'enlace covalente', 'enlace iónico', 'electronegatividad', 'tabla periódica' y 'compuesto químico' en las 323 páginas y NO hay ni una aparición — el libro no enseña enlace. REACTIVIDAD tampoco se…

**Proyectos tecnológicos que permitan resolver problemas relacionados con las ciencias en di**
> «¿Cuál es el [cita del libro: 16 palabras · ce4ac2e91f150efd] registro de sus características.» — pág. 286
> 
> TOMO COMBINADO 3º+4º medio: el libro no dice a qué año pertenece esta unidad. Acá el tramo largo se justifica: la unidad entera ES el conocimiento, una batería de proyectos tecnológicos que resuelven un problema real distinto cada uno — generación eléctrica para una localidad aislada (pp. 286-287),…

**Radiación y su efecto en el ser humano y el entorno.**
> «Hay dos tipos de [cita del libro: 24 palabras · 4df4b5546221df69] la radiación infrarroja» — pág. 149
> 
> TOMO COMBINADO 3º+4º medio: no se puede saber a qué año corresponde el tramo. Elegí pp. 149-152 porque ahí se clasifica la radiación (ionizante / no ionizante), se identifican las fuentes en la casa (microondas, pantallas) y se evalúan los efectos de las ondas electromagnéticas de los celulares y…

**Relación entre salud y enfermedad. Sistema inmune, alergias y enfermedades autoinmunes. Me**
> «Las barreras [cita del libro: 12 palabras · 91638728655ed3d6] y células de memoria.» — pág. 64
> 
> · **págs. 16–18** — definición de salud y su relación con la enfermedad, y medidas de prevención (vías de transmisión, lavado de manos, ITS)
> · **págs. 76–91** — prevención de enfermedades concretas: hanta, VIH, hepatitis B, coronavirus
> 
> TOMO COMBINADO 3º+4º medio: el PDF no marca a qué curso pertenece cada tramo, así que la ubicación es del volumen, no del año. Falta lo de ALERGIAS y ENFERMEDADES AUTOINMUNES: busqué 'alergi', 'autoinmun', 'antígeno', 'hipersensibilidad' en todo el libro; 'autoinmun' da CERO resultados y 'alergi'…

**Sostenibilidad de recursos naturales y consumo responsable.**
> «la sostenibilidad consiste en [cita del libro: 16 palabras · ab0680470b3fea2b] sus propias necesidades» — pág. 200
> 
> TOMO COMBINADO 3º+4º medio: el libro no separa los cursos. Tomé el tramo 200-213 porque las dos mitades del conocimiento se enseñan ahí: el CONSUMO RESPONSABLE en pp. 200-205 (consumo sostenible, reducción de plásticos y su codificación, regla 3R, consumo colaborativo, estrategia familiar de…

### Ciencias Para La Ciudadanía 4º Medio

✅ 4 · 🟡 4 · 🔁 0 · ❌ 0

| | Punto a trabajar | Dónde se enseña | Págs. | También en |
|---|---|---|---|---|
| 🟡 | Cambio climático, efecto invernadero y sus implicancias. | Efectos del cambio climático (Módulo Ambiente y Sostenibilidad, Unidad 1: Cambio climático local y global) | 170–175 | 176–191 |
| ✅ | Desarrollo astronómico en Chile y en el mundo. | Impacto del avance tecnológico (Módulo Tecnología y Sociedad, Unidad 1: Innovación tecnológica y conocimiento del mundo) | 249–251 | — |
| 🟡 | Eficiencia energética y medidas para el buen uso de la electricidad. | Hacia un desarrollo sostenible (Módulo Ambiente y Sostenibilidad, Unidad 2: Consumo sostenible y conciencia ambiental) | 226–228 | 286–287, 295, 298–299 |
| 🟡 | Enlace químico y reactividad en sustancias químicas. Plaguicidas, insecticidas y sustancias químicas de uso común. | Sustancias químicas de uso cotidiano (Módulo Seguridad, Prevención y Autocuidado, Unidad 2: Amenazas y riesgos en mi entorno diario) | 126–131 | 37–38, 119–125, 132–134, 135–139 |
| ✅ | Proyectos tecnológicos que permitan resolver problemas relacionados con las ciencias en diversos ámbitos de la vida. | Proyectos y soluciones tecnológicas (Módulo Tecnología y Sociedad, Unidad 2: Desarrollo y aplicación de proyectos tecnológicos) | 286–307 | — |
| ✅ | Radiación y su efecto en el ser humano y el entorno. | Peligros en el hogar y lugar de trabajo (Módulo Seguridad, Prevención y Autocuidado, Unidad 2: Amenazas y riesgos en mi entorno diario) | 149–153 | — |
| 🟡 | Relación entre salud y enfermedad. Sistema inmune, alergias y enfermedades autoinmunes. Medidas de prevención, como el uso de vacunas. | Agentes patógenos y defensas (Módulo Bienestar y Salud, Unidad 2: Prevención y transmisión de infecciones) | 64–73 | 17–18, 76–89 |
| ✅ | Sostenibilidad de recursos naturales y consumo responsable. | Hacia un desarrollo sostenible (Módulo Ambiente y Sostenibilidad, Unidad 2: Consumo sostenible y conciencia ambiental) | 212–214 | — |

**Cambio climático, efecto invernadero y sus implicancias.**
> «Algunos gases [cita del libro: 20 palabras · 878ebb578813cfdc] fuera.» — pág. 170
> 
> · **págs. 176–191** — las implicancias del cambio climático: megasequía y escasez hídrica (p. 176-177), ecosistemas hídricos y acuíferos (p. 178-180), desertificación (p. 181), alza del nivel del mar y ecosistemas costeros (p. 182-184), acidificación del océano por CO2 (p. 185), cambios en la cobertura vegetal y emisiones (p. 186-187), mitigación, adaptación y ecologismo (p. 188-189) y pérdida de biodiversidad (p. 190-
> 
> TOMO COMBINADO 3º+4º medio: no se distingue el año adentro del libro. Tramo exacto: p. 170 (causas antrópicas y conceptos clave), p. 171 (distinción entre cambio climático y calentamiento global, y factores: aumento de GEI, alza de temperatura, variación de precipitaciones, eventos extremos), p.…

**Desarrollo astronómico en Chile y en el mundo.**
> «En Chile están [cita del libro: 24 palabras · eb049d6746842c45] y el TGM» — pág. 249
> 
> TOMO COMBINADO 3º+4º medio: no puedo determinar el año desde el libro. Tramo corto y exacto, el proyecto '¿Cómo el [cita del libro: 12 palabras · 1a7ad074da0571a7] del universo?': p. 249 arranca con Galileo perfeccionando el telescopio refractor y…

**Eficiencia energética y medidas para el buen uso de la electricidad.**
> «El concepto de eficiencia energética se relaciona con la optimización de la energía.» — pág. 226
> 
> · **págs. 286–287** — generación de energía eléctrica: cómo se produce a partir del agua, el viento, los combustibles fósiles o el sol, y la importancia de las energías renovables
> · **págs. 295** — proyecto de kit de generación de energía eléctrica para situaciones de emergencia: qué artefactos puede abastecer y cómo mejorarlo
> · **págs. 298–299** — proyecto de casa energéticamente eficiente: capacidad de la vivienda de producir parte de la energía que consume
> 
> TOMO COMBINADO 3º+4º medio: el libro no señala a qué año corresponde el tramo. El núcleo es el proyecto '¿Qué acciones me permitirían hacer de mi hogar un lugar energéticamente eficiente?' (p. 226-227: definición, infografía de uso de la energía en el hogar, etiquetado de eficiencia A a G,…

**Enlace químico y reactividad en sustancias químicas. Plaguicidas, insecticidas y sustancia**
> «Según la composición química, los plaguicidas contienen compuestos organoclorados, organofosforados y carbamatos.» — pág. 126
> 
> · **págs. 37–38** — efecto de los plaguicidas en la salud: qué son los plaguicidas, vigilancia de trabajadores expuestos y daño cognitivo
> · **págs. 119–125** — sustancias químicas de uso común: categorías de productos domésticos con su peligrosidad y riesgos, productos de limpieza, detergentes y agentes tensoactivos (p. 121), limpiador casero y jabones (p. 123) y filtros solares químicos con el FPS (p. 124-125)
> · **págs. 132–134** — sustancias químicas de uso común: medicamentos y cosméticos —rotulado, composición química, forma farmacéutica, sobredosis y uso responsable
> · **págs. 135–139** — sustancias químicas de uso común: residuos peligrosos domiciliarios (RPD), productos '100 % naturales', almacenaje y eliminación segura, accidentes e intoxicaciones
> 
> TOMO COMBINADO 3º+4º medio: no se puede distinguir el año adentro del libro. Cubierto: plaguicidas e insecticidas (p. 130-131: clasificación por composición química y peligrosidad, DDT, sintéticos vs. naturales, proyecto de insecticida vegetal) y sustancias químicas de uso común (p. 118-129:…

**Proyectos tecnológicos que permitan resolver problemas relacionados con las ciencias en di**
> «Identificar una localidad [cita del libro: 12 palabras · bfe727e460ed11b2] registro de sus características.» — pág. 286
> 
> TOMO COMBINADO 3º+4º medio: el mismo PDF sirve a las dos materias y no indica el curso. Ésta es la unidad entera porque el conocimiento es justamente 'proyectos en diversos ámbitos', y cada par de páginas es un proyecto distinto: generación eléctrica para una localidad (p. 286-287), vivienda segura…

**Radiación y su efecto en el ser humano y el entorno.**
> «Habitualmente nos exponemos [cita del libro: 12 palabras · b2e270f4a1a9e4be] sol y del espacio.» — pág. 149
> 
> TOMO COMBINADO 3º+4º medio: no es posible saber de qué año es el tramo. Éste es el tramo corto y exacto: p. 149-151 distingue radiación electromagnética ionizante (rayos X y gamma) de no ionizante (ultravioleta, infrarroja, microondas y radiofrecuencias), pide identificar los artefactos del hogar…

**Relación entre salud y enfermedad. Sistema inmune, alergias y enfermedades autoinmunes. Me**
> «Las vacunas generan [cita del libro: 13 palabras · c02f8f11639a22c8] memoria.» — pág. 64
> 
> · **págs. 17–18** — la relación salud-enfermedad: estilos de vida y enfermedades crónicas (p. 17), la definición de salud de la OMS de 1946 con sus ámbitos físico, mental y social, y la prevención y transmisión de infecciones (p. 18)
> · **págs. 76–89** — medidas de prevención de infecciones y enfermedades transmisibles (hantavirus y otras zoonosis endémicas en Chile)
> 
> TOMO COMBINADO 3º+4º medio (mismo PDF para las dos materias, no marca el curso adentro): ubico por contenido, no por año. Cubierto: sistema inmune (p. 64-65: barreras primarias, secundarias innatas y terciarias adaptativas, órganos linfoides), agentes patógenos (p. 66), vacunas e inmunidad de grupo…

**Sostenibilidad de recursos naturales y consumo responsable.**
> «En ecología, [cita del libro: 28 palabras · 50f0e36e0c934df9] no es sostenible.» — pág. 212
> 
> TOMO COMBINADO 3º+4º medio: el PDF cuelga de las dos materias y no marca el curso. El tramo elegido es donde se define el concepto (p. 212-213: sostenibilidad, sus tres pilares ambiental, económico y social, el Informe Brundtland de 1987 y los Objetivos de Desarrollo Sostenible de la ONU). El…

### Educación Ciudadana 3º Medio

✅ 2 · 🟡 4 · 🔁 0 · ❌ 0

| | Punto a trabajar | Dónde se enseña | Págs. | También en |
|---|---|---|---|---|
| 🟡 | Conceptos económicos y economía global actual (por ejemplo: mercado financiero, comercio mundial, cambios en la producción y en el mercado del trabajo, nuevas formas de consumo). | ¿Cómo tomamos decisiones económicas en sociedad? | 98–103 | 104, 111, 118–119, 160, 220–225 |
| 🟡 | Democracia y ciudadanía en Chile (valores, atributos y dimensiones); libertades fundamentales, deberes del Estado, derechos y responsabilidades ciudadanas. | ¿Cuánto ha cambiado la democracia? | 17–19 | 27, 28–29, 30–31, 39 |
| ✅ | Derechos humanos y su reconocimiento, defensa y exigibilidad en Chile. | ¿Cómo me relaciono con los derechos humanos? (Lección 2 de la Unidad 2 «¿Cómo defiende el Estado nuestros derechos humanos?») | 56–62 | — |
| 🟡 | Desafíos de la ciudadanía local y global (por ejemplo: resolución de conflictos y bien común, responsabilidad personal, social y medioambiental). | ¿Cómo se transforman los territorios? | 86–88 | 34, 98, 116–117, 232–235 |
| ✅ | Mecanismos de acceso a la justicia y principales características del sistema judicial chileno. | ¿Cómo se garantiza el acceso a la justicia? (Lección 1 de la Unidad 2 «¿Cómo defiende el Estado nuestros derechos humanos?») | 42–51 | — |
| 🟡 | Procesos geográficos, sociales y culturales recientes en Chile y América Latina (por ejemplo: migraciones, presente de los pueblos indígenas, cambios demográficos, desafíos en torno a la planificación urbana y rural). | ¿Cómo avanzar hacia un territorio inclusivo? | 202–205 | 69–97, 143, 199–200 |

**Conceptos económicos y economía global actual (por ejemplo: mercado financiero, comercio m**
> «Escasez: problemática económica que surge de la existencia de recursos limitados para satisfacer necesidades ilimitadas.» — pág. 98
> 
> · **págs. 104** — cierre de los sistemas económicos (planificación centralizada) y la función del Banco Central, lo más cercano al mercado financiero que hay en el libro
> · **págs. 111** — la inflación y el rol del Banco Central, más ingresos fiscales e impuestos
> · **págs. 118–119** — comercio mundial, apenas de refilón: empresas transnacionales y 'Sueldos justos', el Comercio Justo y el consumo informado (también es lo que cubre 'nuevas formas de consumo')
> · **págs. 160** — nuevas formas de consumo: el hiperconsumismo definido como consumo excesivo de bienes
> · **págs. 220–225** — cambios en la producción y en el mercado del trabajo: automatización, sectores económicos (primario, secundario, terciario), trabajo por aplicaciones, contrato, despido y finiquito. Está en la mitad de 4º medio del mismo tomo
> 
> Lo que SÍ está: conceptos económicos básicos —escasez, bien común, sistema económico, agentes económicos (p.98), flujo circular de la economía entre familias, empresas y Estado (p.99), análisis de causas de un fenómeno económico, la subida de precios (pp.100-101), y los tres sistemas económicos:…

**Democracia y ciudadanía en Chile (valores, atributos y dimensiones); libertades fundamenta**
> «Una de los aspectos [cita del libro: 20 palabras · 6ba74cc52a7391e0] libertades?» — pág. 17
> 
> · **págs. 27** — la mitad 'ciudadanía' del conocimiento: nacionalidad y ciudadanía en Chile según la Constitución vigente, y la inscripción en el registro electoral
> · **págs. 28–29** — las dimensiones o perspectivas sobre la ciudadanía: liberal (sufragio, propiedad, libertad de expresión), comunitaria y republicana (Habermas, civilidad)
> · **págs. 30–31** — participación ciudadana: indicadores de participación, la participación como derecho y como deber, ciudadanía activa (Adela Cortina) y la caída de la participación electoral
> · **págs. 39** — las responsabilidades del ciudadano y cómo el énfasis liberal en los derechos las dejó en desmedro
> 
> Tramo exacto: p.17 Recurso 3 «Los valores fundamentales de la democracia» (libertad, igualdad, soberanía popular, dignidad, DD.HH.) y Recurso 4 «Atributos de la democracia» de Robert Dahl; p.18 Recurso 2 «Los deberes del Estado chileno en la Constitución» (arts. 1° y 5°) más el art. 19° con…

**Derechos humanos y su reconocimiento, defensa y exigibilidad en Chile.**
> «la defensa de los [cita del libro: 24 palabras · a01e6fd62dc75fe4] garante.» — pág. 56
> 
> La lección completa va de la p.52 a la p.63. Reconocimiento: DUDH y lista abreviada de derechos, pp.53-56; qué son y sus características (universales, indivisibles, exigibles), p.57. Defensa en Chile: leyes 21.154, 20.609, 21.120 y 20.422 y el INDH, pp.58-59. Exigibilidad: Plan Nacional de Derechos…

**Desafíos de la ciudadanía local y global (por ejemplo: resolución de conflictos y bien com**
> «La decisión de [cita del libro: 20 palabras · e3c1bf85d1a44029] o mundial.» — pág. 86
> 
> · **págs. 34** — el bien común: '¿Cómo participar en la búsqueda del bien común?' con el Recurso 1 '¿Qué es el bien común?' (el beneficio general que propicia la paz social) y los trámites, obligaciones y beneficios del Estado
> · **págs. 98** — el bien común otra vez, como entrada de vocabulario dentro de los conceptos económicos
> · **págs. 116–117** — responsabilidad medioambiental: desarrollo sostenible, la Agenda 2030 y los Objetivos de Desarrollo Sostenible, con el caso de la acuicultura frente al cambio climático
> · **págs. 232–235** — responsabilidad medioambiental y social, ya en la mitad de 4º medio del tomo: desarrollo como acceso a espacios públicos de calidad, instrumentos económicos y áreas protegidas, educación ambiental, y el impacto de las políticas económicas en la calidad de vida
> 
> El recuadro «¿Cómo avanzar hacia una justicia social y ambiental?» (pp.86-88) es lo que mejor cubre la escala local/global y la RESPONSABILIDAD personal y social: define justicia social con sus 3 aspectos (conflicto, pobreza, discriminación), justicia ambiental con casos chilenos —Ventanas y…

**Mecanismos de acceso a la justicia y principales características del sistema judicial chil**
> «El Poder Judicial está [cita del libro: 24 palabras · f7ed4b4a684e0ebc] específicas» — pág. 42
> 
> Núcleo en pp.42-45: tratados internacionales en materia de justicia (p.42); organigrama del sistema judicial con Corte Suprema, Cortes de Apelaciones y los distintos juzgados —civiles, de garantía, de familia, laborales, tribunales de juicio oral en lo penal— (p.43); Ministerio Público/Fiscalía y…

**Procesos geográficos, sociales y culturales recientes en Chile y América Latina (por ejemp**
> «durante los [cita del libro: 24 palabras · fae44e834ab089d0] para inmigrantes» — pág. 202
> 
> · **págs. 69–97** — el marco geográfico del conocimiento: dimensiones del territorio, límites del territorio nacional y Estado-nación, administración territorial, descentralización y desafíos territoriales; incluye qué es y para qué sirve un censo de población y vivienda (p. 73). No trata migraciones ni pueblos indígenas
> · **págs. 143** — cambios demográficos, suelto: Chile líder regional en esperanza de vida y envejecimiento de la población
> · **págs. 199–200** — desafíos de planificación urbana: espacio público, regulación del territorio entre actores e intereses, multimodalidad, sendas urbanas y velocidad de los vehículos
> 
> El recuadro «El desafío de un Chile intercultural» (pp.202-203) es lo mejor del libro para este conocimiento: fichas de los pueblos originarios (aymara, chango, colla, lickanantay, mapuche, rapa nui, etc.) y datos del INE sobre los migrantes en Chile (edad, país de origen: Venezuela 30,5 %, Perú…

### Educación Ciudadana 4º Medio

✅ 1 · 🟡 5 · 🔁 0 · ❌ 0

| | Punto a trabajar | Dónde se enseña | Págs. | También en |
|---|---|---|---|---|
| 🟡 | Conceptos económicos y economía global actual (por ejemplo: mercado financiero, comercio mundial, cambios en la producción y en el mercado del trabajo, nuevas formas de consumo). | ¿Cómo tomamos decisiones económicas en sociedad? | 98–107 | 111, 118–119, 218–225 |
| 🟡 | Democracia y ciudadanía en Chile (valores, atributos y dimensiones); libertades fundamentales, deberes del Estado, derechos y responsabilidades ciudadanas. | ¿Cuánto ha cambiado la democracia? | 17–19 | 25–35, 39, 186–197 |
| 🟡 | Derechos humanos y su reconocimiento, defensa y exigibilidad en Chile. | ¿Cómo me relaciono con los derechos humanos? | 52–63 | 41–42 |
| 🟡 | Desafíos de la ciudadanía local y global (por ejemplo: resolución de conflictos y bien común, responsabilidad personal, social y medioambiental). | ¿Qué brechas debemos superar para participar? | 148–151 | 34, 192–196, 226–238 |
| ✅ | Mecanismos de acceso a la justicia y principales características del sistema judicial chileno. | ¿Cómo se garantiza el acceso a la justicia? | 42–51 | — |
| 🟡 | Procesos geográficos, sociales y culturales recientes en Chile y América Latina (por ejemplo: migraciones, presente de los pueblos indígenas, cambios demográficos, desafíos en torno a la planificación urbana y rural). | ¿Cómo avanzar hacia un territorio inclusivo? | 202–203 | 73, 82–95, 198–200, 205, 209 |

**Conceptos económicos y economía global actual (por ejemplo: mercado financiero, comercio m**
> «Escasez: problemática económica que surge de la existencia de recursos limitados para satisfacer necesidades ilimitadas» — pág. 98
> 
> · **págs. 111** — política monetaria y el rol del Banco Central de Chile
> · **págs. 118–119** — comercio mundial: empresas transnacionales y comercio justo
> · **págs. 218–225** — cambios en la producción y en el mercado del trabajo: automatización, sectores primario/secundario/terciario, riders y plataformas digitales, trabajo no remunerado
> 
> El tramo principal (Unidad 4 de la mitad de 3º medio) enseña los conceptos económicos: escasez, sistema económico, agentes económicos, bien común, productividad (p. 99), el flujo circular de la economía (p. 99), los tres sistemas económicos (pp. 102-103) y las funciones fiscalizadora,…

**Democracia y ciudadanía en Chile (valores, atributos y dimensiones); libertades fundamenta**
> «Los valores fundamentales de la democracia. El siguiente [cita del libro: 16 palabras · f1203cb7714a0dae] humana» — pág. 17
> 
> · **págs. 25–35** — la parte de ciudadanía: el concepto de ciudadanía, las perspectivas liberal, comunitaria y republicana, y las responsabilidades ciudadanas
> · **págs. 39** — la tensión entre derechos ciudadanos y responsabilidades ciudadanas
> · **págs. 186–197** — los valores de la democracia retomados en la mitad de 4º medio: libertad, igualdad, solidaridad, dignidad y justicia social
> 
> OJO tomo combinado 3º+4º: este tramo cae en la mitad de 3º medio del PDF (Unidad 1, Lección 1), pero es el único lugar donde el libro enseña estos contenidos. Las páginas son las del PDF; la página impresa es la del PDF menos 2. En 17 están los valores (libertad, igualdad, soberanía popular,…

**Derechos humanos y su reconocimiento, defensa y exigibilidad en Chile.**
> «la defensa de los [cita del libro: 24 palabras · a01e6fd62dc75fe4] garante» — pág. 52
> 
> · **págs. 41–42** — reconocimiento: los tratados internacionales de derechos humanos con la fecha en que Chile los ratificó
> 
> Tomo combinado: la lección está en la mitad de 3º medio (Unidad 2 «¿Cómo defiende el Estado nuestros derechos humanos?»), pero enseña el conocimiento completo. Reconocimiento: pp. 56-57 (DUDH y sus características: universales, equitativos, indivisibles; obligaciones del Estado de respetar,…

**Desafíos de la ciudadanía local y global (por ejemplo: resolución de conflictos y bien com**
> «En [cita del libro: 28 palabras · cf1c11844ce85d56] común» — pág. 148
> 
> · **págs. 34** — definición de bien común y cómo participar en su búsqueda
> · **págs. 192–196** — responsabilidad personal y social a través del voluntariado y las organizaciones sociales
> · **págs. 226–238** — responsabilidad medioambiental global: modelos de desarrollo, calentamiento global, Acuerdo de París, IDH ajustado por presiones planetarias y ley de plásticos de un solo uso
> 
> Este es el tramo donde se enseña la resolución de conflictos ligada al bien común (p. 148, con el vocabulario de «conflicto» y «cohesión social»), la cartografía de conflictos socioambientales (p. 149), los conflictos territoriales y la protesta (p. 151) y los niveles de participación para resolver…

**Mecanismos de acceso a la justicia y principales características del sistema judicial chil**
> «El Poder Judicial está [cita del libro: 24 palabras · f7ed4b4a684e0ebc] específicas» — pág. 42
> 
> El buscador no propuso ninguna candidata y sí está: es la Lección 1 de la Unidad 2, en la mitad de 3º medio del tomo combinado. Detalle: p. 43 el organigrama del sistema judicial (juzgados civiles, de garantía, de familia, laborales, tribunales de juicio oral); p. 44-45 qué son el Ministerio…

**Procesos geográficos, sociales y culturales recientes en Chile y América Latina (por ejemp**
> «durante los [cita del libro: 32 palabras · c14c76f511ee7bcf] país» — pág. 202
> 
> · **págs. 73** — el censo de población y vivienda como fuente de los cambios demográficos
> · **págs. 82–95** — procesos territoriales generales: crisis hídrica, centro-periferia, descentralización, urbanización y participación en la planificación territorial
> · **págs. 198–200** — desafíos de la planificación urbana: espacio público, multimodalidad y sendas urbanas
> · **págs. 205** — planificación del territorio con perspectiva de género (manual de la Cepal)
> · **págs. 209** — patrimonio cultural, migrantes e inclusión social
> 
> Tramo corto y exacto: «El desafío de un Chile intercultural» (pp. 202-203) es donde de verdad se enseñan los dos ejemplos nombrados por el currículum: el Recurso 1 caracteriza uno por uno los pueblos indígenas reconocidos hoy en Chile (yagán, afrodescendiente, aymara, chango, colla, lickanantay,…

### Filosofía 3º Medio

✅ 3 · 🟡 1 · 🔁 1 · ❌ 0

| | Punto a trabajar | Dónde se enseña | Págs. | También en |
|---|---|---|---|---|
| ✅ | El problema filosófico del conocimiento humano: perspectivas sobre sus límites y posibilidades. | Unidad 3 • ¿Qué podemos conocer? — Lección 1 • ¿Qué es la verdad? | 72–73 | — |
| ✅ | El problema filosófico del ser humano: esencia y sentido de la vida humana. | Unidad 2 • ¿Qué es la existencia? — Lección 2 • ¿Qué es la existencia humana? | 52–62 | — |
| 🟡 | El problema filosófico del ser: perspectivas filosóficas sobre la realidad | Unidad 2 • ¿Qué es la existencia? — Lección 1 • ¿Es real aquello que percibimos mediante los sentidos? | 42–51 | — |
| ✅ | El saber filosófico. Origen, métodos, problemas de estudio y finalidad. | Unidad 1 • ¿Cómo se hace filosofía? (Lección 1 «¿Todas las personas pueden filosofar?» + Lección 2 «¿Qué herramientas necesito para filosofar?») | 14–34 | — |

**El problema filosófico del conocimiento humano: perspectivas sobre sus límites y posibilid**
> «El [cita del libro: 20 palabras · cd48d72cdf2d4ebd] conocimiento.» — pág. 72
> 
> La candidata del buscador («¿Todas las personas pueden filosofar?» 10-21, score 0.649) es INCORRECTA. El tramo exacto es el recuadro «¿Podemos acceder a la verdad?» (PDF 72-73 = págs. 70-71 del libro), que presenta justamente las perspectivas sobre los límites y posibilidades: dogmatismo ingenuo y…

**El problema filosófico del ser humano: esencia y sentido de la vida humana.**
> «En todas las épocas [cita del libro: 16 palabras · 2deef159a7da6d39] sentido de la vida.» — pág. 52
> 
> La candidata con score 0.9751 («¿Todas las personas pueden filosofar?», 10-21) es INCORRECTA: esa lección trata de qué es filosofar, no del ser humano. El tramo verificado es la Lección 2 de la Unidad 2, que el índice impreso ubica en la pág. 50 del libro = PDF 52. ESENCIA: PDF 52-55, cuerpo y alma…

**El problema filosófico del ser: perspectivas filosóficas sobre la realidad**
> «Como [cita del libro: 28 palabras · e690327cf3e4cfea] una respuesta definitiva.» — pág. 42
> 
> Las candidatas del buscador («¿Todas las personas pueden filosofar?» 10-21 y «¿Qué herramientas necesito para filosofar?» 22-40) son INCORRECTAS: esas son las lecciones de la Unidad 1, sobre qué es filosofar y sobre lógica/argumentación, no sobre el ser. El tramo correcto es la Lección 1 de la…

**El saber filosófico. Origen, métodos, problemas de estudio y finalidad.**
> «La [cita del libro: 16 palabras · 1cbc94c9eb9930b4] historia de la humanidad.» — pág. 14
> 
> Los cuatro componentes están, repartidos dentro de la Unidad 1 (páginas PDF; la numeración impresa del libro va 2 menos: PDF 14 = pág. 12 del libro). ORIGEN: PDF 14-16, con Aristóteles «los hombres comienzan y comenzaron siempre a filosofar movidos por la admiración» y la conciencia de la…

**🔁 Están en el tomo, pero en la mitad del otro curso**

- El problema filosófico ético moral: perspectivas ético-morales y cómo abordan problemáticas actuales. — págs. 150–177

### Filosofía 4º Medio

✅ 0 · 🟡 5 · 🔁 0 · ❌ 0

| | Punto a trabajar | Dónde se enseña | Págs. | También en |
|---|---|---|---|---|
| 🟡 | El problema filosófico del conocimiento humano: perspectivas sobre sus límites y posibilidades. | Unidad 1 • ¿Por qué necesitamos la filosofía? — Lección 1 • ¿Por qué es importante filosofar? («¿Hasta dónde llega el pensamiento filosófico?») | 132–133 | 126, 130–131, 212–214, 224–225 |
| 🟡 | El problema filosófico del ser humano: esencia y sentido de la vida humana. | Unidad 1 • ¿Por qué necesitamos la filosofía? — Lección 2 • ¿Por qué filosofar en la sociedad contemporánea? («¿Cómo se relaciona la filosofía con el mundo del trabajo?») | 140–142 | 190, 203, 215 |
| 🟡 | El problema filosófico del ser: perspectivas filosóficas sobre la realidad | Unidad 4 • El impacto de la filosofía en la sociedad — Lección 2 • ¿Qué presencia tiene la filosofía hoy? | 212–215 | 221, 225 |
| 🟡 | El problema filosófico ético moral: perspectivas ético-morales y cómo abordan problemáticas actuales. | Unidad 2 • Perspectivas filosóficas sobre la acción humana — Lección 1 • ¿Cómo debemos actuar? | 150–164 | 164–176 |
| 🟡 | El saber filosófico. Origen, métodos, problemas de estudio y finalidad. | Unidad 1 • ¿Por qué necesitamos la filosofía? — Lección 1 • ¿Por qué es importante filosofar? | 125–137 | 138–149, 150, 180–182, 204, 212, 224–225 |

**El problema filosófico del conocimiento humano: perspectivas sobre sus límites y posibilid**
> «Nunca sabremos [cita del libro: 20 palabras · b8715dd62d3843fa] objeciones residuales» — pág. 132
> 
> · **págs. 126** — los límites del conocimiento como punto de partida del filosofar
> · **págs. 130–131** — las posibilidades del conocimiento: la oposición doxa/episteme en Platón y la relación entre ciencia y filosofía
> · **págs. 212–214** — perspectivas sobre la verdad y el conocimiento: «La verdad como consenso» y Bunge desde la epistemología
> · **págs. 224–225** — definiciones del vocabulario del problema del conocimiento: epistemología, a priori/a posteriori, dogmatismo, giro lingüístico
> 
> La candidata propuesta (p. 10-21) es de 3º MEDIO y queda fuera del tramo 123-233. El tramo correcto y corto es este recuadro doble: «La verdad» con Platón y Millas, la duda de Descartes, Baudrillard «ir al límite» en vez de a la verdad (p. 132), Rorty sobre justificación versus verdad, Bergson…

**El problema filosófico del ser humano: esencia y sentido de la vida humana.**
> «Y [cita del libro: 24 palabras · 8fa2fe4685924a94] ser efecto del trabajo.» — pág. 140
> 
> · **págs. 190** — la esencia del ser humano problematizada: Simone de Beauvoir contra la esencia dada
> · **págs. 203** — el sentido de la vida: la disincronía y la «pérdida de sentido» según Byung-Chul Han
> · **págs. 215** — el sentido de la vida humana frente a la muerte y la trascendencia, con Jaspers
> 
> Las candidatas del buscador (p. 10-21 con score 0,975 y p. 22-40) son de 3º MEDIO y quedan fuera del tramo 123-233; además hablan de quién puede filosofar, no del ser humano. 4º medio NO tiene una unidad de antropología filosófica. Lo más cercano, y por eso lo marco parcial, es este tramo sobre el…

**El problema filosófico del ser: perspectivas filosóficas sobre la realidad**
> «Las [cita del libro: 16 palabras · 01628298ee764f1d] el mundo».» — pág. 212
> 
> · **págs. 221** — la síntesis nombra las perspectivas sobre la realidad: perspectiva materialista, perspectiva idealista, la verdad como consenso, posmodernidad
> · **págs. 225** — la única definición del problema del ser: qué estudia la ontología
> 
> Las dos candidatas propuestas («¿Todas las personas pueden filosofar?» p. 10-21 y «¿Qué herramientas necesito para filosofar?» p. 22-40) son de 3º MEDIO: están fuera del tramo 123-233 de esta materia, y además tratan de qué es filosofar, no de la realidad. Lo que sí enseña 4º medio son las…

**El problema filosófico ético moral: perspectivas ético-morales y cómo abordan problemática**
> «cada [cita del libro: 24 palabras · a99c8ee029b62613] utilitarista.» — pág. 150
> 
> · **págs. 164–176** — la otra mitad del conocimiento: cómo las perspectivas ético-morales abordan problemáticas actuales — el problema de las manos sucias (Maquiavelo, Coady), diversidad y pluralismo (Cortina), libertad negativa y positiva (Berlin), la ética del discurso (Apel y Habermas), la ética del reconocimiento, y los dilemas éticos del proyecto final
> 
> El buscador no propuso candidatas y sin embargo es el conocimiento mejor cubierto del libro. Aquí se distingue moral de ética (p. 152) y se enseñan las perspectivas: Aristóteles y el justo medio, Mill y el utilitarismo (p. 152), Kant y el imperativo categórico (p. 153), Hume y Nietzsche (p. 153), y…

**El saber filosófico. Origen, métodos, problemas de estudio y finalidad.**
> «Cuando [cita del libro: 24 palabras · e7bde15534e5ba7b] haciendo filosofía.» — pág. 125
> 
> · **págs. 138–149** — la finalidad del filosofar, que se sigue trabajando en esta lección
> · **págs. 150** — los problemas de estudio: listado de las ramas de la filosofía (ética, lógica, metafísica, epistemología)
> · **págs. 180–182** — los métodos, en la práctica: cómo analizar y evaluar un argumento filosófico paso a paso
> · **págs. 204** — los problemas de estudio: las ramas de la filosofía vueltas a listar
> · **págs. 212** — el origen histórico de la filosofía en Grecia (mención de una línea)
> · **págs. 224–225** — definición de los problemas de estudio: metafísica, ontología, epistemología, ética, estética
> 
> Verificado leyendo. El tramo enseña el origen del filosofar (el asombro, la duda y el problema filosófico, p. 126-127), qué se puede conocer desde la filosofía (p. 126), su relación con los demás saberes y con la ciencia (p. 130-131) y su alcance y finalidad (p. 132-137: «¿Hasta dónde llega el…

### Lengua Y Literatura 3º Medio

✅ 1 · 🟡 5 · 🔁 0 · ❌ 0

| | Punto a trabajar | Dónde se enseña | Págs. | También en |
|---|---|---|---|---|
| 🟡 | Argumentación: razonamientos, premisas, relaciones entre ideas y selección léxica. | Tus decisiones son más emocionales que racionales, aunque no te des cuenta, Sergio Parra | 198–200 | 49–50, 113, 167, 214, 221, 271 |
| ✅ | Efecto estético. | Qué vergüenza, Paulina Flores | 42 | — |
| 🟡 | Identidad discursiva. | La metamorfosis: El juego de la verdad, Filosofía&Co | 75 | 29, 225, 320 |
| 🟡 | Posicionamiento de un emisor, su propósito, ideas implícitas, ambigüedades y sesgos. | El cepillo de dientes, una historia de amor y crueldad llega al Teatro UC | 271 | 29, 75, 123 |
| 🟡 | Recursos literarios. | La otra, Gabriela Mistral | 112 | 113, 190, 213, 243, 264 |
| 🟡 | Temas, tópicos y motivos literarios universales. | Americanah, Chimamanda Ngozi Adichie | 301 | — |

**Argumentación: razonamientos, premisas, relaciones entre ideas y selección léxica.**
> «El [cita del libro: 12 palabras · 18eac1900a139640] validarlo.» — pág. 198
> 
> · **págs. 49–50** — las falacias: razonamientos defectuosos al evaluar argumentos
> · **págs. 113** — la selección léxica: adjetivos, sustantivos y verbos que cargan una valoración
> · **págs. 167** — relaciones entre ideas: conectores causales y refuerzo de las ideas con citas
> · **págs. 214** — los organizadores discursivos que ordenan las ideas del texto
> · **págs. 221** — el uso de citas para reforzar un argumento y las marcas del enunciador
> · **págs. 271** — la selección léxica como huella de las creencias e ideologías del autor
> 
> Tramo continuo de tres páginas: p.198-199 recuadro '¿Cómo evaluar la calidad de la información en un texto?' con el contraste de los argumentos de dos textos; p.200 el esquema TESIS / ARGUMENTOS / RESPALDOS con ejemplos, más 'Para asegurar la cohesión y coherencia del texto, puedes utilizar…

**Efecto estético.**
> «Una obra [cita del libro: 16 palabras · 41d6d08533d4dddc] como efecto estético.» — pág. 42
> 
> Recuadro 'Analizar el efecto estético' con el esquema completo de cuatro entradas (temas de la obra, representación del mundo, elementos formales, lector) y sus preguntas orientadoras. También se trabaja en p.52 y p.70 (preguntas), p.302 (aplicado a comparar dos novelas migrantes) y se define en el…

**Identidad discursiva.**
> «A [cita del libro: 24 palabras · feb247206f2bfb8c] aborda.» — pág. 75
> 
> · **págs. 29** — la situación de enunciación: enunciador y audiencia
> · **págs. 225** — las marcas del enunciador: primera persona singular y plural, tercera persona
> · **págs. 320** — la definición del término 'identidad discursiva' (definición de glosario, no lección)
> 
> Recuadro 'Recursos lingüísticos y posición frente a la audiencia': es la enseñanza operativa del concepto (construcción de la voz propia, postura de mayor o menor certeza, jerarquía/adhesión/distancia frente a la audiencia, léxico valorativo y deícticos). El TÉRMINO 'identidad discursiva' aparece…

**Posicionamiento de un emisor, su propósito, ideas implícitas, ambigüedades y sesgos.**
> «El propósito es el [cita del libro: 20 palabras · 83bb883873b8a275] que trata.» — pág. 271
> 
> · **págs. 29** — quién es el enunciador y a qué audiencia se dirige (situación de enunciación)
> · **págs. 75** — los recursos con que el emisor marca su postura y su grado de certeza frente a la audiencia
> · **págs. 123** — lo implícito y el sesgo: marcas de subjetividad, grados de certeza, expresión de opinión y de valoración, y el propósito implícito del emisor
> 
> Recuadro 'Evaluar propósito, punto de vista y posicionamiento' (género discursivo / propósito y punto de vista / creencias e ideologías) más la pauta de preguntas de posicionamiento. Lo IMPLÍCITO y el SESGO se enseñan aparte, en p.123, recuadro '¿Cómo se expresa la subjetividad en los textos?':…

**Recursos literarios.**
> «Un [cita del libro: 16 palabras · 34081f8ab9298bb4] con una tradición cultural.» — pág. 112
> 
> · **págs. 113** — el léxico valorativo como recurso para instalar una valoración o juicio
> · **págs. 190** — los recursos gráficos del manga: planos y viñetas, luz, sombra y color
> · **págs. 213** — el monólogo interior como recurso narrativo
> · **págs. 243** — los rasgos propios de la novela distópica como recursos del género
> · **págs. 264** — el conflicto dramático: las fuerzas u objetivos en tensión en la obra
> 
> Recuadro 'Claves de interpretación: ¿Cómo interpretar símbolos?' — el único recurso literario que el libro DEFINE. Otros recursos se enseñan sueltos en recuadros propios: p.213 'Marcas textuales de la conciencia del personaje' (monólogo interior: 'Mediante este recurso se introducen reflexiones,…

**Temas, tópicos y motivos literarios universales.**
> «¿Cómo interpretar dos obras que abordan un mismo tema? Identificar el tema. Determinar qué temáticas se abordan en cada texto y cuáles comparten.» — pág. 301
> 
> TOMO COMBINADO 3º+4º: el PDF es el mismo para 3º y 4º medio y no marca curso adentro. El recuadro 'Claves de interpretación' de p.301 es el ÚNICO lugar donde el libro enseña a identificar y comparar el TEMA de las obras (jerarquizar temáticas, punto de vista, efecto estético). Falta por completo…

### Lengua Y Literatura 4º Medio

✅ 1 · 🟡 5 · 🔁 0 · ❌ 0

| | Punto a trabajar | Dónde se enseña | Págs. | También en |
|---|---|---|---|---|
| 🟡 | Argumentación: razonamientos, premisas, relaciones entre ideas y selección léxica. | Lectura crítica: El consumo me consume, Tomás Moulian | 171 | 49–50, 75, 176, 199, 200, 271, 307 |
| ✅ | Efecto estético. | Qué vergüenza, Paulina Flores | 42 | — |
| 🟡 | Identidad discursiva. | La metamorfosis: El juego de la verdad, Filosofía&Co | 75 | 29, 225 |
| 🟡 | Posicionamiento de un emisor, su propósito, ideas implícitas, ambigüedades y sesgos. | El cepillo de dientes, una historia de amor y crueldad llega al Teatro UC | 271 | 123, 133, 279, 313 |
| 🟡 | Recursos literarios. | Qué vergüenza, Paulina Flores | 40 | 70, 112, 159, 166, 184, 190, 213 |
| 🟡 | Temas, tópicos y motivos literarios universales. | Americanah, Chimamanda Ngozi Adichie | 301 | 11, 16 |

**Argumentación: razonamientos, premisas, relaciones entre ideas y selección léxica.**
> «Suficiencia: las razones o premisas deben proporcionar evidencia suficiente para llegar a la conclusión.» — pág. 171
> 
> · **págs. 49–50** — las falacias (errores de razonamiento)
> · **págs. 75** — el léxico valorativo
> · **págs. 176** — síntesis de la evaluación de argumentos (razonamientos y premisas)
> · **págs. 199** — comparar la calidad argumentativa de dos textos
> · **págs. 200** — relaciones entre ideas: esquema tesis-argumentos-respaldos y conectores causales y consecutivos
> · **págs. 271** — la selección léxica como marca de las creencias e ideologías del autor
> · **págs. 307** — la selección léxica
> 
> Tomo combinado 3º+4º medio. El recuadro '¿Cómo evaluar argumentos?' (p. 171) cubre razonamientos y premisas: define tesis y argumentos y da los tres criterios (suficiencia, relevancia, aceptabilidad), con la actividad 'ANALIZAR Y EVALUAR LA ARGUMENTACIÓN'; se repite en la síntesis de p. 176. Las…

**Efecto estético.**
> «Una obra [cita del libro: 16 palabras · 41d6d08533d4dddc] como efecto estético.» — pág. 42
> 
> Tomo combinado 3º+4º medio. El recuadro 'Analizar el efecto estético' de p. 42 lo define y da el esquema completo para analizarlo (temas de la obra, representación del mundo, elementos formales, lector). Se retoma y aplica en varias páginas más: p. 52 ('¿Cuál es el efecto estético que intenta…

**Identidad discursiva.**
> «A [cita del libro: 24 palabras · feb247206f2bfb8c] aborda.» — pág. 75
> 
> · **págs. 29** — caracterizar a la enunciadora y su relación con la audiencia
> · **págs. 225** — las marcas del enunciador: primera persona singular/plural y tercera persona
> 
> Tomo combinado 3º+4º medio. El recuadro 'Recursos lingüísticos y posición frente a la audiencia' (p. 75) enseña el contenido del concepto casi con las mismas palabras que el glosario usa para definirlo: la voz que se construye adoptando 'una postura de mayor o menor certeza, de más o menos crítica'…

**Posicionamiento de un emisor, su propósito, ideas implícitas, ambigüedades y sesgos.**
> «El propósito es el [cita del libro: 24 palabras · 2305fecd89f98e70] vinculados.» — pág. 271
> 
> · **págs. 123** — las ideas implícitas: marcas de subjetividad, grados de certeza, opinión y valoración, y el propósito implícito del emisor
> · **págs. 133** — propósito explícito e implícito del emisor
> · **págs. 279** — propósito explícito e implícito del emisor
> · **págs. 313** — evaluación crítica de los elementos del texto (propósito e ideas implícitas)
> 
> Tomo combinado 3º+4º medio. El recuadro 'Evaluar propósito, punto de vista y posicionamiento' (p. 271) es el tramo más exacto: enseña género discursivo, propósito/punto de vista y creencias e ideologías, y la pauta de trabajo pregunta literalmente 'Posicionamiento - ¿Cuál es la posición del emisor…

**Recursos literarios.**
> «Una [cita del libro: 28 palabras · 184655b9267abe08] lector.» — pág. 40
> 
> · **págs. 70** — la intertextualidad: cita, alusión y parodia
> · **págs. 112** — el símbolo
> · **págs. 159** — las variaciones del habla como recurso estético para caracterizar personajes (Radrigán)
> · **págs. 166** — las variaciones del habla como recurso estético para caracterizar personajes (Radrigán)
> · **págs. 184** — los recursos gráficos del cómic (planos, luz y sombra)
> · **págs. 190** — los recursos gráficos del cómic (planos, luz y sombra)
> · **págs. 213** — el monólogo interior y el desplazamiento del narrador a la conciencia del personaje
> 
> Tomo combinado 3º+4º medio. El recuadro Claves de interpretación de p. 40 es el único que define el uso literario del lenguaje, pero NO nombra ni define ninguna figura (solo pregunta '¿Qué tipo de figuras son las destacadas?'). El resto de los recursos se enseña disperso: el símbolo en p. 112 ('Un…

**Temas, tópicos y motivos literarios universales.**
> «¿Cómo interpretar [cita del libro: 20 palabras · 7ae44fa4352c750a] comparten.» — pág. 301
> 
> · **págs. 11** — reconocer hechos u objetos que se reiteran en una obra (motivos recurrentes, sin nombrarlos así)
> · **págs. 16** — determinar el tema como paso del análisis del texto
> 
> Tomo combinado 3º+4º medio. Lo que sí se enseña es identificar el tema y compararlo entre dos obras de culturas distintas (recuadro Claves de interpretación, p. 301, sobre La nieta del señor Linh y Americanah); también se enseña a determinar el tema como paso del análisis en p. 16 ('Analizar el…

### Matemática 3º Medio

✅ 0 · 🟡 4 · 🔁 0 · ❌ 0

| | Punto a trabajar | Dónde se enseña | Págs. | También en |
|---|---|---|---|---|
| 🟡 | Cuartiles y quintiles, planilla de cálculo. | Comparación de conjuntos de datos | 16–18 | — |
| 🟡 | Elementos de la geometría básica para el dibujo técnico. | Ángulos del centro e inscrito en una circunferencia | 60–63 | 59, 64–68, 69–71, 72–81 |
| 🟡 | Función exponencial, planilla de cálculo. | Función exponencial | 36–39 | 17–18, 40–44 |
| 🟡 | Porcentajes, cambio porcentual constante, índices económicos, planilla de cálculo. | Crecimiento y decrecimiento exponencial | 42–43 | 17–18 |

**Cuartiles y quintiles, planilla de cálculo.**
> «Calcula los indicadores de posición: mediana y cuartiles. Q1 = 0, Me = 0,5, Q3 = 3» — pág. 16
> 
> En 16-18 están DOS de las tres partes. Cuartiles: se usan como medida de posición para comparar dos conjuntos ('se pueden utilizar [cita del libro: 24 palabras · 8287db7c5e5c3b5b] los…

**Elementos de la geometría básica para el dibujo técnico.**
> «En una [cita del libro: 16 palabras · 4199041e10e6db22] centro de la circunferencia» — pág. 60
> 
> · **págs. 59** — repaso diagnóstico de los elementos geométricos de la circunferencia (centro, radio, diámetro, cuerda, secante, tangente, arco)
> · **págs. 64–68** — desarrollo de los elementos de la circunferencia: ángulos interiores y exteriores
> · **págs. 69–71** — desarrollo de los elementos de la circunferencia: teorema de las cuerdas
> · **págs. 72–81** — desarrollo de los elementos de la circunferencia: teorema de las secantes y de la secante-tangente
> 
> Los elementos geométricos básicos sí se trabajan, pero SOLO los de la circunferencia y dentro de la Unidad 3 (59-81): la página 59 los repasa como diagnóstico ('Define [cita del libro: 12 palabras · cfda56725527eca1] Centro... d. Radio. e. Diámetro. f. Cuerda. g.…

**Función exponencial, planilla de cálculo.**
> «Se [cita del libro: 12 palabras · 2b91611bcdbd7a46] ab^x, donde a, b ∈ ℝ, con b > 0 y b ≠ 1.» — pág. 36
> 
> · **págs. 17–18** — planilla de cálculo: la única hoja de cálculo del tramo de 3° medio (=PROMEDIO, =VAR.P, =DESVEST.P), en estadística
> · **págs. 40–44** — continuación de la función exponencial con los modelos aplicados de crecimiento y decrecimiento
> 
> La función exponencial está COMPLETA en 36-39: definición, dominio (ℝ) y recorrido (ℝ+), intersección con el eje Y en (0, a), el eje X como asíntota, crecimiento si b > 1 y decrecimiento si 0 < b < 1, y las traslaciones horizontal y vertical de y = ab^(x−c) y y = ab^x + h. Se continúa en…

**Porcentajes, cambio porcentual constante, índices económicos, planilla de cálculo.**
> «Esta expresión se aplica [cita del libro: 12 palabras · 8826b613f7c154f1] de la cantidad existente» — pág. 42
> 
> · **págs. 17–18** — planilla de cálculo: la única hoja de cálculo del tramo de 3° medio, enseñada paso a paso en estadística
> 
> El tramo 42-43 sí enseña el cambio porcentual constante: interés compuesto con la fórmula C_t = C(1+i)^t, el bosque que crece 3,5 % cada año, la moto que se deprecia 20 % anual y el fármaco que pierde 50 % de efectividad por mes. FALTAN dos partes: (1) índices económicos — busqué 'IPC', 'índice de…

### Matemática 4º Medio

✅ 0 · 🟡 2 · 🔁 2 · ❌ 0

| | Punto a trabajar | Dónde se enseña | Págs. | También en |
|---|---|---|---|---|
| 🟡 | Elementos de la geometría básica para el dibujo técnico. | Distancia entre puntos en el plano cartesiano | 196–205 | 206–215 |
| 🟡 | Porcentajes, cambio porcentual constante, índices económicos, planilla de cálculo. | Porcentajes en el comercio | 110–113 | 119, 124–127, 128–131, 130 |

**Elementos de la geometría básica para el dibujo técnico.**
> «Tres puntos, [cita del libro: 26 palabras · 795061f567c41c25] equivalentes» — pág. 196
> 
> · **págs. 206–215** — circunferencia como elemento geométrico: centro, radio, ecuación y posición relativa
> 
> Falta la parte de DIBUJO TÉCNICO: busqué en 109-256 'dibujo técnico', 'escuadra', 'compás', 'regla y compás', 'escala', 'acotación', 'proyección ortogonal', 'isométrica', 'croquis', 'vista frontal', 'plano de una casa' y 'arquitecto' — cero resultados; el libro no enseña representación técnica ni…

**Porcentajes, cambio porcentual constante, índices económicos, planilla de cálculo.**
> «Lección Toma de decisiones [cita del libro: 20 palabras · 6057701709546193] un ejemplo.» — pág. 110
> 
> · **págs. 119** — índices económicos: el IPC y el cálculo de precios con su variación
> · **págs. 124–127** — cambio porcentual constante: capitalización y encadenamiento de factores (0,95 · 1,1 = 1,045)
> · **págs. 128–131** — cambio porcentual constante aplicado a créditos: M = C · (1 + i)^−n, cuotas, amortización
> · **págs. 130** — planilla de cálculo: construir una planilla para comparar alternativas de financiamiento
> 
> Los cuatro componentes están, pero repartidos en la Unidad 1 de 4º medio (110-139). Tramo principal de PORCENTAJES: 110-113 (descuentos, rebajas, comisiones, cambio de divisas). ÍNDICES ECONÓMICOS: p. 119, cierre de 'Presupuestos y planificación' — define el IPC como 'un indicador económico que…

**🔁 Están en el tomo, pero en la mitad del otro curso**

- Cuartiles y quintiles, planilla de cálculo. — págs. 16–20
- Función exponencial, planilla de cálculo. — págs. 36–44

---

