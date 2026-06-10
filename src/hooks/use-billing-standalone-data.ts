"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getSupabase } from "@/services/base";
import { useFrontendSetup } from "@/hooks/use-frontend-setup";
import { effectiveInvoiceSourceAccountId } from "@/lib/billing-invoice-list-data";
import {
  billingPerfMark,
  EMPTY_BILLING_ENRICHMENT,
  enrichCriticalBillingRows,
  enrichDeferredBillingRows,
  enrichSelfBillJobsForIds,
  openSelfBillIdsForEnrichment,
  type BillingEnrichmentState,
} from "@/lib/billing-standalone-enrich";
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
import { syncWorkforceSelfBillsForBilling } from "@/lib/billing-workforce-sync";
import type { YmdBounds } from "@/lib/billing-standalone-period";
import type { Invoice, SelfBill } from "@/types/database";

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
  const [enrichment, setEnrichment] = useState<BillingEnrichmentState>(EMPTY_BILLING_ENRICHMENT);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const fullHistoryLoadedRef = useRef(false);
  const prefetchingRef = useRef(false);
  const hasLoadedOnceRef = useRef(false);
  const selfBillJobsLoadedRef = useRef<Set<string>>(new Set());
  const enrichGenerationRef = useRef(0);

  const dueCtx = useMemo(
    () => ({
      orgStandardTerms: partnerPayoutStandardTerms,
      orgReferenceYmd: partnerPayoutReferenceYmd,
    }),
    [partnerPayoutStandardTerms, partnerPayoutReferenceYmd],
  );

  const mergeSelfBillJobEnrichment = useCallback(
    (partial: Pick<BillingEnrichmentState, "jobsBySelfBillId" | "partnerPaidByJobId">, sbIds: string[]) => {
      for (const id of sbIds) selfBillJobsLoadedRef.current.add(id);
      setEnrichment((prev) => ({
        ...prev,
        jobsBySelfBillId: { ...prev.jobsBySelfBillId, ...partial.jobsBySelfBillId },
        partnerPaidByJobId: { ...prev.partnerPaidByJobId, ...partial.partnerPaidByJobId },
      }));
    },
    [],
  );

  const runDeferredEnrichment = useCallback(
    async (invRows: Invoice[], sbRows: SelfBill[], generation: number) => {
      try {
        const deferred = await enrichDeferredBillingRows(invRows, sbRows);
        if (enrichGenerationRef.current !== generation) return;
        setEnrichment((prev) => ({
          ...prev,
          jobRefToAccountId: deferred.jobRefToAccountId,
          clientNameToAccountId: deferred.clientNameToAccountId,
          accountNameById: deferred.accountNameById,
          accountTermsById: deferred.accountTermsById,
          accountLogoById: deferred.accountLogoById,
          partnerTermsById: deferred.partnerTermsById,
          partnerAvatarById: deferred.partnerAvatarById,
        }));
        if (deferred.mapsFailed || deferred.accountMetaFailed) {
          console.warn("Billing loaded partially — some account or job details may be missing.");
        }

        const openIds = openSelfBillIdsForEnrichment(sbRows).filter(
          (id) => !selfBillJobsLoadedRef.current.has(id),
        );
        if (openIds.length > 0) {
          const jobPartial = await enrichSelfBillJobsForIds(openIds);
          if (enrichGenerationRef.current !== generation) return;
          mergeSelfBillJobEnrichment(jobPartial, openIds);
        }
      } catch (e) {
        console.error("billing deferred enrichment failed", e);
      } finally {
        if (enrichGenerationRef.current === generation) setRefreshing(false);
      }
    },
    [mergeSelfBillJobEnrichment],
  );

  const applyAccountLabels = useCallback((accounts: BillingRepairAccountLabel[]) => {
    if (accounts.length === 0) return;
    const names: Record<string, string> = {};
    const logos: Record<string, string | null> = {};
    for (const a of accounts) {
      if (!a.id?.trim() || !a.label?.trim()) continue;
      names[a.id] = a.label.trim();
      logos[a.id] = a.logoUrl ?? null;
    }
    setEnrichment((prev) => ({
      ...prev,
      accountNameById: { ...prev.accountNameById, ...names },
      accountLogoById: { ...prev.accountLogoById, ...logos },
    }));
  }, []);

  const patchInvoicesPaid = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    const today = new Date().toISOString().split("T")[0]!;
    setInvoices((prev) =>
      prev.map((inv) => {
        if (!idSet.has(inv.id)) return inv;
        const amt = Math.max(0, Math.round((Number(inv.amount ?? 0) || 0) * 100) / 100);
        return {
          ...inv,
          status: "paid" as const,
          paid_date: today,
          collection_stage: "completed",
          amount_paid: amt,
        };
      }),
    );
  }, []);

  const ensureSelfBillJobsEnriched = useCallback(
    async (sbIds?: string[]) => {
      const candidates = sbIds ?? openSelfBillIdsForEnrichment(selfBills);
      const missing = candidates.filter((id) => !selfBillJobsLoadedRef.current.has(id));
      if (missing.length === 0) return;
      setRefreshing(true);
      try {
        const partial = await enrichSelfBillJobsForIds(missing);
        mergeSelfBillJobEnrichment(partial, missing);
      } catch (e) {
        console.error("billing self-bill job enrich failed", e);
      } finally {
        setRefreshing(false);
      }
    },
    [mergeSelfBillJobEnrichment, selfBills],
  );

  const loadData = useCallback(async (opts?: { background?: boolean; bounds?: YmdBounds | null }) => {
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

    const shouldSyncWorkforce = !background && !hasLoadedOnceRef.current;
    if (shouldSyncWorkforce) {
      void syncWorkforceSelfBillsForBilling(bounds).catch((e) =>
        console.error("workforce self-bill sync failed", e),
      );
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

    billingPerfMark("billing:fetch:end");

    if (fetchHadErrors && invRows.length === 0 && sbRows.length === 0) {
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const generation = ++enrichGenerationRef.current;
    if (!background) {
      selfBillJobsLoadedRef.current = new Set();
    }

    if (!background) {
      setLoading(false);
    }
    if (!hasLoadedOnceRef.current) {
      hasLoadedOnceRef.current = true;
      setHasLoadedOnce(true);
    }
    setRefreshing(true);

    try {
      const critical = await enrichCriticalBillingRows(invRows);
      if (enrichGenerationRef.current !== generation) return;
      setEnrichment((prev) => ({
        ...prev,
        jobsByRef: critical.jobsByRef,
        customerPaidByJobId: critical.customerPaidByJobId,
      }));
    } catch (e) {
      console.error("billing critical enrichment failed", e);
      if (enrichGenerationRef.current === generation) setRefreshing(false);
      return;
    }

    void runDeferredEnrichment(invRows, sbRows, generation);
  }, [runDeferredEnrichment]);

  const prefetchFullHistory = useCallback(async () => {
    if (fullHistoryLoadedRef.current || prefetchingRef.current) return;
    prefetchingRef.current = true;
    setRefreshing(true);
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

      const generation = ++enrichGenerationRef.current;
      billingPerfMark("billing:fetch:end");

      const critical = await enrichCriticalBillingRows(mergedInv);
      if (enrichGenerationRef.current !== generation) return;
      setEnrichment((prev) => ({
        ...prev,
        jobsByRef: critical.jobsByRef,
        customerPaidByJobId: critical.customerPaidByJobId,
      }));

      void runDeferredEnrichment(mergedInv, mergedSb, generation);
    } catch (e) {
      console.error("billing full history prefetch failed", e);
      setRefreshing(false);
    } finally {
      prefetchingRef.current = false;
    }
  }, [runDeferredEnrichment]);

  useEffect(() => {
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only initial load
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

  const {
    jobsByRef,
    customerPaidByJobId,
    jobsBySelfBillId,
    partnerPaidByJobId,
    accountNameById,
    accountTermsById,
    accountLogoById,
    jobRefToAccountId,
    clientNameToAccountId,
    partnerTermsById,
    partnerAvatarById,
  } = enrichment;

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

  return useMemo(
    () => ({
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
      prefetchFullHistory,
      applyAccountLabels,
      patchInvoicesPaid,
      ensureSelfBillJobsEnriched,
      periodBounds: (filter: BillingStandaloneFilterValue) => resolveBillingStandaloneFilterBounds(filter),
      selfBillPeriodBounds: (filter: BillingStandaloneFilterValue) => resolveBillingStandaloneFilterBounds(filter),
    }),
    [
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
      prefetchFullHistory,
      applyAccountLabels,
      patchInvoicesPaid,
      ensureSelfBillJobsEnriched,
    ],
  );
}
