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
import re
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


# Lo único que puede llegar acá. TODO lo demás es un error ruidoso.
#
# ⚠️ ESTA ES LA GUARDA MÁS IMPORTANTE DEL PUENTE. `implicit_multiplication_application`
# convierte cualquier carácter que no conozca en un SÍMBOLO LIBRE y lo multiplica,
# así que la entrada sucia no falla: devuelve `ok: true` con otra cosa. Medido
# sobre 21 ejercicios escolares, 12 devolvían un número plausible y equivocado:
#
#     "√(50) + √(8)"   -> ok: true, value "58*√"     (concatena y multiplica por √)
#     "2(x − 3)"       -> ok: true, value "6*x*−"    (el menos U+2212 como variable)
#     "racionalizar …" -> ok: true, value "15*a**3*c*i**2*l*n*o*r**2*z/√"
#
# Un tutor que muestra el paso a paso de "58*√" es peor que uno que no contesta.
# El normalizador (core/mate-normalizar.ts) tiene que dejar la expresión limpia
# ANTES; esto es la red por si se le escapa algo.
_PERMITIDO = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
                 "0123456789"
                 "+-*/()[]^., =<>_")


def _parse(s: str):
    malos = sorted({c for c in s if c not in _PERMITIDO})
    if malos:
        detalle = ", ".join(f"{c!r} (U+{ord(c):04X})" for c in malos)
        raise ValueError(
            f"caracteres sin normalizar: {detalle}. "
            "Pasá la expresión por aSintaxisSympy() antes de llamar al puente."
        )
    return parse_expr(s, local_dict=_NS, transformations=_TRANS, evaluate=True)


def _simplificar(v):
    """Simplifica sin romperse con lo que devuelven `solve` y compañía.

    ⚠️ `solve` NO devuelve una expresión: devuelve una LISTA de soluciones (o un
    dict cuando hay varias incógnitas, o un FiniteSet). `sp.simplify` sobre una
    lista tira "'list' object has no attribute 'replace'", así que el modo `eval`
    reventaba con el caso más común de la escuela — resolver una ecuación. La
    derivada y la integral andaban porque devuelven expresión.
    """
    if isinstance(v, (list, tuple)):
        return [_simplificar(x) for x in v]
    if isinstance(v, dict):
        return {str(k): _simplificar(x) for k, x in v.items()}
    if isinstance(v, sp.Set):
        try:
            return [_simplificar(x) for x in v]
        except TypeError:      # conjuntos infinitos: no se enumeran
            return v
    try:
        return sp.simplify(v)
    except (TypeError, ValueError, AttributeError):
        return v


def _es_real(v) -> bool:
    """¿Este número es real? Se evalúa, no se pregunta (ver el aviso en do_eval)."""
    try:
        if v.is_real is True:
            return True
        return abs(complex(sp.N(v, 25)).imag) < 1e-9
    except Exception:  # noqa: BLE001
        return False


# Una raíz exacta más larga que esto no se le muestra a un chico: se le da el
# decimal, que es lo que va a usar y lo que su calculadora le va a mostrar.
_LARGO_MAXIMO = 40


def _legible(v) -> str:
    """La forma exacta si se puede leer; si no, el decimal.

    La cuártica del reclamo daba raíces de 280 caracteres cada una. Un tutor que
    contesta eso no está enseñando: está volcando la salida de un CAS.
    """
    exacto = _bonito(v)
    if len(exacto) <= _LARGO_MAXIMO:
        return exacto
    try:
        return f"≈ {float(sp.N(v, 10)):.4g}"
    except Exception:  # noqa: BLE001
        return exacto


def _bonito(v) -> str:
    """Cómo se escribe un número en un cuaderno.

    SymPy imprime los Float con toda su precisión: resolver "2,5x = 10" devolvía
    `4.00000000000000`. Eso en la pantalla se lee como un error del programa, no
    como el cuatro que el chico esperaba. Si el decimal es en realidad un
    racional exacto, se muestra como tal.
    """
    try:
        if isinstance(v, sp.Float):
            r = sp.nsimplify(v, rational=True)
            if sp.simplify(r - v) == 0:
                return str(r)
            return str(sp.nsimplify(v, tolerance=1e-10, rational=False))
    except Exception:  # noqa: BLE001
        pass
    return str(v)


def do_eval(expr: str, simplificar: bool = True) -> dict:
    """`simplificar=False` para factor/expand.

    ⚠️ `simplify` DESHACE lo que acaba de hacer `factor`: factor(x**2 - 9) da
    (x-3)*(x+3) y simplify lo devuelve a x**2 - 9. O sea que "factorizá x² - 9"
    contestaba con el enunciado y la función parecía andar. Cuando la operación
    YA produce la forma canónica que se quiere mostrar, no hay que tocarla.
    """
    crudo = _parse(expr)
    val = _simplificar(crudo) if simplificar else crudo
    # Las soluciones se devuelven como LISTA de strings además del `value` plano:
    # el que llama necesita las raíces por separado para marcarlas en el gráfico.
    if isinstance(val, list):
        # ⚠️ LA REALIDAD SE DECIDE NUMÉRICAMENTE, NO PREGUNTANDO `is_real`.
        #
        # En las raíces de una cuártica SymPy no puede decidirlo simbólicamente y
        # `is_real` devuelve None, que en Python NO es False: el filtro las daba
        # por reales a las cuatro. Resultado en pantalla, medido con
        # 5x**4 - 3x + 2 = 0 (que NO tiene ninguna raíz real): media pantalla de
        # radicales anidados con I adentro, presentada como "Resultado" con un
        # tilde verde al lado.
        reales = [x for x in val if _es_real(x)]
        if val and not reales:
            return {"ok": True, "value": "sin solución real", "soluciones": [],
                    "sinSolucionReal": True}
        val = reales or val
        out = {"ok": True, "value": ", ".join(_legible(x) for x in val),
               "soluciones": [_legible(x) for x in val]}
        nums = []
        for x in val:
            try:
                nums.append(float(x))
            except (TypeError, ValueError):
                nums = []
                break
        if nums:
            out["nums"] = nums
        return out
    if isinstance(val, dict):
        return {"ok": True, "value": ", ".join(f"{k} = {_bonito(v)}" for k, v in val.items()),
                "asignaciones": {k: _bonito(v) for k, v in val.items()}}
    out = {"ok": True, "value": _bonito(val)}
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


_XR = sp.Symbol("x", real=True)
_TOL = 1e-9


def _a_reales(e):
    """Reemplaza los símbolos por versiones con `real=True`.

    ⚠️ SIN ESTO EL VERIFICADOR APRUEBA TODO, y en silencio. `_parse` arma la `x`
    del espacio de nombres general, que NO tiene la asunción de realidad; si
    después se resuelve con un `Symbol("x", real=True)`, SymPy está resolviendo
    para una incógnita QUE NO APARECE en la ecuación. Devuelve lo mismo para
    todos los pasos y la cadena entera sale "válida" — incluida una con un error
    deliberado en el medio. Es el peor modo de fallar que puede tener un
    verificador: decir que sí siempre.
    """
    return e.subs({s: sp.Symbol(s.name, real=True) for s in e.free_symbols})


def _como_ecuacion(s: str):
    izq, der = s.split("=", 1)
    return _a_reales(sp.Eq(_parse(izq), _parse(der)))


def _incognita(ec):
    """La incógnita del paso: `x` si está, si no la única que haya."""
    libres = sorted(ec.free_symbols, key=lambda s: s.name)
    for s in libres:
        if s.name == "x":
            return s
    return libres[0] if libres else _XR


def _satisface(ec, raiz) -> bool:
    """¿La raíz satisface la ecuación Y está definida en ella?

    Lo segundo importa tanto como lo primero: una raíz que hace aparecer un
    log(0) o una división por cero NO es solución, aunque la cuenta “dé”.
    """
    try:
        inc = _incognita(ec)
        v = (ec.lhs - ec.rhs).subs(inc, raiz)
        if v.has(sp.zoo, sp.nan, sp.oo):
            return False
        vs = sp.simplify(v)
        if vs == 0:
            return True
        n = complex(sp.N(vs, 30))
        if abs(n.imag) > 1e-12:      # se fue de los reales: fuera del dominio
            return False
        return abs(n.real) < _TOL
    except Exception:  # noqa: BLE001
        return False


def _ramas(paso: str) -> list:
    """Un renglón puede traer VARIAS ecuaciones, y así se escribe en un libro.

    Resolver una cuadrática termina en "x = 2 o x = 3", y ese renglón NO es una
    ecuación sola: es la unión de dos. Sin esto, el verificador comparaba
    "(x-2)(x-3) = 0" contra "x = 2" y marcaba PIERDE — tiene razón en teoría de
    conjuntos y está equivocado sobre lo que el alumno escribió. El paso a paso
    se cortaba justo antes de la respuesta.
    """
    partes = re.split(r"\s+o\s+|\s*;\s*|\s*,\s*(?![^()]*\))", paso, flags=re.IGNORECASE)
    return [p.strip() for p in partes if p.strip() and "=" in p]


def _conjunto(paso: str, v):
    """El conjunto solución del renglón: la UNIÓN de sus ramas."""
    total = sp.S.EmptySet
    for r in _ramas(paso) or [paso]:
        s = sp.solveset(_como_ecuacion(r), v, domain=sp.S.Reals)
        if s.has(sp.ConditionSet):
            return None
        total = sp.Union(total, s)
    return total


def _paso_ecuacion(antes: str, despues: str) -> dict:
    """¿El paso conserva el conjunto solución?

    Devuelve ok / pierde / agrega / mal, y eso es lo que permite EXPLICAR en vez
    de solo marcar en rojo: "pierde" es haber dividido por x y comerse x=0;
    "agrega" es haber elevado al cuadrado y traerse una raíz extraña.
    """
    ea, eb = _como_ecuacion(_ramas(antes)[0] if _ramas(antes) else antes), _como_ecuacion(_ramas(despues)[0] if _ramas(despues) else despues)
    v = _incognita(ea)
    # 1) por conjuntos, cuando SymPy los sabe comparar. Cada renglón puede traer
    #    varias ramas ("x = 2 o x = 3") y se compara la unión.
    try:
        A = _conjunto(antes, v)
        B = _conjunto(despues, v)
        if A is not None and B is not None:
            falta, sobra = sp.simplify(A - B), sp.simplify(B - A)
            vacio = sp.S.EmptySet
            if falta == vacio and sobra == vacio:
                return {"veredicto": "ok", "como": "conjuntos"}
            if sobra == vacio:
                return {"veredicto": "pierde", "como": "conjuntos"}
            if falta == vacio:
                return {"veredicto": "agrega", "como": "conjuntos"}
            return {"veredicto": "mal", "como": "conjuntos"}
    except Exception:  # noqa: BLE001
        pass
    # 2) FALLBACK por pertenencia de raíces. Sin esto, las ecuaciones
    #    trascendentes (la logarítmica típica) devuelven ConditionSet y el
    #    veredicto sale mal: un paso legítimo se marcaba como error.
    try:
        ra = [sp.nsimplify(r) for r in sp.solve(ea, v)]
        rb = [sp.nsimplify(r) for r in sp.solve(eb, v)]
    except Exception:  # noqa: BLE001
        return {"veredicto": "indeciso", "como": "sin método"}
    falta = [str(r) for r in ra if not _satisface(eb, r)]
    sobra = [str(r) for r in rb if not _satisface(ea, r)]
    if not falta and not sobra:
        return {"veredicto": "ok", "como": "raíces"}
    if falta and sobra:
        return {"veredicto": "mal", "como": "raíces", "perdidas": falta, "extranas": sobra}
    if falta:
        return {"veredicto": "pierde", "como": "raíces", "perdidas": falta}
    return {"veredicto": "agrega", "como": "raíces", "extranas": sobra}


def _paso_expresion(antes: str, despues: str) -> dict:
    """Dos expresiones son el mismo paso si su diferencia se anula.

    ⚠️ ESTE ES OTRO VERIFICADOR, no una variante del de arriba, y usar el
    equivocado deja pasar el error más clásico del colegio: (x+5)² = x²+25 tiene
    el MISMO conjunto solución que x = 0, así que por conjuntos da "ok". Por
    diferencia simbólica se detecta al toque.
    """
    d = do_equiv(antes, despues)
    return {"veredicto": "ok" if d.get("equal") else "mal", "como": d.get("how", "diferencia")}


def do_cadena(pasos: list, tipo: str) -> dict:
    """Verifica la cadena renglón por renglón y dice DÓNDE se rompió.

    Localizar importa más que detectar: el paso siguiente a un error suele dar
    "ok" —es correcto respecto del renglón equivocado— y eso permite decirle al
    alumno "hasta acá venías bien, el error está en este renglón".
    """
    if not isinstance(pasos, list) or len(pasos) < 2:
        return {"ok": False, "error": "se necesitan al menos 2 pasos"}
    paso = _paso_expresion if tipo == "expresion" else _paso_ecuacion
    detalle, primer_error = [], None
    for i in range(1, len(pasos)):
        try:
            r = paso(str(pasos[i - 1]), str(pasos[i]))
        except Exception as e:  # noqa: BLE001
            r = {"veredicto": "indeciso", "como": "error", "detalle": str(e)}
        r["paso"] = i
        r["de"], r["a"] = str(pasos[i - 1]), str(pasos[i])
        detalle.append(r)
        if primer_error is None and r["veredicto"] not in ("ok", "indeciso"):
            primer_error = i
    return {"ok": True, "valida": primer_error is None,
            "primerError": primer_error, "pasos": detalle}


# Casos con veredicto conocido. Existen porque este verificador YA falló del peor
# modo posible: aprobando todo. Un `x` sin asunción de realidad en el parseo hacía
# que SymPy resolviera para una incógnita ausente, y la cadena con un error
# deliberado en el medio salía "válida". Un verificador que dice que sí siempre es
# peor que no tenerlo: da confianza donde no hay.
_AUTOTEST = [
    ("lineal correcta", "ecuacion", ["3*x + 5 = 20", "3*x = 15", "x = 5"], None),
    ("error en el medio", "ecuacion", ["3*x + 5 = 20", "3*x = 25", "x = 25/3"], 1),
    ("dividir por x pierde x=0", "ecuacion", ["x**2 = 3*x", "x = 3"], 1),
    ("elevar al cuadrado agrega", "ecuacion", ["sqrt(x + 2) = x", "x + 2 = x**2"], 1),
    ("multiplicar ambos lados", "ecuacion", ["x/3 + 1 = 4", "x + 3 = 12", "x = 9"], None),
    ("denominador variable", "ecuacion", ["1/(x - 1) = 2", "1 = 2*(x - 1)", "x = 3/2"], None),
    ("cuadrática por fórmula", "ecuacion", ["x**2 - 5*x + 6 = 0", "(x - 2)*(x - 3) = 0"], None),
    # Así termina una cuadrática en un libro: el renglón final trae las dos ramas.
    ("cuadrática con las dos ramas", "ecuacion",
     ["x**2 - 5*x + 6 = 0", "(x - 2)*(x - 3) = 0", "x = 2 o x = 3"], None),
    # Y una rama sola SÍ tiene que marcarse: deja afuera la otra respuesta.
    ("una rama sola pierde la otra", "ecuacion",
     ["(x - 2)*(x - 3) = 0", "x = 2"], 1),
    ("binomio al cuadrado", "expresion", ["(x + 5)**2", "x**2 + 10*x + 25"], None),
    # El error más clásico del colegio. Por conjunto solución PASARÍA —tiene el
    # mismo {0} que "x = 0"—; solo lo agarra la diferencia simbólica.
    ("olvidar el doble producto", "expresion", ["(x + 5)**2", "x**2 + 25"], 1),
    ("factorizar bien", "expresion", ["x**2 - 5*x + 6", "(x - 2)*(x - 3)"], None),
]


def do_autotest() -> dict:
    fallas = []
    for nombre, tipo, pasos, esperado in _AUTOTEST:
        r = do_cadena(pasos, tipo)
        got = r.get("primerError")
        if got != esperado:
            fallas.append({"caso": nombre, "esperaba": esperado, "dio": got})
    return {"ok": not fallas, "corridos": len(_AUTOTEST),
            "fallas": fallas} if fallas else {"ok": True, "corridos": len(_AUTOTEST)}


def do_puntos(expr: str, variable: str, desde: float, hasta: float, n: int) -> dict:
    """Muestrea la función para dibujarla.

    Se evalúa acá y no en el navegador porque la expresión ya está parseada y
    porque una raíz de un negativo o una división por cero tienen que salir como
    HUECO en la curva, no como un punto en cualquier lado: `1/x` no se dibuja
    cruzando el cero. Los no-finitos se devuelven como `null` y el que dibuja
    corta el trazo ahí.
    """
    e = _a_reales(_parse(expr))
    libres = [s for s in e.free_symbols if s.name == variable]
    v = libres[0] if libres else sp.Symbol(variable, real=True)
    f = sp.lambdify(v, e, "math")
    paso = (hasta - desde) / max(1, n - 1)
    pts = []
    for i in range(n):
        x = desde + i * paso
        try:
            y = f(x)
            y = float(y)
            pts.append([round(x, 6), round(y, 6)] if y == y and abs(y) != float("inf") else [round(x, 6), None])
        except Exception:  # noqa: BLE001  fuera del dominio: hueco
            pts.append([round(x, 6), None])
    return {"ok": True, "puntos": pts}


def main():
    try:
        # JSON por argv[1] (lo usa el eval) o por stdin (uso manual).
        payload = sys.argv[1] if len(sys.argv) > 1 else sys.stdin.read()
        req = json.loads(payload or "{}")
        mode = req.get("mode")
        if mode == "eval":
            print(json.dumps(do_eval(req["expr"], req.get("simplificar", True))))
        elif mode == "equiv":
            print(json.dumps(do_equiv(req["a"], req["b"])))
        elif mode == "puntos":
            print(json.dumps(do_puntos(req["expr"], req.get("variable", "x"),
                                       float(req.get("desde", -10)), float(req.get("hasta", 10)),
                                       int(req.get("n", 120)))))
        elif mode == "autotest":
            print(json.dumps(do_autotest()))
        elif mode == "cadena":
            # tipo: "ecuacion" (conjunto solución) | "expresion" (diferencia).
            print(json.dumps(do_cadena(req["pasos"], req.get("tipo", "ecuacion"))))
        else:
            print(json.dumps({"ok": False, "error": f"modo desconocido: {mode}"}))
    except Exception as e:  # noqa: BLE001 — nunca tirar la corrida del eval
        print(json.dumps({"ok": False, "equal": False, "error": str(e)}))


if __name__ == "__main__":
    main()
