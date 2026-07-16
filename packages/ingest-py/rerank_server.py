#!/usr/bin/env python
"""
Servidor de reranking (Plan v2 §2, capa A1). Carga bge-reranker-v2-m3 UNA vez y
lo sirve por HTTP local. Su score (cross-encoder) discrimina relevancia mucho
mejor que el coseno comprimido de bge-m3 → señal para el gate de abstención.

Usa transformers directamente (AutoModelForSequenceClassification), no
FlagEmbedding: su código de reranker rompe con transformers nuevos
(XLMRobertaTokenizer.prepare_for_model fue removido).

Uso:
  packages/ingest-py/.venv/bin/python packages/ingest-py/rerank_server.py
Endpoints:
  GET  /health   -> {"status":"ok","model":...,"device":...}
  POST /rerank   <- {"query": str, "passages": [str], "normalize": bool}
                 -> {"scores": [float]}   (normalize=true aplica sigmoide 0-1)
  POST /nli      <- {"pairs": [[premise, hypothesis], ...]}
                 -> {"results": [{"entailment":p,"neutral":p,"contradiction":p}]}
                 NLI direccional (mDeBERTa-v3 xnli multilingüe), lazy-load.
"""
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MODEL = os.environ.get("RERANK_MODEL", "BAAI/bge-reranker-v2-m3")
PORT = int(os.environ.get("RERANK_PORT", "8790"))
MAX_LEN = int(os.environ.get("RERANK_MAX_LEN", "512"))
# NLI direccional (entailment/neutral/contradiction) — capa A3 real. El reranker
# (bge) mide RELEVANCIA y no distingue "on-topic pero falso"; este modelo sí.
NLI_MODEL = os.environ.get("NLI_MODEL", "MoritzLaurer/mDeBERTa-v3-base-xnli-multilingual-nli-2mil7")

print(f"[rerank] cargando {MODEL} ...", file=sys.stderr, flush=True)
import torch  # noqa: E402
from transformers import AutoModelForSequenceClassification, AutoTokenizer  # noqa: E402

DEVICE = "mps" if torch.backends.mps.is_available() else "cpu"
tokenizer = AutoTokenizer.from_pretrained(MODEL)
model = AutoModelForSequenceClassification.from_pretrained(MODEL).to(DEVICE).eval()
print(f"[rerank] listo en 127.0.0.1:{PORT} (device={DEVICE})", file=sys.stderr, flush=True)


@torch.no_grad()
def score_pairs(query, passages, normalize):
    pairs = [[query, p] for p in passages]
    inputs = tokenizer(
        pairs,
        padding=True,
        truncation=True,
        max_length=MAX_LEN,
        return_tensors="pt",
    ).to(DEVICE)
    logits = model(**inputs).logits.view(-1).float()
    if normalize:
        logits = torch.sigmoid(logits)
    return logits.cpu().tolist()


# --- NLI direccional (lazy: solo se carga en el primer /nli, para no demorar el
#     arranque del reranker ni pagar la RAM si nadie lo usa) --------------------
_nli = {"tok": None, "model": None, "idx": None}


def _ensure_nli():
    if _nli["model"] is None:
        print(f"[nli] cargando {NLI_MODEL} ...", file=sys.stderr, flush=True)
        tok = AutoTokenizer.from_pretrained(NLI_MODEL)
        m = AutoModelForSequenceClassification.from_pretrained(NLI_MODEL).to(DEVICE).eval()
        # Mapa label->índice robusto (NO hardcodear el orden del modelo).
        idx = {v.lower(): k for k, v in m.config.id2label.items()}
        for need in ("entailment", "neutral", "contradiction"):
            if need not in idx:
                raise RuntimeError(f"El modelo NLI no expone la etiqueta '{need}': {m.config.id2label}")
        _nli.update(tok=tok, model=m, idx=idx)
        print(f"[nli] listo (labels={m.config.id2label})", file=sys.stderr, flush=True)
    return _nli


@torch.no_grad()
def nli_pairs(pairs):
    """pairs: [[premise, hypothesis], ...] -> [{entailment,neutral,contradiction}]."""
    n = _ensure_nli()
    tok, m, idx = n["tok"], n["model"], n["idx"]
    premises = [p[0] for p in pairs]
    hyps = [p[1] for p in pairs]
    inputs = tok(
        premises,
        hyps,
        padding=True,
        truncation=True,
        max_length=MAX_LEN,
        return_tensors="pt",
    ).to(DEVICE)
    probs = torch.softmax(m(**inputs).logits.float(), dim=-1).cpu().tolist()
    return [
        {
            "entailment": row[idx["entailment"]],
            "neutral": row[idx["neutral"]],
            "contradiction": row[idx["contradiction"]],
        }
        for row in probs
    ]


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):  # silencio
        pass

    def _send(self, code, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            self._send(200, {"status": "ok", "model": MODEL, "device": DEVICE})
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self):
        if self.path not in ("/rerank", "/nli"):
            return self._send(404, {"error": "not found"})
        n = int(self.headers.get("Content-Length", "0"))
        try:
            req = json.loads(self.rfile.read(n) or b"{}")
        except json.JSONDecodeError:
            return self._send(400, {"error": "JSON inválido"})

        if self.path == "/nli":
            pairs = req.get("pairs", [])
            if not pairs:
                return self._send(200, {"results": []})
            try:
                return self._send(200, {"results": nli_pairs(pairs)})
            except Exception as e:  # carga del modelo / inferencia
                return self._send(500, {"error": f"nli: {e}"})

        passages = req.get("passages", [])
        if not passages:
            return self._send(200, {"scores": []})
        scores = score_pairs(
            req.get("query", ""), passages, bool(req.get("normalize", False))
        )
        self._send(200, {"scores": scores})


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
