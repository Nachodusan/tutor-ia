// Genera las páginas web interactivas de la auditoría de alucinación.
// Lee el snapshot congelado + el ORDEN de las planillas CSV (que es distinto
// por persona a propósito) y emite web/persona-A.html y web/persona-B.html.
// Las páginas son ciegas: no incluyen nada de llave.csv.
//
//   node packages/eval/src/auditoria-web.mjs

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dirAud = join(root, 'golden', 'auditoria');
const dirOut = join(dirAud, 'web');
mkdirSync(dirOut, { recursive: true });

// ── datos ────────────────────────────────────────────────────────────────
const lineas = readFileSync(join(root, 'golden', 'auditoria-snapshot.jsonl'), 'utf8')
  .trim().split('\n').map((l) => JSON.parse(l));
const porId = new Map();
for (const r of lineas) {
  if (r.afirmacion_id) porId.set(r.afirmacion_id, r);
  if (r.respuesta_id) porId.set(r.respuesta_id, r);
}

function idsDeCsv(archivo) {
  return readFileSync(join(dirAud, archivo), 'utf8')
    .trim().split('\n').slice(1)
    .map((l) => l.match(/^"([^"]+)"/)[1]);
}

function pagina(persona) {
  const ids = idsDeCsv(`planilla-${persona}.csv`);
  const idsG = idsDeCsv(`planilla-${persona}-sin-material.csv`);

  const casos = ids.map((id) => {
    const r = porId.get(id);
    if (!r) throw new Error(`falta ${id} en el snapshot`);
    return {
      id,
      pregunta: r.pregunta_alumno,
      afirmacion: r.afirmacion,
      respuesta: r.respuesta_completa,
      material: (r.material ?? []).map((m) => ({ etiqueta: m.etiqueta, texto: m.texto })),
    };
  });
  const casosG = idsG.map((id) => {
    const r = porId.get(id);
    if (!r) throw new Error(`falta ${id} en el snapshot`);
    return { id, pregunta: r.pregunta_alumno, respuesta: r.respuesta_completa };
  });

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Auditoría — Persona ${persona}</title>
<style>
  :root {
    --fondo: #faf8f4; --tarjeta: #ffffff; --tinta: #2b2620; --suave: #6f675c;
    --borde: #e4ddd2; --acento: #3d6b52; --marca: #fff3c4; --marca-tinta: #4a3f10;
    --ok: #2e7d4f; --mal: #b3423a; --neutro: #7a6f5f; --peligro: #fbeceb;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --fondo: #1c1a17; --tarjeta: #262320; --tinta: #ece7df; --suave: #a89e90;
      --borde: #3a352f; --acento: #7fbf9c; --marca: #4a3f10; --marca-tinta: #ffe999;
      --ok: #66bb8a; --mal: #e08078; --neutro: #a89e90; --peligro: #3a2422;
    }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--fondo); color: var(--tinta);
    font: 16px/1.55 "Iowan Old Style", Georgia, serif; }
  header { position: sticky; top: 0; z-index: 5; background: var(--fondo);
    border-bottom: 1px solid var(--borde); padding: 10px 16px;
    display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
  header h1 { font-size: 17px; margin: 0; }
  .barra { flex: 1; min-width: 140px; height: 10px; border-radius: 5px;
    background: var(--borde); overflow: hidden; }
  .barra > div { height: 100%; width: 0; background: var(--acento); transition: width .2s; }
  .contador { font-size: 14px; color: var(--suave); white-space: nowrap; }
  header button { font: inherit; font-size: 14px; padding: 6px 12px; border-radius: 8px;
    border: 1px solid var(--borde); background: var(--tarjeta); color: var(--tinta); cursor: pointer; }
  header button.exportar { border-color: var(--acento); color: var(--acento); font-weight: 600; }
  main { max-width: 860px; margin: 0 auto; padding: 20px 16px 90px; }
  .intro { color: var(--suave); font-size: 15px; margin-bottom: 22px; }
  .intro strong { color: var(--tinta); }
  .caso { background: var(--tarjeta); border: 1px solid var(--borde); border-radius: 12px;
    padding: 18px 20px; margin-bottom: 18px; }
  .caso.hecho { opacity: .55; }
  .caso.hecho:focus-within, .caso.hecho:hover { opacity: 1; }
  .cabecera { display: flex; justify-content: space-between; gap: 10px; align-items: baseline; }
  .num { font-size: 13px; color: var(--suave); letter-spacing: .04em; }
  .pregunta { font-style: italic; color: var(--suave); margin: 6px 0 12px; }
  .respuesta { white-space: pre-wrap; }
  mark { background: var(--marca); color: var(--marca-tinta); padding: 1px 3px; border-radius: 3px; }
  details { margin: 12px 0; border: 1px dashed var(--borde); border-radius: 8px; padding: 8px 12px; }
  summary { cursor: pointer; color: var(--acento); font-weight: 600; font-size: 15px; }
  .chunk { margin-top: 10px; font-size: 15px; }
  .chunk .fuente { font-size: 13px; color: var(--suave); margin-bottom: 4px; }
  .chunk .texto { white-space: pre-wrap; }
  .botones { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 14px; }
  .botones button { font: inherit; font-size: 14px; font-weight: 600; padding: 8px 16px;
    border-radius: 999px; border: 1.5px solid var(--borde); background: transparent;
    color: var(--suave); cursor: pointer; }
  .botones button[data-e="FUNDAMENTADA"].activo, .botones button[data-e="AVISO"].activo
    { border-color: var(--ok); color: var(--ok); background: color-mix(in srgb, var(--ok) 12%, transparent); }
  .botones button[data-e="ALUCINACION"].activo, .botones button[data-e="NO_AVISO"].activo
    { border-color: var(--mal); color: var(--mal); background: color-mix(in srgb, var(--mal) 12%, transparent); }
  .botones button[data-e="NO_APLICA"].activo
    { border-color: var(--neutro); color: var(--neutro); background: color-mix(in srgb, var(--neutro) 14%, transparent); }
  .nota { margin-top: 10px; width: 100%; font: inherit; font-size: 14px; padding: 8px 10px;
    border: 1px solid var(--borde); border-radius: 8px; background: var(--fondo); color: var(--tinta); }
  h2 { margin: 34px 0 6px; font-size: 20px; }
  .aviso { background: var(--peligro); border: 1px solid var(--borde); border-radius: 10px;
    padding: 10px 14px; font-size: 14px; margin: 10px 0 20px; }
  .regla { font-size: 15px; color: var(--suave); margin: 0 0 18px; }
  .pasos li { margin-bottom: 6px; }
  .consigna { font-weight: 700; margin: 14px 0 0; }
  footer { position: fixed; bottom: 0; left: 0; right: 0; background: var(--fondo);
    border-top: 1px solid var(--borde); padding: 8px 16px; text-align: center;
    font-size: 13px; color: var(--suave); }
</style>
</head>
<body>
<header>
  <h1>Persona ${persona}</h1>
  <div class="barra"><div id="progreso"></div></div>
  <span class="contador" id="contador"></span>
  <button id="pendiente">Ir al siguiente sin responder</button>
  <button class="exportar" id="exportar">Terminé — descargar mis respuestas</button>
</header>
<main>
  <p class="intro"><strong>¿De qué se trata?</strong> Un programa de computadora
  les responde dudas a alumnos usando su libro de clase. Queremos saber si a veces
  <strong>inventa cosas que no están en el libro</strong>. Para eso necesitamos su
  ojo humano.</p>
  <p class="intro"><strong>Qué hay que hacer en cada caso:</strong></p>
  <ol class="intro pasos">
    <li>Lea la frase <mark>marcada en amarillo</mark>. Esa es la única frase que
      se evalúa (el resto de la respuesta es solo contexto).</li>
    <li>Toque <strong>«Ver el texto del libro»</strong> y léalo.</li>
    <li>Responda: ¿lo que dice la frase marcada <strong>está en ese texto</strong>?
      <ul>
        <li><strong>Sí, está en el libro</strong> — aunque esté dicho con otras palabras.</li>
        <li><strong>No, no está en el libro</strong> — aunque sea verdad en la vida
          real: si no sale del texto, va acá.</li>
        <li><strong>No corresponde</strong> — la frase no afirma nada: es una pregunta
          al alumno, un «¿te quedó claro?», una invitación a pensar.</li>
      </ul>
    </li>
  </ol>
  <p class="intro">Si duda, escriba por qué en el cuadro de nota. No hace falta
  terminar de una vez: <strong>todo queda guardado solo</strong> en esta computadora,
  puede cerrar y seguir otro día (en el mismo navegador). Al terminar todo, toque el
  botón verde de arriba y envíe los dos archivos que se descargan.</p>
  <div class="aviso">⛔ Importante: trabaje <strong>solo</strong>, sin comentar los
  casos con la otra persona ni mirar su página, hasta que ambos terminen. Si se
  ponen de acuerdo antes, la medición pierde valor.</div>
  <section id="casos"></section>
  <h2>Última parte — 11 respuestas sin libro</h2>
  <p class="regla">En estos casos el programa respondió <strong>sin tener texto del
  libro</strong>. Acá la pregunta es otra: ¿le avisó al alumno que eso no estaba en
  su libro, o respondió como si sí estuviera? No hay frase marcada: se lee la
  respuesta entera.</p>
  <section id="casosG"></section>
</main>
<footer>Sus respuestas se guardan solas en esta computadora · puede cerrar y seguir después</footer>
<script>
const CASOS = ${JSON.stringify(casos)};
const CASOS_G = ${JSON.stringify(casosG)};
const CLAVE = 'auditoria-persona-${persona}';
const estado = JSON.parse(localStorage.getItem(CLAVE) || '{}');
function guardar() { localStorage.setItem(CLAVE, JSON.stringify(estado)); pintarProgreso(); }

function resaltar(respuesta, afirmacion) {
  const i = respuesta.indexOf(afirmacion);
  const e = (s) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  if (i < 0) return e(respuesta) + '\\n\\n<mark>' + e(afirmacion) + '</mark>';
  return e(respuesta.slice(0, i)) + '<mark>' + e(afirmacion) + '</mark>' + e(respuesta.slice(i + afirmacion.length));
}

function tarjeta(c, n, total, opciones, conMaterial) {
  const div = document.createElement('article');
  div.className = 'caso'; div.id = 'caso-' + c.id;
  const guardado = estado[c.id] || {};
  let html = '<div class="cabecera"><span class="num">Caso ' + n + ' de ' + total + '</span></div>' +
    '<p class="pregunta">Pregunta del alumno: «' + c.pregunta.replace(/</g,'&lt;') + '»</p>' +
    '<p class="respuesta">' + (conMaterial ? resaltar(c.respuesta, c.afirmacion)
      : c.respuesta.replace(/</g,'&lt;')) + '</p>';
  if (conMaterial) {
    html += '<details><summary>Ver el texto del libro</summary>' +
      c.material.map((m) => '<div class="chunk"><div class="fuente">' +
        m.etiqueta.replace(/</g,'&lt;') + '</div><div class="texto">' +
        m.texto.replace(/</g,'&lt;') + '</div></div>').join('') + '</details>';
  }
  html += '<p class="consigna">' + (conMaterial
      ? '¿Lo que dice la frase marcada está en el texto del libro?'
      : '¿Le avisó al alumno que esto no estaba en su libro?') + '</p>' +
    '<div class="botones">' + opciones.map((o) =>
    '<button data-e="' + o.valor + '" class="' + (guardado.etiqueta === o.valor ? 'activo' : '') + '">' +
    o.texto + '</button>').join('') + '</div>' +
    '<input class="nota" placeholder="Nota (opcional): si dudó, escriba por qué" value="' +
    (guardado.nota || '').replace(/"/g, '&quot;') + '">';
  div.innerHTML = html;
  if (guardado.etiqueta) div.classList.add('hecho');
  div.querySelectorAll('.botones button').forEach((b) => b.onclick = () => {
    const ya = estado[c.id]?.etiqueta === b.dataset.e;
    estado[c.id] = { ...estado[c.id], etiqueta: ya ? '' : b.dataset.e };
    div.querySelectorAll('.botones button').forEach((x) => x.classList.toggle('activo', x === b && !ya));
    div.classList.toggle('hecho', !ya);
    guardar();
  });
  div.querySelector('.nota').oninput = (ev) => {
    estado[c.id] = { ...estado[c.id], nota: ev.target.value }; guardar();
  };
  return div;
}

const cont = document.getElementById('casos');
CASOS.forEach((c, i) => cont.append(tarjeta(c, i + 1, CASOS.length, [
  { valor: 'FUNDAMENTADA', texto: 'Sí, está en el libro' },
  { valor: 'ALUCINACION', texto: 'No, no está en el libro' },
  { valor: 'NO_APLICA', texto: 'No corresponde' },
], true)));
const contG = document.getElementById('casosG');
CASOS_G.forEach((c, i) => contG.append(tarjeta(c, i + 1, CASOS_G.length, [
  { valor: 'AVISO', texto: 'Sí, avisó' },
  { valor: 'NO_AVISO', texto: 'No avisó' },
], false)));

function pintarProgreso() {
  const todos = [...CASOS, ...CASOS_G];
  const hechos = todos.filter((c) => estado[c.id]?.etiqueta).length;
  document.getElementById('progreso').style.width = (100 * hechos / todos.length) + '%';
  document.getElementById('contador').textContent = hechos + ' de ' + todos.length + ' respondidos';
}
pintarProgreso();

document.getElementById('pendiente').onclick = () => {
  const falta = [...CASOS, ...CASOS_G].find((c) => !estado[c.id]?.etiqueta);
  if (falta) document.getElementById('caso-' + falta.id)
    .scrollIntoView({ behavior: 'smooth', block: 'center' });
};

function csv(campos) { return campos.map((v) => '"' + String(v ?? '').replace(/"/g, '""') + '"').join(','); }
function bajar(nombre, contenido) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([contenido], { type: 'text/csv;charset=utf-8' }));
  a.download = nombre; a.click(); URL.revokeObjectURL(a.href);
}
document.getElementById('exportar').onclick = () => {
  bajar('planilla-${persona}.csv',
    'id,pregunta_del_alumno,afirmacion,etiqueta,nota\\n' + CASOS.map((c) =>
      csv([c.id, c.pregunta, c.afirmacion, estado[c.id]?.etiqueta || '', estado[c.id]?.nota || ''])).join('\\n') + '\\n');
  bajar('planilla-${persona}-sin-material.csv',
    'id,pregunta_del_alumno,etiqueta,nota\\n' + CASOS_G.map((c) =>
      csv([c.id, c.pregunta, estado[c.id]?.etiqueta || '', estado[c.id]?.nota || ''])).join('\\n') + '\\n');
};
</script>
</body>
</html>
`;
}

for (const p of ['A', 'B']) {
  writeFileSync(join(dirOut, `persona-${p}.html`), pagina(p));
  console.log(`web/persona-${p}.html listo`);
}

writeFileSync(join(dirOut, 'index.html'), `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Auditoría de alucinación</title>
<style>
  body { font: 17px/1.6 Georgia, serif; max-width: 640px; margin: 60px auto; padding: 0 20px;
    background: #faf8f4; color: #2b2620; }
  @media (prefers-color-scheme: dark) { body { background: #1c1a17; color: #ece7df; } a { color: #7fbf9c; } }
  a { color: #3d6b52; }
  .tarjeta { border: 1px solid #8886; border-radius: 12px; padding: 18px 22px; margin: 16px 0; }
  .tarjeta a { font-size: 20px; font-weight: 700; text-decoration: none; }
  small { opacity: .7; }
</style></head><body>
<h1>Revisión del tutor con inteligencia artificial</h1>
<p>Un programa les responde dudas a alumnos usando su libro de clase. Necesitamos
que dos profesores revisen, cada uno por su lado, si el programa dice cosas que
no están en el libro.</p>
<p>Cada profesor abre <strong>solo su página</strong>, en su propia computadora.
Las instrucciones están adentro. Toma entre 1½ y 2½ horas, y no hace falta
terminar de una vez: el avance se guarda solo.</p>
<p><strong>Regla de oro:</strong> no comentar los casos con el otro profesor ni
mirar su página hasta que ambos terminen.</p>
<div class="tarjeta"><a href="persona-A.html">Profesor/a A →</a><br><small>81 casos, en su orden</small></div>
<div class="tarjeta"><a href="persona-B.html">Profesor/a B →</a><br><small>los mismos casos, en otro orden</small></div>
</body></html>
`);
console.log('web/index.html listo');
