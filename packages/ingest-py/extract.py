#!/usr/bin/env python
"""Sidecar de extracción de PDF a Markdown usando pymupdf4llm.

Uso:
    .venv/bin/python extract.py <input.pdf> [--pages 1-10] [--out salida.json]

Emite por stdout (o al archivo de --out) UN objeto JSON con la forma:

    {
      "sourcePath": str,
      "pageCount": int,
      "title": str | null,
      "pages": [{"page": int (1-based), "md": str}, ...]
    }

Todo mensaje de progreso/diagnóstico va por stderr, NUNCA por stdout.
"""

import argparse
import contextlib
import json
import os
import sys

# pymupdf captura su stream de mensajes al importarse (bypasea redirect_stdout):
# hay que fijarlo a stderr ANTES de que se importe, para no ensuciar el JSON.
os.environ.setdefault("PYMUPDF_MESSAGE", "fd:2")
os.environ.setdefault("PYMUPDF_LOG", "fd:2")


def log(msg: str) -> None:
    """Progreso/diagnóstico por stderr (stdout queda reservado al JSON)."""
    print(msg, file=sys.stderr, flush=True)


def parse_pages(spec: str, page_count: int) -> list[int]:
    """Parsea "5" | "5-20" | "5,7,9" (1-based) a lista 0-based ordenada.

    Valida contra page_count y levanta ValueError con mensaje claro.
    """
    result: set[int] = set()
    for part in spec.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            lo_s, _, hi_s = part.partition("-")
            try:
                lo, hi = int(lo_s), int(hi_s)
            except ValueError:
                raise ValueError(f"Rango de páginas inválido: '{part}'")
            if lo < 1 or hi < lo:
                raise ValueError(f"Rango de páginas inválido: '{part}'")
            result.update(range(lo - 1, hi))
        else:
            try:
                n = int(part)
            except ValueError:
                raise ValueError(f"Número de página inválido: '{part}'")
            if n < 1:
                raise ValueError(f"Número de página inválido: '{part}'")
            result.add(n - 1)
    if not result:
        raise ValueError(f"Especificación de páginas vacía: '{spec}'")
    out_of_range = [p + 1 for p in result if p >= page_count]
    if out_of_range:
        raise ValueError(
            f"Páginas fuera de rango (el PDF tiene {page_count}): "
            + ", ".join(str(p) for p in sorted(out_of_range))
        )
    return sorted(result)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Extrae un PDF a Markdown por página (pymupdf4llm) y emite JSON."
    )
    parser.add_argument("input", help="Ruta al PDF de entrada")
    parser.add_argument(
        "--pages",
        help='Páginas 1-based a extraer: "5" | "5-20" | "5,7,9". Por defecto, todas.',
    )
    parser.add_argument(
        "--out",
        help="Archivo de salida para el JSON. Sin --out, se escribe por stdout.",
    )
    args = parser.parse_args()

    # Imports pesados después de parsear args para que --help sea instantáneo.
    import pymupdf  # type: ignore
    import pymupdf4llm  # type: ignore

    # Refuerzo: por si PYMUPDF_MESSAGE ya estaba definido en el entorno.
    try:
        pymupdf.set_messages(fd=2)
    except Exception:
        pass

    try:
        doc = pymupdf.open(args.input)
    except Exception as exc:  # archivo inexistente, PDF corrupto, sin permisos...
        log(f"Error: no se pudo abrir '{args.input}': {exc}")
        return 1

    try:
        page_count = doc.page_count
        raw_title = (doc.metadata or {}).get("title") or ""
        title = raw_title.strip() or None
    finally:
        doc.close()

    pages_0based: list[int] | None = None
    if args.pages:
        try:
            pages_0based = parse_pages(args.pages, page_count)
        except ValueError as exc:
            log(f"Error: {exc}")
            return 1

    if pages_0based is None:
        pages_0based = list(range(page_count))
    total = len(pages_0based)
    log(f"Extrayendo {total} página(s) de '{args.input}' ({page_count} en total)...")

    # Procesamos en lotes de 25 páginas para poder reportar progreso por stderr
    # (el OCR puede ser lento). Redirigimos stdout de la librería a stderr para
    # que el JSON por stdout nunca se contamine (p.ej. warnings de OCR).
    BATCH = 25
    chunks: list[dict] = []
    done = 0
    try:
        with contextlib.redirect_stdout(sys.stderr):
            for start in range(0, total, BATCH):
                batch = pages_0based[start : start + BATCH]
                chunks.extend(
                    pymupdf4llm.to_markdown(
                        args.input,
                        page_chunks=True,
                        pages=batch,
                        show_progress=False,
                    )
                )
                done += len(batch)
                log(f"Progreso: {done}/{total} páginas")
    except Exception as exc:
        log(f"Error extrayendo '{args.input}': {exc}")
        return 1

    pages_out = []
    for chunk in chunks:
        meta = chunk.get("metadata") or {}
        page_number = meta.get("page_number")  # ya es 1-based
        if page_number is None:
            log("Advertencia: chunk sin metadata['page_number']; se omite.")
            continue
        pages_out.append({"page": int(page_number), "md": chunk.get("text", "")})

    result = {
        "sourcePath": args.input,
        "pageCount": page_count,
        "title": title,
        "pages": pages_out,
    }

    payload = json.dumps(result, ensure_ascii=False)
    if args.out:
        try:
            with open(args.out, "w", encoding="utf-8") as fh:
                fh.write(payload)
        except OSError as exc:
            log(f"Error: no se pudo escribir '{args.out}': {exc}")
            return 1
        log(f"JSON escrito en '{args.out}' ({len(pages_out)} páginas)")
    else:
        sys.stdout.write(payload)
        sys.stdout.write("\n")

    return 0


if __name__ == "__main__":
    sys.exit(main())
