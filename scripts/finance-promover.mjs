#!/usr/bin/env node
/**
 * Passa o que fechou de rascunho para pronto, no domingo do corte.
 *
 * As duas regras que o dono pediu são o MESMO instante, e vale escrever isso
 * porque não é óbvio: o pagamento cai na sexta, e cinco dias antes da sexta é
 * o domingo. Então à meia-noite de domingo, de uma vez:
 *
 *   FATURA   rascunho -> a receber, quando o serviço já foi entregue e o
 *            período dele fechou. Rascunho de job que ainda não aconteceu
 *            continua rascunho: não se cobra trabalho que não foi feito.
 *   SELF-BILL acumulando -> pronto para pagar, quando a quinzena dele fechou.
 *            É o "cinco dias antes", contado do outro lado.
 *
 * A quinzena é ancorada num pagamento real (sex 07/08/2026) e caminha de 14 em
 * 14 dias, então continua certa em dezembro sem ninguém contar sexta na mão.
 *
 *   node scripts/finance-promover.mjs            # relatório
 *   node scripts/finance-promover.mjs --aplicar  # escreve
 */
import { readFileSync } from "node:fs";
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
const ymd = (d) => d.toISOString().slice(0, 10);

// Sexta 07/08/2026 foi um pagamento real. O corte é o domingo 5 dias antes.
const ANCORA_SEXTA = new Date("2026-08-07T00:00:00Z");
const hoje = new Date();
let sexta = new Date(ANCORA_SEXTA);
while (sexta <= hoje) sexta = new Date(sexta.getTime() + 14 * 86400e3);
const CORTE = ymd(new Date(sexta.getTime() - 5 * 86400e3));  // domingo que fechou (sexta menos 5)
const PROX_SEXTA = ymd(sexta);

console.log(`\nCorte fechado: domingo ${CORTE}  ·  próximo pagamento: sexta ${PROX_SEXTA}\n`);

// ── Faturas: rascunho -> a receber ────────────────────────────────────────
const drafts = await (await fetch(
  `${SB}/rest/v1/invoices?select=reference,job_reference,amount,status&status=eq.draft&deleted_at=is.null&limit=500`,
  { headers: SH },
)).json();
const refs = [...new Set(drafts.map((i) => i.job_reference).filter(Boolean))];
const jm = new Map();
for (let k = 0; k < refs.length; k += 40) {
  const p = refs.slice(k, k + 40).map((r) => `"${r}"`).join(",");
  for (const j of await (await fetch(`${SB}/rest/v1/jobs?select=reference,status,completed_date&reference=in.(${encodeURIComponent(p)})`, { headers: SH })).json()) jm.set(j.reference, j);
}
const promover = [], ficam = [];
for (const i of drafts) {
  const j = i.job_reference ? jm.get(i.job_reference) : null;
  // Entregue e com o período fechado. Sem data de conclusão não há o que cobrar.
  if (j && j.completed_date && j.completed_date <= CORTE && j.status !== "cancelled") promover.push({ i, j });
  else ficam.push({ i, j });
}
console.log(`FATURAS  rascunho -> a receber: ${promover.length} (${fmt(promover.reduce((a, x) => a + (+x.i.amount || 0), 0))})`);
for (const { i, j } of promover) console.log(`  ${i.reference.padEnd(14)} ${fmt(i.amount).padStart(9)}  ${i.job_reference}  entregue ${j.completed_date}`);
console.log(`  seguem em rascunho: ${ficam.length} (serviço ainda não entregue ou período aberto)`);

// ── Self-bills: acumulando -> pronto para pagar ───────────────────────────
const bills = await (await fetch(
  `${SB}/rest/v1/self_bills?select=reference,partner_name,net_payout,status,week_end&status=eq.accumulating&week_end=lte.${CORTE}&limit=500`,
  { headers: SH },
)).json();
const comValor = (bills ?? []).filter((b) => (Number(b.net_payout) || 0) > 0);
const zerados = (bills ?? []).length - comValor.length;
console.log(`\nSELF-BILLS  acumulando -> pronto para pagar: ${comValor.length} (${fmt(comValor.reduce((a, b) => a + (+b.net_payout || 0), 0))})`);
for (const b of comValor) console.log(`  ${b.reference.slice(0, 26).padEnd(27)} ${fmt(b.net_payout).padStart(9)}  ${b.partner_name}`);
if (zerados) console.log(`  ${zerados} com valor zero ficam de fora: bill sem job não vira pagamento.`);

if (!APLICAR) { console.log("\n(relatório apenas — rode com --aplicar para escrever)\n"); process.exit(0); }

for (const { i } of promover) {
  await fetch(`${SB}/rest/v1/invoices?reference=eq.${encodeURIComponent(i.reference)}`, {
    method: "PATCH", headers: SHW, body: JSON.stringify({ status: "pending" }),
  });
}
for (const b of comValor) {
  await fetch(`${SB}/rest/v1/self_bills?reference=eq.${encodeURIComponent(b.reference)}`, {
    method: "PATCH", headers: SHW, body: JSON.stringify({ status: "ready_to_pay" }),
  });
}
console.log(`\naplicado: ${promover.length} fatura(s) e ${comValor.length} self-bill(s)\n`);
