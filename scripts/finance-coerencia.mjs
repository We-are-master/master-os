#!/usr/bin/env node
/**
 * Coerência do a receber: o job e a invoice dele nunca podem discordar.
 *
 * Esta é a peça que sustenta a promessa de que o "Ready to receive" nunca cobra
 * quem já pagou — e ela existe separada dos agentes de propósito. Os agentes
 * escrevem certo, mas o desencontro não nasce só de robô: nasce de gente
 * marcando um lado na tela e esquecendo o outro, e nasce de robô que ainda vai
 * ser escrito. Uma conferência que depende do agente que ela deveria vigiar não
 * vigia nada.
 *
 * Olha nas DUAS direções, porque as duas aconteceram de verdade nesta base:
 *
 *   job pago  + invoice aberta  -> cobrança falsa. Alguém liga cobrando quem já
 *                                  pagou. Foi o que a varredura do Checkatrade
 *                                  produziu em 17/08 antes de ser corrigida.
 *   job aberto + invoice paga   -> o inverso, e mais silencioso: o financeiro
 *                                  já deu por recebido e o job segue dizendo
 *                                  que deve. 68 jobs da Housekeep estavam assim.
 *
 * Mais dois casos que não são desencontro mas também sujam o a receber:
 * invoice viva em job cancelado, e invoice cujo job não existe mais.
 *
 *   node scripts/finance-coerencia.mjs           # relatório
 *   node scripts/finance-coerencia.mjs --email   # relatório + email
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const MANDAR = process.argv.includes("--email");

const env = {};
for (const arq of [".env.local", ".env"]) {
  try {
    for (const l of readFileSync(join(RAIZ, arq), "utf8").split("\n")) {
      const m = l.match(/^([A-Z_0-9]+)=(.*)$/);
      if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
    }
  } catch {}
}
const SB = env.NEXT_PUBLIC_SUPABASE_URL;
const SH = { apikey: env.SERVICE_ROLE_KEY, authorization: "Bearer " + env.SERVICE_ROLE_KEY };
const fmt = (v) => "£" + (Number(v) || 0).toFixed(2);
const falta = (i) => Math.max(0, (Number(i.amount) || 0) - (Number(i.amount_paid) || 0));

/** O PostgREST tem limite de URL; buscar referência em lotes evita 414. */
async function jobsPorRef(refs) {
  const mapa = new Map();
  for (let k = 0; k < refs.length; k += 40) {
    const p = refs.slice(k, k + 40).map((r) => `"${r}"`).join(",");
    const lote = await (await fetch(
      `${SB}/rest/v1/jobs?select=reference,status,payment_status,client_price,deleted_at&reference=in.(${encodeURIComponent(p)})`,
      { headers: SH },
    )).json();
    for (const j of lote ?? []) mapa.set(j.reference, j);
  }
  return mapa;
}

async function main() {
  const L = [];
  const contas = await (await fetch(`${SB}/rest/v1/accounts?select=id,company_name`, { headers: SH })).json();
  const nomeConta = Object.fromEntries((contas ?? []).map((a) => [a.id, a.company_name]));

  const invoices = await (await fetch(
    `${SB}/rest/v1/invoices?select=reference,job_reference,status,amount,amount_paid,due_date,source_account_id&deleted_at=is.null&limit=2000`,
    { headers: SH },
  )).json();
  const refs = [...new Set(invoices.map((i) => i.job_reference).filter(Boolean))];
  const jobs = await jobsPorRef(refs);

  const cobrancaFalsa = [], recebidoMasAberto = [], jobMorto = [], semJob = [];
  const viva = (s) => s === "pending" || s === "overdue" || s === "partially_paid" || s === "draft";

  for (const i of invoices) {
    if (i.status === "cancelled" || i.status === "void") continue;
    const j = i.job_reference ? jobs.get(i.job_reference) : null;

    if (i.job_reference && !j) { if (viva(i.status)) semJob.push(i); continue; }
    if (!j) continue;

    if ((j.deleted_at || j.status === "cancelled") && viva(i.status)) { jobMorto.push({ i, j }); continue; }
    if (j.payment_status === "paid" && viva(i.status)) { cobrancaFalsa.push({ i, j }); continue; }
    if (i.status === "paid" && j.payment_status !== "paid" && j.status !== "cancelled" && !j.deleted_at) {
      recebidoMasAberto.push({ i, j });
    }
  }

  const linha = (x) => `  ${x.i.reference.padEnd(14)} ${String(x.i.job_reference).padEnd(10)} ${fmt(x.i.amount).padStart(10)}  job ${x.j.status}/${x.j.payment_status}  ${nomeConta[x.i.source_account_id] ?? "sem conta"}`;

  L.push(`Invoices vivas conferidas: ${invoices.length}`);
  L.push("");
  L.push(`COBRANCA FALSA (job pago, invoice aberta): ${cobrancaFalsa.length}  ${fmt(cobrancaFalsa.reduce((a, x) => a + falta(x.i), 0))}`);
  for (const x of cobrancaFalsa) L.push(linha(x));
  L.push("");
  L.push(`RECEBIDO MAS JOB ABERTO (invoice paga, job nao): ${recebidoMasAberto.length}  ${fmt(recebidoMasAberto.reduce((a, x) => a + (Number(x.i.amount) || 0), 0))}`);
  for (const x of recebidoMasAberto.slice(0, 25)) L.push(linha(x));
  if (recebidoMasAberto.length > 25) L.push(`  ... e mais ${recebidoMasAberto.length - 25}`);
  L.push("");
  L.push(`INVOICE VIVA EM JOB CANCELADO: ${jobMorto.length}  ${fmt(jobMorto.reduce((a, x) => a + falta(x.i), 0))}`);
  for (const x of jobMorto) L.push(linha(x));
  L.push("");
  L.push(`INVOICE SEM JOB: ${semJob.length}  ${fmt(semJob.reduce((a, i) => a + falta(i), 0))}`);
  for (const i of semJob) L.push(`  ${i.reference.padEnd(14)} ${String(i.job_reference).padEnd(10)} ${fmt(i.amount).padStart(10)}  ${nomeConta[i.source_account_id] ?? "sem conta"}`);

  const total = cobrancaFalsa.length + recebidoMasAberto.length + jobMorto.length + semJob.length;
  L.unshift(total === 0 ? "TUDO COERENTE." : `${total} incoerencia(s) no a receber.`);

  const texto = L.join("\n");
  console.log("\n" + texto + "\n");

  if (MANDAR && total && env.RESEND_API_KEY) {
    const cfg = await (await fetch(`${SB}/rest/v1/company_settings?select=daily_brief_emails&limit=1`, { headers: SH })).json();
    const para = String(cfg?.[0]?.daily_brief_emails ?? "").split(/[,;\s]+/).filter((s) => s.includes("@"));
    if (para.length) {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer " + env.RESEND_API_KEY },
        body: JSON.stringify({
          from: env.RESEND_FROM_EMAIL ?? "Fixfy <noreply@getfixfy.com>",
          to: para, subject: `A receber: ${total} incoerencia(s)`,
          text: texto + "\n\n-- \nConferencia de coerencia. Nada aqui foi corrigido automaticamente.",
        }),
      });
      console.log(r.ok ? `email enviado para ${para.join(", ")}` : `falha no email: ${(await r.text()).slice(0, 160)}`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
