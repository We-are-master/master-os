import type { WorkforceCommissionBasis, WorkforcePaymentMethod } from "@/types/database";

export const WORKFORCE_PAYMENT_METHOD_OPTIONS: { value: WorkforcePaymentMethod; label: string }[] = [
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "wise", label: "Wise" },
];

export const WORKFORCE_COMMISSION_BASIS_OPTIONS: { value: WorkforceCommissionBasis; label: string }[] = [
  { value: "revenue", label: "Revenue" },
  { value: "gross_profit", label: "Gross margin" },
];

export async function requestWorkforceOnboardingLink(
  personId: string,
  options?: { sendEmail?: boolean; customMessage?: string },
): Promise<{ onboardingUrl: string; sentTo?: string; warning?: string }> {
  const res = await fetch(`/api/admin/workforce/${personId}/send-welcome`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sendEmail: options?.sendEmail ?? false,
      customMessage: options?.customMessage?.trim() || undefined,
    }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    error?: string;
    onboardingUrl?: string;
    sentTo?: string;
    warning?: string;
  };
  if (!res.ok) throw new Error(data.error ?? "Could not create onboarding link");
  if (!data.onboardingUrl) throw new Error("No onboarding URL returned");
  return {
    onboardingUrl: data.onboardingUrl,
    sentTo: data.sentTo,
    warning: data.warning,
  };
}
