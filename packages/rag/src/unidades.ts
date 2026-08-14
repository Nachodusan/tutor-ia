/**
 * UNIDADES DEL LIBRO — el camino que ve el alumno.
 *
 * El camino se arma por UNIDAD y no por lección: una unidad engloba más, así que
 * cada nodo da para enseñar de verdad en vez de ser un título suelto. Las
 * lecciones NO se tiran: siguen en `book_sections` con level = 2, intactas,
 * porque son la granularidad que después se cruza con las bases curriculares
 * del estado. Acá se AGREGA el nivel 1, no se reemplaza nada.
 *
 * La fuente es `chunks.unit`, que sale del encabezado corriente de cada página
 * ("Unidad 3 • Los ecosistemas"). Es más universal que el índice impreso: 53 de
 * las 66 materias con libro lo tienen, contra 44 que tienen índice legible.
 *
 * Pero viene sucio, y por eso todo este archivo existe. Medido sobre el corpus:
 * de 228 rangos (documento, unidad) en crudo, solo 59 no se solapan con otro —
 * el 26%. Las dos fuentes de basura son sistemáticas:
 *   · la página del índice nombra TODAS las unidades, así que se le pega la que
 *     el extractor tenía en la mano (en Ciencias Naturales 4º son 5 chunks de la
 *     "unidad 2" en la página 6),
 *   · el cierre del libro (síntesis, glosario) referencia unidades anteriores
 *     (2 chunks de la "unidad 1" en la página 197 del mismo libro).
 * Con el saneado de abajo, 45 de 61 documentos quedan con rangos limpios.
 *
 * Puro a propósito: es la parte con lógica y se prueba sin base.
 */

/** Una página con el recuento de chunks por unidad. */
export interface PaginaUnidad {
  page: number;
  unit: number;
  chunks: number;
}

/** Una lección del índice con la unidad que le tocó por mayoría de sus chunks. */
export interface LeccionConUnidad {
  ord: number;
  unit: number | null;
  pageStart: number;
  pageEnd: number;
}

/** Un grupo de lecciones consecutivas que comparten unidad. */
export interface GrupoUnidad {
  unit: number;
  pageStart: number;
  pageEnd: number;
  /** Los `ord` de las lecciones que caen adentro, en orden. */
  lecciones: number[];
}

/**
 * Agrupa las lecciones del índice en unidades, por CORRIDAS consecutivas.
 *
 * Por corridas y no por número de unidad, y la diferencia no es teórica: el
 * texto de Biología es de 1º Y 2º medio en un solo tomo, así que su numeración
 * va 1,1,1,1 · 2,2 · 3,3,3 · 1,1 · 2,2,2,2 · 3,3,3. Agrupar por número juntaría
 * la unidad 1 de primero con la de segundo en un solo nodo, mezclando evolución
 * con sistema nervioso.
 *
 * La unidad va desde la primera hasta la última lección de su corrida, así que
 * la cobertura es completa por construcción: no quedan huecos entre unidades
 * porque no se recorta nada. Es la ventaja de derivar la unidad DE las lecciones
 * en vez de recortar rangos de páginas y ver qué lección cae adentro — así,
 * medido, Biología perdía 107 páginas entre la unidad 1 y la 2.
 *
 * Las lecciones sin unidad (107 de 1696 en el corpus) se cuelgan de la corrida
 * que venía: son las páginas que el extractor no alcanzó a etiquetar, no un
 * tema aparte.
 */
export function agruparEnUnidades(lecciones: LeccionConUnidad[]): GrupoUnidad[] {
  const orden = [...lecciones].sort((a, b) => a.ord - b.ord);
  const grupos: GrupoUnidad[] = [];
  for (const l of orden) {
    const ultimo = grupos[grupos.length - 1];
    // Sin unidad → sigue en el grupo abierto. Si todavía no hay ninguno, espera:
    // colgarla de una unidad que no existe sería inventarle un lugar.
    if (l.unit === null) {
      if (!ultimo) continue;
      ultimo.pageEnd = Math.max(ultimo.pageEnd, l.pageEnd);
      ultimo.lecciones.push(l.ord);
      continue;
    }
    if (ultimo && ultimo.unit === l.unit) {
      ultimo.pageEnd = Math.max(ultimo.pageEnd, l.pageEnd);
      ultimo.lecciones.push(l.ord);
    } else {
      grupos.push({ unit: l.unit, pageStart: l.pageStart, pageEnd: l.pageEnd, lecciones: [l.ord] });
    }
  }
  return grupos.filter((g) => g.lecciones.length > 0);
}

export interface RangoUnidad {
  unit: number;
  pageStart: number;
  pageEnd: number;
  /** Páginas distintas que quedaron dentro del rango, para poder ponderar. */
  paginas: number;
}

/**
 * Hueco máximo, en páginas, que no corta una unidad. Una unidad real tiene
 * páginas sin chunk (una lámina a doble página, una actividad sin texto
 * extraíble); seis tolera eso sin llegar a unir dos unidades distintas, que en
 * este corpus están separadas por decenas de páginas.
 */
const HUECO_MAX = 6;

/** Una unidad de una o dos páginas es un artefacto —una mención cruzada—, no
 *  una unidad. Medido: subir este mínimo por encima de 2 no rescata ningún
 *  documento más, así que se queda en el valor más permisivo que sirve. */
const PAGINAS_MIN = 2;

/** La corrida contigua más larga, tolerando huecos de hasta `HUECO_MAX`. */
function corridaDominante(paginas: number[]): number[] {
  if (paginas.length === 0) return [];
  const orden = [...paginas].sort((a, b) => a - b);
  const bloques: number[][] = [[orden[0]!]];
  for (const p of orden.slice(1)) {
    const actual = bloques[bloques.length - 1]!;
    if (p - actual[actual.length - 1]! <= HUECO_MAX) actual.push(p);
    else bloques.push([p]);
  }
  return bloques.reduce((a, b) => (b.length > a.length ? b : a));
}

/**
 * Los rangos de página de las unidades de UN documento, saneados.
 *
 * Dos pasos, en este orden:
 *  1. cada PÁGINA se queda con una sola unidad: la que tiene más chunks ahí
 *     (empate → la de número menor). Esto solo ya elimina el solape por
 *     construcción: una página no puede pertenecer a dos unidades.
 *  2. cada unidad se queda con su corrida contigua dominante, que es lo que
 *     descarta la página del índice y la del cierre — quedan como bloques
 *     sueltos de una página frente a la corrida real de decenas.
 *
 * Devuelve vacío si el resultado no es creíble: menos de dos unidades, rangos
 * que igual se solapan, o numeración que no avanza con las páginas (unidad 2
 * empezando antes que la unidad 1). Eso último pasa en 14 documentos y significa
 * que el extractor se confundió de unidad: ahí es mejor no tener camino por
 * unidades que tener uno con el orden cambiado.
 */
export function rangosDeUnidades(paginas: PaginaUnidad[]): RangoUnidad[] {
  if (paginas.length === 0) return [];

  // 1. dueño de cada página
  const mejor = new Map<number, { unit: number; chunks: number }>();
  for (const p of paginas) {
    const previo = mejor.get(p.page);
    if (!previo || p.chunks > previo.chunks || (p.chunks === previo.chunks && p.unit < previo.unit)) {
      mejor.set(p.page, { unit: p.unit, chunks: p.chunks });
    }
  }
  const porUnidad = new Map<number, number[]>();
  for (const [page, { unit }] of mejor) {
    const xs = porUnidad.get(unit) ?? [];
    xs.push(page);
    porUnidad.set(unit, xs);
  }

  // 2. corrida dominante de cada unidad
  const rangos: RangoUnidad[] = [];
  for (const [unit, pags] of porUnidad) {
    const c = corridaDominante(pags);
    if (c.length < PAGINAS_MIN) continue;
    rangos.push({ unit, pageStart: c[0]!, pageEnd: c[c.length - 1]!, paginas: c.length });
  }
  rangos.sort((a, b) => a.pageStart - b.pageStart);

  if (rangos.length < 2) return [];
  for (let i = 1; i < rangos.length; i++) {
    if (rangos[i]!.pageStart <= rangos[i - 1]!.pageEnd) return []; // solape
    if (rangos[i]!.unit <= rangos[i - 1]!.unit) return [];         // numeración al revés
  }
  return rangos;
}

/** Encabezado corriente: "Unidad 3 • Los ecosistemas", con cualquier separador. */
const ENCABEZADO = /Unidad\s*(\d+)\s*[•·–—-]\s*([^\n]{3,70})/gi;

/**
 * La portadilla AL REVÉS: "¿Para qué sirve la imaginación? 1 Unidad".
 *
 * Algunas editoriales ponen el título antes y el número después (Lenguaje 2º
 * básico es el caso claro: sus cuatro unidades salían como "Unidad 1..4" porque
 * el patrón normal no encuentra nada). Solo se usa como respaldo, y solo pide UNA
 * coincidencia: en la portadilla el título aparece una vez, no repetido como en
 * el encabezado corriente.
 */
const PORTADILLA_INVERSA = /(?:^|\n)\s*([^\n]{4,60}?)\s*\n?\s*(\d{1,2})\s+Unidad\b/g;

/**
 * El título de una unidad: el PREFIJO COMÚN de sus encabezados corrientes.
 *
 * La primera versión de esto votaba la variante repetida, y no funcionaba: el
 * encabezado se repite en cada página, pero lo que el chunk arrastra ATRÁS
 * cambia siempre ("…La Tierra en movimiento ¿Qué aprenderás?" en una página,
 * "…La Tierra en movimiento Conozcamos las placas" en la otra). Con la cola
 * distinta cada vez, no hay dos capturas iguales y la votación no juntaba nunca
 * dos votos. Lo estable es el principio, no la repetición.
 *
 * Así que se toma el prefijo común PALABRA POR PALABRA — cortar por carácter
 * dejaría títulos partidos al medio. Se exigen al menos dos capturas: con una
 * sola, el "prefijo común" es la captura entera con su cola de cuerpo pegada.
 *
 * Devuelve null cuando no hay prefijo creíble. Pasa en Lenguaje 1º, donde la
 * regex agarra la bibliografía ("Pág. 84 Long, J. (2007). Vida de…") y las
 * capturas no comparten principio. Un "Unidad 3" pelado es feo; un título
 * inventado es peor.
 */
export function tituloDeUnidad(unit: number, contenidos: string[]): string | null {
  const capturas: string[][] = [];
  for (const c of contenidos) {
    for (const m of (c ?? "").matchAll(ENCABEZADO)) {
      if (Number(m[1]) !== unit) continue;
      const limpio = m[2]!.replace(/\s+/g, " ").trim();
      if (limpio) capturas.push(limpio.split(" "));
    }
  }
  if (capturas.length < 2) {
    // Respaldo: la portadilla invertida. Se vota entre las coincidencias porque
    // el número suelto también aparece en referencias ("ver 2 Unidad").
    const votos = new Map<string, number>();
    for (const c of contenidos) {
      for (const m of (c ?? "").matchAll(PORTADILLA_INVERSA)) {
        if (Number(m[2]) !== unit) continue;
        const t = m[1]!.replace(/\s+/g, " ").trim().replace(/[\s,;:.\-–—•·]+$/, "");
        if (t.length >= 4 && t.length <= 60 && /[a-záéíóúñ]/i.test(t)) {
          votos.set(t, (votos.get(t) ?? 0) + 1);
        }
      }
    }
    if (votos.size === 0) return null;
    const max = Math.max(...votos.values());
    return [...votos.entries()].filter(([, n]) => n === max).map(([t]) => t)
      .sort((a, b) => b.length - a.length)[0]!;
  }

  // Prefijo por MAYORÍA, no por unanimidad. Con unanimidad, una sola captura
  // rara —una referencia cruzada a otra unidad, un pie de página— vaciaba el
  // prefijo y la unidad se quedaba sin título: medido sobre el corpus, así solo
  // el 54% de las 176 unidades conseguía nombre y el resto mostraba "Unidad 4",
  // que a un chico no le dice nada. Se toma el prefijo más largo que compartan
  // al menos dos tercios de las capturas.
  const minimo = Math.max(2, Math.ceil(capturas.length * 2 / 3));
  let mejor: string[] = [];
  const largoMax = Math.max(...capturas.map((c) => c.length));
  for (let n = 1; n <= largoMax; n++) {
    const conteo = new Map<string, number>();
    for (const c of capturas) {
      if (c.length < n) continue;
      const pref = c.slice(0, n).join(" ");
      conteo.set(pref, (conteo.get(pref) ?? 0) + 1);
    }
    let ganador: string | null = null;
    let votos = 0;
    for (const [pref, v] of conteo) if (v > votos) { ganador = pref; votos = v; }
    if (ganador === null || votos < minimo) break;
    mejor = ganador.split(" ");
  }
  if (mejor.length === 0) return null;

  const titulo = mejor.join(" ").trim().replace(/[\s,;:.\-–—•·]+$/, "");
  return titulo.length >= 3 && titulo.length <= 60 ? titulo : null;
}
