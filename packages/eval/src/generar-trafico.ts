/**
 * GENERAR TRÁFICO para la auditoría de alucinación (§4 del plan).
 *
 * Manda cada pregunta de `golden/trafico-preguntas.jsonl` por el **camino real
 * de producción** (`POST /api/chat`) y registra qué message_id produjo.
 *
 * ── Las cuatro reglas del plan, y por qué ───────────────────────────────────
 *  1. POR `/api/chat`, no por un script que llame al modelo por afuera. Solo ese
 *     camino escribe `citations` y `verification` en `messages`, y sin eso no hay
 *     nada que auditar.
 *  2. PIPELINE SIN TOCAR: mismo prompt, mismo modelo, mismos umbrales. Si se
 *     mejora algo para que la muestra salga linda, la muestra deja de describir
 *     el producto.
 *  3. UNA SOLA CUENTA, para que el perfil del alumno (que fija el nivel de
 *     lectura y la penalización por grado) no sea una variable suelta adentro de
 *     la muestra.
 *  4. SIN RE-INGESTAR nada hasta que termine el etiquetado: una re-ingesta en el
 *     medio rompe los `chunkId`. Con las citas blindadas (guardan el texto) el
 *     daño sería menor, pero la regla se mantiene.
 *
 * Secuencial y con pausa entre turnos a propósito: el sidecar del reranker tiene
 * una sola GPU y responde 503 si se lo satura, y un 503 acá es una pregunta
 * perdida de la muestra.
 *
 *   pnpm --filter @tutor-ia/eval generar-trafico -- --solo t001   # prueba de 1
 *   pnpm --filter @tutor-ia/eval generar-trafico
 */
import { readFile, writeFile } from "node:fs/promises";
import { getSql } from "@tutor-ia/db";

const BASE = process.env.TUTOR_URL ?? "http://localhost:3000";
const USUARIO = process.env.TRAFICO_USER ?? "demo-1m-01";
const PASS = process.env.TRAFICO_PASS ?? "demo-demo-demo-demo";
const PAUSA_MS = Number(process.env.TRAFICO_PAUSA_MS ?? "1500");

const argv = process.argv.slice(2);
const solo = argv.includes("--solo") ? argv[argv.indexOf("--solo") + 1] : null;

interface Pregunta {
  id: string; materia: string; pregunta: string;
  registro: "alumno" | "libro";
  tipo: "respondible" | "sin_material" | "premisa_falsa";
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const preguntas = (await readFile(
    new URL("../golden/trafico-preguntas.jsonl", import.meta.url), "utf8",
  )).split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as Pregunta);
  const aCorrer = solo ? preguntas.filter((p) => p.id === solo) : preguntas;
  if (aCorrer.length === 0) {
    console.error(`❌ No encontré la pregunta "${solo}".`);
    process.exit(1);
  }

  const sql = getSql();
  const materias = await sql<{ id: string; name: string }[]>`
    select id, name from subjects where user_id is null and disabled_at is null`;
  const porNombre = new Map(materias.map((m) => [m.name, m.id]));
  const faltan = [...new Set(aCorrer.map((p) => p.materia))].filter((m) => !porNombre.has(m));
  if (faltan.length) {
    console.error(`❌ Materias del jsonl que no existen o están en pausa:\n   ${faltan.join("\n   ")}`);
    process.exit(1);
  }

  // Login: una sola sesión para todo el tráfico (regla 3).
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USUARIO, password: PASS }),
  });
  if (!login.ok) {
    console.error(`❌ Login falló (${login.status}). ¿Está levantada la web en ${BASE}?`);
    process.exit(1);
  }
  const cookie = login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");

  console.log(
    `📤 Generando tráfico — ${aCorrer.length} preguntas\n` +
      `   cuenta: ${USUARIO} (una sola, por la regla 3)\n` +
      `   destino: ${BASE}/api/chat\n`,
  );

  const salida: unknown[] = [];
  let conCitas = 0, sinCitas = 0, fallidas = 0;

  for (const [i, p] of aCorrer.entries()) {
    const t0 = Date.now();
    process.stdout.write(`  ${String(i + 1).padStart(2)}/${aCorrer.length} ${p.id} [${p.tipo.padEnd(13)}] `);
    try {
      // Cada pregunta arranca su PROPIA conversación (sin sessionId ni history):
      // la unidad de la auditoría es la afirmación, y arrastrar historia metería
      // el turno previo como variable dentro de la muestra.
      const res = await fetch(`${BASE}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({
          question: p.pregunta,
          subjectId: porNombre.get(p.materia),
          subjectName: p.materia,
          history: [],
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const texto = await res.text();
      const frame = texto.split("\x1e")[1]?.split("\n")[0];
      const sessionId = frame
        ? ((JSON.parse(frame) as { sessionId?: string }).sessionId ?? null)
        : null;
      if (!sessionId) throw new Error("la respuesta no trajo sessionId");

      // El message_id se resuelve desde la base: la ruta no lo devuelve.
      const filas = await sql<{ id: string; n: number }[]>`
        select m.id, coalesce(jsonb_array_length(m.citations), 0)::int as n
        from messages m
        where m.session_id = ${sessionId}::uuid and m.role = 'assistant'
        order by m.created_at desc limit 1`;
      const fila = filas[0];
      const tuvoCitas = (fila?.n ?? 0) > 0;
      tuvoCitas ? conCitas++ : sinCitas++;
      salida.push({
        ...p, cuenta: USUARIO, session_id: sessionId,
        message_id: fila?.id ?? null, tuvo_citas: tuvoCitas, citas: fila?.n ?? 0,
      });
      console.log(`${tuvoCitas ? `✓ ${fila!.n} citas` : "· sin citas"}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    } catch (e) {
      fallidas++;
      salida.push({ ...p, cuenta: USUARIO, message_id: null, tuvo_citas: false, error: String(e) });
      console.log(`❌ ${e instanceof Error ? e.message : e}`);
    }
    if (i < aCorrer.length - 1) await dormir(PAUSA_MS);
  }

  const out = new URL("../golden/trafico-generado.jsonl", import.meta.url).pathname;
  // Append: correr en tandas no debe pisar lo anterior.
  const previo = await readFile(out, "utf8").catch(() => "");
  await writeFile(out, previo + salida.map((s) => JSON.stringify(s)).join("\n") + "\n", "utf8");

  console.log(
    `\n${"═".repeat(56)}\n` +
      `con citas: ${conCitas} · sin citas: ${sinCitas} · fallidas: ${fallidas}\n` +
      `💾 ${out}`,
  );
  await sql.end();
}

await main();
process.exit(0);
