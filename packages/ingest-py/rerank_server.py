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
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MODEL = os.environ.get("RERANK_MODEL", "BAAI/bge-reranker-v2-m3")
PORT = int(os.environ.get("RERANK_PORT", "8790"))
MAX_LEN = int(os.environ.get("RERANK_MAX_LEN", "512"))

# ─────────────────────────────────────────────────────────────────────────────
# DISCIPLINA DE COLA — el arreglo de la cascada de threads zombi.
#
# Qué pasaba (medido 2026-07-31): `ThreadingHTTPServer` atiende cada request en
# su propio thread SIN cola ni lock, así que N pedidos se intercalan sobre una
# sola GPU y la latencia de CADA UNO crece ~N×. Cuando el cliente aborta a los
# 60 s, el thread de Python NO se cancela —no hay forma de abortar un handler de
# http.server— y sigue quemando MPS. El pedido siguiente compite con ese zombi,
# tarda más, también expira, y se realimenta: 8 fallos consecutivos desde un
# cliente secuencial, y un pico de 954 s con p50 de 10,8 s.
#
# Dos mecanismos, y hacen falta los dos:
#   1) GPU_LOCK serializa. Encolados, el primero sale rápido y solo el último
#      corre riesgo; intercalados, cruzan el timeout todos juntos.
#   2) Rechazo temprano. Un semáforo solo no alcanza: un pedido que espera en la
#      cola mientras el cliente ya se fue igual quema GPU cuando le toca. Si no
#      se consigue el turno antes de QUEUE_WAIT_S, se devuelve 503 al instante
#      en vez de dejar que el cliente agote su propio timeout.
# ─────────────────────────────────────────────────────────────────────────────
GPU_LOCK = threading.Semaphore(1)
# Debe quedar POR DEBAJO del timeout del cliente (RERANK_TIMEOUT_MS, hoy 60 s):
# la gracia es contestar 503 antes de que el cliente corte solo.
QUEUE_WAIT_S = float(os.environ.get("RERANK_QUEUE_WAIT_S", "40"))
_stats = {"lock": threading.Lock(), "encolados": 0, "rechazados": 0}
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


class Ocupado(Exception):
    """No se consiguió turno de GPU dentro de QUEUE_WAIT_S."""


class turno_corto:
    """Turno con espera BREVE, para el healthcheck. Si no lo consigue rápido es
    justamente la señal que queremos: la GPU está saturada."""

    def __enter__(self):
        if not GPU_LOCK.acquire(timeout=float(os.environ.get("RERANK_HEALTH_WAIT_S", "2"))):
            raise Ocupado("healthcheck: sin turno de GPU")
        return self

    def __exit__(self, *exc):
        GPU_LOCK.release()
        return False


class turno:
    """Turno exclusivo de GPU. Context manager para no olvidar el release."""

    def __enter__(self):
        with _stats["lock"]:
            _stats["encolados"] += 1
        if not GPU_LOCK.acquire(timeout=QUEUE_WAIT_S):
            with _stats["lock"]:
                _stats["encolados"] -= 1
                _stats["rechazados"] += 1
            raise Ocupado(f"sin turno de GPU tras {QUEUE_WAIT_S}s")
        return self

    def __exit__(self, *exc):
        GPU_LOCK.release()
        with _stats["lock"]:
            _stats["encolados"] -= 1
        return False


@torch.no_grad()
def score_pairs(query, passages, normalize):
    """Serializado: un forward de GPU por vez (ver DISCIPLINA DE COLA arriba)."""
    pairs = [[query, p] for p in passages]
    inputs = tokenizer(
        pairs,
        padding=True,
        truncation=True,
        max_length=MAX_LEN,
        return_tensors="pt",
    ).to(DEVICE)
    with turno():
        logits = model(**inputs).logits.view(-1).float()
        if normalize:
            logits = torch.sigmoid(logits)
        return logits.cpu().tolist()


# --- NLI direccional (lazy: solo se carga en el primer /nli, para no demorar el
#     arranque del reranker ni pagar la RAM si nadie lo usa) --------------------
_nli = {"tok": None, "model": None, "idx": None}
# Sin este lock, dos /nli en frío entran los dos al `if is None` y cada uno baja
# y carga una copia COMPLETA de mDeBERTa a MPS. No mordió todavía, pero está
# armado desde que el server es multi-thread.
_nli_lock = threading.Lock()


def _ensure_nli():
    if _nli["model"] is not None:
        return _nli
    with _nli_lock:
        if _nli["model"] is not None:  # otro thread lo cargó mientras esperábamos
            return _nli
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
    with turno():
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
    def log_message(self, *args):  # el acceso lo logueamos nosotros, con datos útiles
        pass

    def _log(self, endpoint, n, t0, code, extra=""):
        """Log de acceso. Antes NO había ninguno: el log solo tenía tracebacks y
        era imposible reconstruir qué request entró, con qué tamaño ni cuánto
        tardó — justo lo que hacía falta para diagnosticar la cascada."""
        ms = int((time.perf_counter() - t0) * 1000)
        print(
            f"[acc] {endpoint} n={n} {ms}ms -> {code}"
            f" encolados={_stats['encolados']}{extra}",
            file=sys.stderr,
            flush=True,
        )

    def _send(self, code, obj):
        body = json.dumps(obj).encode("utf-8")
        try:
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            # El cliente ya cortó (abortó por timeout). No es un error del server:
            # el trabajo se hizo y no hay a quién entregárselo. Antes esto llenaba
            # el log de tracebacks que parecían caídas del sidecar.
            print(f"[acc] cliente desconectado antes de la respuesta ({code})",
                  file=sys.stderr, flush=True)

    def do_GET(self):
        if self.path != "/health":
            return self._send(404, {"error": "not found"})
        # HEALTHCHECK REAL. Antes devolvía un dict literal sin tocar el modelo, así
        # que contestaba "ok" en milisegundos con la GPU saturada y `rerankerDown`
        # (teaching.ts) NUNCA se activaba: el fallo se disfrazaba de abstención.
        # Ahora hace un forward mínimo pidiendo turno, y si no lo consigue rápido
        # reporta 'degraded' — que es información accionable, no un adorno.
        t0 = time.perf_counter()
        try:
            with turno_corto():
                tk = tokenizer([["ping", "pong"]], return_tensors="pt",
                               truncation=True, max_length=16).to(DEVICE)
                with torch.no_grad():
                    model(**tk)
        except Ocupado:
            return self._send(503, {
                "status": "degraded", "model": MODEL, "device": DEVICE,
                "encolados": _stats["encolados"], "rechazados": _stats["rechazados"],
                "detalle": "la GPU está saturada; los /rerank van a expirar",
            })
        self._send(200, {
            "status": "ok", "model": MODEL, "device": DEVICE,
            "ms": int((time.perf_counter() - t0) * 1000),
            "encolados": _stats["encolados"], "rechazados": _stats["rechazados"],
        })

    def do_POST(self):
        if self.path not in ("/rerank", "/nli"):
            return self._send(404, {"error": "not found"})
        n = int(self.headers.get("Content-Length", "0"))
        try:
            req = json.loads(self.rfile.read(n) or b"{}")
        except json.JSONDecodeError:
            return self._send(400, {"error": "JSON inválido"})

        t0 = time.perf_counter()

        if self.path == "/nli":
            pairs = req.get("pairs", [])
            if not pairs:
                return self._send(200, {"results": []})
            try:
                out = nli_pairs(pairs)
            except Ocupado as e:
                # 503 EXPLÍCITO en vez de dejar que el cliente agote su timeout.
                # Es la diferencia entre "el sidecar avisa que está saturado" y
                # "la pregunta se pierde y parece una abstención".
                self._log("/nli", len(pairs), t0, 503)
                return self._send(503, {"error": str(e), "retry": True})
            except Exception as e:  # carga del modelo / inferencia
                self._log("/nli", len(pairs), t0, 500)
                return self._send(500, {"error": f"nli: {e}"})
            self._log("/nli", len(pairs), t0, 200)
            return self._send(200, {"results": out})

        passages = req.get("passages", [])
        if not passages:
            return self._send(200, {"scores": []})
        try:
            scores = score_pairs(
                req.get("query", ""), passages, bool(req.get("normalize", False))
            )
        except Ocupado as e:
            self._log("/rerank", len(passages), t0, 503)
            return self._send(503, {"error": str(e), "retry": True})
        except Exception as e:
            self._log("/rerank", len(passages), t0, 500)
            return self._send(500, {"error": f"rerank: {e}"})
        self._log("/rerank", len(passages), t0, 200)
        self._send(200, {"scores": scores})


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
