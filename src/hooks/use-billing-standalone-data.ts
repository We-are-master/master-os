"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getSupabase } from "@/services/base";
import { useFrontendSetup } from "@/hooks/use-frontend-setup";
import {
  fetchAllActiveInvoices,
  fetchCustomerPaidSumByJobIds,
  fetchJobsByReferences,
  effectiveInvoiceSourceAccountId,
} from "@/lib/billing-invoice-list-data";
import { computeLinkedJobsMapsForSelfBillIds } from "@/lib/billing-selfbill-actions";
import { resolveBillingStandaloneFilterBounds, type BillingStandaloneFilterValue } from "@/lib/billing-standalone-filter";
import type { Invoice, SelfBill } from "@/types/database";

export function useBillingStandaloneData() {
  const { partnerPayoutStandardTerms, partnerPayoutReferenceYmd } = useFrontendSetup();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [selfBills, setSelfBills] = useState<SelfBill[]>([]);
  const [jobsByRef, setJobsByRef] = useState<Awaited<ReturnType<typeof fetchJobsByReferences>>>({});
  const [customerPaidByJobId, setCustomerPaidByJobId] = useState<Record<string, number>>({});
  const [jobsBySelfBillId, setJobsBySelfBillId] = useState<Awaited<ReturnType<typeof computeLinkedJobsMapsForSelfBillIds>>["map"]>({});
  const [partnerPaidByJobId, setPartnerPaidByJobId] = useState<Record<string, number>>({});
  const [partnerTermsById, setPartnerTermsById] = useState<Record<string, string | null>>({});
  const [accountNameById, setAccountNameById] = useState<Record<string, string>>({});
  const [accountTermsById, setAccountTermsById] = useState<Record<string, string>>({});
  const [accountLogoById, setAccountLogoById] = useState<Record<string, string | null>>({});
  const [jobRefToAccountId, setJobRefToAccountId] = useState<Record<string, string>>({});
  const [clientNameToAccountId, setClientNameToAccountId] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const dueCtx = useMemo(
    () => ({
      orgStandardTerms: partnerPayoutStandardTerms,
      orgReferenceYmd: partnerPayoutReferenceYmd,
    }),
    [partnerPayoutStandardTerms, partnerPayoutReferenceYmd],
  );

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = getSupabase();
      const [invRows, sbRes] = await Promise.all([
        fetchAllActiveInvoices(),
        supabase.from("self_bills").select("*").order("created_at", { ascending: false }),
      ]);
      if (sbRes.error) throw sbRes.error;
      const sbRows = (sbRes.data ?? []) as SelfBill[];
      setInvoices(invRows);
      setSelfBills(sbRows);

      const refs = [...new Set(invRows.map((i) => i.job_reference?.trim()).filter(Boolean))] as string[];
      const jobMap = await fetchJobsByReferences(refs);
      const jobIds = [...new Set(Object.values(jobMap).map((j) => j.id))];
      const paidMap = await fetchCustomerPaidSumByJobIds(jobIds);
      setJobsByRef(jobMap);
      setCustomerPaidByJobId(paidMap);

      const sbIds = sbRows.map((s) => s.id);
      const { map, partnerPaidByJobId: partnerPaid } = await computeLinkedJobsMapsForSelfBillIds(sbIds);
      setJobsBySelfBillId(map);
      setPartnerPaidByJobId(partnerPaid);

      const { data: jobClientRows } =
        refs.length > 0
          ? await supabase
              .from("jobs")
              .select("reference, client_id, clients(source_account_id, full_name)")
              .in("reference", refs)
          : { data: [] as unknown[] };
      const j2a: Record<string, string> = {};
      const c2a: Record<string, string> = {};
      for (const row of jobClientRows ?? []) {
        const r = row as {
          reference?: string;
          clients?: { source_account_id?: string | null; full_name?: string | null } | { source_account_id?: string | null; full_name?: string | null }[];
        };
        const clients = Array.isArray(r.clients) ? r.clients[0] : r.clients;
        const aid = clients?.source_account_id?.trim();
        const ref = r.reference?.trim();
        if (ref && aid) j2a[ref] = aid;
        const fn = clients?.full_name?.trim();
        if (fn && aid) c2a[fn] = aid;
      }
      setJobRefToAccountId(j2a);
      setClientNameToAccountId(c2a);

      const accountIds = [
        ...new Set([
          ...invRows.map((i) => i.source_account_id?.trim()).filter(Boolean),
          ...Object.values(j2a),
          ...Object.values(c2a),
        ]),
      ] as string[];
      if (accountIds.length) {
        const { data: accRows } = await supabase
          .from("accounts")
          .select("id, company_name, contact_name, payment_terms, logo_url")
          .in("id", accountIds);
        const names: Record<string, string> = {};
        const terms: Record<string, string> = {};
        const logos: Record<string, string | null> = {};
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
        setAccountNameById(names);
        setAccountTermsById(terms);
        setAccountLogoById(logos);
      }

      const partnerIds = [...new Set(sbRows.map((s) => s.partner_id?.trim()).filter(Boolean))] as string[];
      if (partnerIds.length) {
        const termsPatch: Record<string, string | null> = {};
        const CHUNK = 80;
        for (let i = 0; i < partnerIds.length; i += CHUNK) {
          const { data } = await supabase
            .from("partners")
            .select("id, payment_terms")
            .in("id", partnerIds.slice(i, i + CHUNK));
          for (const row of data ?? []) {
            const pr = row as { id: string; payment_terms?: string | null };
            termsPatch[pr.id] = pr.payment_terms?.trim() || null;
          }
        }
        setPartnerTermsById(termsPatch);
      }
    } catch (e) {
      console.error("billing standalone load failed", e);
      setInvoices([]);
      setSelfBills([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    const supabase = getSupabase();
    let t: ReturnType<typeof setTimeout>;
    const schedule = () => {
      clearTimeout(t);
      t = setTimeout(() => void loadData(), 350);
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
    (inv: Invoice) =>
      effectiveInvoiceSourceAccountId(inv, jobRefToAccountId, clientNameToAccountId),
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
