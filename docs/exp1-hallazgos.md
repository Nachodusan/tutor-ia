# Experimento #1 — Hallazgos sobre un libro real

**Libro:** *Lengua y Literatura 8° básico, Tomo I* (Santillana, ed. MACROTIPO de la
Biblioteca Central Para Ciegos, 2024). 280–344 págs, 27,3 MB.
**Fecha:** 2026-07-14. **Comando:** `pnpm --filter @tutor-ia/eval exp1 <pdf> 60`

## Resultado (sobre los 344 chunks)

| Señal | Resultado | Impacto |
|---|---|---|
| chars/página (prom) | **505** | bajo — muchas páginas con imágenes; texto denso sí se captura (~640) |
| mojibake | 0 | ✅ codificación limpia (UTF-8) |
| caracteres de fórmula | 0 | ✅ es literatura, no hay fórmulas |
| **palabra partida `"x - y"`** | **139 chunks (40%), 357 casos** | 🔴 rompe embeddings **y** la cita literal A2 |
| **encabezado pegado al inicio** | **340 chunks (99%)** | 🔴 header corriente dentro del texto de casi todo chunk |
| **número de página al final** | **285 chunks (83%)** | 🟠 ruido de footer |
| códigos de recurso (BDA/U1_ACT…) | 37 chunks, 78 casos | 🟠 marcas de audio/imagen incrustadas |
| letras espaciadas (`B Á SICO`) | 9 chunks | 🟠 "BÁSICO"→"B Á SICO", "creer"→"cre er" |
| **idea cortada (sin punto final)** | **130 chunks (38%)** | 🔴 oración partida entre chunks (corte por página) |

## Veredicto

**Falla el criterio del §10** ("no hay headers/footers en medio de los párrafos"):
99% de los chunks arrastran el encabezado corriente y 83% un número de página.
**Se confirma E2/E16: hay que reemplazar la ingesta (Fase 0.5).**

### Matiz importante
Este PDF es un **caso fácil**: edición macrotipo, **una sola columna**, ya linealizada
para accesibilidad. Por eso `pdf-parse` **no** exhibe su peor falla (columnas
interleaveadas). La captura de texto en sí es aceptable (las páginas densas salen
completas). El problema es el **post-procesado**: de-hyphenation, headers/footers y
límites de chunk. Un libro de texto normal (multicolumna) fallaría **peor**.

### Por qué la de-hyphenation es la más grave
El texto trae `"cortaplu - mas"`, `"difu - sión"`, `"pro - venzales"` (guion de corte de
línea convertido en `" - "`). Consecuencias:
- El embedding de `"cortaplu - mas"` no se parece al de la consulta `"cortaplumas"`.
- La **cita literal A2** (`chunk.includes("cortaplumas")`) **falla** → afirmaciones
  correctas se marcarían como "fuera del material". Es decir: esta corrupción **rompe
  nuestro propio verificador anti-alucinaciones**.

## Requisitos que esto le impone a la Fase 0.5 (ingesta nueva)

1. **De-hyphenation** — unir `palabra- \n palabra` → `palabra`. Prioridad 1.
2. **Quitar headers/footers corrientes** — detectar el boilerplate repetido por página
   (`"Lengua y Literatura N"`, `"Unidad N  N"`) y removerlo antes de chunkear.
3. **Quitar ruido de recurso y números de página** — `BDA`, `U1_ACT_*`, `U1_IMA_*`,
   números sueltos de folio.
4. **Chunking consciente de estructura/oración** — no cortar a mitad de oración ni en el
   borde de página (unir continuaciones). 38% de cortes hoy.
5. **Arreglar letter-spacing** — `"B Á SICO"`→`"BÁSICO"`, `"cre er"`→`"creer"`.
6. **Páginas con imágenes** — chars/página bajo indica páginas ilustradas; separar
   captions (content_type=figure_caption) y prever OCR para las que sean imagen pura.

> Estos 6 puntos salen de datos reales, no de teoría. La herramienta correcta del plan
> (`pymupdf4llm`/`Docling`) resuelve 1–5 de fábrica; el punto 6 (imágenes) puede pedir
> Apple Vision para las páginas escaneadas/ilustradas.

## Meta-hallazgo sobre la herramienta
Los detectores automáticos **iniciales** de exp1 subreportaron (decían "0 headers,
2 cortes"). Se **fortalecieron** para cuantificar de-hyphenation, headers pegados,
folios, códigos, letter-spacing y cortes de oración. Confirma el §9: "si no lo medís,
no existe" — y "las señales automáticas son débiles, mirá con los ojos".
