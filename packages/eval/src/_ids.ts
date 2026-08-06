import { readFile } from "node:fs/promises";
import { getSql } from "@tutor-ia/db";
import { resolverAnclas, type ChunkLite, type GoldAnchor } from "./lib/gold-anchors";
const sql = getSql();
const anclas = (await readFile(new URL("../golden/gold-anchors.jsonl", import.meta.url).pathname,"utf8")).split("\n").filter(Boolean).map(l=>JSON.parse(l) as GoldAnchor);
const rows = (await readFile(new URL("../golden/questions.jsonl", import.meta.url).pathname,"utf8")).split("\n").filter(l=>l.trim()).map(l=>JSON.parse(l) as {id:string;expect_chunks?:string[]}).filter(r=>r.expect_chunks?.length);
const todos = await sql<ChunkLite[]>`select c.id, c.content, d.title as "documentTitle" from chunks c join documents d on d.id=c.document_id where d.title = any(${[...new Set(anclas.map(a=>a.documentTitle))]})`;
let tot=0, cobs:number[]=[];
for (const r of rows) { const {ids, peorCobertura} = resolverAnclas(anclas.filter(a=>a.questionId===r.id), todos); tot+=ids.length; cobs.push(peorCobertura); }
const med=(x:number[])=>x.reduce((a,b)=>a+b,0)/x.length;
console.log(`chunks en el libro ahora: ${todos.length}`);
console.log(`ids gold por pregunta: ${(tot/rows.length).toFixed(2)}  (ANTES del re-chunk: 1.69)`);
console.log(`cobertura media del ancla: ${(100*med(cobs)).toFixed(1)}%  · mínima ${(100*Math.min(...cobs)).toFixed(1)}%`);
await sql.end(); process.exit(0);
