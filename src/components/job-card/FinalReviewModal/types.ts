/** Presentational types for the Final review modal — display-only, no DB shape mapping. */

export type InvoiceDisplayStatus = "issued" | "pending" | "on_hold";
export type SelfBillDisplayStatus = "issued" | "pending" | "on_hold";

export type ReportItem = {
  id: string;
  name: string;
  uploaded: boolean;
  approved: boolean;
};

export type FinalReviewModalProps = {
  isOpen: boolean;
  onClose: () => void;

  /** Display meta */
  jobId: string;
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

  /** UI state lifted to parent so the existing handler can read forceReason etc. */
  confirmed: boolean;
  onConfirmedChange: (v: boolean) => void;
  sentToAccounts: boolean;
  onSentToAccountsChange: (v: boolean) => void;
  forceMode: boolean;
  onForceModeChange: (v: boolean) => void;
  forceReason: string;
  onForceReasonChange: (v: string) => void;

  /** Optional slot for hourly-job billed-hours input (rendered before the attestation section). */
  hourlySlot?: React.ReactNode;

  /** Wired to existing mutation handler */
  onApprove: () => void;
  onForceApprove: () => void;
  submitting?: boolean;
};
