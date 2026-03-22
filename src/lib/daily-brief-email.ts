import type { OpsSnapshot } from "@/lib/master-brain-metrics";

export function buildDailyBriefHtml(params: {
  companyName: string;
  kind: "morning" | "evening";
  snapshot: OpsSnapshot;
  insightsHtml?: string;
}): string {
  const title = params.kind === "morning" ? "Morning brief" : "End of day brief";
  const rows = [
    ["Active jobs (excl. completed)", String(params.snapshot.jobsNotCompleted)],
    ["Total jobs", String(params.snapshot.jobsTotal)],
    ["Jobs with work scheduled today (date)", String(params.snapshot.jobsScheduledToday)],
    ["Quotes awaiting customer", String(params.snapshot.quotesAwaitingCustomer)],
    ["New requests", String(params.snapshot.requestsNew)],
    ["Pending invoices", `${params.snapshot.invoicesPending} (~£${params.snapshot.invoicesPendingAmount.toFixed(2)})`],
  ];

  const table = `<table style="border-collapse:collapse;width:100%;max-width:560px;font-family:system-ui,sans-serif;font-size:14px;color:#111">
    ${rows.map(([k, v]) => `<tr><td style="padding:8px 0;border-bottom:1px solid #eee">${k}</td><td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right;font-weight:600">${v}</td></tr>`).join("")}
  </table>`;

  const recent =
    params.snapshot.recentLines.length > 0
      ? `<p style="font-family:system-ui,sans-serif;font-size:13px;color:#444;margin-top:20px"><strong>Recent activity</strong></p><ul style="font-family:system-ui,sans-serif;font-size:13px;color:#333">${params.snapshot.recentLines.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul>`
      : "";

  const brain =
    params.insightsHtml && params.insightsHtml.trim()
      ? `<div style="margin-top:24px;padding:16px;background:#f8fafc;border-radius:12px;border:1px solid #e2e8f0">
          <p style="margin:0 0 8px;font-family:system-ui,sans-serif;font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase">Master Brain insights</p>
          <div style="font-family:system-ui,sans-serif;font-size:14px;color:#1e293b;line-height:1.5">${params.insightsHtml}</div>
        </div>`
      : "";

  return `<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#f1f5f9">
    <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:16px;padding:28px;border:1px solid #e2e8f0">
      <h1 style="font-family:system-ui,sans-serif;font-size:20px;margin:0 0 8px">${escapeHtml(params.companyName)} — ${title}</h1>
      <p style="font-family:system-ui,sans-serif;font-size:13px;color:#64748b;margin:0 0 20px">Operational snapshot</p>
      ${table}
      ${recent}
      ${brain}
      <p style="font-family:system-ui,sans-serif;font-size:11px;color:#94a3b8;margin-top:28px">Sent by Master OS · configure in Settings → AI &amp; Daily brief</p>
    </div>
  </body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Convert plain text / markdown-lite bullets from model to safe HTML paragraphs */
export function insightsTextToHtml(text: string): string {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const out: string[] = [];
  for (const line of lines) {
    if (!line) continue;
    if (line.startsWith("- ") || line.startsWith("• ")) {
      out.push(`<p style="margin:4px 0;padding-left:12px;border-left:3px solid #f97316">${escapeHtml(line.replace(/^[-•]\s*/, ""))}</p>`);
    } else {
      out.push(`<p style="margin:8px 0">${escapeHtml(line)}</p>`);
    }
  }
  return out.join("") || `<p>${escapeHtml(text)}</p>`;
}
