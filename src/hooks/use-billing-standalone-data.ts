"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getSupabase } from "@/services/base";
import { useFrontendSetup } from "@/hooks/use-frontend-setup";
import {
  fetchAccountMetadataForInvoices,
  type BillingAccountMetadata,
} from "@/lib/billing-account-metadata";
import {
  fetchCustomerPaidSumByJobIds,
  fetchJobsByReferences,
  effectiveInvoiceSourceAccountId,
} from "@/lib/billing-invoice-list-data";
import { computeLinkedJobsMapsForSelfBillIds } from "@/lib/billing-selfbill-actions";
import { buildInvoiceAccountMaps } from "@/lib/billing-invoice-account-resolve";
import {
  fetchInvoicesForBilling,
  fetchSelfBillsForBilling,
  mergeInvoicesById,
  mergeSelfBillsById,
} from "@/lib/billing-standalone-fetch";
import {
  getBillingInitialFetchBounds,
  resolveBillingStandaloneFilterBounds,
  type BillingStandaloneFilterValue,
} from "@/lib/billing-standalone-filter";
import type { YmdBounds } from "@/lib/billing-standalone-period";
import type { Invoice, SelfBill } from "@/types/database";

const PARTNER_TERMS_CHUNK = 80;

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

const EMPTY_ACCOUNT_META: BillingAccountMetadata = {
  accountNameById: {},
  accountTermsById: {},
  accountLogoById: {},
};

async function enrichBillingRows(
  invRows: Invoice[],
  sbRows: SelfBill[],
): Promise<{
  jobsByRef: Awaited<ReturnType<typeof fetchJobsByReferences>>;
  customerPaidByJobId: Record<string, number>;
  jobsBySelfBillId: Awaited<ReturnType<typeof computeLinkedJobsMapsForSelfBillIds>>["map"];
  partnerPaidByJobId: Record<string, number>;
  jobRefToAccountId: Record<string, string>;
  clientNameToAccountId: Record<string, string>;
  accountNameById: Record<string, string>;
  accountTermsById: Record<string, string>;
  accountLogoById: Record<string, string | null>;
  partnerTermsById: Record<string, string | null>;
  partnerAvatarById: Record<string, string | null>;
  mapsFailed: boolean;
  accountMetaFailed: boolean;
}> {
  const refs = [...new Set(invRows.map((i) => i.job_reference?.trim()).filter(Boolean))] as string[];
  const sbIds = sbRows.map((s) => s.id);
  const partnerIds = [...new Set(sbRows.map((s) => s.partner_id?.trim()).filter(Boolean))] as string[];

  let jobMap: Awaited<ReturnType<typeof fetchJobsByReferences>> = {};
  let linkedJobs: Awaited<ReturnType<typeof computeLinkedJobsMapsForSelfBillIds>> = {
    map: {},
    partnerPaidByJobId: {},
  };
  let jobRefToAccountId: Record<string, string> = {};
  let clientNameToAccountId: Record<string, string> = {};
  let partnerTerms: Record<string, string | null> = {};
  let partnerAvatars: Record<string, string | null> = {};
  let paidMap: Record<string, number> = {};
  let accountMeta = EMPTY_ACCOUNT_META;
  let mapsFailed = false;
  let accountMetaFailed = false;

  // Two independent enrichment chains run in parallel:
  //   Chain A: jobs/linked-jobs/partner-meta (stage 1) → customer-paid sums (stage 3).
  //   Chain B: invoice account maps (stage 2) → account metadata (stage 4).
  // Previously each stage awaited the prior, so wall-clock was the sum. With
  // Promise.allSettled the wall-clock drops to max(chainA, chainB).
  const chainA = (async () => {
    const [jobs, linked, partnerMeta] = await Promise.all([
      fetchJobsByReferences(refs),
      computeLinkedJobsMapsForSelfBillIds(sbIds),
      fetchPartnerBillingMeta(partnerIds),
    ]);
    const jobIds = [...new Set(Object.values(jobs).map((j) => j.id))];
    const paid = await fetchCustomerPaidSumByJobIds(jobIds);
    return { jobs, linked, partnerMeta, paid };
  })();

  const chainB = (async () => {
    const accountMaps = await buildInvoiceAccountMaps(invRows);
    const meta = await fetchAccountMetadataForInvoices(
      invRows,
      accountMaps.jobRefToAccountId,
      accountMaps.clientNameToAccountId,
    );
    return { accountMaps, meta };
  })();

  const [aResult, bResult] = await Promise.allSettled([chainA, chainB]);

  if (aResult.status === "fulfilled") {
    jobMap = aResult.value.jobs;
    linkedJobs = aResult.value.linked;
    partnerTerms = aResult.value.partnerMeta.termsById;
    partnerAvatars = aResult.value.partnerMeta.avatarById;
    paidMap = aResult.value.paid;
  } else {
    console.error("billing chain A enrich failed", aResult.reason);
    mapsFailed = true;
  }

  if (bResult.status === "fulfilled") {
    jobRefToAccountId = bResult.value.accountMaps.jobRefToAccountId;
    clientNameToAccountId = bResult.value.accountMaps.clientNameToAccountId;
    accountMeta = bResult.value.meta;
  } else {
    console.error("billing chain B enrich failed", bResult.reason);
    accountMetaFailed = true;
  }

  return {
    jobsByRef: jobMap,
    customerPaidByJobId: paidMap,
    jobsBySelfBillId: linkedJobs.map,
    partnerPaidByJobId: linkedJobs.partnerPaidByJobId,
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

export type BillingRepairAccountLabel = {
  id: string;
  label: string;
  logoUrl: string | null;
  count: number;
};

export function useBillingStandaloneData() {
  const { partnerPayoutStandardTerms, partnerPayoutReferenceYmd } = useFrontendSetup();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [selfBills, setSelfBills] = useState<SelfBill[]>([]);
  const [jobsByRef, setJobsByRef] = useState<Awaited<ReturnType<typeof fetchJobsByReferences>>>({});
  const [customerPaidByJobId, setCustomerPaidByJobId] = useState<Record<string, number>>({});
  const [jobsBySelfBillId, setJobsBySelfBillId] = useState<
    Awaited<ReturnType<typeof computeLinkedJobsMapsForSelfBillIds>>["map"]
  >({});
  const [partnerPaidByJobId, setPartnerPaidByJobId] = useState<Record<string, number>>({});
  const [partnerTermsById, setPartnerTermsById] = useState<Record<string, string | null>>({});
  const [partnerAvatarById, setPartnerAvatarById] = useState<Record<string, string | null>>({});
  const [accountNameById, setAccountNameById] = useState<Record<string, string>>({});
  const [accountTermsById, setAccountTermsById] = useState<Record<string, string>>({});
  const [accountLogoById, setAccountLogoById] = useState<Record<string, string | null>>({});
  const [jobRefToAccountId, setJobRefToAccountId] = useState<Record<string, string>>({});
  const [clientNameToAccountId, setClientNameToAccountId] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const fullHistoryLoadedRef = useRef(false);
  const prefetchingRef = useRef(false);
  const hasLoadedOnceRef = useRef(false);

  const dueCtx = useMemo(
    () => ({
      orgStandardTerms: partnerPayoutStandardTerms,
      orgReferenceYmd: partnerPayoutReferenceYmd,
    }),
    [partnerPayoutStandardTerms, partnerPayoutReferenceYmd],
  );

  const applyEnrichment = useCallback((enriched: Awaited<ReturnType<typeof enrichBillingRows>>) => {
    setJobsByRef(enriched.jobsByRef);
    setCustomerPaidByJobId(enriched.customerPaidByJobId);
    setJobsBySelfBillId(enriched.jobsBySelfBillId);
    setPartnerPaidByJobId(enriched.partnerPaidByJobId);
    setJobRefToAccountId(enriched.jobRefToAccountId);
    setClientNameToAccountId(enriched.clientNameToAccountId);
    setAccountNameById(enriched.accountNameById);
    setAccountTermsById(enriched.accountTermsById);
    setAccountLogoById(enriched.accountLogoById);
    setPartnerTermsById(enriched.partnerTermsById);
    setPartnerAvatarById(enriched.partnerAvatarById);
  }, []);

  const applyAccountLabels = useCallback((accounts: BillingRepairAccountLabel[]) => {
    if (accounts.length === 0) return;
    const names: Record<string, string> = {};
    const logos: Record<string, string | null> = {};
    for (const a of accounts) {
      if (!a.id?.trim() || !a.label?.trim()) continue;
      names[a.id] = a.label.trim();
      logos[a.id] = a.logoUrl ?? null;
    }
    setAccountNameById((prev) => ({ ...prev, ...names }));
    setAccountLogoById((prev) => ({ ...prev, ...logos }));
  }, []);

  const loadData = useCallback(
    async (opts?: { background?: boolean; bounds?: YmdBounds | null }) => {
      const background = opts?.background ?? false;
      const bounds =
        opts?.bounds !== undefined
          ? opts.bounds
          : fullHistoryLoadedRef.current
            ? null
            : getBillingInitialFetchBounds();

      if (background) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      let invRows: Invoice[] = [];
      let sbRows: SelfBill[] = [];
      let fetchHadErrors = false;

      const [invResult, sbResult] = await Promise.allSettled([
        fetchInvoicesForBilling(bounds),
        fetchSelfBillsForBilling(bounds),
      ]);

      if (invResult.status === "fulfilled") {
        invRows = invResult.value;
        setInvoices(invRows);
      } else {
        fetchHadErrors = true;
        console.error("billing invoices fetch failed", invResult.reason);
        if (!background && !hasLoadedOnceRef.current) setInvoices([]);
      }

      if (sbResult.status === "fulfilled") {
        sbRows = sbResult.value;
        setSelfBills(sbRows);
      } else {
        fetchHadErrors = true;
        console.error("billing self-bills fetch failed", sbResult.reason);
        if (!background && !hasLoadedOnceRef.current) setSelfBills([]);
      }

      if (bounds === null) fullHistoryLoadedRef.current = true;

      if (fetchHadErrors && invRows.length === 0 && sbRows.length === 0) {
        setLoading(false);
        setRefreshing(false);
        return;
      }

      try {
        const enriched = await enrichBillingRows(invRows, sbRows);
        applyEnrichment(enriched);
        hasLoadedOnceRef.current = true;
        setHasLoadedOnce(true);

        if (enriched.mapsFailed || enriched.accountMetaFailed) {
          console.warn("Billing loaded partially — some account or job details may be missing.");
        }
      } catch (e) {
        console.error("billing enrichment failed", e);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [applyEnrichment],
  );

  const prefetchFullHistory = useCallback(async () => {
    if (fullHistoryLoadedRef.current || prefetchingRef.current) return;
    prefetchingRef.current = true;
    try {
      const [fullInv, fullSb] = await Promise.all([
        fetchInvoicesForBilling(null),
        fetchSelfBillsForBilling(null),
      ]);
      let mergedInv = fullInv;
      let mergedSb = fullSb;
      setInvoices((prev) => {
        mergedInv = mergeInvoicesById([...prev, ...fullInv]);
        return mergedInv;
      });
      setSelfBills((prev) => {
        mergedSb = mergeSelfBillsById([...prev, ...fullSb]);
        return mergedSb;
      });
      fullHistoryLoadedRef.current = true;
      const enriched = await enrichBillingRows(mergedInv, mergedSb);
      applyEnrichment(enriched);
    } catch (e) {
      console.error("billing full history prefetch failed", e);
    } finally {
      prefetchingRef.current = false;
    }
  }, [applyEnrichment]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await loadData();
      if (!cancelled) void prefetchFullHistory();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only initial load + prefetch
  }, []);

  useEffect(() => {
    const supabase = getSupabase();
    let t: ReturnType<typeof setTimeout>;
    const schedule = () => {
      clearTimeout(t);
      t = setTimeout(() => {
        void loadData({
          background: true,
          bounds: fullHistoryLoadedRef.current ? null : getBillingInitialFetchBounds(),
        });
      }, 350);
    };
    const ch = supabase
      .channel("billing_standalone")
      .on("postgres_changes", { event: "*", schema: "public", table: "invoices" }, schedule)
      .on("postgres_changes", { event: "*", schema: "public", table: "self_bills" }, schedule)
      .on("postgres_changes", { event: "*", schema: "public", table: "job_payments" }, schedule)
      .subscribe();
    return () => {
      clearTimeout(t);
      supabase.removeChannel(ch);
    };
  }, [loadData]);

  const resolveAccountId = useCallback(
    (inv: Invoice) => effectiveInvoiceSourceAccountId(inv, jobRefToAccountId, clientNameToAccountId),
    [jobRefToAccountId, clientNameToAccountId],
  );

  const partnerDueCtx = useCallback(
    (partnerId?: string | null) => ({
      partnerTerms: partnerId?.trim() ? partnerTermsById[partnerId.trim()] ?? null : null,
      orgStandardTerms: dueCtx.orgStandardTerms,
      orgReferenceYmd: dueCtx.orgReferenceYmd,
    }),
    [partnerTermsById, dueCtx],
  );

  return {
    loading,
    refreshing,
    hasLoadedOnce,
    invoices,
    selfBills,
    jobsByRef,
    customerPaidByJobId,
    jobsBySelfBillId,
    partnerPaidByJobId,
    accountNameById,
    accountTermsById,
    accountLogoById,
    jobRefToAccountId,
    clientNameToAccountId,
    resolveAccountId,
    partnerDueCtx,
    partnerAvatarById,
    dueCtx,
    loadData,
    applyAccountLabels,
    periodBounds: (filter: BillingStandaloneFilterValue) => resolveBillingStandaloneFilterBounds(filter),
    selfBillPeriodBounds: (filter: BillingStandaloneFilterValue) => resolveBillingStandaloneFilterBounds(filter),
  };
}
