import type { AccountBillingAddresseeMode } from "@/lib/account-billing-addressee";
import type { Invoice, SelfBill } from "@/types/database";

/** Client-safe eligibility checks for job detail send buttons (no Node/fs imports). */

export type InvoiceSendEligibilityInput = {
  invoice: Pick<Invoice, "status"> | null | undefined;
  canIncludeInvoice: boolean;
  documentEmail: string | null | undefined;
  mode?: AccountBillingAddresseeMode | null;
  loading?: boolean;
  /** Set when billing-contact API failed — distinct from a missing email on file. */
  loadError?: string | null;
};

export type SendEligibility = { ok: true } | { ok: false; reason: string };

export function missingBillingEmailReason(mode?: AccountBillingAddresseeMode | null): string {
  if (mode === "account") {
    return "No billing email. Set Billing Email on the account Finance tab.";
  }
  return "No client email. Add it on the client record (Accounts → Clients or /clients).";
}

export function formatBillingContactLoadError(status: number, message?: string | null): string {
  const detail = message?.trim();
  if (status === 0) {
    return detail
      ? `Could not load billing contact: ${detail}`
      : "Could not load billing contact. Check your connection and try again.";
  }
  if (detail) return `Could not load billing contact (${status}): ${detail}`;
  return `Could not load billing contact (${status}). Check server configuration and try again.`;
}

export function canSendJobInvoiceEmail(input: InvoiceSendEligibilityInput): SendEligibility {
  if (input.loading) return { ok: false, reason: "Loading billing contact…" };
  if (input.loadError?.trim()) return { ok: false, reason: input.loadError.trim() };
  if (!input.invoice) return { ok: false, reason: "No invoice linked to this job yet." };
  if (input.invoice.status === "cancelled") return { ok: false, reason: "Invoice is cancelled." };
  if (!input.canIncludeInvoice) {
    return { ok: false, reason: "This account does not allow invoice emails. Update Billing on the account." };
  }
  if (!input.documentEmail?.trim()) {
    return { ok: false, reason: missingBillingEmailReason(input.mode) };
  }
  return { ok: true };
}

const SELF_BILL_PAYOUT_VOID_STATUSES = new Set<string>([
  "payout_archived",
  "payout_cancelled",
  "payout_lost",
]);

function isSelfBillPayoutVoided(sb: Pick<SelfBill, "status">): boolean {
  return SELF_BILL_PAYOUT_VOID_STATUSES.has(sb.status);
}

export type SelfBillSendEligibilityInput = {
  selfBill: Pick<SelfBill, "status" | "bill_origin" | "partner_id"> | null | undefined;
  partnerEmail: string | null | undefined;
};

export function canSendJobSelfBillEmail(input: SelfBillSendEligibilityInput): SendEligibility {
  if (!input.selfBill) return { ok: false, reason: "No self-bill linked to this job yet." };
  if (isSelfBillPayoutVoided(input.selfBill)) return { ok: false, reason: "Self-bill is void or cancelled." };
  if (input.selfBill.bill_origin === "internal") {
    return { ok: false, reason: "Internal payroll bills are not emailed to partners." };
  }
  if (!input.selfBill.partner_id?.trim()) return { ok: false, reason: "Assign a partner on this job first." };
  if (!input.partnerEmail?.trim()) return { ok: false, reason: "Partner has no email on file." };
  return { ok: true };
}
