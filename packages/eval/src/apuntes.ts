/**
 * GENERA EL APUNTE DE CADA PARADA DEL CAMINO.
 *
 *   pnpm --filter @tutor-ia/eval apuntes --key siamqlm --ver
 *   pnpm --filter @tutor-ia/eval apuntes --materia "Física 1º Medio" --limite 5 --aplicar
 *   pnpm --filter @tutor-ia/eval apuntes --todas --aplicar
 *
 * Sin `--aplicar` imprime y NO escribe. Conviene mirar antes: de un apunte se
 * estudia varias veces, así que un error acá se repite en cada repaso.
 *
 * ⚠️ EL SIDECAR TIENE QUE ESTAR ARRIBA para que corra el gate. Sin él el apunte
 * se guarda marcado `gate.corrido: false` y hay que volver a pasarlo.
 */
import { armarApunte, verificarApunte, apunteATexto, partirEnOraciones, SinApunte } from "@tutor-ia/core";
import { toJson } from "@tutor-ia/db";
import { fetchLessonMaterial, nliPairs } from "@tutor-ia/rag";
import { paradas, materiasConPlan, errorFrecuente, queSeEvalua, sql } from "./paradas-lib";

const APLICAR = process.argv.includes("--aplicar");
const TODAS = process.argv.includes("--todas");
const VER = process.argv.includes("--ver");
const arg = (f: string) => {
  const i = process.argv.indexOf(f);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const LIMITE = Number(arg("--limite") ?? (TODAS ? 100000 : 3));
/** El modelo es un MoE: a temperatura 0 igual cambia de corrida. Ver clases.ts. */
const REINTENTOS = Number(arg("--reintentos") ?? 2);

async function main() {
  const lista = (await paradas({ materia: arg("--materia"), key: arg("--key") })).slice(0, LIMITE);
  if (lista.length === 0) {
    console.log("Ningún resultado para ese filtro. Materias con plan:");
    console.log(`  ${(await materiasConPlan()).join("\n  ")}`);
    await sql.end();
    return;
  }
  console.log(`${lista.length} parada(s)${APLICAR ? "" : "  [ensayo: no escribe]"}\n`);

  let ok = 0, sinMaterial = 0, fallo = 0, sinGate = 0;

  for (const p of lista) {
    const etiqueta = `${p.subjectName} · ${p.title} (${p.key}, p.${p.p0}-${p.p1})`;
    if (!p.documentId) { console.log(`  –  ${etiqueta}\n     sin documentId en el plan`); sinMaterial++; continue; }

    const frags = await fetchLessonMaterial({
      subjectId: p.subjectId, documentId: p.documentId, pageStart: p.p0, pageEnd: p.p1,
    });
    const oraciones = partirEnOraciones(frags.map((f) => ({ content: f.content, page: f.page })));
    if (oraciones.length < 4) {
      console.log(`  –  ${etiqueta}\n     ${oraciones.length} oración(es) usables: no alcanza para un apunte`);
      sinMaterial++; continue;
    }

    const [ef, ev] = await Promise.all([
      errorFrecuente(p.subjectId, p.title),
      queSeEvalua(p.subjectId, p.title),
    ]);
    const t0 = Date.now();
    try {
      let a = null as Awaited<ReturnType<typeof armarApunte>> | null;
      let ultimo: unknown = null;
      for (let intento = 0; intento <= REINTENTOS && !a; intento++) {
        try {
          const bruto = await armarApunte({
            titulo: p.title, subjectName: p.subjectName, oraciones,
            errorFrecuente: ef, evaluacion: ev,
          });
          a = await verificarApunte(bruto, oraciones, nliPairs);
        } catch (e) {
          ultimo = e;
          if (intento < REINTENTOS) console.log(`     · intento ${intento + 1} sin apunte (${e instanceof SinApunte ? e.razon : e}), reintento`);
        }
      }
      if (!a) throw ultimo;

      const g = a.gate!;
      if (!g.corrido) sinGate++;
      console.log(
        `  ✓  ${etiqueta}\n` +
        `     ${oraciones.length} oraciones → ${a.puntos.length} puntos · ${((Date.now() - t0) / 1000).toFixed(1)}s · ` +
        (g.corrido ? `gate: ${g.respaldados}/${g.puntos} respaldados, ${g.contradichos} contradichos` : `GATE NO CORRIÓ (${g.motivo})`) +
        (ef ? " · con error frecuente" : "") + (a.seEvalua.length ? ` · ${a.seEvalua.length} conceptos evaluables` : ""),
      );
      if (VER) {
        console.log("\n" + apunteATexto(a, { titulo: p.title, materia: p.subjectName, p0: p.p0, p1: p.p1 })
          .split("\n").map((l) => `     ${l}`).join("\n") + "\n");
      }

      if (APLICAR) {
        await sql`
          insert into lesson_notes (subject_id, topic_key, apunte, gate, topic_title)
          values (${p.subjectId}, ${p.key}, ${toJson(sql, a)}, ${toJson(sql, a.gate ?? null)}, ${p.title})
          on conflict (subject_id, topic_key) do update
            set apunte = excluded.apunte, gate = excluded.gate,
                topic_title = excluded.topic_title, generated_at = now()`;
      }
      ok++;
    } catch (e) {
      console.log(`  ✗  ${etiqueta}\n     ${e instanceof SinApunte ? e.razon : e instanceof Error ? e.message : String(e)}`);
      fallo++;
    }
  }

  console.log(`\n${ok} listos · ${sinMaterial} sin material · ${fallo} fallaron`);
  if (sinGate > 0) console.log(`⚠️  ${sinGate} sin gate: el sidecar no estaba. Hay que volver a pasarlos.`);
  if (!APLICAR && ok > 0) console.log(`\nNo se escribió nada. Con --aplicar se guardan.`);
  await sql.end();
}

void main();
