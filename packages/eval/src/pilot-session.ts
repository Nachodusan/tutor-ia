import { getSql } from "@tutor-ia/db";
import {
  getTeachingContext,
  streamTeaching,
  teachingAbstention,
  type ChatMessage,
} from "@tutor-ia/core";

const uid = process.env.EVAL_USER_ID!;
const sql = getSql();
const [s] = await sql<{ id: string }[]>`select id from subjects where name='Ciencias Naturales 1º Básico' order by created_at desc limit 1`;
const subjectId = s!.id;

async function turn(question: string, history: ChatMessage[], struggling = false) {
  const { ctx, grounded, rerankerDown } = await getTeachingContext({ userId: uid, subjectId, question, history, struggling });
  if (rerankerDown) return { text: "[reranker caído]", grounded: false };
  if (!grounded) {
    console.log(`  [abstención — ni TE ni GDD cubren]`);
    return { text: teachingAbstention(), grounded: false };
  }
  console.log(`  [grounded via ${ctx.citableSource} · OAs=${ctx.oas.join(",")} · pedagogía: ${Object.entries(ctx.pedagogy).filter(([, v]) => v.length).map(([k]) => k).join("/")}]`);
  let text = "";
  for await (const chunk of streamTeaching({ userId: uid, subjectId, question, history, struggling }, ctx)) text += chunk;
  return { text, grounded: true };
}

const Q1 = "Enséñame para qué sirven los órganos de los sentidos";
console.log(`\n👦 ${Q1}`);
const r1 = await turn(Q1, []);
console.log(`🧑‍🏫 ${r1.text}\n`);

const history: ChatMessage[] = [
  { role: "user", content: Q1 },
  { role: "assistant", content: r1.text },
];
const Q2 = "No entendí, ¿me lo explicás de otra forma?";
console.log(`👦 ${Q2}`);
const r2 = await turn(Q2, history, true);
console.log(`🧑‍🏫 ${r2.text}\n`);

await sql.end();
process.exit(0);
