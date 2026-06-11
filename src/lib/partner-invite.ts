export type InvitePartnerFromZeroResult = {
  partnerId: string;
  created: boolean;
  resent: boolean;
  email: string;
  onboardingUrl: string;
  fullUrl?: string;
  sentTo?: string;
  emailSent?: boolean;
  emailError?: string | null;
  warning?: string;
  expiresAt?: string;
};

export async function invitePartnerFromZero(input: {
  email: string;
  phone?: string;
  sendEmail?: boolean;
}): Promise<InvitePartnerFromZeroResult> {
  const res = await fetch("/api/partners/invite", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: input.email.trim(),
      phone: input.phone?.trim() || undefined,
      sendEmail: input.sendEmail !== false,
    }),
  });

  const data = (await res.json().catch(() => ({}))) as InvitePartnerFromZeroResult & { error?: string };
  if (!res.ok) throw new Error(data.error ?? "Could not send partner invite");
  if (!data.onboardingUrl) throw new Error("No onboarding URL returned");
  return data;
}
