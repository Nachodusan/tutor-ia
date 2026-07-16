# Capítulo 3 — Límites y continuidad

## 3.2 Definición ε-δ de límite

Sea f una función definida en un intervalo abierto que contiene a a, excepto
posiblemente en a. Decimos que el límite de f(x) cuando x tiende a a es L, y
escribimos lim_{x→a} f(x) = L, si para todo ε > 0 existe δ > 0 tal que
0 < |x − a| < δ implica |f(x) − L| < ε.

Esta definición captura la idea intuitiva de que f(x) se puede acercar a L tanto
como se quiera, con tal de tomar x suficientemente cerca de a.

## 3.3 Continuidad

Una función f es continua en a si lim_{x→a} f(x) = f(a). Esto exige tres cosas:
que f(a) esté definida, que el límite exista, y que ambos coincidan.

Un resultado central relaciona continuidad y derivabilidad: si f es derivable en
a, entonces f es continua en a. El recíproco es falso: f(x) = |x| es continua en
0 pero no derivable allí.
