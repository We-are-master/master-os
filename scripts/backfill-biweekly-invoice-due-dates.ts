/**
 * Recalculate invoice due dates for biweekly accounts (Housekeep by default).
 * Usage: npx tsx scripts/backfill-biweekly-invoice-due-dates.ts [--dry-run] [--account-id=UUID]
 */
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { createClient } from "@supabase/supabase-js";

function loadEnvFile(name: string) {
  const path = resolve(process.cwd(), name);
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnvFile(".env.local");
loadEnvFile(".env");
import { dueDateIsoFromAccountPaymentTerms } from "../src/lib/account-payment-due-date";
import { loadOrgPartnerPayoutSettings } from "../src/lib/org-partner-payout-settings-server";

const HOUSEKEEP_ACCOUNT_ID = "9659bbfb-eb56-4a31-9773-7f5e1335d0b4";
const dryRun = process.argv.includes("--dry-run");
const allAccounts = process.argv.includes("--all");
const accountArg = process.argv.find((a) => a.startsWith("--account-id="));
const scopeAccountId = allAccounts ? null : accountArg ? accountArg.split("=")[1]! : HOUSEKEEP_ACCOUNT_ID;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || process.env.SERVICE_ROLE_KEY?.trim();
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SERVICE_ROLE_KEY");
  process.exit(1);
}

const admin = createClient(url, key);
const SKIP_STATUSES = new Set(["paid", "cancelled"]);

async function main() {
  const orgCtx = await loadOrgPartnerPayoutSettings(admin);
  const orgPaymentCtx = {
    orgStandardTerms: orgCtx.orgStandardTerms,
    orgReferenceYmd: orgCtx.orgReferenceYmd ?? null,
  };

  let invQuery = admin
    .from("invoices")
    .select("id, reference, job_reference, due_date, source_account_id, status, created_at")
    .not("job_reference", "is", null)
    .is("deleted_at", null);
  if (scopeAccountId) invQuery = invQuery.eq("source_account_id", scopeAccountId);

  const { data: invoices, error: invErr } = await invQuery;
  if (invErr) throw invErr;

  const eligible = (invoices ?? []).filter((i) => !SKIP_STATUSES.has(String(i.status)));
  const jobRefs = [...new Set(eligible.map((i) => String(i.job_reference).trim()))];

  const { data: jobs } = await admin
    .from("jobs")
    .select("reference, client_id, completed_date, scheduled_finish_date, scheduled_end_at, scheduled_start_at")
    .in("reference", jobRefs.length ? jobRefs : ["__none__"]);

  const jobByRef = Object.fromEntries((jobs ?? []).map((j) => [j.reference, j]));

  const accountIds = scopeAccountId
    ? [scopeAccountId]
    : [...new Set(eligible.map((i) => i.source_account_id).filter((x): x is string => Boolean(x)))];

  const { data: accountRows } = await admin
    .from("accounts")
    .select("id, company_name, payment_terms")
    .in("id", accountIds.length ? accountIds : ["00000000-0000-0000-0000-000000000000"]);

  const accountById = Object.fromEntries((accountRows ?? []).map((a) => [a.id, a]));

  console.log(`Org ref: ${orgPaymentCtx.orgReferenceYmd ?? "—"} · ${dryRun ? "DRY RUN" : "APPLY"}`);

  let totalChanges = 0;

  for (const accountId of accountIds) {
    const accounts = accountById[accountId];
    if (!accounts?.payment_terms) continue;

    const accountInvoices = eligible.filter((i) => i.source_account_id === accountId);
    if (!accountInvoices.length) continue;

    const changes: { reference: string; old: string; next: string }[] = [];

    for (const inv of accountInvoices) {
      const job = jobByRef[String(inv.job_reference).trim()];
      const anchorStr =
        job?.completed_date?.slice(0, 10) ??
        job?.scheduled_finish_date?.slice(0, 10) ??
        (job?.scheduled_end_at ? String(job.scheduled_end_at).slice(0, 10) : null) ??
        (job?.scheduled_start_at ? String(job.scheduled_start_at).slice(0, 10) : null) ??
        String(inv.created_at).slice(0, 10);
      const anchor = new Date(`${anchorStr}T12:00:00`);
      const next = dueDateIsoFromAccountPaymentTerms(anchor, accounts.payment_terms, orgPaymentCtx);
      if (next !== inv.due_date) {
        changes.push({ reference: String(inv.reference), old: String(inv.due_date), next });
        if (!dryRun) {
          const { error } = await admin.from("invoices").update({ due_date: next }).eq("id", inv.id);
          if (error) throw error;
        }
      }
    }

    if (changes.length === 0) continue;

    console.log(`\n${accounts.company_name} · ${accounts.payment_terms}`);
    console.log(`Changes: ${changes.length}`);
    for (const c of changes.slice(0, 10)) {
      console.log(`  ${c.reference}: ${c.old} → ${c.next}`);
    }
    if (changes.length > 10) console.log(`  … +${changes.length - 10} more`);
    totalChanges += changes.length;
  }

  if (totalChanges === 0) {
    const single = scopeAccountId ? accountById[scopeAccountId] : null;
    if (single) {
      console.log(`Account: ${single.company_name} · terms: ${single.payment_terms}`);
    }
    console.log("Changes: 0");
  } else {
    console.log(`\nTotal changes: ${totalChanges}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
