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
"""
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MODEL = os.environ.get("RERANK_MODEL", "BAAI/bge-reranker-v2-m3")
PORT = int(os.environ.get("RERANK_PORT", "8790"))
MAX_LEN = int(os.environ.get("RERANK_MAX_LEN", "512"))

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
        if self.path != "/rerank":
            return self._send(404, {"error": "not found"})
        n = int(self.headers.get("Content-Length", "0"))
        try:
            req = json.loads(self.rfile.read(n) or b"{}")
        except json.JSONDecodeError:
            return self._send(400, {"error": "JSON inválido"})
        passages = req.get("passages", [])
        if not passages:
            return self._send(200, {"scores": []})
        scores = score_pairs(
            req.get("query", ""), passages, bool(req.get("normalize", False))
        )
        self._send(200, {"scores": scores})


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
