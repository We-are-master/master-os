import type { AccountFinalEmailPolicy } from "@/lib/account-final-email-policy";
import type { DueDateSource } from "@/lib/partner-payout-schedule";

/** Presentational types for the Final review modal — display-only, no DB shape mapping. */

export type InvoiceDisplayStatus = "issued" | "pending" | "on_hold";
export type SelfBillDisplayStatus = "issued" | "pending" | "on_hold";

export type ReportItem = {
  id: string;
  name: string;
  uploaded: boolean;
  approved: boolean;
};

/** How the job is completed from the client-communication perspective. */
export type CompletionDelivery = "stage_only" | "email";

/** Sanity-check snapshot for the Summary button (invoice addressee, email, amount, reports). */
export type FinalReviewSummarySnapshot = {
  invoiceTo: string;
  /** Corporate account name when the client is linked to an account; null if not. */
  linkedAccountName: string | null;
  emailTo: string | null;
  emailLoading: boolean;
  finalAmountLabel: string;
  reportsOk: boolean;
  reportsDetail: string;
};

export type FinalReviewModalProps = {
  isOpen: boolean;
  onClose: () => void;

  /** Optional: pre-final checklist (header Summary). */
  reviewSummary?: FinalReviewSummarySnapshot | null;

  /** Display meta */
  /** Human reference (`JOB-9427`) — **rótulo**, impresso no cabeçalho. */
  jobId: string;
  /**
   * UUID da linha — **chave**, usada para falar com a API.
   *
   * São dois campos de propósito. Enquanto existia só o `jobId`, o hook do
   * envio externo consultava `/api/jobs/JOB-9427/...`, que responde 404 porque
   * a rota busca por UUID, e o selo do passo 3 nunca apareceu.
   */
  jobUuid: string;
  jobTitle: string;
  clientName: string;
  partnerName: string;
  currentUserName: string;

  /** Numbers (already computed upstream) */
  jobValue: number;
  partnerPayout: number;
  margin: number;
  marginPct: number;
  received: number;
  paidOut: number;
  clientOutstanding: number;
  partnerOutstanding: number;

  /** Status display */
  invoiceStatus: InvoiceDisplayStatus;
  selfBillStatus: SelfBillDisplayStatus;
  invoiceReference?: string | null;
  selfBillReference?: string | null;

  /** Reports */
  reports: ReportItem[];
  /**
   * O relatório final cru, para a tela de conferência que abre antes do
   * financeiro. Sem ele o modal só sabia que existe relatório, não o que ele
   * diz, e aprovar virava um ato de fé.
   */
  rawFinalReport?: unknown;
  /**
   * O relatório de chegada, que é onde moram as fotos do "antes".
   *
   * Vai junto porque conferir só a conclusão é conferir metade: a Housekeep
   * pede antes E depois, e o que prova o trabalho é o par.
   */
  rawStartReport?: unknown;
  /** Janela em campo (`partner_timer_*`) — vira Start/Finish na plataforma. */
  timerStartedAt?: string | null;
  timerEndedAt?: string | null;
  /** Abre o modal de edição do relatório. Sem isso, "Edit" não tem para onde ir. */
  onEditReport?: () => void;

  completionDelivery: CompletionDelivery | null;
  onCompletionDeliveryChange: (v: CompletionDelivery) => void;
  includeInvoiceInEmail: boolean;
  onIncludeInvoiceInEmailChange: (v: boolean) => void;
  includeReportInEmail: boolean;
  onIncludeReportInEmailChange: (v: boolean) => void;
  /** From linked account; if both false, only “internal” is available. */
  accountEmailPolicy: AccountFinalEmailPolicy;

  /** UI state lifted to parent so the existing handler can read attestations. */
  confirmed: boolean;
  onConfirmedChange: (v: boolean) => void;

  /** Optional slot for hourly-job billed-hours input (rendered before the attestation section). */
  hourlySlot?: React.ReactNode;

  /** Payment due dates confirmed at approve (optional — hidden when omitted). */
  paymentSchedule?: {
    invoiceDueYmd: string;
    onInvoiceDueYmdChange: (v: string) => void;
    invoiceDueSource: DueDateSource;
    partnerDueYmd: string;
    onPartnerDueYmdChange: (v: string) => void;
    partnerDueSource: DueDateSource;
    showPartner: boolean;
    partnerTermsLabel: string | null;
    orgStandardTerms: string;
    orgPayoutReferenceYmd?: string | null;
    loading?: boolean;
  };

  /** Wired to existing mutation handler */
  onApprove: () => void;
  submitting?: boolean;
};
