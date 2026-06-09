"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getSupabase } from "@/services/base";
import { useFrontendSetup } from "@/hooks/use-frontend-setup";
import {
  fetchCustomerPaidSumByJobIds,
  fetchJobsByReferences,
  effectiveInvoiceSourceAccountId,
} from "@/lib/billing-invoice-list-data";
import { computeLinkedJobsMapsForSelfBillIds } from "@/lib/billing-selfbill-actions";
import {
  fetchInvoicesForBilling,
  fetchSelfBillsForBilling,
} from "@/lib/billing-standalone-fetch";
import {
  resolveBillingStandaloneFilterBounds,
  type BillingStandaloneFilterValue,
} from "@/lib/billing-standalone-filter";
import type { Invoice, SelfBill } from "@/types/database";

const PARTNER_TERMS_CHUNK = 80;
const JOB_CLIENT_CHUNK = 100;

async function fetchPartnerPaymentTerms(partnerIds: string[]): Promise<Record<string, string | null>> {
  if (partnerIds.length === 0) return {};
  const supabase = getSupabase();
  const termsPatch: Record<string, string | null> = {};
  const chunks: string[][] = [];
  for (let i = 0; i < partnerIds.length; i += PARTNER_TERMS_CHUNK) {
    chunks.push(partnerIds.slice(i, i + PARTNER_TERMS_CHUNK));
  }
  const results = await Promise.all(
    chunks.map((chunk) => supabase.from("partners").select("id, payment_terms").in("id", chunk)),
  );
  for (const { data, error } of results) {
    if (error) throw error;
    for (const row of data ?? []) {
      const pr = row as { id: string; payment_terms?: string | null };
      termsPatch[pr.id] = pr.payment_terms?.trim() || null;
    }
  }
  return termsPatch;
}

async function fetchJobRefAccountMaps(refs: string[]): Promise<{
  jobRefToAccountId: Record<string, string>;
  clientNameToAccountId: Record<string, string>;
}> {
  const j2a: Record<string, string> = {};
  const c2a: Record<string, string> = {};
  if (refs.length === 0) return { jobRefToAccountId: j2a, clientNameToAccountId: c2a };

  const supabase = getSupabase();
  const chunks: string[][] = [];
  for (let i = 0; i < refs.length; i += JOB_CLIENT_CHUNK) {
    chunks.push(refs.slice(i, i + JOB_CLIENT_CHUNK));
  }
  const results = await Promise.all(
    chunks.map((chunk) =>
      supabase
        .from("jobs")
        .select("reference, client_id, clients(source_account_id, full_name)")
        .in("reference", chunk),
    ),
  );
  for (const { data, error } of results) {
    if (error) throw error;
    for (const row of data ?? []) {
      const r = row as {
        reference?: string;
        clients?: { source_account_id?: string | null; full_name?: string | null } | {
          source_account_id?: string | null;
          full_name?: string | null;
        }[];
      };
      const clients = Array.isArray(r.clients) ? r.clients[0] : r.clients;
      const aid = clients?.source_account_id?.trim();
      const ref = r.reference?.trim();
      if (ref && aid) j2a[ref] = aid;
      const fn = clients?.full_name?.trim();
      if (fn && aid) c2a[fn] = aid;
    }
  }
  return { jobRefToAccountId: j2a, clientNameToAccountId: c2a };
}

async function fetchAccountMaps(
  invRows: Invoice[],
  jobRefToAccountId: Record<string, string>,
  clientNameToAccountId: Record<string, string>,
): Promise<{
  accountNameById: Record<string, string>;
  accountTermsById: Record<string, string>;
  accountLogoById: Record<string, string | null>;
}> {
  const accountIds = [
    ...new Set([
      ...invRows.map((i) => i.source_account_id?.trim()).filter(Boolean),
      ...Object.values(jobRefToAccountId),
      ...Object.values(clientNameToAccountId),
    ]),
  ] as string[];

  const names: Record<string, string> = {};
  const terms: Record<string, string> = {};
  const logos: Record<string, string | null> = {};
  if (accountIds.length === 0) return { accountNameById: names, accountTermsById: terms, accountLogoById: logos };

  const supabase = getSupabase();
  const { data: accRows, error } = await supabase
    .from("accounts")
    .select("id, company_name, contact_name, payment_terms, logo_url")
    .in("id", accountIds);
  if (error) throw error;
  for (const a of accRows ?? []) {
    const row = a as {
      id: string;
      company_name?: string | null;
      contact_name?: string | null;
      payment_terms?: string | null;
      logo_url?: string | null;
    };
    names[row.id] = row.company_name?.trim() || row.contact_name?.trim() || row.id;
    terms[row.id] = row.payment_terms?.trim() || "—";
    logos[row.id] = row.logo_url ?? null;
  }
  return { accountNameById: names, accountTermsById: terms, accountLogoById: logos };
}

export function useBillingStandaloneData(periodFilter: BillingStandaloneFilterValue) {
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
  const [accountNameById, setAccountNameById] = useState<Record<string, string>>({});
  const [accountTermsById, setAccountTermsById] = useState<Record<string, string>>({});
  const [accountLogoById, setAccountLogoById] = useState<Record<string, string | null>>({});
  const [jobRefToAccountId, setJobRefToAccountId] = useState<Record<string, string>>({});
  const [clientNameToAccountId, setClientNameToAccountId] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);

  const fetchBounds = useMemo(
    () => resolveBillingStandaloneFilterBounds(periodFilter),
    [periodFilter],
  );

  const dueCtx = useMemo(
    () => ({
      orgStandardTerms: partnerPayoutStandardTerms,
      orgReferenceYmd: partnerPayoutReferenceYmd,
    }),
    [partnerPayoutStandardTerms, partnerPayoutReferenceYmd],
  );

  const loadData = useCallback(
    async (opts?: { background?: boolean }) => {
      if (opts?.background) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      try {
        const [invRows, sbRows] = await Promise.all([
          fetchInvoicesForBilling(fetchBounds),
          fetchSelfBillsForBilling(fetchBounds),
        ]);
        setInvoices(invRows);
        setSelfBills(sbRows);

        const refs = [...new Set(invRows.map((i) => i.job_reference?.trim()).filter(Boolean))] as string[];
        const sbIds = sbRows.map((s) => s.id);
        const partnerIds = [...new Set(sbRows.map((s) => s.partner_id?.trim()).filter(Boolean))] as string[];

        const [jobMap, linkedJobs, accountMaps, partnerTerms] = await Promise.all([
          fetchJobsByReferences(refs),
          computeLinkedJobsMapsForSelfBillIds(sbIds),
          fetchJobRefAccountMaps(refs),
          fetchPartnerPaymentTerms(partnerIds),
        ]);

        const jobIds = [...new Set(Object.values(jobMap).map((j) => j.id))];
        const [paidMap, accountMeta] = await Promise.all([
          fetchCustomerPaidSumByJobIds(jobIds),
          fetchAccountMaps(invRows, accountMaps.jobRefToAccountId, accountMaps.clientNameToAccountId),
        ]);

        setJobsByRef(jobMap);
        setCustomerPaidByJobId(paidMap);
        setJobsBySelfBillId(linkedJobs.map);
        setPartnerPaidByJobId(linkedJobs.partnerPaidByJobId);
        setJobRefToAccountId(accountMaps.jobRefToAccountId);
        setClientNameToAccountId(accountMaps.clientNameToAccountId);
        setAccountNameById(accountMeta.accountNameById);
        setAccountTermsById(accountMeta.accountTermsById);
        setAccountLogoById(accountMeta.accountLogoById);
        setPartnerTermsById(partnerTerms);
        setHasLoadedOnce(true);
      } catch (e) {
        console.error("billing standalone load failed", e);
        if (!opts?.background) {
          setInvoices([]);
          setSelfBills([]);
        }
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [fetchBounds],
  );

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    const supabase = getSupabase();
    let t: ReturnType<typeof setTimeout>;
    const schedule = () => {
      clearTimeout(t);
      t = setTimeout(() => void loadData({ background: true }), 350);
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
    dueCtx,
    loadData,
    periodBounds: (filter: BillingStandaloneFilterValue) => resolveBillingStandaloneFilterBounds(filter),
    selfBillPeriodBounds: (filter: BillingStandaloneFilterValue) => resolveBillingStandaloneFilterBounds(filter),
  };
}
