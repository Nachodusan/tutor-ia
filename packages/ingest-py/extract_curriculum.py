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
        text = doc[i].get_text()
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
