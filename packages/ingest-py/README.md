# @tutor-ia/ingest-py — sidecar de extracción de PDF

Sidecar en Python que convierte un PDF a Markdown por página usando
[pymupdf4llm](https://pypi.org/project/pymupdf4llm/) y emite un único objeto
JSON. Lo consume el worker de ingesta TypeScript (`packages/rag`), que lo
spawnea como proceso hijo y parsea el stdout.

## Por qué existe

`pdf-parse` (Node) producía texto con palabras partidas ("x - y"), headers
corrientes pegados, folios sueltos y letter-spacing roto (ver
`docs/exp1-hallazgos.md`). pymupdf4llm resuelve la de-hyphenation, emite los
headers/folios como líneas aisladas fáciles de filtrar, y auto-OCRea las
páginas imagen con Tesseract.

## Requisitos

- venv ya creado en `.venv` (Python 3.14) con `pymupdf4llm` instalado.
- Para OCR de páginas imagen: `tesseract` en el PATH
  (`brew install tesseract`; en esta máquina: `/opt/homebrew/bin/tesseract`).
  Sin tesseract, las páginas imagen salen sin texto (aviso por stderr).

## Uso

```bash
.venv/bin/python extract.py <input.pdf> [--pages 1-10] [--out salida.json]
```

- `--pages`: selección 1-based. Acepta `"5"`, `"5-20"` o `"5,7,9"` (y combinaciones:
  `"1-3,7"`). Sin `--pages` se extrae el libro completo.
- `--out`: escribe el JSON en un archivo. Sin `--out`, el JSON sale por
  **stdout** (una sola línea). Todo progreso/diagnóstico (incluido el OCR de
  pymupdf) va por **stderr**, nunca por stdout.
- Progreso por stderr cada 25 páginas (el OCR puede ser lento).
- Errores (archivo inexistente, PDF corrupto, páginas fuera de rango):
  mensaje claro por stderr y exit code 1.

### Ejemplo

```bash
.venv/bin/python extract.py ~/Desktop/Tomo_I_Lengua_y_Literatura8vo.pdf \
  --pages 20-30 --out /tmp/probe.json
```

## Contrato de salida (SidecarDoc)

Un único objeto JSON:

```ts
interface SidecarDoc {
  sourcePath: string;
  pageCount: number;               // páginas totales del PDF
  title: string | null;            // metadata del PDF si existe
  pages: { page: number; md: string }[];  // page 1-based, md = markdown de pymupdf4llm
}
```

Notas:

- `page` viene de `metadata["page_number"]` de pymupdf4llm, que **ya es
  1-based**.
- `pages` solo contiene las páginas pedidas con `--pages` (o todas), en orden
  ascendente.
- El markdown conserva los headers corrientes como headings (`# **Unidad 1**`)
  y los folios como líneas bold aisladas (`**18**`): los limpia
  `packages/rag/src/clean.ts` río abajo.

## Integración con el worker TS

El worker spawnea el sidecar y consume stdout:

```ts
import { spawn } from 'node:child_process';

const py = spawn(
  '/Users/dusan/Documents/ia/packages/ingest-py/.venv/bin/python',
  ['/Users/dusan/Documents/ia/packages/ingest-py/extract.py', pdfPath],
);
// acumular py.stdout → JSON.parse al cerrar; py.stderr → log de progreso
// exit code !== 0 → fallo de extracción
```

Pipeline: `extract.py` → `cleanPages()` (`packages/rag/src/clean.ts`) →
`chunkStructural()` (`packages/rag/src/chunk-structural.ts`).
