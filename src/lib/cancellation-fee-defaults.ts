/** Who pays an optional office-recorded cancellation fee (dashboard cancel). */
export type CancellationFeeParty = "none" | "client" | "partner" | "both";

export type CancelFeeSuggestion = {
  amountGbp: number;
  sourceLabel: string;
};

export function suggestClientCancellationFee(input: {
  accountDefault?: number | null | undefined;
  companyDefault?: number | null | undefined;
}): CancelFeeSuggestion {
  const account = coerceFee(input.accountDefault);
  if (account > 0) return { amountGbp: account, sourceLabel: "account default" };
  const company = coerceFee(input.companyDefault);
  if (company > 0) return { amountGbp: company, sourceLabel: "company default" };
  return { amountGbp: 0, sourceLabel: "" };
}

export function suggestPartnerCancellationFee(input: {
  partnerDefault?: number | null | undefined;
  companyPartnerDefault?: number | null | undefined;
}): CancelFeeSuggestion {
  const pd = coerceFee(input.partnerDefault);
  if (pd > 0) return { amountGbp: pd, sourceLabel: "partner default" };
  const cd = coerceFee(input.companyPartnerDefault);
  if (cd > 0) return { amountGbp: cd, sourceLabel: "company partner fee default" };
  return { amountGbp: 0, sourceLabel: "" };
}

function coerceFee(v: number | null | undefined): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 100) / 100;
}
