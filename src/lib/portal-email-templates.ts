/**
 * Email templates for portal user notifications.
 *
 * Minimal HTML structure — header, body paragraph, CTA button. Doesn't
 * try to be a full responsive template since the volume is low and the
 * messages are short.
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

interface NewQuoteEmailArgs {
  accountName: string;
  quoteRef:    string;
  quoteTitle:  string;
  portalUrl:   string;
}

export function buildNewQuoteEmail({
  accountName,
  quoteRef,
  quoteTitle,
  portalUrl,
}: NewQuoteEmailArgs): { subject: string; html: string } {
  const subject = `New quote ${quoteRef} ready for review`;
  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0f172a">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px">
        <img src="https://wearemaster.com/favicon.png" alt="Master" style="width:40px;height:40px" />
        <strong style="font-size:18px;color:#0f172a">Master Portal</strong>
      </div>
      <h1 style="font-size:22px;margin:0 0 8px;color:#0f172a">A new quote is ready for you</h1>
      <p style="color:#64748b;margin:0 0 24px;line-height:1.5">
        Hi ${escapeHtml(accountName)} team — the Master team just sent quote
        <strong>${escapeHtml(quoteRef)}</strong> for <strong>${escapeHtml(quoteTitle)}</strong>.
        Review the line items, scope, and total in your portal and accept or decline whenever you&rsquo;re ready.
      </p>
      <a href="${portalUrl}"
         style="display:inline-block;background:#E94A02;color:white;padding:14px 28px;border-radius:12px;text-decoration:none;font-weight:700;font-size:14px">
        Review quote ${escapeHtml(quoteRef)}
      </a>
      <p style="color:#94a3b8;font-size:12px;margin:32px 0 0;line-height:1.5">
        This is an automatic notification from the Master account portal.
        If you weren&rsquo;t expecting this, you can safely ignore it or reply to
        <a href="mailto:hello@wearemaster.com" style="color:#E94A02">hello@wearemaster.com</a>.
      </p>
    </div>
  `;
  return { subject, html };
}
