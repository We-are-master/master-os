/**
 * Partner cash-out classifications (ledger label only — must match drawer + self-bill UI).
 */
export const PARTNER_PAY_LEDGER_LABEL_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Optional — for history" },
  { value: "Advance", label: "Advance" },
  { value: "Partial payout", label: "Partial payout" },
  { value: "Early payment", label: "Early payment" },
  { value: "Deposit pass-through", label: "Deposit pass-through (client → partner)" },
  { value: "Other", label: "Other" },
];

/** When true, recording partner_pay skips `partner labour cap − paid so far` enforcement (e.g. deposit forwarded early). */
const BYPASS_PARTNER_PAY_CAP_LABELS = new Set(["Advance", "Early payment", "Deposit pass-through"]);

export function partnerPayLedgerBypassesPartnerCap(label: string | undefined | null): boolean {
  return BYPASS_PARTNER_PAY_CAP_LABELS.has((label ?? "").trim());
}
