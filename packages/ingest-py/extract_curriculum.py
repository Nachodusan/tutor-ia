#!/usr/bin/env python
"""
Extractor de currículum (Plan v3, doble corpus tipado). Lee un PDF oficial y
emite BLOQUES con metadata curricular, para ingestar contenido y pedagogía con
roles distintos.

Uso:
  python extract_curriculum.py <pdf> --kind content|pedagogy   -> JSON a stdout

Salida (stdout, SOLO JSON):
  {"kind":..., "units":{...mapa OA...}, "blocks":[
      {"page":int, "unit":int|null, "lesson":int|null, "oa":str|null,
       "topic":str|null, "pedagogy_type":str|null, "header":str|null, "text":str}
  ]}

Estructura detectada (validada en Ciencias Naturales 1º Básico):
  - encabezado corriente "Unidad N • Lección M" -> (unit, lesson) de cada página
  - cuadro de planificación "Lección N (Xh)\\nOAk. <desc>" -> mapa (unit,lesson)->OA
  - bloques de la GDD por encabezado de línea corta (Ideas previas, Ambientes de
    aprendizaje, Habilidades científicas, Evaluación, Solucionario, etc.)
"""
import json
import os
import re
import sys

import fitz  # pymupdf

# El TE de grados bajos es muy visual: MuPDF escupe "syntax error: unknown
# keyword" por operadores de gráficos vectoriales. Son inofensivos pero
# contaminaban stdout (que debe ser SOLO JSON) → los silenciamos.
fitz.TOOLS.mupdf_display_errors(False)

# Encabezados de bloque de la GDD -> pedagogy_type normalizado. Los 5 canónicos
# del plan + los secundarios útiles (errores frecuentes, etc.). El resto -> None
# (texto general de la lección, no un bloque tipado).
BLOCK_HEADERS = [
    (r"ideas previas", "ideas_previas"),
    (r"ambientes? de aprendizaje", "ambiente_aprendizaje"),
    (r"habilidades? cient[ií]ficas?", "habilidad"),
    (r"actitudes? cient[ií]ficas?", "actitud"),
    (r"solucionarios?", "solucionario"),
    (r"evaluaci[oó]n(?:es)?(?:\s+\w+)?", "evaluacion"),
    (r"errores frecuentes", "errores_frecuentes"),
    (r"preguntas de calidad", "preguntas_calidad"),
    (r"profundizaci[oó]n(?:es)?\s+y\s+variaciones", "profundizacion"),
    (r"ritmos y estilos", "ritmos_estilos"),
    (r"herramientas digitales", "herramientas_digitales"),
    (r"actividad(?:es)?\s+complementaria", "actividad_complementaria"),
    (r"prop[oó]sito y recomendaciones", "proposito"),
]
_HEADER_RES = [(re.compile(rf"^\s*{pat}\b", re.I), typ) for pat, typ in BLOCK_HEADERS]

# "Unidad 1 • Lección 1" (acepta • · - o "y"), tolerante a saltos de línea.
_RUN_HEADER = re.compile(r"unidad\s*(\d+)\s*[•·\-–]\s*lecci[oó]n\s*(\d+)", re.I)
# Para el TE (contenido), unidad/lección aparecen por separado. Guardas contra el
# índice (unidades/lecciones con número absurdo = referencias de página).
_UNIT_ONLY = re.compile(r"unidad\s*(\d+)", re.I)
_LESSON_ONLY = re.compile(r"lecci[oó]n\s*(\d+)", re.I)
_MAX_UNIT = 20
_MAX_LESSON = 30
# Fila de planificación: "Lección 1 (13 h)" seguida (misma o próx. línea) de "OA6. ..."
_PLAN_LESSON = re.compile(r"lecci[oó]n\s*(\d+)\s*\(", re.I)
_PLAN_OA = re.compile(r"\bOA\s*(\d+)\s*[.\-:]?\s*(.+)", re.I)
_UNIT_TITLE = re.compile(r"^\s*unidad\s*(\d+)\s*:\s*(.+)", re.I)


# ── CÓMO SE LEE UNA PÁGINA ───────────────────────────────────────────────────
# `get_text()` devuelve la página como texto corrido con saltos simples. El
# problema es lo que pasa río abajo: `parseMarkdownBlocks` (clean.ts) separa
# párrafos por LÍNEA EN BLANCO, y ahí casi no hay ninguna. Medido sobre 21
# páginas de Lengua 8º: **1,0 párrafos por página** (mediana 1, máximo 1). O sea
# que `chunkStructural` corre ciego —queda degradado a un cortador de 500 tokens
# que parte por oraciones— y se ve en la distribución de longitudes, apretada
# contra el techo (p50 1.795 · p75 1.927 · p90 1.969 chars).
#
# La misma página con `get_text("blocks")` tiene 15-26 bloques visuales. Ejemplo
# real, Biología 1º Medio pág. 137, que HOY es un solo chunk y un solo vector:
#
#   "Neurona presináptica" · "Neurotransmisores" · "Botón presináptico"
#   "Vesícula presináptica con neurotransmisor" · [364c de prosa sobre redes
#   neuronales] · [245c sobre el impulso nervioso] · "Reflexiona" · [pregunta]
#
# Ocho etiquetas de un diagrama, dos párrafos y una consigna promediados juntos.
# Emitiéndolos separados por línea en blanco, el chunker puede cerrar en frontera
# de bloque en vez de a mitad de la prosa.
#
# Y es MÁS BARATO: medido, 0,65× el costo de `get_text()`.
#
# ⛔ MEDIDO Y RECHAZADO (2026-08-06). La hipótesis era razonable y resultó FALSA:
# separar en bloques visuales EMPEORA el retrieval. A/B sobre Lengua 8º TE, el
# libro del golden, re-ingestando en los dos modos y midiendo con `retrieval-guard`:
#
#   |                              | plano  | bloques |
#   | recall@5 (por chunk_id)      | 88,0%  |  58,3%  |
#   | recall por COBERTURA         | 90,5%  |  72,4%  |  ← el comparable
#   | correct_mode                 | 21/24  |  21/24  |
#
# La primera fila NO es concluyente por sí sola: al partir más fino, el pasaje
# gold pasó de vivir en 1,69 chunks a 3,69, así que acertar "todo el gold" dentro
# de los mismos 5 slots del top-5 se vuelve mecánicamente más difícil. Por eso se
# construyó `recallPorCobertura` (lib/gold-anchors.ts), que mide qué fracción del
# PASAJE quedó dentro de lo recuperado y es invariante al corte. Esa métrica
# también cae 18 puntos: la regresión es real, no de medición.
#
# Y no es pérdida de texto: la extracción por bloques conserva -0,92% de
# caracteres con **0 palabras únicas perdidas** (vocabulario idéntico).
#
# La explicación más probable es que el orden de lectura (y,x) y los bloques
# cortos rompen la coherencia semántica: las etiquetas sueltas de un diagrama
# terminan pegadas a la prosa del bloque siguiente, y en páginas a dos columnas
# el barrido por `y` intercala columnas que el orden interno del PDF mantenía
# separadas. El chunk resultante mezcla MÁS, no menos.
#
# Queda el código y el flag porque la idea de cortar por estructura sigue siendo
# correcta — lo que falla es usar los bloques crudos de PyMuPDF como esa
# estructura. Un intento futuro debería agrupar bloques por columna y por
# proximidad tipográfica antes de emitirlos, y volver a correr este mismo A/B.
USAR_BLOQUES = os.environ.get("EXTRACT_BLOCKS", "0") != "0"


def texto_de_pagina(pagina):
    """El texto de la página, con sus bloques visuales separados por línea en blanco."""
    if not USAR_BLOQUES:
        return pagina.get_text()
    # b = (x0, y0, x1, y1, texto, n_bloque, tipo). tipo 0 = texto, 1 = imagen.
    bloques = [b for b in pagina.get_text("blocks") if b[6] == 0 and b[4].strip()]
    if not bloques:
        return pagina.get_text()
    # Orden de LECTURA (arriba→abajo, izquierda→derecha), no el de generación del
    # PDF: en libros muy visuales el orden interno intercala barra lateral,
    # actividad y prosa. `y` se redondea a 3 pt para que dos bloques de la misma
    # línea no se ordenen al revés por un pixel de diferencia.
    bloques.sort(key=lambda b: (round(b[1] / 3), b[0]))
    return "\n\n".join(" ".join(b[4].split()) for b in bloques)


def match_block_header(line):
    for rex, typ in _HEADER_RES:
        if rex.match(line):
            return typ, line.strip()
    return None, None


def parse_plan(doc):
    """Recorre las páginas de planificación y arma (unit,lesson)->{oa,oa_text}."""
    plan = {}
    cur_unit = None
    for i in range(doc.page_count):
        # OJO: la planificación se lee SIEMPRE en plano. Es una tabla, y
        # separarla en bloques rompería el emparejamiento "Lección N (Xh)" → "OAk".
        text = doc[i].get_text()
        if "planificaci" not in text.lower():
            continue
        lines = [ln.strip() for ln in text.split("\n")]
        j = 0
        while j < len(lines):
            mu = _UNIT_TITLE.match(lines[j])
            if mu:
                cur_unit = int(mu.group(1))
            ml = _PLAN_LESSON.search(lines[j])
            if ml and cur_unit is not None:
                lesson = int(ml.group(1))
                # buscar el "OAk. ..." en las próximas líneas
                for k in range(j, min(j + 4, len(lines))):
                    mo = _PLAN_OA.search(lines[k])
                    if mo:
                        plan[(cur_unit, lesson)] = {
                            "oa": f"OA{mo.group(1)}",
                            "oa_text": mo.group(2).strip()[:300],
                        }
                        break
            j += 1
    return plan


def extract(pdf_path, kind):
    doc = fitz.open(pdf_path)
    plan = parse_plan(doc) if kind == "pedagogy" else {}

    blocks = []
    unit = lesson = None  # se arrastran entre páginas si la página no los repite
    for i in range(doc.page_count):
        text = texto_de_pagina(doc[i])
        flat = re.sub(r"\s+", " ", text)
        # (unit, lesson) del encabezado corriente combinado (GDD).
        m = _RUN_HEADER.search(flat)
        if m:
            unit, lesson = int(m.group(1)), int(m.group(2))
        elif kind == "content" and "índice" not in flat.lower() and "indice" not in flat.lower():
            # TE: unidad/lección por separado, con guardas contra el índice.
            mu = _UNIT_ONLY.search(flat)
            if mu and int(mu.group(1)) <= _MAX_UNIT:
                u = int(mu.group(1))
                if u != unit:
                    unit, lesson = u, None  # nueva unidad → resetear lección
            ml = _LESSON_ONLY.search(flat)
            if ml and int(ml.group(1)) <= _MAX_LESSON:
                lesson = int(ml.group(1))
        oa_info = plan.get((unit, lesson), {})
        oa = oa_info.get("oa")
        topic = oa_info.get("oa_text")

        if kind == "content":
            # Contenido: la página entera es un bloque de contenido (el chunker
            # estructural TS lo parte después). Guardamos su (unit, lesson).
            if text.strip():
                blocks.append({
                    "page": i + 1, "unit": unit, "lesson": lesson,
                    "oa": oa, "topic": topic, "pedagogy_type": None,
                    "header": None, "text": text,
                })
            continue

        # Pedagogía: partir la página en bloques por encabezado.
        lines = text.split("\n")
        cur_type = cur_header = None
        buf = []

        def flush():
            if buf and any(s.strip() for s in buf):
                blocks.append({
                    "page": i + 1, "unit": unit, "lesson": lesson,
                    "oa": oa, "topic": topic,
                    "pedagogy_type": cur_type, "header": cur_header,
                    "text": "\n".join(buf).strip(),
                })

        for ln in lines:
            typ, hdr = match_block_header(ln)
            if typ:
                flush()
                cur_type, cur_header, buf = typ, hdr, []
            else:
                buf.append(ln)
        flush()

    return {"kind": kind, "units": {f"{u}-{l}": v for (u, l), v in plan.items()}, "blocks": blocks}


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "uso: extract_curriculum.py <pdf> --kind content|pedagogy"}))
        sys.exit(1)
    pdf = sys.argv[1]
    kind = "content"
    if "--kind" in sys.argv:
        kind = sys.argv[sys.argv.index("--kind") + 1]
    try:
        out = extract(pdf, kind)
        sys.stdout.write(json.dumps(out, ensure_ascii=False))
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
