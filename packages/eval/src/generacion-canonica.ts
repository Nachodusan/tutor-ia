/**
 * ¿PUEDE EL MODELO ESCRIBIR EL TROZO DE LIBRO QUE FALTA?
 *
 * Solo para el recorte CANÓNICO: los componentes del currículum que no están en
 * ningún libro del corpus y que son hecho estable, igual en cualquier país
 * (ADN, Mendel, leyes de conservación, ciclo del carbono, ortografía).
 *
 * ── Por qué esta corrida no repite la que ya se descartó ──
 * El piloto de 2026-08-21 dio 0/5 y 1/5, pero medía otra cosa: LEER UNA FUENTE
 * WEB Y REDACTAR. Su peor defecto fue la COPIA (el investigador calcaba la
 * estructura de la fuente y el redactor la reproducía), y su peor error de hecho
 * salió en prosa interpretativa — invirtió lo que dice el DL 3.516. Acá no hay
 * fuente que calcar y no hay prosa que interpretar: se le pide al modelo lo que
 * ya sabe. El riesgo cambia de "plagio + error" a solo "error", y eso sí se
 * puede medir. Que el patrón previo diga "funciona en lo canónico" es una
 * HIPÓTESIS heredada, no un resultado: esto la pone a prueba.
 *
 * ── Lo que se mide, y por qué cada cosa ──
 *  1. ERROR DE HECHO — juez que debe CITAR el error y escribir la corrección.
 *     Pedirle un veredicto suelto produce "parece correcto" sin información.
 *  2. ESCÉPTICO por cada error acusado. Es obligatorio, no un lujo: en la
 *     auditoría de alucinación del golden, 8 jueces sobre 14 afirmaciones dieron
 *     ~79% de ruido del instrumento y solo 3 inventos reales. Sin esta segunda
 *     vuelta, la tasa que salga de acá mide al juez tanto como al generador.
 *  3. REGISTRO — determinístico, por lista de palabras. Un juez para esto sería
 *     caro y peor: "vosotros" o "ordenador" se detectan con un grep, y el piloto
 *     v1 ya se cayó por voseo rioplatense en un producto chileno.
 *  4. NIVEL — juez aparte. El material tiene que servirle a un alumno de 1º
 *     Medio; los textos universitarios son el modo de fallar de OpenStax (§8.12)
 *     y se ven "correctos" en cualquier chequeo de hechos.
 *
 * ⚠️ LIMITACIÓN QUE HAY QUE LEER ANTES DE CREERLE AL NÚMERO: juez y generador
 * son el MISMO modelo salvo que se pase `JUEZ_MODEL`. `exp6` ya avisa que eso es
 * ruidoso. El escéptico lo atenúa, no lo elimina. Con `JUEZ_MODEL` distinto el
 * número vale bastante más.
 *
 * Uso:
 *   pnpm --filter @tutor-ia/eval generacion-canonica [--n 25] [--salida ruta.json]
 */
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chatJSON, chatText } from "@tutor-ia/core";
import { getSql } from "@tutor-ia/db";

const argv = process.argv.slice(2);
const flag = (n: string): string | null => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1]! : null;
};
const TOPE = Number(flag("n") ?? "25");
const SALIDA = resolve(process.cwd(), flag("salida") ?? "generacion-canonica.json");
const JUEZ_MODEL = process.env.JUEZ_MODEL || undefined;

const sql = getSql();

interface Caso {
  asignatura: string;
  curso: string;
  item: string;
  componente: string;
}

/**
 * El código de curso, escrito como para que un modelo sepa de qué edad hablamos.
 *
 * ⚠️ Esto NO es cosmética, y se descubrió midiendo: pasándole `2M` crudo, el juez
 * de nivel razonó sobre **"2º de Bachillerato"** —17-18 años, España— cuando el
 * alumno real es de 2º Medio chileno, 15-16. Un veredicto de "¿le sirve a este
 * curso?" dictado sobre el curso equivocado es ruido con cara de dato. Es la
 * trampa del §8.13 del HANDOFF: medir con una entrada que no es la que el
 * sistema recibe.
 *
 * La edad va explícita y no solo el nombre: "1º Medio" tampoco significa nada
 * fuera de Chile.
 */
function cursoLegible(codigo: string): string {
  const m = /^(\d)([BM])$/.exec(codigo.trim());
  if (m) {
    const n = Number(m[1]);
    return m[2] === "B"
      ? `${n}º Básico (Chile, alumno de ${n + 5}-${n + 6} años)`
      : `${n}º Medio (Chile, alumno de ${n + 13}-${n + 14} años)`;
  }
  // Los niveles EPJA llegan con su nombre largo ("Nivel 1 Educación Media") y
  // son de ADULTOS que retoman la escuela: decir "alumno de 15 años" ahí sería
  // otra entrada falsa.
  return `${codigo} (Chile, educación de personas jóvenes y adultas)`;
}

/**
 * El MISMO criterio que la consulta que produjo la lista: componente no cubierto
 * en su libro (`ok=false`), sin destino en otro libro (`no ? 'en'`), no local, y
 * fuera de salud e interpretación. Va en SQL y no filtrando en TS a propósito:
 * si el recorte se define en dos lados, se desincronizan y el número deja de
 * corresponder a la lista que se discutió.
 */
const EXCLUIR_SALUD = `droga|autocuidado|protección`;
const EXCLUIR_PROSA = `impacto|comprensión oral|tono|volumen|inflexión|ritmo`;

async function traerCasos(): Promise<Caso[]> {
  return sql<Caso[]>`
    with comp as (
      select distinct
             m.asignatura,
             coalesce(m.curso_resuelto, m.nivel) as curso,
             m.item,
             lower(trim(c.valor->>'c')) as componente
        from curriculum_map m,
             lateral jsonb_array_elements(m.componentes_cobertura) as c(valor)
       where m.metodo = 'lector-v1'
         and m.componentes_cobertura is not null
         and coalesce(m.local, false) = false
         and (c.valor->>'ok')::boolean is false
         and not (c.valor ? 'en')
    )
    select asignatura, curso, item, componente
      from comp
     where componente !~ ${EXCLUIR_SALUD}
       and componente !~ ${EXCLUIR_PROSA}
     order by asignatura, componente
     limit ${TOPE}`;
}

// ── 1. GENERAR ───────────────────────────────────────────────────────────────

/**
 * El prompt pide EXPLÍCITAMENTE no meter particulares chilenos.
 *
 * Es la lección de §9.5, y acá pesa el doble: estos textos son justamente los que
 * NO tienen libro detrás, así que la NLI no puede verificarlos contra nada. Un
 * "en Chile se estudia con…" saldría sin red. El contenido canónico no necesita
 * localizarse: el ADN es el mismo en todos lados, y ahí está la razón por la que
 * este recorte es el único candidato.
 */
function promptGeneracion(c: Caso): string {
  return `Sos quien escribe el texto de estudio de un libro escolar chileno.

Escribí la explicación de este contenido para un alumno de ${cursoLegible(c.curso)}:

  CONTENIDO: ${c.componente}
  (es parte de: ${c.item})
  ASIGNATURA: ${c.asignatura}

Reglas:
- Castellano de CHILE. Nada de "vosotros", "ordenador", "coger", "zumo", ni voseo rioplatense ("tenés", "podés", "vos").
- Nivel de ${cursoLegible(c.curso)}, no universitario. Si hay que elegir entre precisión técnica y que se entienda, que se entienda.
- Entre 120 y 220 palabras. Prosa explicativa, sin listas ni títulos.
- Solo hechos estables y universales. NO menciones nada específico de Chile (ni lugares, ni leyes, ni fechas locales, ni datos nacionales): este texto no tiene libro detrás que lo respalde.
- No inventes cifras ni porcentajes que no sean estándar del tema.

Devolvé SOLO el texto, sin preámbulo.`;
}

// ── 2. REGISTRO (determinístico) ─────────────────────────────────────────────

/**
 * Lista corta y literal. No pretende cubrir el idioma: cubre los dos modos de
 * fallar que ya se vieron (voseo rioplatense en el piloto v1, y el español
 * peninsular que trae el modelo por volumen de entrenamiento).
 */
const REGISTRO_MALO: [RegExp, string][] = [
  [/\bvosotros\b|\bvuestro/i, "peninsular: vosotros/vuestro"],
  [/\bordenador\b/i, "peninsular: ordenador"],
  [/\bzumo\b/i, "peninsular: zumo"],
  [/\bcoger\b/i, "peninsular: coger"],
  [/\bmóvil\b(?!\s*(de|del))/i, "peninsular: móvil (por celular)"],
  [/\b(tenés|podés|querés|sabés|debés|hacés)\b/i, "voseo rioplatense"],
  [/\bvos\b(?!\s*otros)/i, "voseo rioplatense: vos"],
];

const fallosDeRegistro = (t: string): string[] =>
  REGISTRO_MALO.filter(([re]) => re.test(t)).map(([, etiqueta]) => etiqueta);

// ── 3. JUEZ DE HECHOS ────────────────────────────────────────────────────────

const ERRORES_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["errores"],
  properties: {
    errores: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["cita", "problema", "correccion"],
        properties: {
          cita: { type: "string", description: "el tramo TEXTUAL del texto que está mal" },
          problema: { type: "string" },
          correccion: { type: "string" },
        },
      },
    },
  },
} as const;

interface ErrorAcusado { cita: string; problema: string; correccion: string }

async function juzgarHechos(c: Caso, texto: string): Promise<ErrorAcusado[]> {
  const r = await chatJSON<{ errores: ErrorAcusado[] }>(
    [
      {
        role: "system",
        content:
          "Sos un profesor de ciencias que corrige el borrador de un libro escolar. " +
          "Buscás ERRORES DE HECHO: afirmaciones falsas, confusiones de conceptos, cifras equivocadas. " +
          "NO son errores: simplificar para el nivel escolar, omitir detalles avanzados, " +
          "o elegir un ejemplo en vez de otro. Si el texto es correcto, devolvé la lista vacía.",
      },
      {
        role: "user",
        content: `CONTENIDO QUE DEBÍA EXPLICAR: ${c.componente} (${c.asignatura}, ${cursoLegible(c.curso)})

=== TEXTO ===
${texto}
=== FIN ===

Listá SOLO los errores de hecho, cada uno con la cita textual, el problema y la corrección.`,
      },
    ],
    ERRORES_SCHEMA,
    JUEZ_MODEL ? { model: JUEZ_MODEL } : undefined,
  );
  return r.errores ?? [];
}

// ── 4. ESCÉPTICO ─────────────────────────────────────────────────────────────

const REFUTA_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["acusacion_valida", "porque"],
  properties: {
    acusacion_valida: { type: "boolean" },
    porque: { type: "string" },
  },
} as const;

/**
 * Prompt con la carga de la prueba INVERTIDA: el escéptico defiende al texto.
 *
 * Un "revisá si esto está bien" produce acuerdo con el juez casi siempre (el
 * modelo lee la acusación como premisa). Pedirle que la refute es lo que hizo
 * aparecer el 79% de ruido en la auditoría del golden.
 */
async function escéptico(c: Caso, texto: string, e: ErrorAcusado): Promise<boolean> {
  const r = await chatJSON<{ acusacion_valida: boolean; porque: string }>(
    [
      {
        role: "system",
        content:
          "Sos el autor del texto y te acusaron de un error. Tu trabajo es DEFENDERLO. " +
          "Marcá la acusación como válida SOLO si el texto realmente dice algo falso. " +
          "Si la acusación es una preferencia de estilo, un detalle avanzado que el nivel " +
          "escolar puede omitir, o una lectura forzada de lo que el texto dice, es INVÁLIDA.",
      },
      {
        role: "user",
        content: `TEXTO (${c.componente}, ${cursoLegible(c.curso)}):
${texto}

ACUSACIÓN:
  cita: "${e.cita}"
  problema: ${e.problema}
  corrección propuesta: ${e.correccion}

¿La acusación es válida?`,
      },
    ],
    REFUTA_SCHEMA,
    JUEZ_MODEL ? { model: JUEZ_MODEL } : undefined,
  );
  return r.acusacion_valida;
}

// ── 5. NIVEL ─────────────────────────────────────────────────────────────────

const NIVEL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["apto", "porque"],
  properties: { apto: { type: "boolean" }, porque: { type: "string" } },
} as const;

async function juzgarNivel(c: Caso, texto: string): Promise<{ apto: boolean; porque: string }> {
  return chatJSON<{ apto: boolean; porque: string }>(
    [
      {
        role: "system",
        content:
          "Decidís si un texto le sirve a un alumno del curso indicado. NO juzgás si es correcto: " +
          "juzgás si lo puede LEER y ENTENDER. Marcá 'apto: false' si asume conocimientos que ese " +
          "curso no tiene, o si el vocabulario es universitario.",
      },
      { role: "user", content: `CURSO: ${cursoLegible(c.curso)}\n\n=== TEXTO ===\n${texto}\n=== FIN ===` },
    ],
    NIVEL_SCHEMA,
    JUEZ_MODEL ? { model: JUEZ_MODEL } : undefined,
  );
}

// ── Corrida ──────────────────────────────────────────────────────────────────

interface Resultado extends Caso {
  texto: string;
  palabras: number;
  registro: string[];
  acusados: ErrorAcusado[];
  confirmados: ErrorAcusado[];
  nivel: { apto: boolean; porque: string };
  limpio: boolean;
}

async function main(): Promise<void> {
  const casos = await traerCasos();
  console.log(`\n═══ GENERACIÓN CANÓNICA — ${casos.length} componentes ═══`);
  console.log(`juez: ${JUEZ_MODEL ?? "el MISMO modelo que genera (ver la limitación en la cabecera)"}\n`);

  const out: Resultado[] = [];
  for (const [i, c] of casos.entries()) {
    process.stdout.write(`[${i + 1}/${casos.length}] ${c.componente.slice(0, 46).padEnd(48)}`);
    try {
      const texto = (await chatText([{ role: "user", content: promptGeneracion(c) }])).trim();
      const registro = fallosDeRegistro(texto);
      const acusados = await juzgarHechos(c, texto);

      // El escéptico corre por acusación, no por texto: una acusación buena y
      // tres malas en el mismo texto tienen que poder separarse.
      const confirmados: ErrorAcusado[] = [];
      for (const e of acusados) {
        if (await escéptico(c, texto, e)) confirmados.push(e);
      }
      const nivel = await juzgarNivel(c, texto);

      const limpio = confirmados.length === 0 && registro.length === 0 && nivel.apto;
      out.push({
        ...c, texto, palabras: texto.split(/\s+/).length,
        registro, acusados, confirmados, nivel, limpio,
      });
      console.log(
        `${limpio ? "✓" : "✗"}  hechos ${confirmados.length}/${acusados.length}` +
        `${registro.length ? ` · registro ${registro.length}` : ""}` +
        `${nivel.apto ? "" : " · nivel"}`,
      );
    } catch (e) {
      console.log(`ERROR: ${e instanceof Error ? e.message : e}`);
    }
  }

  // ── Reporte ────────────────────────────────────────────────────────────────
  const n = out.length;
  const limpios = out.filter((r) => r.limpio).length;
  const conError = out.filter((r) => r.confirmados.length > 0).length;
  const acusadosTot = out.reduce((s, r) => s + r.acusados.length, 0);
  const confirmadosTot = out.reduce((s, r) => s + r.confirmados.length, 0);

  console.log(`\n═══ RESULTADO ═══`);
  console.log(`  limpios (sin error, registro ok, nivel ok):  ${limpios}/${n}`);
  console.log(`  con al menos un error de hecho CONFIRMADO:   ${conError}/${n}`);
  console.log(`  con problema de registro:                    ${out.filter((r) => r.registro.length).length}/${n}`);
  console.log(`  con nivel inadecuado:                        ${out.filter((r) => !r.nivel.apto).length}/${n}`);
  console.log(`\n  RUIDO DEL JUEZ: ${acusadosTot} errores acusados → ${confirmadosTot} confirmados` +
    `${acusadosTot ? ` (${Math.round((1 - confirmadosTot / acusadosTot) * 100)}% descartado por el escéptico)` : ""}`);

  if (confirmadosTot > 0) {
    console.log(`\n  ── errores confirmados, para leerlos a mano ──`);
    for (const r of out.filter((x) => x.confirmados.length)) {
      console.log(`  · [${r.curso}] ${r.componente}`);
      for (const e of r.confirmados) console.log(`      "${e.cita.slice(0, 90)}"\n        → ${e.problema}`);
    }
  }

  await writeFile(SALIDA, JSON.stringify({ casos: out }, null, 2), "utf8");
  console.log(`\n  Los ${n} textos completos quedaron en ${SALIDA}`);
  console.log(`  ⚠️ El número no vale sin LEER algunos: el juez es el mismo modelo que generó.\n`);
  await sql.end();
}

await main();
