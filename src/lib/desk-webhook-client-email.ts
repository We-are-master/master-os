const EMPTY_TOKENS = new Set(["", "0", "-", "n/a", "na", "none", "null", "undefined", "{{customer.email}}"]);

/** Emails treated as “macro empty” — replaced by fallback or omitted. Override via env. */
function ignoredPlaceholderEmails(): Set<string> {
  const raw =
    process.env.DESK_WEBHOOK_IGNORE_CLIENT_EMAILS?.trim() || "victor@joao.com";
  return new Set(
    raw
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

function fallbackClientEmail(): string | null {
  const fb = process.env.DESK_WEBHOOK_FALLBACK_CLIENT_EMAIL?.trim().toLowerCase();
  if (!fb || !fb.includes("@")) return null;
  return fb;
}

/**
 * Normalises client_email from Desk/Zendesk webhooks.
 * Empty macro fields (0, blank, legacy victor@joao.com) → env fallback or null.
 */
export function resolveDeskWebhookClientEmail(raw: unknown): string | null {
  const s = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!s || EMPTY_TOKENS.has(s) || ignoredPlaceholderEmails().has(s)) {
    return fallbackClientEmail();
  }
  return s;
}
