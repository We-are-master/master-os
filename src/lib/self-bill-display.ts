import type { SelfBill } from "@/types/database";
import { isSelfBillPayoutVoided } from "@/services/self-bills";

/** Internal finance label for payout-void self-bills (partner sees `partner_status_label`). */
export const SELF_BILL_FINANCE_VOID_LABEL = "Void";

/** Partner-facing status line (Cancelled / Lost / Archived). */
export function selfBillPartnerStatusLine(sb: Pick<SelfBill, "partner_status_label" | "status">): string {
  if (isSelfBillPayoutVoided(sb)) {
    return sb.partner_status_label?.trim() || "Closed out";
  }
  return sb.status;
}
