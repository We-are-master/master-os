/**
 * Sends the 1-tap approval email for a queued blog/social item.
 * Fire-and-forget from the ingest routes; uses the same Resend setup as the
 * lifecycle email cron. Recipient: CONTENT_APPROVER_EMAIL (falls back to a
 * sensible Fixfy inbox).
 */
import { Resend } from "resend";
import { FIXFY_BRAND } from "@/lib/social/content";

type ApprovalEmailInput = {
  kind: "blog" | "social";
  title: string; // blog title or social caption (first line)
  body: string; // excerpt / sub / caption preview
  imageUrl?: string | null; // social preview image
  product: string;
  approveUrl: string;
  rejectUrl: string;
};

function approverEmail(): string {
  return process.env.CONTENT_APPROVER_EMAIL?.trim() || "hello@getfixfy.com";
}

function esc(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildHtml(i: ApprovalEmailInput): string {
  const { navy, orange, off, ink, gray } = FIXFY_BRAND;
  const kindLabel = i.kind === "blog" ? "Blog post" : "Social post";
  const img = i.imageUrl
    ? `<tr><td style="padding:0 0 20px;"><img src="${esc(i.imageUrl)}" alt="Preview" style="width:100%;max-width:520px;border-radius:12px;display:block;border:1px solid ${off};" /></td></tr>`
    : "";
  return `<!doctype html><html><body style="margin:0;background:${off};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${ink};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${off};padding:28px 16px;"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(2,0,64,.08);">
  <tr><td style="background:${navy};padding:20px 28px;">
    <p style="margin:0;color:${orange};font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;">Social Media Designer · ${esc(i.product)}</p>
    <p style="margin:4px 0 0;color:#fff;font-size:18px;font-weight:700;">${kindLabel} ready for approval</p>
  </td></tr>
  <tr><td style="padding:24px 28px 8px;">
    <table role="presentation" width="100%">${img}</table>
    <h1 style="margin:0 0 8px;font-size:20px;line-height:1.3;color:${ink};">${esc(i.title)}</h1>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.5;color:${gray};">${esc(i.body)}</p>
    <table role="presentation" cellpadding="0" cellspacing="0"><tr>
      <td style="padding-right:10px;"><a href="${esc(i.approveUrl)}" style="display:inline-block;background:${orange};color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:13px 28px;border-radius:999px;">Approve &amp; ${i.kind === "blog" ? "publish" : "queue"}</a></td>
      <td><a href="${esc(i.rejectUrl)}" style="display:inline-block;background:#fff;color:${navy};text-decoration:none;font-weight:600;font-size:15px;padding:13px 24px;border-radius:999px;border:1px solid ${FIXFY_BRAND.line};">Reject</a></td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:18px 28px 24px;"><p style="margin:0;font-size:12px;color:${gray};">One tap — no login needed. Fixfy · getfixfy.com</p></td></tr>
</table></td></tr></table></body></html>`;
}

export async function sendApprovalEmail(input: ApprovalEmailInput): Promise<void> {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) return; // silently skip if email isn't configured
  const from = process.env.RESEND_FROM_EMAIL?.trim() || "Fixfy <hello@getfixfy.com>";
  const resend = new Resend(key);
  const subject =
    input.kind === "blog"
      ? `📝 Approve blog: ${input.title}`
      : `📣 Approve social post (${input.product})`;
  try {
    await resend.emails.send({ from, to: [approverEmail()], subject, html: buildHtml(input) });
  } catch {
    // best-effort — ingest already succeeded; approval links also returned in the API response
  }
}
