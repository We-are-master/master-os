import { fetchAccountMetadataForBilling } from "@/lib/billing-account-metadata";
import {
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
} from "@/lib/billing-standalone-fetch";
import type { YmdBounds } from "@/lib/billing-standalone-period";
import type { Bill, Invoice, InvoicePaymentInstallment, SelfBill, SelfBillPaymentInstallment } from "@/types/database";

export type BillingBundle = {
  invoices: Invoice[];
  selfBills: SelfBill[];
  bills: Bill[];
  installmentsByInvoiceId: Record<string, InvoicePaymentInstallment[]>;
  installmentsBySelfBillId: Record<string, SelfBillPaymentInstallment[]>;
  enrichment: BillingEnrichmentState;
  /** Self-bills cujas linhas de job já vieram no pacote. */
  selfBillJobsLoadedIds: string[];
  /** Partes que falharam: a tela mostra o resto e avisa no console. */
  partial: string[];
};

/**
 * Tudo que o Billing precisa para abrir, de uma vez.
 *
 * São as MESMAS leituras que a tela fazia em cascata no navegador (lista, parcelas, jobs,
 * pagamentos, contas, runway, linhas de self-bill). Aqui elas rodam juntas: as três listas
 * primeiro, e todo o resto em paralelo. Chamada pela rota `/api/billing/bundle`, perto do
 * banco e sem preflight, vira uma ida e volta para o navegador.
 */
export async function loadBillingBundle(bounds: YmdBounds | null): Promise<BillingBundle> {
  const [invoices, selfBills, bills] = await Promise.all([
    fetchInvoicesForBilling(bounds),
    fetchSelfBillsForBilling(bounds),
    fetchBillsForBilling(bounds),
  ]);

  const partial: string[] = [];
  const soft = async <T>(label: string, run: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await run();
    } catch (e) {
      console.error(`billing bundle: ${label} failed`, e);
      partial.push(label);
      return fallback;
    }
  };

  const invoiceJobRefs = new Set(invoices.map((i) => i.job_reference?.trim()).filter(Boolean) as string[]);
  const openSelfBillIds = openSelfBillIdsForEnrichment(selfBills);
  const E = EMPTY_BILLING_ENRICHMENT;

  const [
    installmentsByInvoiceId,
    installmentsBySelfBillId,
    critical,
    earlyAccountMeta,
    earlyPartnerMeta,
    deferred,
    runway,
    selfBillJobs,
  ] = await Promise.all([
    soft("invoice installments", () => fetchInstallmentsForBilling(invoices), {}),
    soft("self-bill installments", () => fetchSelfBillInstallmentsForBilling(selfBills), {}),
    soft("jobs and customer payments", () => enrichCriticalBillingRows(invoices), {
      jobsByRef: E.jobsByRef,
      customerPaidByJobId: E.customerPaidByJobId,
      customerPaymentRows: E.customerPaymentRows,
    }),
    soft(
      "account names",
      () => fetchAccountMetadataForBilling(invoices.map((i) => i.source_account_id?.trim() ?? "").filter(Boolean)),
      { accountNameById: {}, accountTermsById: {}, accountLogoById: {} },
    ),
    soft(
      "partner avatars",
      () => fetchPartnerBillingMeta([...new Set(selfBills.map((s) => s.partner_id?.trim()).filter(Boolean))] as string[]),
      { termsById: {}, avatarById: {} },
    ),
    soft("account resolution", () => enrichDeferredBillingRows(invoices, selfBills), null),
    soft("runway", () => enrichRunwayBillingRows(bounds, invoiceJobRefs), {
      payrollRunwayRows: E.payrollRunwayRows,
      pipelineJobs: E.pipelineJobs,
      clientIdToAccountId: E.clientIdToAccountId,
    }),
    soft("self-bill job lines", () => enrichSelfBillJobsForIds(openSelfBillIds), null),
  ]);

  const enrichment: BillingEnrichmentState = {
    ...E,
    ...critical,
    ...runway,
    jobsBySelfBillId: selfBillJobs?.jobsBySelfBillId ?? {},
    visitsBySelfBillId: selfBillJobs?.visitsBySelfBillId ?? {},
    partnerPaidByJobId: selfBillJobs?.partnerPaidByJobId ?? {},
    jobRefToAccountId: deferred?.jobRefToAccountId ?? {},
    clientNameToAccountId: deferred?.clientNameToAccountId ?? {},
    accountNameById: { ...earlyAccountMeta.accountNameById, ...(deferred?.accountNameById ?? {}) },
    accountTermsById: { ...earlyAccountMeta.accountTermsById, ...(deferred?.accountTermsById ?? {}) },
    accountLogoById: { ...earlyAccountMeta.accountLogoById, ...(deferred?.accountLogoById ?? {}) },
    partnerTermsById: { ...earlyPartnerMeta.termsById, ...(deferred?.partnerTermsById ?? {}) },
    partnerAvatarById: { ...earlyPartnerMeta.avatarById, ...(deferred?.partnerAvatarById ?? {}) },
  };
  if (deferred?.mapsFailed) partial.push("account resolution");

  return {
    invoices,
    selfBills,
    bills,
    installmentsByInvoiceId,
    installmentsBySelfBillId,
    enrichment,
    selfBillJobsLoadedIds: selfBillJobs ? openSelfBillIds : [],
    partial,
  };
}
