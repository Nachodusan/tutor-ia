# EPJA — cómo se divide por NIVELES (no por grado)

Extraído de **Bases Curriculares para la Educación de Personas Jóvenes y Adultas**
(Mineduc, Decreto Supremo N° 10/2022, edición 2024, ISBN 978-956-413-083-5),
páginas 46-49 del PDF.

> "El nivel educacional es el tramo cronológico en que se divide el proceso escolar
> que ocurre dentro de cada ciclo de aprendizaje de la modalidad de educación de
> personas jóvenes y adultas."

## Equivalencia nivel → cursos

| Ciclo | Nivel | Cursos |
|---|---|---|
| Básica | 1 | 1º a 4º Básico |
| Básica | 2 | 5º y 6º Básico |
| Básica | 3 | 7º y 8º Básico |
| Media Humanístico-Científica | 1 | 1º y 2º Medio |
| Media Humanístico-Científica | 2 | 3º y 4º Medio |
| Media TP · Oficios | 1 | 1º y 2º Medio |
| Media TP · Oficios | 2 | 3º y 4º Medio |
| Media TP · Especialidades | 1 | 1º y 2º Medio |
| Media TP · Especialidades | 2 | 3º Medio |
| Media TP · Especialidades | 3 | 4º Medio |

⚠️ Especialidades es la ÚNICA que separa 3º y 4º Medio en dos niveles distintos.

## Asignaturas por nivel

### Educación Básica
- **Nivel 1** — General: Lenguaje y Comunicación, Matemática. (Solo dos.)
- **Niveles 2 y 3** — General: Lenguaje y Comunicación, Matemática, Ciencias
  Naturales, Historia/Geografía/CCSS, Inglés (opcional).
  Diferenciada: Formación en Oficios (opcional).

### Educación Media Humanístico-Científica (Niveles 1 y 2)
- General: Lengua y Literatura, Matemática, Ciencias Naturales,
  **Historia/Geografía/CCSS en Nivel 1 · Educación Ciudadana en Nivel 2**, Inglés.
- Instrumental: Pensamiento Computacional, Responsabilidad Personal y Social,
  Emprendimiento y Empleabilidad, Educación Financiera.
- Diferenciada: Artes Visuales, Educación Física y Salud, Filosofía.
  (El establecimiento ofrece al menos dos por nivel; cada estudiante cursa al menos una.)

### Media TP con Formación en Oficios (Niveles 1 y 2)
- General e Instrumental: igual que HC. Diferenciada: Oficios.

### Media TP con Formación en Especialidades
- **Nivel 1** — General: Lengua y Literatura, Matemática, Ciencias Naturales,
  Historia/Geografía/CCSS, Inglés.
- **Niveles 2 y 3** — General: Lengua y Literatura, Matemática,
  **Educación Ciudadana**, Ciencias Naturales, Inglés.
- Instrumental: los mismos cuatro. Diferenciada: Especialidades.

## Qué NO calza con el producto hoy

1. **La app se organiza por GRADO** (`apps/web/lib/cursos.ts`, 1B…4M). EPJA se
   organiza por nivel + modalidad. Son dos ejes distintos: un mismo alumno de
   "Nivel 2 Básica" abarca 5º y 6º.
2. **En Media, EPJA tiene UNA "Ciencias Naturales"**; el corpus tiene Biología,
   Física y Química por separado. No hay correspondencia 1:1.
3. **Básica Nivel 1 solo tiene Lenguaje y Matemática** — sin Ciencias ni Historia.
4. **1º a 4º Básico están BLOQUEADOS** en la app (ver `cursos-bloqueados`), y el
   motivo era el desarrollo infantil. En EPJA esos cursos los cursan personas
   jóvenes y adultas, así que la razón del bloqueo no aplica igual: hay que
   decidirlo aparte y no heredarlo por el número de curso.
5. Aparecen asignaturas que el corpus no tiene: Pensamiento Computacional,
   Responsabilidad Personal y Social, Emprendimiento y Empleabilidad, Educación
   Financiera, Artes Visuales, Educación Física y Salud, Oficios, Especialidades.
