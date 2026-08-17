#!/usr/bin/env node
/**
 * Alinha o job pela invoice quando ela já foi conciliada como paga.
 *
 * Existiam dois registros para o mesmo dinheiro e eles se contradiziam: a
 * invoice com status=paid e paid_date preenchida, e o job com
 * payment_status=unpaid. Quem lia o job (lista, dispatch, telão, régua de
 * parceiro) via dívida; quem lia a invoice via quitado. O mesmo valor estava
 * recebido e devendo ao mesmo tempo, dependendo da tela.
 *
 * A invoice é o lado confiável: ela tem data de recebimento e foi conciliada
 * contra o banco. Então o job é que se alinha a ela, e não o contrário.
 *
 * Roda uma vez, para o passivo histórico. O que impede de acontecer de novo é a
 * conferência diária (finance-coerencia.mjs), não este script.
 *
 * Salva o estado anterior em .logs/ antes de escrever: 128 escritas de
 * financeiro sem rota de volta é imprudente, mesmo quando a regra é simples.
 *
 *   node scripts/finance-alinhar-job-pela-invoice.mjs            # relatório
 *   node scripts/finance-alinhar-job-pela-invoice.mjs --aplicar  # escreve
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const APLICAR = process.argv.includes("--aplicar");

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
const SHW = { ...SH, "content-type": "application/json", prefer: "return=representation" };
const fmt = (v) => "£" + (Number(v) || 0).toFixed(2);

const invoices = await (await fetch(
  `${SB}/rest/v1/invoices?select=reference,job_reference,status,amount,paid_date,source_account_id&status=eq.paid&deleted_at=is.null&limit=1000`,
  { headers: SH },
)).json();

const refs = [...new Set(invoices.map((i) => i.job_reference).filter(Boolean))];
const jobs = new Map();
for (let k = 0; k < refs.length; k += 40) {
  const p = refs.slice(k, k + 40).map((r) => `"${r}"`).join(",");
  const lote = await (await fetch(
    `${SB}/rest/v1/jobs?select=id,reference,status,payment_status,finance_status,payment_amount,paid_at,client_price&reference=in.(${encodeURIComponent(p)})`,
    { headers: SH },
  )).json();
  for (const j of lote ?? []) jobs.set(j.reference, j);
}

const alvos = [];
for (const i of invoices) {
  const j = i.job_reference ? jobs.get(i.job_reference) : null;
  if (!j) continue;
  if (j.payment_status === "paid") continue;
  // Job cancelado não vira pago: ele tem o próprio caminho, e a invoice viva
  // num job morto é outra categoria (a conferência aponta separado).
  if (j.status === "cancelled") continue;
  alvos.push({ inv: i, job: j });
}

console.log(`\nJobs a alinhar pela invoice: ${alvos.length}  ${fmt(alvos.reduce((a, x) => a + (Number(x.inv.amount) || 0), 0))}\n`);
let difere = 0;
for (const { inv, job } of alvos) {
  const d = Math.abs((Number(inv.amount) || 0) - (Number(job.client_price) || 0)) > 0.01;
  if (d) difere++;
}
console.log(`  desses, ${difere} tem valor de invoice diferente do client_price do job`);
console.log(`  (o payment_amount grava o valor da INVOICE, que e o que foi recebido)\n`);

if (!APLICAR) {
  for (const { inv, job } of alvos.slice(0, 10)) {
    console.log(`  ${job.reference.padEnd(10)} ${inv.reference.padEnd(14)} ${fmt(inv.amount).padStart(10)}  recebido ${inv.paid_date ?? "(sem data)"}  job:${job.payment_status}`);
  }
  if (alvos.length > 10) console.log(`  ... e mais ${alvos.length - 10}`);
  console.log("\n(relatorio apenas — rode com --aplicar para escrever)");
  process.exit(0);
}

// Rota de volta antes de qualquer escrita.
mkdirSync(join(RAIZ, ".logs"), { recursive: true });
const backup = join(RAIZ, ".logs", `alinhamento-antes-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "")}.json`);
writeFileSync(backup, JSON.stringify(alvos.map(({ job, inv }) => ({
  reference: job.reference, id: job.id, invoice: inv.reference,
  antes: { payment_status: job.payment_status, finance_status: job.finance_status, payment_amount: job.payment_amount, paid_at: job.paid_at },
})), null, 1));
console.log(`estado anterior salvo em ${backup}\n`);

let ok = 0, erro = 0;
for (const { inv, job } of alvos) {
  const r = await fetch(`${SB}/rest/v1/jobs?id=eq.${job.id}`, {
    method: "PATCH", headers: SHW,
    body: JSON.stringify({
      payment_status: "paid",
      finance_status: "paid",
      payment_amount: Number(inv.amount) || 0,
      paid_at: inv.paid_date ? `${inv.paid_date}T12:00:00Z` : new Date().toISOString(),
    }),
  });
  if (r.ok) ok++;
  else { erro++; console.log(`  ERRO ${job.reference}: ${(await r.text()).slice(0, 110)}`); }
}
console.log(`\nalinhados: ${ok}  |  erros: ${erro}`);
