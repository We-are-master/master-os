#!/usr/bin/env node
/**
 * Aplica a migração 258 (colunas de cancelamento do partner em jobs) e conserta
 * o JOB-9436, cujo "Pay the partner £200" foi engolido pela coluna inexistente.
 *
 * O que faz, nesta ordem:
 *   1. ALTER TABLE jobs: partner_cancelled_at, partner_cancellation_reason,
 *      partner_cancellation_fee, partner_cancellation_compensation_gbp (IF NOT EXISTS).
 *   2. NOTIFY pgrst reload schema (PostgREST passa a aceitar as colunas).
 *   3. JOB-9436: grava partner_cancellation_compensation_gbp = 200 e zera o
 *      partner_agreed_value = 200 posto à mão como contorno (job cancelado tem
 *      labour zerado; a compensação agora carrega os £200).
 *   4. Recalcula o self-bill do job: net_payout inclui a compensação e o status
 *      sai de draft para awaiting_payment (espelha applyOfficeCancellationFees).
 *
 * Usa o endpoint pg-meta do Kong com a SERVICE_ROLE_KEY do .env — não precisa
 * de DATABASE_URL.
 *
 *   node supabase/scripts/apply-258-partner-cancellation-columns.mjs
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const env = {};
for (const arq of [".env.local", ".env"]) {
  try {
    for (const l of readFileSync(join(RAIZ, arq), "utf8").split("\n")) {
      const m = l.match(/^([A-Z_0-9]+)=(.*)$/);
      if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
    }
  } catch {}
}
const SB = env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, "");
const SH = {
  apikey: env.SERVICE_ROLE_KEY,
  authorization: "Bearer " + env.SERVICE_ROLE_KEY,
  "content-type": "application/json",
};

async function q(query) {
  const r = await fetch(`${SB}/pg/query`, {
    method: "POST",
    headers: SH,
    body: JSON.stringify({ query }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${t}`);
  return t ? JSON.parse(t) : null;
}

async function main() {
  const sql = readFileSync(
    join(RAIZ, "supabase", "migrations", "258_jobs_partner_cancellation_columns.sql"),
    "utf8",
  );
  await q(sql);
  console.log("1/4 migração 258 aplicada");

  await q("NOTIFY pgrst, 'reload schema';");
  console.log("2/4 PostgREST recarregado");

  const jobs = await q(`
    update public.jobs
       set partner_cancellation_compensation_gbp = 200,
           partner_agreed_value = 0
     where reference = 'JOB-9436' and status = 'cancelled'
     returning id, reference, self_bill_id, partner_cancellation_compensation_gbp;
  `);
  if (!jobs?.length) throw new Error("JOB-9436 não encontrado ou não está cancelado — nada alterado.");
  const job = jobs[0];
  console.log(`3/4 ${job.reference}: compensação £200 gravada`);

  if (!job.self_bill_id) {
    console.log("4/4 job sem self-bill vinculado — abra o job e use Sync no card do self-bill.");
    return;
  }

  /** Espelho de refreshSelfBillPayoutState: payable + compensação - clawback. */
  const upd = await q(`
    with linhas as (
      select
        sum(case when j.status in ('awaiting_payment','completed') and j.deleted_at is null
                 then coalesce(j.partner_cost, 0) else 0 end) as job_value,
        sum(case when j.status in ('awaiting_payment','completed') and j.deleted_at is null
                 then coalesce(j.materials_cost, 0) else 0 end) as materials,
        count(*) filter (where j.status in ('awaiting_payment','completed') and j.deleted_at is null) as jobs_count,
        sum(case when j.status = 'cancelled' and j.partner_cancelled_at is null
                 then coalesce(j.partner_cancellation_compensation_gbp, 0) else 0 end) as comp,
        sum(case when j.status = 'cancelled' and j.partner_cancelled_at is null
                 then coalesce(j.cancellation_fee_partner_gbp, 0) else 0 end)
        + sum(case when j.status = 'cancelled' and j.partner_cancelled_at is not null
                 then coalesce(j.partner_cancellation_fee, 0) else 0 end) as claw
      from public.jobs j
      where j.self_bill_id = '${job.self_bill_id}'
    )
    update public.self_bills sb
       set jobs_count = l.jobs_count,
           job_value = l.job_value,
           materials = l.materials,
           net_payout = round(greatest(0, l.job_value + l.materials - l.claw + l.comp)::numeric, 2),
           status = case when sb.status in ('draft','accumulating','pending_review') and l.comp > 0
                         then 'awaiting_payment' else sb.status end
      from linhas l
     where sb.id = '${job.self_bill_id}'
     returning sb.reference, sb.status, sb.jobs_count, sb.job_value, sb.net_payout;
  `);
  console.log("4/4 self-bill recalculado:", JSON.stringify(upd?.[0] ?? null));
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
