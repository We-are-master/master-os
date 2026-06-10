import { getSupabase } from "@/services/base";
import {
  fetchAccountMetadataForInvoices,
  type BillingAccountMetadata,
} from "@/lib/billing-account-metadata";
import {
  fetchCustomerPaidSumByJobIds,
  fetchJobsByReferences,
} from "@/lib/billing-invoice-list-data";
import { buildInvoiceAccountMaps } from "@/lib/billing-invoice-account-resolve";
import { computeLinkedJobsMapsForSelfBillIds } from "@/lib/billing-selfbill-actions";
import { isSelfBillClosed } from "@/services/self-bills";
import type { Invoice, SelfBill } from "@/types/database";

const PARTNER_TERMS_CHUNK = 80;

export type BillingEnrichmentState = {
  jobsByRef: Awaited<ReturnType<typeof fetchJobsByReferences>>;
  customerPaidByJobId: Record<string, number>;
  jobsBySelfBillId: Awaited<ReturnType<typeof computeLinkedJobsMapsForSelfBillIds>>["map"];
  partnerPaidByJobId: Record<string, number>;
  partnerTermsById: Record<string, string | null>;
  partnerAvatarById: Record<string, string | null>;
  accountNameById: Record<string, string>;
  accountTermsById: Record<string, string>;
  accountLogoById: Record<string, string | null>;
  jobRefToAccountId: Record<string, string>;
  clientNameToAccountId: Record<string, string>;
};

export const EMPTY_BILLING_ENRICHMENT: BillingEnrichmentState = {
  jobsByRef: {},
  customerPaidByJobId: {},
  jobsBySelfBillId: {},
  partnerPaidByJobId: {},
  partnerTermsById: {},
  partnerAvatarById: {},
  accountNameById: {},
  accountTermsById: {},
  accountLogoById: {},
  jobRefToAccountId: {},
  clientNameToAccountId: {},
};

const PERF_MARKS = [
  "billing:fetch:end",
  "billing:critical:end",
  "billing:deferred:end",
  "billing:selfbill-jobs:end",
] as const;

export function billingPerfMark(name: string): void {
  if (process.env.NODE_ENV !== "development") return;
  performance.mark(name);
  if (name === "billing:fetch:end") {
    console.debug("[billing perf] fetch complete");
  }
  if (name === "billing:critical:end") {
    const m = performance.measure("billing:critical", "billing:fetch:end", "billing:critical:end");
    console.debug(`[billing perf] critical enrich ${Math.round(m.duration)}ms`);
  }
  if (name === "billing:deferred:end") {
    const start = performance.getEntriesByName("billing:critical:end")[0]?.startTime;
    if (start != null) {
      const m = performance.measure("billing:deferred", {
        start: start,
        end: performance.getEntriesByName("billing:deferred:end")[0]!.startTime,
      });
      console.debug(`[billing perf] deferred enrich ${Math.round(m.duration)}ms`);
    }
  }
  if (name === "billing:selfbill-jobs:end") {
    console.debug("[billing perf] self-bill job lines loaded");
  }
  for (const mark of PERF_MARKS) {
    if (mark === name) continue;
    const entries = performance.getEntriesByName(mark);
    if (entries.length > 8) performance.clearMarks(mark);
  }
}

export function openSelfBillIdsForEnrichment(sbRows: SelfBill[]): string[] {
  return sbRows.filter((sb) => !isSelfBillClosed(sb)).map((sb) => sb.id);
}

async function fetchPartnerBillingMeta(partnerIds: string[]): Promise<{
  termsById: Record<string, string | null>;
  avatarById: Record<string, string | null>;
}> {
  if (partnerIds.length === 0) return { termsById: {}, avatarById: {} };
  const supabase = getSupabase();
  const termsById: Record<string, string | null> = {};
  const avatarById: Record<string, string | null> = {};
  const chunks: string[][] = [];
  for (let i = 0; i < partnerIds.length; i += PARTNER_TERMS_CHUNK) {
    chunks.push(partnerIds.slice(i, i + PARTNER_TERMS_CHUNK));
  }
  const results = await Promise.all(
    chunks.map((chunk) => supabase.from("partners").select("id, payment_terms, avatar_url").in("id", chunk)),
  );
  for (const { data, error } of results) {
    if (error) throw error;
    for (const row of data ?? []) {
      const pr = row as { id: string; payment_terms?: string | null; avatar_url?: string | null };
      termsById[pr.id] = pr.payment_terms?.trim() || null;
      avatarById[pr.id] = pr.avatar_url?.trim() || null;
    }
  }
  return { termsById, avatarById };
}

/** Fast path: jobs + customer paid sums (KPIs, aging, attention balances). */
export async function enrichCriticalBillingRows(
  invRows: Invoice[],
): Promise<Pick<BillingEnrichmentState, "jobsByRef" | "customerPaidByJobId">> {
  const refs = [...new Set(invRows.map((i) => i.job_reference?.trim()).filter(Boolean))] as string[];
  const jobMap = await fetchJobsByReferences(refs);
  const jobIds = [...new Set(Object.values(jobMap).map((j) => j.id))];
  const paidMap = await fetchCustomerPaidSumByJobIds(jobIds);
  billingPerfMark("billing:critical:end");
  return { jobsByRef: jobMap, customerPaidByJobId: paidMap };
}

const EMPTY_ACCOUNT_META: BillingAccountMetadata = {
  accountNameById: {},
  accountTermsById: {},
  accountLogoById: {},
};

/** Background: account maps, metadata, partner terms/avatars (no self-bill job lines). */
export async function enrichDeferredBillingRows(
  invRows: Invoice[],
  sbRows: SelfBill[],
): Promise<
  Pick<
    BillingEnrichmentState,
    | "jobRefToAccountId"
    | "clientNameToAccountId"
    | "accountNameById"
    | "accountTermsById"
    | "accountLogoById"
    | "partnerTermsById"
    | "partnerAvatarById"
  > & { mapsFailed: boolean; accountMetaFailed: boolean }
> {
  const partnerIds = [...new Set(sbRows.map((s) => s.partner_id?.trim()).filter(Boolean))] as string[];

  let jobRefToAccountId: Record<string, string> = {};
  let clientNameToAccountId: Record<string, string> = {};
  let accountMeta = EMPTY_ACCOUNT_META;
  let partnerTerms: Record<string, string | null> = {};
  let partnerAvatars: Record<string, string | null> = {};
  let mapsFailed = false;
  let accountMetaFailed = false;

  const [mapsResult, partnerResult] = await Promise.allSettled([
    (async () => {
      const accountMaps = await buildInvoiceAccountMaps(invRows);
      const meta = await fetchAccountMetadataForInvoices(
        invRows,
        accountMaps.jobRefToAccountId,
        accountMaps.clientNameToAccountId,
      );
      return { accountMaps, meta };
    })(),
    fetchPartnerBillingMeta(partnerIds),
  ]);

  if (mapsResult.status === "fulfilled") {
    jobRefToAccountId = mapsResult.value.accountMaps.jobRefToAccountId;
    clientNameToAccountId = mapsResult.value.accountMaps.clientNameToAccountId;
    accountMeta = mapsResult.value.meta;
  } else {
    console.error("billing deferred account maps failed", mapsResult.reason);
    mapsFailed = true;
  }

  if (partnerResult.status === "fulfilled") {
    partnerTerms = partnerResult.value.termsById;
    partnerAvatars = partnerResult.value.avatarById;
  } else {
    console.error("billing deferred partner meta failed", partnerResult.reason);
  }

  billingPerfMark("billing:deferred:end");

  return {
    jobRefToAccountId,
    clientNameToAccountId,
    accountNameById: accountMeta.accountNameById,
    accountTermsById: accountMeta.accountTermsById,
    accountLogoById: accountMeta.accountLogoById,
    partnerTermsById: partnerTerms,
    partnerAvatarById: partnerAvatars,
    mapsFailed,
    accountMetaFailed,
  };
}

/** Lazy: linked job lines + partner paid totals for specific self-bill ids. */
export async function enrichSelfBillJobsForIds(
  sbIds: string[],
): Promise<Pick<BillingEnrichmentState, "jobsBySelfBillId" | "partnerPaidByJobId">> {
  if (sbIds.length === 0) {
    return { jobsBySelfBillId: {}, partnerPaidByJobId: {} };
  }
  const linked = await computeLinkedJobsMapsForSelfBillIds(sbIds);
  billingPerfMark("billing:selfbill-jobs:end");
  return {
    jobsBySelfBillId: linked.map,
    partnerPaidByJobId: linked.partnerPaidByJobId,
  };
}
