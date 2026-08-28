/**
 * APUNTES PARA LAS PARADAS DEL PROGRAMA — las que el libro de la materia no cubre.
 *
 * Al final del camino hay una unidad con lo que el Estado exige y este libro no
 * trae (§9.7). Hasta ahora esas paradas solo DECÍAN el hueco y mandaban al
 * tutor. Pero medido: de 43 paradas, **21 tienen TODO su material** en libros
 * del alumno y 18 la mayor parte — lo que falta casi nunca es el contenido, es
 * el ALCANCE. El apunte se puede armar hoy, con material real.
 *
 * ── En qué se diferencia de `apuntes` (el batch normal) ─────────────────────
 * El otro toma UN rango de páginas de UN tomo. Éste junta los pedacitos de los
 * N tomos donde vive cada componente del conocimiento (`materialDeParada`), y
 * por eso cada oración viaja con su libro: cada tomo empieza en su página 1, así
 * que "pág. 181" sin decir de cuál manda a leer cualquier cosa. Es el bug de los
 * 158 pilares falsos (§8.5) y del puntero de §9.4, y acá el riesgo es mayor
 * porque el material viene de varios tomos SIEMPRE, no por accidente.
 *
 * ── Lo que NO hace, a propósito ─────────────────────────────────────────────
 * NO inventa el contenido que falta. Los componentes sin material quedan
 * declarados (`faltan`), no rellenados. Generar ese trozo se midió aparte
 * (§11): sale bien en ciencias, pero necesita revisión humana y una marca
 * propia, y son 4 paradas de 43. Mezclarlo acá convertiría un apunte con
 * respaldo verificable en uno que mezcla dos cosas sin distinguirlas.
 *
 * Uso:
 *   pnpm --filter @tutor-ia/eval apuntes-programa --materia "Biología" [--aplicar]
 *   pnpm --filter @tutor-ia/eval apuntes-programa --todas --aplicar
 */
import { armarApunte, verificarApunte, partirEnOraciones, SinApunte, apunteATexto, type Apunte } from "@tutor-ia/core";
import { getSql, toJson } from "@tutor-ia/db";
import { materialDeParada, nliPairs } from "@tutor-ia/rag";

const argv = process.argv.slice(2);
const tiene = (n: string) => argv.includes(`--${n}`);
const flag = (n: string): string | null => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1]! : null;
};
const MATERIA = flag("materia");
const APLICAR = tiene("aplicar");
/** Regenerar lo ya hecho. Sin esto el batch es RESUMIBLE: se puede cortar y
 *  relanzar sin pagar de nuevo las paradas que ya salieron. */
const FORZAR = tiene("forzar");
const sql = getSql();

/** Misma clave que `claveParada` en rag/curriculum.ts. Si cambia allá, cambia acá. */
function claveParada(subjectId: string, item: string): string {
  const base = `${subjectId}|${item}`;
  let h = 0;
  for (let i = 0; i < base.length; i++) h = (Math.imul(31, h) + base.charCodeAt(i)) | 0;
  return `p${(h >>> 0).toString(36)}`;
}

interface Fila {
  subject_id: string; materia: string; item: string; verificado: string;
  cobertura: { c: string; ok: boolean; en?: { materia: string } | null }[] | null;
}

async function paradas(): Promise<Fila[]> {
  return sql<Fila[]>`
    select cm.subject_id, s.name as materia, cm.item, cm.verificado,
           cm.componentes_cobertura as cobertura
      from curriculum_map cm join subjects s on s.id = cm.subject_id
     where cm.metodo = 'lector-v1'
       and s.disabled_at is null
       and cm.verificado in ('no_esta', 'otro_año', 'parcial')
       and cm.componentes_cobertura is not null
       and (${MATERIA}::text is null or s.name ilike ${"%" + (MATERIA ?? "") + "%"})
     order by s.name, cm.item`;
}

async function main(): Promise<void> {
  const filas = await paradas();
  // Una misma parada puede tener varias filas (nivel × curso): se apunta una vez.
  const vistas = new Set<string>();
  const unicas = filas.filter((f) => {
    const k = `${f.subject_id}|${f.item}`;
    if (vistas.has(k)) return false;
    vistas.add(k);
    return true;
  });

  console.log(`\n═══ APUNTES DE PARADAS DEL PROGRAMA ═══`);
  console.log(`${unicas.length} paradas${MATERIA ? ` en "${MATERIA}"` : ""}${APLICAR ? "" : "  (SIMULACRO: sin --aplicar no escribe)"}\n`);

  // Las que ya tienen apunte, para saltearlas. Una consulta, no una por parada.
  const yaHechas = new Set(
    (await sql<{ subject_id: string; topic_key: string }[]>`
      select subject_id::text, topic_key from lesson_notes where topic_key like 'p%'`)
      .map((r) => `${r.subject_id}|${r.topic_key}`),
  );

  let hechos = 0, sinMaterial = 0, fallados = 0, salteadas = 0;

  for (const [i, f] of unicas.entries()) {
    const faltan = (f.cobertura ?? []).filter((c) => !c.ok && !c.en).map((c) => c.c);
    const conMaterial = (f.cobertura ?? []).length - faltan.length;
    const etiqueta = `${f.item.slice(0, 54)}…`;
    if (!FORZAR && yaHechas.has(`${f.subject_id}|${claveParada(f.subject_id, f.item)}`)) {
      console.log(`[${i + 1}/${unicas.length}] ${etiqueta}\n    · ya tiene apunte, se saltea (--forzar para rehacerlo)`);
      salteadas++;
      continue;
    }
    process.stdout.write(`[${i + 1}/${unicas.length}] ${etiqueta} · ${f.materia}\n`);

    const frags = await materialDeParada(f.subject_id, f.item);
    const tomos = [...new Set(frags.map((x) => x.libro))];
    console.log(`    material: ${frags.length} fragmentos de ${tomos.length} tomo(s)` +
      ` · componentes con material ${conMaterial}, sin material ${faltan.length}`);

    if (frags.length === 0) {
      console.log(`    ⚠ sin material: se deja como está (la parada sigue diciendo el hueco)`);
      sinMaterial++;
      continue;
    }

    const oraciones = partirEnOraciones(frags);
    if (oraciones.length < 4) {
      console.log(`    ⚠ solo ${oraciones.length} oraciones utilizables: no alcanza`);
      sinMaterial++;
      continue;
    }

    /**
     * UN REINTENTO, y solo para el fallo de generación.
     *
     * DeepInfra devuelve JSON inválido cada tanto —medido: 1 de 8 acá y 4 de 25
     * en la corrida de generación canónica— y `withRetry` no lo cubre porque no
     * es 429 ni 5xx, es un 200 con el cuerpo roto. Sin esto la parada se pierde
     * entera por un hipo del proveedor, y como el batch es idempotente el costo
     * de reintentar es una llamada.
     *
     * Solo `generacion`: `sin_material` y `vacio` son deterministas y reintentar
     * daría exactamente lo mismo.
     */
    let apunte: Apunte | null = null;
    for (let intento = 1; intento <= 2 && !apunte; intento++) {
      try {
        apunte = await armarApunte({
          titulo: f.item,
          subjectName: f.materia,
          oraciones,
          // Sin guía docente: esta parada no es una lección de este libro, así que
          // no hay `errores_frecuentes` que le corresponda. La regla de §10.3 vale
          // igual — si no entra aviso, no sale bloque.
        });
      } catch (e) {
        const razon = e instanceof SinApunte ? e.razon : String(e);
        if (razon === "generacion" && intento === 1) {
          console.log(`    · el proveedor falló, reintento`);
          continue;
        }
        console.log(`    ✗ ${razon}`);
        break;
      }
    }
    if (!apunte) { fallados++; continue; }

    // El gate de NLI, igual que el batch normal: veto, no sello.
    try {
      apunte = await verificarApunte(apunte, oraciones, nliPairs);
    } catch {
      console.log(`    ⚠ el sidecar de NLI no respondió: queda sin gate`);
    }

    const g = apunte.gate;
    console.log(`    apunte: ${apunte.puntos.length} puntos · ${apunte.palabras.length} palabras` +
      (g?.corrido ? ` · gate ${g.respaldados}/${g.puntos} respaldados, ${g.contradichos} contradichos` : " · sin gate"));
    // Cuántos puntos citan un tomo distinto del de la materia: es lo que
    // justifica todo el trabajo de arrastrar el libro por la tubería.
    const conLibro = apunte.puntos.filter((p) => p.libro).length;
    console.log(`    ${conLibro}/${apunte.puntos.length} puntos citan su TOMO` +
      (faltan.length ? `  ·  queda sin cubrir: ${faltan.join(", ")}` : ""));

    if (APLICAR) {
      await sql`
        insert into lesson_notes (subject_id, topic_key, apunte, gate, topic_title)
        values (${f.subject_id}::uuid, ${claveParada(f.subject_id, f.item)},
                ${toJson(sql, apunte)}, ${toJson(sql, apunte.gate ?? null)}, ${f.item})
        on conflict (subject_id, topic_key) do update
          set apunte = excluded.apunte, gate = excluded.gate,
              topic_title = excluded.topic_title, generated_at = now()`;
    } else {
      console.log("\n" + apunteATexto(apunte, { titulo: f.item, materia: f.materia })
        .split("\n").map((l) => "      " + l).join("\n") + "\n");
    }
    hechos++;
  }

  console.log(`\n═══ ${hechos} apuntes · ${salteadas} ya estaban · ${sinMaterial} sin material · ${fallados} fallados ═══`);
  if (!APLICAR) console.log(`(simulacro: nada se escribió. Con --aplicar se guardan en lesson_notes)`);
  await sql.end();
}

await main();
