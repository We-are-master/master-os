import type { Account } from "@/types/database";

/** What an account allows in the “completion email” pack (operator picks a subset in Final review). */
export type AccountFinalEmailPolicy = {
  canIncludeInvoice: boolean;
  canIncludeReport: boolean;
};

/**
 * True = offer this part in the final-review email; controlled per account in Billing settings.
 * Missing columns (pre-migration) default to true.
 */
export function accountFinalEmailPolicyFromRow(account: Account | null): AccountFinalEmailPolicy {
  if (!account) {
    return { canIncludeInvoice: true, canIncludeReport: true };
  }
  const inv = (account as { email_include_invoice_on_final?: boolean }).email_include_invoice_on_final;
  const rep = (account as { email_include_report_on_final?: boolean }).email_include_report_on_final;
  return {
    canIncludeInvoice: inv !== false,
    canIncludeReport: rep !== false,
  };
}

export function canSendClientEmailWithPack(policy: AccountFinalEmailPolicy): boolean {
  return policy.canIncludeInvoice || policy.canIncludeReport;
}
