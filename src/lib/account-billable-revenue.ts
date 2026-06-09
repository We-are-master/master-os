import { getSupabase } from "@/services/base";
import { chunkIds } from "@/lib/supabase-in-chunks";
import type { Account } from "@/types/database";

const BILLABLE_JOB_STATUSES = ["awaiting_payment", "completed"] as const;
const BILLABLE_INVOICE_STATUSES = new Set([
  "paid",
  "pending",
  "awaiting_payment",
  "partially_paid",
  "overdue",
]);

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Billable customer revenue per B2B account: jobs awaiting payment / completed (no live invoice duplicate)
 * plus open or paid invoices with source_account_id.
 */
export async function computeBillableRevenueForAccounts(
  accountIds: string[],
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const id of accountIds) out[id] = 0;
  if (!accountIds.length) return out;

  const supabase = getSupabase();

  const clients: { id: string; source_account_id?: string | null }[] = [];
  for (const idChunk of chunkIds(accountIds)) {
    const { data, error: clientsErr } = await supabase
      .from("clients")
      .select("id, source_account_id")
      .in("source_account_id", idChunk);
    if (clientsErr) throw new Error(clientsErr.message);
    clients.push(...((data ?? []) as { id: string; source_account_id?: string | null }[]));
  }

  const clientIds = clients.map((c) => c.id);
  const clientToAccount = new Map<string, string>();
  for (const c of clients) {
    const aid = c.source_account_id?.trim();
    if (aid) clientToAccount.set(c.id, aid);
  }
  if (!clientIds.length) {
    await addInvoiceRevenue(supabase, accountIds, out);
    return out;
  }

  const jobs: {
    client_id?: string | null;
    client_price?: number;
    extras_amount?: number;
    invoice_id?: string | null;
  }[] = [];
  for (const idChunk of chunkIds(clientIds)) {
    const { data, error: jobsErr } = await supabase
      .from("jobs")
      .select("client_id, client_price, extras_amount, status, invoice_id")
      .in("client_id", idChunk)
      .in("status", [...BILLABLE_JOB_STATUSES])
      .is("deleted_at", null);
    if (jobsErr) throw new Error(jobsErr.message);
    jobs.push(...((data ?? []) as typeof jobs));
  }

  const invoicedJobIds = new Set<string>();
  for (const row of jobs) {
    const invId = (row as { invoice_id?: string | null }).invoice_id?.trim();
    if (invId) invoicedJobIds.add(invId);
  }

  let liveInvoices = new Set<string>();
  if (invoicedJobIds.size > 0) {
    const invRows: { id: string; status?: string }[] = [];
    for (const idChunk of chunkIds([...invoicedJobIds])) {
      const { data, error: invErr } = await supabase
        .from("invoices")
        .select("id, status")
        .in("id", idChunk)
        .is("deleted_at", null);
      if (invErr) throw new Error(invErr.message);
      invRows.push(...((data ?? []) as { id: string; status?: string }[]));
    }
    liveInvoices = new Set(
      invRows
        .filter((i) => {
          const st = i.status ?? "";
          return st && st !== "cancelled" && st !== "draft" && st !== "audit_required";
        })
        .map((i) => i.id),
    );
  }

  for (const row of jobs) {
    const clientId = (row as { client_id?: string | null }).client_id?.trim();
    const accountId = clientId ? clientToAccount.get(clientId) : undefined;
    if (!accountId) continue;
    const invId = (row as { invoice_id?: string | null }).invoice_id?.trim();
    if (invId && liveInvoices.has(invId)) continue;
    const amt =
      Number((row as { client_price?: number }).client_price ?? 0) +
      Number((row as { extras_amount?: number }).extras_amount ?? 0);
    out[accountId] = roundMoney((out[accountId] ?? 0) + amt);
  }

  await addInvoiceRevenue(supabase, accountIds, out);
  return out;
}

async function addInvoiceRevenue(
  supabase: ReturnType<typeof getSupabase>,
  accountIds: string[],
  out: Record<string, number>,
) {
  for (const idChunk of chunkIds(accountIds)) {
    const { data: invoices, error } = await supabase
      .from("invoices")
      .select("source_account_id, amount, status")
      .in("source_account_id", idChunk)
      .is("deleted_at", null);
    if (error) throw new Error(error.message);

    for (const row of invoices ?? []) {
      const accountId = (row as { source_account_id?: string | null }).source_account_id?.trim();
      if (!accountId) continue;
      const status = (row as { status?: string }).status ?? "";
      if (!BILLABLE_INVOICE_STATUSES.has(status)) continue;
      const amt = Number((row as { amount?: number }).amount ?? 0);
      out[accountId] = roundMoney((out[accountId] ?? 0) + amt);
    }
  }
}

export async function enrichAccountsBillableRevenue(accounts: Account[]): Promise<Account[]> {
  if (!accounts.length) return accounts;
  const ids = [...new Set(accounts.map((a) => a.id))];
  const revenueById = await computeBillableRevenueForAccounts(ids);
  return accounts.map((a) => ({
    ...a,
    total_revenue: revenueById[a.id] ?? a.total_revenue,
  }));
}
