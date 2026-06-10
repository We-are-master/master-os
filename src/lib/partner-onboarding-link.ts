export async function requestPartnerOnboardingLink(
  partnerId: string,
  options?: {
    sendEmail?: boolean;
    requestedDocIds?: string[] | null;
    customMessage?: string;
    expiresInDays?: number;
  },
): Promise<{
  onboardingUrl: string;
  sentTo?: string;
  warning?: string;
  emailSent?: boolean;
  emailError?: string | null;
  expiresAt?: string;
  fullUrl?: string;
}> {
  const res = await fetch(`/api/partners/${partnerId}/onboarding-link`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sendEmail: options?.sendEmail ?? false,
      requestedDocIds: options?.requestedDocIds,
      customMessage: options?.customMessage?.trim() || undefined,
      expiresInDays: options?.expiresInDays,
    }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    error?: string;
    onboardingUrl?: string;
    uploadUrl?: string;
    sentTo?: string;
    warning?: string;
    emailSent?: boolean;
    emailError?: string | null;
    expiresAt?: string;
    fullUrl?: string;
  };
  if (!res.ok) throw new Error(data.error ?? "Could not create onboarding link");
  const onboardingUrl = data.onboardingUrl ?? data.uploadUrl;
  if (!onboardingUrl) throw new Error("No onboarding URL returned");
  return {
    onboardingUrl,
    sentTo: data.sentTo,
    warning: data.warning,
    emailSent: data.emailSent,
    emailError: data.emailError,
    expiresAt: data.expiresAt,
    fullUrl: data.fullUrl,
  };
}
