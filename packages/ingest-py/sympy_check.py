#!/usr/bin/env python
"""
Puente a SymPy (Plan v2 §4-B, Eje "correcto"). Un CAS local para:
  - CALCULAR exacto lo que el 7B a veces resuelve mal (límites, derivadas,
    aritmética), traduciendo el problema a una expresión SymPy.
  - PUNTUAR por equivalencia SIMBÓLICA, no textual: cos(0) ≡ 1, 2x·cos(x²) ≡
    cos(x²)·2x (los 2 falsos negativos de scoring del exp2).

Protocolo (stdin/stdout JSON, una llamada por invocación):
  {"mode":"eval","expr":"limit(sin(x)/x, x, 0)"}      -> {"ok":true,"value":"1","num":1.0}
  {"mode":"equiv","a":"1","b":"cos(0)"}               -> {"equal":true}
Todo error se reporta como {"ok":false,"error":...} sin tirar la corrida.
"""
import json
import sys

import sympy as sp
from sympy.parsing.sympy_parser import (
    parse_expr,
    standard_transformations,
    implicit_multiplication_application,
    convert_xor,
)

# x,y,z como símbolos por defecto; e/pi/oo y funciones comunes desde sympy.
_X, _Y, _Z, _N, _T = sp.symbols("x y z n t")
_NS = {
    "x": _X, "y": _Y, "z": _Z, "n": _N, "t": _T,
    "limit": sp.limit, "diff": sp.diff, "integrate": sp.integrate,
    "sin": sp.sin, "cos": sp.cos, "tan": sp.tan, "log": sp.log, "ln": sp.log,
    "exp": sp.exp, "sqrt": sp.sqrt, "Abs": sp.Abs, "factorial": sp.factorial,
    "pi": sp.pi, "e": sp.E, "E": sp.E, "oo": sp.oo, "Rational": sp.Rational,
    "Sum": sp.Sum, "summation": sp.summation, "solve": sp.solve, "Eq": sp.Eq,
}
_TRANS = standard_transformations + (
    implicit_multiplication_application,  # "2x" -> 2*x
    convert_xor,                          # "x^2" -> x**2
)


def _parse(s: str):
    return parse_expr(s, local_dict=_NS, transformations=_TRANS, evaluate=True)


def do_eval(expr: str) -> dict:
    val = _parse(expr)
    val = sp.simplify(val)
    out = {"ok": True, "value": str(val)}
    try:
        out["num"] = float(val)  # si es numérico cerrado
    except (TypeError, ValueError):
        pass
    return out


def do_equiv(a: str, b: str) -> dict:
    ea, eb = _parse(a), _parse(b)
    # 1) diferencia simbólica se anula
    try:
        if sp.simplify(ea - eb) == 0:
            return {"equal": True, "how": "symbolic"}
    except (TypeError, ValueError):
        pass
    # 2) equivalencia numérica (para no-números que igual coinciden)
    try:
        if bool(sp.nsimplify(sp.N(ea - eb, 12)) == 0) or abs(float(sp.N(ea - eb))) < 1e-9:
            return {"equal": True, "how": "numeric"}
    except (TypeError, ValueError):
        pass
    return {"equal": False}


def main():
    try:
        # JSON por argv[1] (lo usa el eval) o por stdin (uso manual).
        payload = sys.argv[1] if len(sys.argv) > 1 else sys.stdin.read()
        req = json.loads(payload or "{}")
        mode = req.get("mode")
        if mode == "eval":
            print(json.dumps(do_eval(req["expr"])))
        elif mode == "equiv":
            print(json.dumps(do_equiv(req["a"], req["b"])))
        else:
            print(json.dumps({"ok": False, "error": f"modo desconocido: {mode}"}))
    except Exception as e:  # noqa: BLE001 — nunca tirar la corrida del eval
        print(json.dumps({"ok": False, "equal": False, "error": str(e)}))


if __name__ == "__main__":
    main()
