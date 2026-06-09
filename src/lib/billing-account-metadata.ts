import type { SupabaseClient } from "@supabase/supabase-js";
import { accountLinkedLabel } from "@/lib/account-display";
import { effectiveInvoiceSourceAccountId } from "@/lib/billing-invoice-list-data";
import { getSupabase } from "@/services/base";
import type { Invoice } from "@/types/database";

const ACCOUNT_CHUNK = 80;

export type BillingAccountMetadata = {
  accountNameById: Record<string, string>;
  accountTermsById: Record<string, string>;
  accountLogoById: Record<string, string | null>;
};

/** Collect every account id the billing UI may resolve for grouping. */
export function collectBillingAccountIds(
  invRows: Pick<Invoice, "source_account_id" | "job_reference" | "client_name">[],
  jobRefToAccountId: Record<string, string>,
  clientNameToAccountId: Record<string, string>,
): string[] {
  const ids = new Set<string>();
  for (const inv of invRows) {
    const direct = inv.source_account_id?.trim();
    if (direct) ids.add(direct);
    const resolved = effectiveInvoiceSourceAccountId(inv, jobRefToAccountId, clientNameToAccountId);
    if (resolved) ids.add(resolved);
  }
  for (const id of Object.values(jobRefToAccountId)) {
    const t = id?.trim();
    if (t) ids.add(t);
  }
  for (const id of Object.values(clientNameToAccountId)) {
    const t = id?.trim();
    if (t) ids.add(t);
  }
  return [...ids];
}

export function mergeAccountMetadata(
  base: BillingAccountMetadata,
  patch: Partial<BillingAccountMetadata>,
): BillingAccountMetadata {
  return {
    accountNameById: { ...base.accountNameById, ...patch.accountNameById },
    accountTermsById: { ...base.accountTermsById, ...patch.accountTermsById },
    accountLogoById: { ...base.accountLogoById, ...patch.accountLogoById },
  };
}

export async function fetchAccountMetadataForBilling(
  accountIds: string[],
  supabase: SupabaseClient = getSupabase(),
): Promise<BillingAccountMetadata> {
  const names: Record<string, string> = {};
  const terms: Record<string, string> = {};
  const logos: Record<string, string | null> = {};
  const unique = [...new Set(accountIds.map((id) => id.trim()).filter(Boolean))];
  if (unique.length === 0) {
    return { accountNameById: names, accountTermsById: terms, accountLogoById: logos };
  }

  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += ACCOUNT_CHUNK) {
    chunks.push(unique.slice(i, i + ACCOUNT_CHUNK));
  }

  const results = await Promise.all(
    chunks.map((chunk) =>
      supabase
        .from("accounts")
        .select("id, company_name, contact_name, email, payment_terms, logo_url")
        .in("id", chunk)
        .is("deleted_at", null),
    ),
  );

  for (const { data, error } of results) {
    if (error) throw error;
    for (const a of data ?? []) {
      const row = a as {
        id: string;
        company_name?: string | null;
        contact_name?: string | null;
        email?: string | null;
        payment_terms?: string | null;
        logo_url?: string | null;
      };
      const label = accountLinkedLabel(row);
      names[row.id] = label || "Unknown account";
      terms[row.id] = row.payment_terms?.trim() || "—";
      logos[row.id] = row.logo_url ?? null;
    }
  }

  return { accountNameById: names, accountTermsById: terms, accountLogoById: logos };
}

export async function fetchAccountMetadataForInvoices(
  invRows: Invoice[],
  jobRefToAccountId: Record<string, string>,
  clientNameToAccountId: Record<string, string>,
): Promise<BillingAccountMetadata> {
  const accountIds = collectBillingAccountIds(invRows, jobRefToAccountId, clientNameToAccountId);
  return fetchAccountMetadataForBilling(accountIds);
}
