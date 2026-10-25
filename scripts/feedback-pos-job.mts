/**
 * FEEDBACK PÓS-JOB: o e-mail que pergunta "como foi?" um dia depois do job
 * concluído. As regras moram em `src/lib/feedback/pos-job.ts`; quem roda todo
 * dia é o cron `/api/cron/feedback-pos-job` (atrás de FEEDBACK_POS_JOB=on).
 * Este script é para ver a fila e para envio manual.
 *
 *   npx tsx scripts/feedback-pos-job.mts                     # ENSAIO: lista, não grava nada
 *   npx tsx scripts/feedback-pos-job.mts --aplicar           # manda (9h-20h de Londres)
 *   npx tsx scripts/feedback-pos-job.mts --aplicar --agora   # manda fora da janela
 *
 * `--enviar` continua aceito como sinônimo de `--aplicar`. `CLIENT_MESSAGING_ENABLED=1`
 * também tem que estar de pé.
 *
 * Até 14/10/2026 este script filtrava por `payment_status = paid` nas últimas
 * 72h. Agora é job `completed` concluído de ontem até 7 dias atrás, só cliente
 * B2C da Fixfy (conta B2B só com `client_feedback_whatsapp`), sem reclamação.
 */
import { createClient } from "@supabase/supabase-js";
import { loadEnvLocal } from "./load-env-local.mjs";

loadEnvLocal();

// Import DEPOIS do loadEnvLocal: `import` estático é içado, e o cliente do
// Zendesk lê as credenciais no carregamento do módulo (veio "Zendesk not configured").
const { varrerFeedbackPosJob } = await import("../src/lib/feedback/pos-job");

const aplicar = process.argv.includes("--aplicar") || process.argv.includes("--enviar");
const ignorarJanela = process.argv.includes("--agora");

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)!,
  { auth: { persistSession: false } },
);

const { hoje, linhas, modo, aviso } = await varrerFeedbackPosJob(sb, { aplicar, ignorarJanela });

console.log(`\n[feedback] ${hoje} · ${modo === "envio" ? "ENVIO REAL" : "ENSAIO (nada gravado, nada enviado)"}`);
if (aviso) console.log(`aviso: ${aviso}`);
for (const l of linhas) {
  const marca = l.resultado === "enviado" ? "✓" : l.resultado === "enviaria" ? "→" : l.resultado === "falhou" ? "✗" : "·";
  console.log(`  ${marca} ${l.reference.padEnd(10)} ${l.detalhe}`);
}
const conta = (r: string) => linhas.filter((l) => l.resultado === r).length;
console.log(
  `\n${linhas.length} job(s) na janela · enviariam: ${conta("enviaria")} · enviados: ${conta("enviado")} · pulados: ${conta("pulado")} · falhas: ${conta("falhou")}\n`,
);
