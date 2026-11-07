# Material de terceros

La licencia MIT de este repositorio cubre **el código** y nada más.

## Los textos escolares no están acá

El sistema trabaja sobre los textos escolares oficiales del Ministerio de
Educación de Chile. Esos textos **no forman parte de este repositorio** y no se
distribuyen con él:

- el corpus vive fuera de git (205 MB, en una base de datos local);
- los fixtures de evaluación guardan **anclas**, no texto: documento, página y
  el hash del fragmento;
- donde había una cita textual quedó una marca con su largo y su hash —
  `[cita del libro: 20 palabras · 5c2a047…]`. El hash alcanza para
  **verificarla** contra el corpus, pero no para reconstruirla.

Los derechos sobre esos textos son de sus autores y editoriales. Quien quiera
correr el proyecto tiene que conseguir el material por su cuenta y asegurarse
de tener derecho a usarlo.

## Cómo se comprueba

Que acá no haya texto de los libros no es una promesa, es una medición. El
detector coteja el historial completo —todas las versiones de todos los
archivos, en todos los commits— contra el corpus real:

```
pnpm --filter @tutor-ia/eval golden-texto --auditar --historial
```

Busca **por contenido**, no por nombre de campo, porque buscar campos llamados
`texto` o `content` encontró 3 archivos cuando había 24. Y mira el historial,
no el árbol de trabajo, porque un repo público publica todos los commits.

Si el corpus no está cargado, **falla en vez de decir "limpio"**: una auditoría
que no puede concluir tiene que decirlo.

## Material con licencia abierta

Si el proyecto llega a incluir material de terceros con licencia abierta —por
ejemplo artículos CC BY—, su atribución va junto al material, no acá.
