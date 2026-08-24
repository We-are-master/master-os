"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getSupabase } from "@/services/base";
import { useFrontendSetup } from "@/hooks/use-frontend-setup";
import { fetchAccountMetadataForBilling } from "@/lib/billing-account-metadata";
import { effectiveInvoiceSourceAccountId } from "@/lib/billing-invoice-list-data";
import {
  billingPerfMark,
  EMPTY_BILLING_ENRICHMENT,
  enrichCriticalBillingRows,
  enrichDeferredBillingRows,
  enrichRunwayBillingRows,
  enrichSelfBillJobsForIds,
  fetchPartnerBillingMeta,
  openSelfBillIdsForEnrichment,
  type BillingEnrichmentState,
} from "@/lib/billing-standalone-enrich";
import {
  fetchBillsForBilling,
  fetchInstallmentsForBilling,
  fetchInvoicesForBilling,
  fetchSelfBillInstallmentsForBilling,
  fetchSelfBillsForBilling,
  mergeBillsById,
  mergeInvoicesById,
  mergeSelfBillsById,
} from "@/lib/billing-standalone-fetch";
import {
  getBillingInitialFetchBounds,
  resolveBillingStandaloneFilterBounds,
  type BillingStandaloneFilterValue,
} from "@/lib/billing-standalone-filter";
import type { YmdBounds } from "@/lib/billing-standalone-period";
import type { Bill, Invoice, InvoicePaymentInstallment, SelfBill, SelfBillPaymentInstallment } from "@/types/database";

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
  const [bills, setBills] = useState<Bill[]>([]);
  const [installmentsByInvoiceId, setInstallmentsByInvoiceId] = useState<
    Record<string, InvoicePaymentInstallment[]>
  >({});
  const [installmentsBySelfBillId, setInstallmentsBySelfBillId] = useState<
    Record<string, SelfBillPaymentInstallment[]>
  >({});
  const [enrichment, setEnrichment] = useState<BillingEnrichmentState>(EMPTY_BILLING_ENRICHMENT);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const fullHistoryLoadedRef = useRef(false);
  const prefetchingRef = useRef(false);
  const hasLoadedOnceRef = useRef(false);
  const selfBillJobsLoadedRef = useRef<Set<string>>(new Set());
  const enrichGenerationRef = useRef(0);
  /** Mirrors `refreshing` for the realtime scheduler — coalesce instead of stacking pipelines. */
  const refreshingRef = useRef(false);
  const pendingWhileHiddenRef = useRef(false);

  useEffect(() => {
    refreshingRef.current = refreshing;
  }, [refreshing]);

  const dueCtx = useMemo(
    () => ({
      orgStandardTerms: partnerPayoutStandardTerms,
      orgReferenceYmd: partnerPayoutReferenceYmd,
    }),
    [partnerPayoutStandardTerms, partnerPayoutReferenceYmd],
  );

  const mergeSelfBillJobEnrichment = useCallback(
    (
      partial: Pick<BillingEnrichmentState, "jobsBySelfBillId" | "visitsBySelfBillId" | "partnerPaidByJobId">,
      sbIds: string[],
    ) => {
      for (const id of sbIds) selfBillJobsLoadedRef.current.add(id);
      setEnrichment((prev) => ({
        ...prev,
        jobsBySelfBillId: { ...prev.jobsBySelfBillId, ...partial.jobsBySelfBillId },
        visitsBySelfBillId: { ...prev.visitsBySelfBillId, ...partial.visitsBySelfBillId },
        partnerPaidByJobId: { ...prev.partnerPaidByJobId, ...partial.partnerPaidByJobId },
      }));
    },
    [],
  );

  /**
   * Three independent legs, each painting the screen as soon as ITS data lands.
   * They used to sit behind one Promise.all, so account names (cheap) waited for
   * the payroll/pipeline runway fetch and the self-bill job lines (expensive) —
   * the list said "Unknown account" until the slowest leg finished.
   */
  const runDeferredEnrichment = useCallback(
    async (invRows: Invoice[], sbRows: SelfBill[], generation: number, bounds: YmdBounds | null) => {
      const invoiceJobRefs = new Set(
        invRows.map((i) => i.job_reference?.trim()).filter(Boolean) as string[],
      );

      const legs: Promise<void>[] = [];

      legs.push(
        enrichDeferredBillingRows(invRows, sbRows)
          .then((deferred) => {
            if (enrichGenerationRef.current !== generation) return;
            setEnrichment((prev) => ({
              ...prev,
              jobRefToAccountId: deferred.jobRefToAccountId,
              clientNameToAccountId: deferred.clientNameToAccountId,
              accountNameById: { ...prev.accountNameById, ...deferred.accountNameById },
              accountTermsById: { ...prev.accountTermsById, ...deferred.accountTermsById },
              accountLogoById: { ...prev.accountLogoById, ...deferred.accountLogoById },
              partnerTermsById: { ...prev.partnerTermsById, ...deferred.partnerTermsById },
              partnerAvatarById: { ...prev.partnerAvatarById, ...deferred.partnerAvatarById },
            }));
            if (deferred.mapsFailed || deferred.accountMetaFailed) {
              console.warn("Billing loaded partially — some account or job details may be missing.");
            }
          })
          .catch((e) => console.error("billing deferred account enrichment failed", e)),
      );

      legs.push(
        enrichRunwayBillingRows(bounds, invoiceJobRefs)
          .then((runway) => {
            if (enrichGenerationRef.current !== generation) return;
            setEnrichment((prev) => ({
              ...prev,
              payrollRunwayRows: runway.payrollRunwayRows,
              pipelineJobs: runway.pipelineJobs,
              clientIdToAccountId: runway.clientIdToAccountId,
            }));
          })
          .catch((e) => console.error("billing runway enrichment failed", e)),
      );

      const openIds = openSelfBillIdsForEnrichment(sbRows).filter(
        (id) => !selfBillJobsLoadedRef.current.has(id),
      );
      if (openIds.length > 0) {
        legs.push(
          enrichSelfBillJobsForIds(openIds)
            .then((jobPartial) => {
              if (enrichGenerationRef.current !== generation) return;
              mergeSelfBillJobEnrichment(jobPartial, openIds);
            })
            .catch((e) => console.error("billing self-bill job enrich failed", e)),
        );
      }

      try {
        await Promise.allSettled(legs);
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

    // Deliberately NO workforce sync here. Opening the page used to fire a
    // write sync (purge + upsert of monthly workforce self-bills), whose own
    // writes echoed back through the realtime channel below and re-ran this
    // whole pipeline several times — the "sync, sync, sync" slow open. The
    // sync lives on the manual Sync button (handleSync) and can be scheduled
    // server-side; reading a page must not write.

    let invRows: Invoice[] = [];
    let sbRows: SelfBill[] = [];
    let billRows: Bill[] = [];
    let fetchHadErrors = false;

    const [invResult, sbResult, billResult] = await Promise.allSettled([
      fetchInvoicesForBilling(bounds),
      fetchSelfBillsForBilling(bounds),
      fetchBillsForBilling(bounds),
    ]);

    if (invResult.status === "fulfilled") {
      invRows = invResult.value;
      setInvoices(invRows);
    } else {
      fetchHadErrors = true;
      console.error("billing invoices fetch failed", invResult.reason);
      if (!background && !hasLoadedOnceRef.current) {
        setInvoices([]);
        setInstallmentsByInvoiceId({});
      }
    }

    if (sbResult.status === "fulfilled") {
      sbRows = sbResult.value;
      setSelfBills(sbRows);
    } else {
      fetchHadErrors = true;
      console.error("billing self-bills fetch failed", sbResult.reason);
      if (!background && !hasLoadedOnceRef.current) {
        setSelfBills([]);
        setInstallmentsBySelfBillId({});
      }
    }

    /** Both installment maps in one round-trip window — they used to run in series. */
    const [invInstResult, sbInstResult] = await Promise.allSettled([
      invResult.status === "fulfilled" ? fetchInstallmentsForBilling(invRows) : Promise.resolve(null),
      sbResult.status === "fulfilled" ? fetchSelfBillInstallmentsForBilling(sbRows) : Promise.resolve(null),
    ]);
    if (invInstResult.status === "fulfilled") {
      if (invInstResult.value) setInstallmentsByInvoiceId(invInstResult.value);
    } else {
      console.error("billing installments fetch failed", invInstResult.reason);
      setInstallmentsByInvoiceId({});
    }
    if (sbInstResult.status === "fulfilled") {
      if (sbInstResult.value) setInstallmentsBySelfBillId(sbInstResult.value);
    } else {
      console.error("billing self-bill installments fetch failed", sbInstResult.reason);
      setInstallmentsBySelfBillId({});
    }

    if (billResult.status === "fulfilled") {
      billRows = billResult.value;
      setBills(billRows);
    } else {
      fetchHadErrors = true;
      console.error("billing bills fetch failed", billResult.reason);
      if (!background && !hasLoadedOnceRef.current) setBills([]);
    }

    if (bounds === null) fullHistoryLoadedRef.current = true;

    billingPerfMark("billing:fetch:end");

    if (fetchHadErrors && invRows.length === 0 && sbRows.length === 0 && billRows.length === 0) {
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

    /**
     * Account names paint immediately: most invoices already carry
     * source_account_id, and the accounts lookup is one cheap query. The full
     * invoice→job→client→quote→ticket crawl (deferred leg) still fills the
     * unlinked stragglers later — but the list must not say "Unknown account"
     * for a minute while that crawl runs.
     */
    void fetchAccountMetadataForBilling(
      invRows.map((i) => i.source_account_id?.trim() ?? "").filter(Boolean),
    )
      .then((meta) => {
        if (enrichGenerationRef.current !== generation) return;
        setEnrichment((prev) => ({
          ...prev,
          accountNameById: { ...prev.accountNameById, ...meta.accountNameById },
          accountTermsById: { ...prev.accountTermsById, ...meta.accountTermsById },
          accountLogoById: { ...prev.accountLogoById, ...meta.accountLogoById },
        }));
      })
      .catch((e) => console.error("billing early account meta failed", e));

    /** Same treatment for partner avatars/terms: one cheap query, straight onto the ledger rows. */
    void fetchPartnerBillingMeta(
      [...new Set(sbRows.map((s) => s.partner_id?.trim()).filter(Boolean))] as string[],
    )
      .then((meta) => {
        if (enrichGenerationRef.current !== generation) return;
        setEnrichment((prev) => ({
          ...prev,
          partnerTermsById: { ...prev.partnerTermsById, ...meta.termsById },
          partnerAvatarById: { ...prev.partnerAvatarById, ...meta.avatarById },
        }));
      })
      .catch((e) => console.error("billing early partner meta failed", e));

    try {
      const critical = await enrichCriticalBillingRows(invRows);
      if (enrichGenerationRef.current !== generation) return;
      setEnrichment((prev) => ({
        ...prev,
        jobsByRef: critical.jobsByRef,
        customerPaidByJobId: critical.customerPaidByJobId,
        customerPaymentRows: critical.customerPaymentRows,
      }));
    } catch (e) {
      console.error("billing critical enrichment failed", e);
      if (enrichGenerationRef.current === generation) setRefreshing(false);
      return;
    }

    void runDeferredEnrichment(invRows, sbRows, generation, bounds);
  }, [runDeferredEnrichment]);

  const prefetchFullHistory = useCallback(async () => {
    if (fullHistoryLoadedRef.current || prefetchingRef.current) return;
    prefetchingRef.current = true;
    setRefreshing(true);
    try {
      const [fullInv, fullSb, fullBills] = await Promise.all([
        fetchInvoicesForBilling(null),
        fetchSelfBillsForBilling(null),
        fetchBillsForBilling(null),
      ]);
      let mergedInv = fullInv;
      let mergedSb = fullSb;
      let mergedBills = fullBills;
      setInvoices((prev) => {
        mergedInv = mergeInvoicesById([...prev, ...fullInv]);
        return mergedInv;
      });
      setSelfBills((prev) => {
        mergedSb = mergeSelfBillsById([...prev, ...fullSb]);
        return mergedSb;
      });
      setBills((prev) => {
        mergedBills = mergeBillsById([...prev, ...fullBills]);
        return mergedBills;
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
        customerPaymentRows: critical.customerPaymentRows,
      }));

      void runDeferredEnrichment(mergedInv, mergedSb, generation, null);
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
    let t: ReturnType<typeof setTimeout> | null = null;
    /**
     * Realtime hardening. A change on any of these tables used to refire the
     * FULL fetch+enrich pipeline after 350ms — and agents/robots write these
     * tables all day, so the page never settled. Now: longer debounce, one
     * pipeline at a time (coalesce while a cycle is still running), and no
     * reloads while the tab is hidden (a single one runs on return instead).
     */
    const REALTIME_DEBOUNCE_MS = 2500;
    const run = () => {
      t = null;
      if (refreshingRef.current) {
        t = setTimeout(run, REALTIME_DEBOUNCE_MS);
        return;
      }
      void loadData({
        background: true,
        bounds: fullHistoryLoadedRef.current ? null : getBillingInitialFetchBounds(),
      });
    };
    const schedule = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        pendingWhileHiddenRef.current = true;
        return;
      }
      if (t) clearTimeout(t);
      t = setTimeout(run, REALTIME_DEBOUNCE_MS);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible" && pendingWhileHiddenRef.current) {
        pendingWhileHiddenRef.current = false;
        schedule();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    const ch = supabase
      .channel("billing_standalone")
      .on("postgres_changes", { event: "*", schema: "public", table: "invoices" }, schedule)
      .on("postgres_changes", { event: "*", schema: "public", table: "self_bills" }, schedule)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "self_bill_payment_installments" },
        schedule,
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "job_payments" }, schedule)
      .on("postgres_changes", { event: "*", schema: "public", table: "bills" }, schedule)
      .subscribe();
    return () => {
      if (t) clearTimeout(t);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      supabase.removeChannel(ch);
    };
  }, [loadData]);

  const {
    jobsByRef,
    customerPaidByJobId,
    customerPaymentRows,
    payrollRunwayRows,
    pipelineJobs,
    clientIdToAccountId,
    jobsBySelfBillId,
    visitsBySelfBillId,
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
      bills,
      installmentsByInvoiceId,
      installmentsBySelfBillId,
      jobsByRef,
      customerPaidByJobId,
      customerPaymentRows,
      payrollRunwayRows,
      pipelineJobs,
      clientIdToAccountId,
      jobsBySelfBillId,
      visitsBySelfBillId,
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
      bills,
      installmentsByInvoiceId,
      installmentsBySelfBillId,
      jobsByRef,
      customerPaidByJobId,
      customerPaymentRows,
      payrollRunwayRows,
      pipelineJobs,
      clientIdToAccountId,
      jobsBySelfBillId,
      visitsBySelfBillId,
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
