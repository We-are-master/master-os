#!/usr/bin/env node
/**
 * O que entra e o que sai na sexta do pagamento.
 *
 * O caixa da Fixfy tem dois ritmos diferentes, e é isso que torna a conta
 * confusa de fazer de cabeça:
 *
 *   HOUSEKEEP  quinzenal, sexta sim sexta não. O extrato do período chega antes
 *              e diz "You will be paid on Fri X". Entra tudo de uma vez.
 *   PARCEIROS  mesma quinzena da Housekeep (self_bills biweekly), então o que
 *              entra e o que sai batem no mesmo dia. É o dia que aperta.
 *   CHECKATRADE  não tem sexta: cai 72h depois da conclusão do job, pingado, e
 *              antes disso fica no saldo da plataforma esperando o repasse.
 *
 * Por isso o resumo separa "chega na sexta" de "chega quando chegar": juntar os
 * dois faz parecer que há mais dinheiro no dia do que realmente há.
 *
 *   node scripts/finance-sexta.mjs
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
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
const HK = "9659bbfb-eb56-4a31-9773-7f5e1335d0b4";

const hoje = new Date();
const ymd = (d) => d.toISOString().slice(0, 10);

// A âncora é um pagamento real da Housekeep (sex 07/08/2026); daí em diante a
// quinzena é determinística, sem depender de contar sextas na mão.
const ANCORA = new Date("2026-08-07T00:00:00Z");
let sexta = new Date(ANCORA);
while (sexta <= hoje) sexta = new Date(sexta.getTime() + 14 * 86400e3);
const fimPeriodo = new Date(sexta.getTime() - 5 * 86400e3);   // domingo antes
const iniPeriodo = new Date(fimPeriodo.getTime() - 13 * 86400e3);

console.log(`\n=== SEXTA DO PAGAMENTO: ${ymd(sexta)} ===`);
console.log(`periodo que ela liquida: ${ymd(iniPeriodo)} a ${ymd(fimPeriodo)}\n`);

// ─── ENTRA: Housekeep da quinzena ──────────────────────────────────────────
const hkJobs = await (await fetch(
  `${SB}/rest/v1/jobs?select=reference,client_price,payment_status,status,scheduled_date&scheduled_date=gte.${ymd(iniPeriodo)}&scheduled_date=lte.${ymd(fimPeriodo)}&deleted_at=is.null&limit=500`,
  { headers: SH },
)).json();
const hkInv = await (await fetch(
  `${SB}/rest/v1/invoices?select=job_reference&source_account_id=eq.${HK}&deleted_at=is.null&limit=1000`,
  { headers: SH },
)).json();
const ehHK = new Set(hkInv.map((i) => i.job_reference).filter(Boolean));
const entraHK = hkJobs.filter((j) => ehHK.has(j.reference) && j.payment_status !== "paid" && j.status !== "cancelled");
const somaHK = entraHK.reduce((a, j) => a + (Number(j.client_price) || 0), 0);

// ─── ENTRA: Checkatrade, que não espera sexta ──────────────────────────────
const ctInv = await (await fetch(
  `${SB}/rest/v1/invoices?select=job_reference&source_account_id=eq.38b48520-f116-4263-90e5-8cd5a7d39ecf&deleted_at=is.null&limit=1000`,
  { headers: SH },
)).json();
const ehCT = new Set(ctInv.map((i) => i.job_reference).filter(Boolean));
const ctTodos = await (await fetch(
  `${SB}/rest/v1/jobs?select=reference,client_price,payment_status,status,completed_date,scheduled_date&payment_status=eq.unpaid&deleted_at=is.null&limit=1000`,
  { headers: SH },
)).json();
// Duas regras que a primeira versão não tinha, e sem elas o número mentia para
// mais em milhares:
//
// 1. As 72h contam da CONCLUSAO, não da data agendada. Job agendado mas não
//    concluído (late, on_hold) não gera pagamento nenhum.
// 2. Job velho e não pago não é dinheiro a caminho. O Checkatrade paga em 72h,
//    então um job de junho ainda "unpaid" em agosto não está vindo: ou o
//    dinheiro entrou e não foi escriturado, ou tem problema. Somar isso ao
//    caixa da semana é contar duas vezes o que já está na conta.
const ATRASADO = new Date(hoje.getTime() - 21 * 86400e3);
const ctMaduro = [], ctVerde = [], ctVelho = [];
for (const j of ctTodos) {
  if (!ehCT.has(j.reference) || j.status === "cancelled") continue;
  const concl = j.completed_date;
  if (!concl) { ctVerde.push(j); continue; }          // não concluído: não paga
  if (new Date(concl) < ATRASADO) { ctVelho.push(j); continue; }
  if (new Date(new Date(concl).getTime() + 3 * 86400e3) <= sexta) ctMaduro.push(j);
  else ctVerde.push(j);
}
const somaCTm = ctMaduro.reduce((a, j) => a + (Number(j.client_price) || 0), 0);
const somaCTv = ctVerde.reduce((a, j) => a + (Number(j.client_price) || 0), 0);
const somaCTvelho = ctVelho.reduce((a, j) => a + (Number(j.client_price) || 0), 0);

// ─── SAI: parceiros da mesma quinzena ──────────────────────────────────────
const bills = await (await fetch(
  `${SB}/rest/v1/self_bills?select=reference,partner_name,net_payout,status,week_start,week_end,jobs_count&week_end=lte.${ymd(fimPeriodo)}&status=in.(%22accumulating%22,%22ready_to_pay%22,%22awaiting_payment%22)&limit=500`,
  { headers: SH },
)).json();
// Um self-bill absurdo estraga a leitura do dia inteiro sem parecer errado: em
// 17/08 o SB-2026-W22-JOB-9199 dizia £14.093 para 7 jobs, quando o job âncora
// era um End of Tenancy de £130 de custo de parceiro, e sozinho respondia por
// 80% da saída da sexta. Media por job é o cheiro mais barato de detectar isso.
const TETO_POR_JOB = 1500;
const suspeitos = (bills ?? []).filter((b) => {
  const n = Math.max(1, Number(b.jobs_count) || 1);
  return (Number(b.net_payout) || 0) / n > TETO_POR_JOB;
});
const suspeitoRef = new Set(suspeitos.map((b) => b.reference));

const porParceiro = new Map();
for (const b of bills ?? []) {
  if (suspeitoRef.has(b.reference)) continue;
  const k = b.partner_name ?? "(sem nome)";
  porParceiro.set(k, (porParceiro.get(k) ?? 0) + (Number(b.net_payout) || 0));
}
const somaSai = [...porParceiro.values()].reduce((a, v) => a + v, 0);
const somaSuspeita = suspeitos.reduce((a, b) => a + (Number(b.net_payout) || 0), 0);

console.log(`ENTRA NA SEXTA`);
console.log(`  Housekeep, ${entraHK.length} job(s) da quinzena          ${fmt(somaHK).padStart(11)}`);
console.log(`\nSAI NA SEXTA`);
for (const [p, v] of [...porParceiro.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(p).slice(0, 34).padEnd(35)} ${fmt(v).padStart(11)}`);
}
console.log(`  ${"".padEnd(35)} ${"".padStart(11, "-")}`);
console.log(`  ${String(bills?.length ?? 0).padStart(3)} self-bill(s)${"".padEnd(20)} ${fmt(somaSai).padStart(11)}`);

console.log(`\n  >>> SALDO DO DIA: ${fmt(somaHK - somaSai)}${somaHK - somaSai < 0 ? "   (sai mais do que entra)" : ""}`);

if (suspeitos.length) {
  console.log(`\nFORA DA CONTA ACIMA — self-bill com media por job acima de ${fmt(TETO_POR_JOB)}:`);
  for (const b of suspeitos) {
    console.log(`  ${b.reference.padEnd(27)} ${fmt(b.net_payout).padStart(11)}  ${b.jobs_count} job(s) = ${fmt((Number(b.net_payout) || 0) / Math.max(1, Number(b.jobs_count) || 1))}/job  ${b.partner_name}  [${b.status} desde ${b.week_start}]`);
  }
  console.log(`  total segurado ${fmt(somaSuspeita)}. Confira antes de pagar: se estiver certo, o saldo do dia e ${fmt(somaHK - somaSai - somaSuspeita)}.`);
}

console.log(`\nFORA DA SEXTA (Checkatrade cai 72h apos a conclusao)`);
console.log(`  concluido, cai ate a sexta       ${String(ctMaduro.length).padStart(3)} job(s)  ${fmt(somaCTm).padStart(11)}`);
console.log(`  ainda nao concluido ou fora da janela ${String(ctVerde.length).padStart(3)} job(s)  ${fmt(somaCTv).padStart(11)}`);
if (ctVelho.length) console.log(`  ATRASADO ha mais de 3 semanas    ${String(ctVelho.length).padStart(3)} job(s)  ${fmt(somaCTvelho).padStart(11)}   <<< o Checkatrade paga em 72h: isto provavelmente ja entrou e nao foi escriturado`);
console.log(`\n  >>> CAIXA ATE A SEXTA: ${fmt(somaHK + somaCTm - somaSai)}${suspeitos.length ? "   (sem os self-bills segurados)" : ""}\n`);
