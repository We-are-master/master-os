function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

interface NewTicketEmailArgs {
  accountName: string;
  ticketRef: string;
  subject: string;
  type: string;
  priority: string;
  body: string;
  senderName: string;
  dashboardUrl: string;
}

export function buildNewTicketInternalEmail(args: NewTicketEmailArgs): { subject: string; html: string } {
  return {
    subject: `New ticket ${args.ticketRef} from ${args.accountName}: ${args.subject}`,
    html: `
      <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0f172a">
        <h1 style="font-size:20px;margin:0 0 8px">New support ticket</h1>
        <p style="color:#64748b;margin:0 0 24px">${escapeHtml(args.senderName)} from ${escapeHtml(args.accountName)} opened a ticket.</p>
        <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
          <tr><td style="padding:8px 0;color:#64748b;width:120px">Reference</td><td style="padding:8px 0;font-weight:600">${escapeHtml(args.ticketRef)}</td></tr>
          <tr><td style="padding:8px 0;color:#64748b">Subject</td><td style="padding:8px 0">${escapeHtml(args.subject)}</td></tr>
          <tr><td style="padding:8px 0;color:#64748b">Type</td><td style="padding:8px 0;text-transform:capitalize">${escapeHtml(args.type.replace(/_/g, " "))}</td></tr>
          <tr><td style="padding:8px 0;color:#64748b">Priority</td><td style="padding:8px 0;text-transform:capitalize">${escapeHtml(args.priority)}</td></tr>
        </table>
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px;margin-bottom:24px">
          <p style="margin:0;white-space:pre-wrap;line-height:1.5">${escapeHtml(args.body)}</p>
        </div>
        <a href="${args.dashboardUrl}" style="display:inline-block;background:#E94A02;color:white;padding:12px 24px;border-radius:12px;text-decoration:none;font-weight:700">Open in dashboard</a>
      </div>
    `,
  };
}

interface TicketReplyEmailArgs {
  recipientName: string;
  ticketRef: string;
  subject: string;
  senderName: string;
  body: string;
  portalUrl: string;
}

export function buildTicketReplyPortalEmail(args: TicketReplyEmailArgs): { subject: string; html: string } {
  return {
    subject: `Reply on ticket ${args.ticketRef}: ${args.subject}`,
    html: `
      <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0f172a">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px">
          <img src="/favicon.png" alt="Fixfy" style="width:40px;height:40px" />
          <strong style="font-size:18px;color:#0f172a">Fixfy Portal</strong>
        </div>
        <h1 style="font-size:20px;margin:0 0 8px">New reply on your ticket</h1>
        <p style="color:#64748b;margin:0 0 24px">
          Hi ${escapeHtml(args.recipientName)} — ${escapeHtml(args.senderName)} replied to ticket
          <strong>${escapeHtml(args.ticketRef)}</strong>: ${escapeHtml(args.subject)}
        </p>
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px;margin-bottom:24px">
          <p style="margin:0;white-space:pre-wrap;line-height:1.5">${escapeHtml(args.body)}</p>
        </div>
        <a href="${args.portalUrl}" style="display:inline-block;background:#E94A02;color:white;padding:12px 24px;border-radius:12px;text-decoration:none;font-weight:700">View in portal</a>
        <p style="color:#94a3b8;font-size:12px;margin:32px 0 0">
          Reply at <a href="mailto:support@getfixfy.com" style="color:#E94A02">support@getfixfy.com</a> or through the portal.
        </p>
      </div>
    `,
  };
}

interface TicketReplyInternalEmailArgs {
  ticketRef: string;
  subject: string;
  senderName: string;
  accountName: string;
  body: string;
  dashboardUrl: string;
}

export function buildTicketReplyInternalEmail(args: TicketReplyInternalEmailArgs): { subject: string; html: string } {
  return {
    subject: `Reply on ${args.ticketRef} from ${args.accountName}`,
    html: `
      <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0f172a">
        <h1 style="font-size:20px;margin:0 0 8px">${escapeHtml(args.senderName)} replied to ${escapeHtml(args.ticketRef)}</h1>
        <p style="color:#64748b;margin:0 0 24px">${escapeHtml(args.accountName)} — ${escapeHtml(args.subject)}</p>
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px;margin-bottom:24px">
          <p style="margin:0;white-space:pre-wrap;line-height:1.5">${escapeHtml(args.body)}</p>
        </div>
        <a href="${args.dashboardUrl}" style="display:inline-block;background:#E94A02;color:white;padding:12px 24px;border-radius:12px;text-decoration:none;font-weight:700">Open ticket</a>
      </div>
    `,
  };
}
