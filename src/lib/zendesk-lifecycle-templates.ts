/**
 * Customer-facing HTML templates for Zendesk public comments fired when a
 * job/quote crosses a terminal lifecycle event:
 *   - Job completed   → "Job done — thanks" (auto-closes ticket via Completed status)
 *   - Job cancelled   → "Job cancelled — here's why"
 *   - Quote rejected  → "Quote closed" (auto-closes ticket via Lost status)
 *
 * Detailed final-review with report PDFs + invoice still goes through the
 * existing manual `final-review-email` flow — these are short notices.
 */

interface CommonArgs {
  customerName: string;
  reference:    string;
  title:        string;
  /** Optional free-text reason (cancellation reason / rejection note). */
  reason?:      string | null;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function firstName(full: string): string {
  return (full.trim().split(/\s+/)[0] ?? "").trim();
}

function compactHtml(html: string): string {
  return html.replace(/>\s+</g, "><").trim();
}

function shell(args: { tone: "success" | "warn" | "neutral"; eyebrow: string; heading: string; body: string }): string {
  const palette = {
    success: { bg: "#E4F4EC", fg: "#0E8A5F", deep: "#0A5A3F" },
    warn:    { bg: "#FFF3E0", fg: "#B35900", deep: "#7A3D00" },
    neutral: { bg: "#F0F1F7", fg: "#444B6B", deep: "#1F2540" },
  }[args.tone];

  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0A0A1F;max-width:600px;">
  <div style="background:${palette.bg};border-radius:10px;padding:18px 22px;margin-bottom:16px;">
    <p style="margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;color:${palette.fg};">
      ${escapeHtml(args.eyebrow)}
    </p>
    <p style="margin:0;font-size:18px;font-weight:700;color:${palette.deep};">
      ${escapeHtml(args.heading)}
    </p>
  </div>
  ${args.body}
</div>
  `;
  return compactHtml(html);
}

export function buildJobCompletedHtml(args: CommonArgs): string {
  const fname = firstName(args.customerName) || "there";
  const body = `
  <p style="margin:0 0 14px;font-size:15px;line-height:23px;color:#3A3A55;">
    Hi ${escapeHtml(fname)}, your job <strong>#${escapeHtml(args.reference)}</strong>
    (${escapeHtml(args.title)}) has been marked complete by our team.
  </p>
  <p style="margin:0 0 14px;font-size:15px;line-height:23px;color:#3A3A55;">
    A full report and final invoice will be sent shortly. If anything looks off
    when you receive them, just reply to this email and we'll sort it out.
  </p>
  <p style="margin:0;font-size:13px;line-height:20px;color:#6B6B85;">
    Thanks for choosing us.
  </p>
  `;
  return shell({ tone: "success", eyebrow: "✓ Job completed", heading: "All done — thanks!", body });
}

export function buildJobCancelledHtml(args: CommonArgs): string {
  const fname = firstName(args.customerName) || "there";
  const reasonBlock = args.reason?.trim()
    ? `
  <div style="background:#F7F7FB;border:1px solid #E4E4EC;border-radius:10px;padding:16px 20px;margin-bottom:16px;">
    <p style="margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;color:#6B6B85;">Reason</p>
    <p style="margin:0;font-size:14px;line-height:21px;color:#3A3A55;white-space:pre-wrap;">${escapeHtml(args.reason!.trim())}</p>
  </div>`
    : "";
  const body = `
  <p style="margin:0 0 14px;font-size:15px;line-height:23px;color:#3A3A55;">
    Hi ${escapeHtml(fname)}, the job <strong>#${escapeHtml(args.reference)}</strong>
    (${escapeHtml(args.title)}) has been cancelled.
  </p>
  ${reasonBlock}
  <p style="margin:0;font-size:13px;line-height:20px;color:#6B6B85;">
    If this wasn't expected, just reply to this email — we're happy to help reschedule
    or sort out any questions.
  </p>
  `;
  return shell({ tone: "warn", eyebrow: "Job cancelled", heading: "Booking cancelled", body });
}

export function buildQuoteRejectedHtml(args: CommonArgs): string {
  const fname = firstName(args.customerName) || "there";
  const reasonBlock = args.reason?.trim()
    ? `
  <div style="background:#F7F7FB;border:1px solid #E4E4EC;border-radius:10px;padding:16px 20px;margin-bottom:16px;">
    <p style="margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;color:#6B6B85;">Your note</p>
    <p style="margin:0;font-size:14px;line-height:21px;color:#3A3A55;white-space:pre-wrap;">${escapeHtml(args.reason!.trim())}</p>
  </div>`
    : "";
  const body = `
  <p style="margin:0 0 14px;font-size:15px;line-height:23px;color:#3A3A55;">
    Hi ${escapeHtml(fname)}, we've recorded that quote
    <strong>#${escapeHtml(args.reference)}</strong> won't be going ahead.
  </p>
  ${reasonBlock}
  <p style="margin:0;font-size:13px;line-height:20px;color:#6B6B85;">
    If you'd like a revised quote or have questions, just reply to this email — we're here.
  </p>
  `;
  return shell({ tone: "neutral", eyebrow: "Quote closed", heading: "Quote no longer active", body });
}

/** Side conversation body (partner-facing) on auto job creation from quote accept. */
export function buildPartnerJobConfirmedSideConvBody(args: {
  reference:       string;
  title:           string;
  scheduledDate:   string;
  scheduledHour:   string;
  propertyAddress: string;
  scope:           string | null;
  /** Partner-scoped report submission link — included as a CTA when set so
   *  the partner can submit the work report directly from this email. */
  reportUrl?:      string;
}): string {
  const cta = args.reportUrl
    ? `
  <p style="margin:18px 0 6px;">
    <a href="${escapeHtml(args.reportUrl)}" style="display:inline-block;background:#020040;color:#ffffff;text-decoration:none;padding:11px 18px;border-radius:6px;font-weight:600;font-size:13px;">
      Submit work report
    </a>
  </p>
  <p style="margin:0;font-size:11px;color:#9A9AA0;">
    No app needed — opens a web form. Photos are resized automatically before upload.
  </p>`
    : "";

  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0A0A1F;max-width:560px;">
  <h2 style="margin:0 0 8px;font-size:18px;">Job confirmed — #${escapeHtml(args.reference)}</h2>
  <p style="margin:0 0 12px;font-size:14px;color:#3A3A55;">${escapeHtml(args.title)}</p>
  <p style="margin:0 0 6px;font-size:13px;color:#6B6B85;">📅 ${escapeHtml(args.scheduledDate)} · 🕐 ${escapeHtml(args.scheduledHour)}</p>
  <p style="margin:0 0 12px;font-size:13px;color:#6B6B85;">📍 ${escapeHtml(args.propertyAddress)}</p>
  ${args.scope ? `<p style="margin:0;font-size:13px;line-height:20px;color:#3A3A55;white-space:pre-wrap;">${escapeHtml(args.scope)}</p>` : ""}
  ${cta}
</div>
  `;
  return compactHtml(html);
}
