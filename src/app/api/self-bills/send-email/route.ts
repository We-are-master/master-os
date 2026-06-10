import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { requireAuth, isValidUUID } from "@/lib/auth-api";
import { createServiceClient } from "@/lib/supabase/service";
import { renderSelfBillPdfBuffer } from "@/lib/self-bill-pdf-server";
import { partnerFieldSelfBillPaymentDueDate } from "@/lib/self-bill-period";
import { formatCurrency } from "@/lib/utils";
import { isSelfBillPayoutVoided } from "@/services/self-bills";
import { createClient } from "@/lib/supabase/server";
import {
  groupSelfBillsByPeriod,
  resolvePaymentRunForGroup,
  type PaymentRunCycleKind,
  type ResolvedPaymentRun,
} from "@/lib/self-bill-payment-run";
import { createSideConversation, replyToSideConversation } from "@/lib/zendesk";
import type { SelfBill } from "@/types/database";
import type { SupabaseClient } from "@supabase/supabase-js";

type Skipped = { id: string; reference?: string; reason: string };

type SendContext = {
  supabase: SupabaseClient;
  resend: Resend;
  fromEmail: string;
  ccEmail: string | null;
  companyName: string | null;
  userId: string;
  userName: string;
  runByGroupKey: Map<string, ResolvedPaymentRun>;
  cycleKind: PaymentRunCycleKind;
};

function escapeHtmlSimple(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function selfBillPeriodLine(sb: SelfBill): string {
  const week = sb.week_label ?? sb.period ?? "—";
  if (sb.week_start && sb.week_end) {
    return `${new Date(sb.week_start).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} – ${new Date(
      sb.week_end,
    ).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`;
  }
  return week;
}

function resolveDueYmd(sb: SelfBill): string | null {
  const weekEndStr = sb.week_end?.trim() ?? "";
  return sb.due_date?.trim() || (weekEndStr ? partnerFieldSelfBillPaymentDueDate(weekEndStr) : null);
}

function buildSelfBillEmailHtml(
  sb: SelfBill,
  dueYmd: string | null,
  args: { partnerName?: string | null; companyName?: string | null },
): string {
  const amount = formatCurrency(Number(sb.net_payout ?? 0));
  const firstName = (args.partnerName?.trim() || "").split(/\s+/)[0] || "there";
  const periodLine = selfBillPeriodLine(sb);
  const jobsCount = Number(sb.jobs_count ?? 0);
  const jobsLine = jobsCount > 0 ? `${jobsCount} job${jobsCount === 1 ? "" : "s"} included` : "";
  const dueLine = dueYmd ?? "—";
  const company = args.companyName?.trim() || "Fixfy";

  const row = (label: string, value: string) => `
                <tr>
                  <td valign="middle" style="padding-top:6px; font-size:11px; font-weight:700; letter-spacing:1px; color:#9A9AA8; text-transform:uppercase;">${label}</td>
                  <td valign="middle" align="right" style="padding-top:6px; font-size:13px; color:#020040; font-weight:600;">${value}</td>
                </tr>`;

  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#F2F0FA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0A0A1F;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F2F0FA;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="background:#fff;border-radius:12px;overflow:hidden;max-width:560px;">
        <tr><td bgcolor="#020040" style="background:#020040;padding:22px 32px;color:#fff;">
          <p style="margin:0;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#A0A0CC;">Self-billing statement</p>
          <p style="margin:6px 0 0 0;font-size:18px;font-weight:700;color:#fff;">${escapeHtmlSimple(sb.reference)}</p>
        </td></tr>
        <tr><td style="padding:28px 32px 8px 32px;">
          <p style="margin:0 0 14px 0;font-size:15px;line-height:22px;">Hi ${escapeHtmlSimple(firstName)},</p>
          <p style="margin:0 0 18px 0;font-size:14px;line-height:21px;color:#3A3A55;">
            Your self-billing statement for ${escapeHtmlSimple(periodLine)} is attached as a PDF. The amount below is what we'll pay you for the work in that window.
          </p>
        </td></tr>
        <tr><td style="padding:0 32px 24px 32px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F7F7FA;border-radius:8px;">
            <tr><td style="padding:14px 18px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                ${row("Period", escapeHtmlSimple(periodLine))}
                ${row("Amount due", amount)}
                ${row("Payment date", escapeHtmlSimple(dueLine))}
                ${jobsLine ? row("Coverage", jobsLine) : ""}
              </table>
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:0 32px 24px 32px;">
          <p style="margin:0;font-size:13px;line-height:19px;color:#3A3A55;">
            Paid via bank transfer to the account on file. The PDF breaks down each job — keep it for your records.
            If anything looks off, reply to this email before payment day and we'll sort it out.
          </p>
        </td></tr>
        <tr><td bgcolor="#020040" style="background:#020040;padding:18px 32px;text-align:center;color:#A0A0CC;font-size:12px;">
          ${escapeHtmlSimple(company)} &middot; <a href="mailto:support@getfixfy.com" style="color:#A0A0CC;text-decoration:none;">support@getfixfy.com</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function buildBundledSelfBillEmailHtml(
  bills: SelfBill[],
  dueYmd: string | null,
  args: { partnerName?: string | null; companyName?: string | null },
): string {
  const firstName = (args.partnerName?.trim() || "").split(/\s+/)[0] || "there";
  const company = args.companyName?.trim() || "Fixfy";
  const total = bills.reduce((sum, sb) => sum + Number(sb.net_payout ?? 0), 0);
  const dueLine = dueYmd ?? "—";
  const count = bills.length;

  const lineRows = bills
    .map((sb) => {
      const period = escapeHtmlSimple(selfBillPeriodLine(sb));
      const ref = escapeHtmlSimple(sb.reference);
      const amt = formatCurrency(Number(sb.net_payout ?? 0));
      return `<tr>
        <td style="padding:8px 0;border-bottom:1px solid #E8E8EE;font-size:13px;color:#020040;font-weight:600;">${ref}</td>
        <td style="padding:8px 0;border-bottom:1px solid #E8E8EE;font-size:12px;color:#3A3A55;">${period}</td>
        <td align="right" style="padding:8px 0;border-bottom:1px solid #E8E8EE;font-size:13px;color:#020040;font-weight:600;font-variant-numeric:tabular-nums;">${amt}</td>
      </tr>`;
    })
    .join("");

  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#F2F0FA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0A0A1F;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F2F0FA;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="background:#fff;border-radius:12px;overflow:hidden;max-width:560px;">
        <tr><td bgcolor="#020040" style="background:#020040;padding:22px 32px;color:#fff;">
          <p style="margin:0;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#A0A0CC;">Self-billing statements</p>
          <p style="margin:6px 0 0 0;font-size:18px;font-weight:700;color:#fff;">${count} period${count === 1 ? "" : "s"} · ${formatCurrency(total)}</p>
        </td></tr>
        <tr><td style="padding:28px 32px 8px 32px;">
          <p style="margin:0 0 14px 0;font-size:15px;line-height:22px;">Hi ${escapeHtmlSimple(firstName)},</p>
          <p style="margin:0 0 18px 0;font-size:14px;line-height:21px;color:#3A3A55;">
            Your self-billing statements for ${count} work period${count === 1 ? "" : "s"} are attached as PDFs. The summary below is the total we'll pay you.
          </p>
        </td></tr>
        <tr><td style="padding:0 32px 24px 32px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F7F7FA;border-radius:8px;">
            <tr><td style="padding:14px 18px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <th align="left" style="padding:0 0 6px;font-size:10px;font-weight:700;letter-spacing:1px;color:#9A9AA8;text-transform:uppercase;">Reference</th>
                  <th align="left" style="padding:0 0 6px;font-size:10px;font-weight:700;letter-spacing:1px;color:#9A9AA8;text-transform:uppercase;">Period</th>
                  <th align="right" style="padding:0 0 6px;font-size:10px;font-weight:700;letter-spacing:1px;color:#9A9AA8;text-transform:uppercase;">Amount</th>
                </tr>
                ${lineRows}
                <tr>
                  <td colspan="2" style="padding-top:12px;font-size:11px;font-weight:700;letter-spacing:1px;color:#9A9AA8;text-transform:uppercase;">Total due</td>
                  <td align="right" style="padding-top:12px;font-size:15px;color:#020040;font-weight:700;font-variant-numeric:tabular-nums;">${formatCurrency(total)}</td>
                </tr>
                <tr>
                  <td colspan="2" style="padding-top:8px;font-size:11px;font-weight:700;letter-spacing:1px;color:#9A9AA8;text-transform:uppercase;">Payment date</td>
                  <td align="right" style="padding-top:8px;font-size:13px;color:#020040;font-weight:600;">${escapeHtmlSimple(dueLine)}</td>
                </tr>
              </table>
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:0 32px 24px 32px;">
          <p style="margin:0;font-size:13px;line-height:19px;color:#3A3A55;">
            Paid via bank transfer to the account on file. Each PDF breaks down the jobs for that period.
            If anything looks off, reply to this email before payment day and we'll sort it out.
          </p>
        </td></tr>
        <tr><td bgcolor="#020040" style="background:#020040;padding:18px 32px;text-align:center;color:#A0A0CC;font-size:12px;">
          ${escapeHtmlSimple(company)} &middot; <a href="mailto:support@getfixfy.com" style="color:#A0A0CC;text-decoration:none;">support@getfixfy.com</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function buildSelfBillSideConvHtml(sb: SelfBill, dueYmd: string | null, partnerEmail: string): string {
  const week = sb.week_label ?? sb.period ?? "—";
  const dueLine = dueYmd ? `<p style="margin:0 0 8px;">Payment due: <strong>${dueYmd}</strong></p>` : "";
  return `<div style="font-family:system-ui,sans-serif;color:#0A0A1F;max-width:560px;">
      <p style="margin:0 0 8px;">Self-bill <strong>${sb.reference}</strong> sent to <strong>${partnerEmail}</strong>.</p>
      <p style="margin:0 0 8px;">Week: ${week}</p>
      ${dueLine}
      <p style="margin:0 0 8px;">Amount: <strong>${formatCurrency(Number(sb.net_payout ?? 0))}</strong></p>
      <p style="margin:0;color:#6B6B85;font-size:13px;">PDF was emailed via Resend (Zendesk side conversations don't carry attachments).</p>
    </div>`;
}

function buildBundledSelfBillSideConvHtml(
  bills: SelfBill[],
  dueYmd: string | null,
  partnerEmail: string,
): string {
  const total = bills.reduce((sum, sb) => sum + Number(sb.net_payout ?? 0), 0);
  const dueLine = dueYmd ? `<p style="margin:0 0 8px;">Payment due: <strong>${dueYmd}</strong></p>` : "";
  const rows = bills
    .map(
      (sb) =>
        `<li><strong>${sb.reference}</strong> · ${selfBillPeriodLine(sb)} · ${formatCurrency(Number(sb.net_payout ?? 0))}</li>`,
    )
    .join("");
  return `<div style="font-family:system-ui,sans-serif;color:#0A0A1F;max-width:560px;">
      <p style="margin:0 0 8px;">Bundled self-bill email sent to <strong>${partnerEmail}</strong> (${bills.length} statement${bills.length === 1 ? "" : "s"}).</p>
      <ul style="margin:0 0 8px;padding-left:18px;">${rows}</ul>
      ${dueLine}
      <p style="margin:0 0 8px;">Total: <strong>${formatCurrency(total)}</strong></p>
      <p style="margin:0;color:#6B6B85;font-size:13px;">PDFs were emailed via Resend (Zendesk side conversations don't carry attachments).</p>
    </div>`;
}

function parseCycleHint(raw: unknown): PaymentRunCycleKind | "auto" {
  if (raw === "standard" || raw === "off_cycle" || raw === "auto") return raw;
  return "auto";
}

function runForSelfBill(sb: SelfBill, runByGroupKey: Map<string, ResolvedPaymentRun>): ResolvedPaymentRun | null {
  const groupKey = `${sb.week_start ?? ""}|${sb.week_end ?? ""}`;
  return runByGroupKey.get(groupKey) ?? null;
}

async function stampSelfBillSent(
  ctx: SendContext,
  sb: SelfBill,
  partnerEmail: string,
  run: ResolvedPaymentRun | null,
  sideConvId: string | null,
  ccList: string[] | undefined,
  resendId: string | undefined,
  bundled: boolean,
  bundledCount: number,
): Promise<void> {
  const stamp = new Date().toISOString();
  const { error: stampErr } = await ctx.supabase
    .from("self_bills")
    .update({
      pdf_generated_at: stamp,
      email_sent_at: stamp,
      payment_run_id: run?.id ?? null,
      zendesk_ticket_id: run?.zendesk_ticket_id ?? null,
      zendesk_ticket_url: run?.zendesk_ticket_url ?? null,
      zendesk_side_conversation_id: sideConvId,
    })
    .eq("id", sb.id);
  if (stampErr) console.warn("[self-bills send-email] state stamp failed", sb.id, stampErr);

  void ctx.supabase.from("audit_logs").insert({
    entity_type: "self_bill",
    entity_id: sb.id,
    entity_ref: sb.reference,
    action: "bulk_update",
    field_name: "email_sent",
    new_value: partnerEmail,
    user_id: ctx.userId,
    user_name: ctx.userName,
    metadata: {
      email_to: partnerEmail,
      cc: ccList ?? [],
      resend_id: resendId,
      payment_run_id: run?.id ?? null,
      zendesk_ticket_id: run?.zendesk_ticket_id ?? null,
      zendesk_ticket_url: run?.zendesk_ticket_url ?? null,
      zendesk_side_conversation_id: sideConvId,
      cycle_kind: run?.cycle_kind ?? ctx.cycleKind,
      bundled,
      bundled_count: bundledCount,
    },
  });
}

async function postZendeskSideConv(
  run: ResolvedPaymentRun | null,
  existingSideConvId: string | null | undefined,
  partnerEmail: string,
  partnerName: string | null,
  subject: string,
  htmlBody: string,
): Promise<string | null> {
  if (!run?.zendesk_ticket_id) return existingSideConvId?.trim() || null;

  let sideConvId = existingSideConvId?.trim() || null;
  const toName = partnerName ?? undefined;

  if (sideConvId) {
    const reply = await replyToSideConversation({
      ticketId: run.zendesk_ticket_id,
      sideConversationId: sideConvId,
      htmlBody,
      toEmail: partnerEmail,
      toName,
    });
    if (!reply.ok) {
      console.warn("[self-bills send-email] side conv reply failed; opening fresh thread", reply.error);
      const fresh = await createSideConversation({
        ticketId: run.zendesk_ticket_id,
        toEmail: partnerEmail,
        toName,
        subject,
        htmlBody,
      });
      if (fresh.ok && fresh.id) sideConvId = String(fresh.id);
    }
  } else {
    const opened = await createSideConversation({
      ticketId: run.zendesk_ticket_id,
      toEmail: partnerEmail,
      toName,
      subject,
      htmlBody,
    });
    if (opened.ok && opened.id) {
      sideConvId = String(opened.id);
    } else {
      console.warn("[self-bills send-email] side conv create failed", opened.error);
    }
  }

  return sideConvId;
}

async function sendSingleSelfBill(
  ctx: SendContext,
  id: string,
  sb: SelfBill,
  sentIds: string[],
  skipped: Skipped[],
): Promise<void> {
  if (isSelfBillPayoutVoided(sb)) {
    skipped.push({ id, reference: sb.reference, reason: "Void or cancelled" });
    return;
  }
  if (sb.bill_origin === "internal") {
    skipped.push({ id, reference: sb.reference, reason: "Internal payroll bill" });
    return;
  }
  if (!sb.partner_id?.trim()) {
    skipped.push({ id, reference: sb.reference, reason: "No partner linked" });
    return;
  }

  const { data: partner } = await ctx.supabase
    .from("partners")
    .select("email, name")
    .eq("id", sb.partner_id)
    .maybeSingle();
  const partnerEmail = partner?.email?.trim().toLowerCase();
  const partnerName = partner?.name?.trim() ?? null;
  if (!partnerEmail) {
    skipped.push({ id, reference: sb.reference, reason: "Partner has no email" });
    return;
  }

  const pdfResult = await renderSelfBillPdfBuffer(ctx.supabase, id);
  if ("error" in pdfResult) {
    skipped.push({ id, reference: sb.reference, reason: pdfResult.error });
    return;
  }

  const dueYmd = resolveDueYmd(sb);
  const safeName = String(sb.reference ?? "self-bill").replace(/[^\w.-]+/g, "_");
  const ccList = ctx.ccEmail && ctx.ccEmail.toLowerCase() !== partnerEmail ? [ctx.ccEmail] : undefined;

  const { data: emailResult, error: emailError } = await ctx.resend.emails.send({
    from: ctx.fromEmail,
    to: [partnerEmail],
    cc: ccList,
    subject: `Self-Billing Statement | ${sb.week_label ?? sb.period ?? "weekly"}`,
    html: buildSelfBillEmailHtml(sb, dueYmd, { partnerName, companyName: ctx.companyName }),
    attachments: [
      {
        filename: `${safeName}.pdf`,
        content: pdfResult.buffer,
        contentType: "application/pdf",
      },
    ],
  });

  if (emailError) {
    skipped.push({
      id,
      reference: sb.reference,
      reason:
        typeof emailError === "object" && emailError && "message" in emailError
          ? String((emailError as { message: unknown }).message)
          : "Email delivery failed",
    });
    return;
  }

  const run = runForSelfBill(sb, ctx.runByGroupKey);
  const sideConvId = await postZendeskSideConv(
    run,
    sb.zendesk_side_conversation_id,
    partnerEmail,
    partnerName,
    `Self-bill ${sb.reference} — ${partnerName ?? partnerEmail}`,
    buildSelfBillSideConvHtml(sb, dueYmd, partnerEmail),
  );

  await stampSelfBillSent(ctx, sb, partnerEmail, run, sideConvId, ccList, emailResult?.id, false, 1);
  sentIds.push(id);
}

async function sendPartnerBundle(
  ctx: SendContext,
  partnerId: string,
  billIds: string[],
  sbById: Map<string, SelfBill>,
  sentIds: string[],
  skipped: Skipped[],
): Promise<boolean> {
  const bills: SelfBill[] = [];
  for (const id of billIds) {
    const sb = sbById.get(id);
    if (!sb) {
      skipped.push({ id, reason: "Not found" });
      continue;
    }
    if (isSelfBillPayoutVoided(sb)) {
      skipped.push({ id, reference: sb.reference, reason: "Void or cancelled" });
      continue;
    }
    if (sb.bill_origin === "internal") {
      skipped.push({ id, reference: sb.reference, reason: "Internal payroll bill" });
      continue;
    }
    if (!sb.partner_id?.trim() || sb.partner_id !== partnerId) {
      skipped.push({ id, reference: sb.reference, reason: "Partner mismatch" });
      continue;
    }
    bills.push(sb);
  }

  if (!bills.length) return false;

  const { data: partner } = await ctx.supabase
    .from("partners")
    .select("email, name")
    .eq("id", partnerId)
    .maybeSingle();
  const partnerEmail = partner?.email?.trim().toLowerCase();
  const partnerName = partner?.name?.trim() ?? null;
  if (!partnerEmail) {
    for (const sb of bills) {
      skipped.push({ id: sb.id, reference: sb.reference, reason: "Partner has no email" });
    }
    return false;
  }

  const attachments: { filename: string; content: Buffer; contentType: string }[] = [];
  const readyBills: SelfBill[] = [];

  for (const sb of bills) {
    const pdfResult = await renderSelfBillPdfBuffer(ctx.supabase, sb.id);
    if ("error" in pdfResult) {
      skipped.push({ id: sb.id, reference: sb.reference, reason: pdfResult.error });
      continue;
    }
    const safeName = String(sb.reference ?? "self-bill").replace(/[^\w.-]+/g, "_");
    attachments.push({
      filename: `${safeName}.pdf`,
      content: pdfResult.buffer,
      contentType: "application/pdf",
    });
    readyBills.push(sb);
  }

  if (!readyBills.length) return false;

  const dueDates = readyBills.map((sb) => resolveDueYmd(sb)).filter((d): d is string => !!d);
  const dueYmd = dueDates.sort()[0] ?? null;
  const ccList = ctx.ccEmail && ctx.ccEmail.toLowerCase() !== partnerEmail ? [ctx.ccEmail] : undefined;
  const total = readyBills.reduce((sum, sb) => sum + Number(sb.net_payout ?? 0), 0);
  const count = readyBills.length;

  const { data: emailResult, error: emailError } = await ctx.resend.emails.send({
    from: ctx.fromEmail,
    to: [partnerEmail],
    cc: ccList,
    subject:
      count === 1
        ? `Self-Billing Statement | ${readyBills[0]!.week_label ?? readyBills[0]!.period ?? "weekly"}`
        : `Self-Billing Statements | ${count} periods · ${formatCurrency(total)}`,
    html: buildBundledSelfBillEmailHtml(readyBills, dueYmd, { partnerName, companyName: ctx.companyName }),
    attachments,
  });

  if (emailError) {
    for (const sb of readyBills) {
      skipped.push({
        id: sb.id,
        reference: sb.reference,
        reason:
          typeof emailError === "object" && emailError && "message" in emailError
            ? String((emailError as { message: unknown }).message)
            : "Email delivery failed",
      });
    }
    return false;
  }

  const primaryRun = runForSelfBill(readyBills[0]!, ctx.runByGroupKey);
  const existingSideConv = readyBills.find((sb) => sb.zendesk_side_conversation_id?.trim())?.zendesk_side_conversation_id ?? null;
  const sideConvId = await postZendeskSideConv(
    primaryRun,
    existingSideConv,
    partnerEmail,
    partnerName,
    count === 1
      ? `Self-bill ${readyBills[0]!.reference} — ${partnerName ?? partnerEmail}`
      : `Self-bills (${count}) — ${partnerName ?? partnerEmail}`,
    buildBundledSelfBillSideConvHtml(readyBills, dueYmd, partnerEmail),
  );

  for (const sb of readyBills) {
    const run = runForSelfBill(sb, ctx.runByGroupKey);
    await stampSelfBillSent(ctx, sb, partnerEmail, run, sideConvId, ccList, emailResult?.id, true, count);
    sentIds.push(sb.id);
  }

  return true;
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  let body: { selfBillIds?: unknown; paymentRunHint?: unknown; bundleByPartner?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const rawIds = body.selfBillIds;
  if (!Array.isArray(rawIds) || rawIds.length === 0) {
    return NextResponse.json({ error: "selfBillIds array required" }, { status: 400 });
  }
  const selfBillIds = rawIds.filter((id): id is string => typeof id === "string" && isValidUUID(id));
  if (selfBillIds.length === 0) {
    return NextResponse.json({ error: "No valid self-bill ids" }, { status: 400 });
  }
  const cycleHint = parseCycleHint(body.paymentRunHint);
  const bundleByPartner = body.bundleByPartner === true;

  const resendKey = process.env.RESEND_API_KEY?.trim();
  if (!resendKey) {
    return NextResponse.json({ error: "RESEND_API_KEY not configured" }, { status: 503 });
  }
  const fromEmail = process.env.RESEND_FROM_EMAIL?.trim();
  if (!fromEmail) {
    return NextResponse.json({ error: "RESEND_FROM_EMAIL not configured" }, { status: 503 });
  }

  const supabase = createServiceClient();
  const { data: company } = await supabase.from("company_settings").select("email, company_name").limit(1).maybeSingle();
  const ccEmail =
    process.env.SELF_BILL_CC_EMAIL?.trim() ||
    (company?.email && String(company.email).trim()) ||
    null;
  const companyEmail = (company?.email && String(company.email).trim()) || null;
  const companyName = (company?.company_name && String(company.company_name).trim()) || null;

  const profileClient = await createClient();
  const { data: profile } = await profileClient
    .from("profiles")
    .select("full_name")
    .eq("id", auth.user.id)
    .maybeSingle();
  const userName = profile?.full_name?.trim() || auth.user.email || "User";

  const { data: sbRows } = await supabase
    .from("self_bills")
    .select("*")
    .in("id", selfBillIds);
  const sbList = ((sbRows ?? []) as SelfBill[]).filter((sb) => !!sb);
  const sbById = new Map(sbList.map((sb) => [sb.id, sb]));

  const cycleKind: PaymentRunCycleKind = cycleHint === "off_cycle" ? "off_cycle" : "standard";
  const requesterEmail = companyEmail || auth.user.email || "no-reply@example.com";
  const requesterName = companyName || userName;

  const groups = groupSelfBillsByPeriod(sbList);
  const runByGroupKey = new Map<string, ResolvedPaymentRun>();
  for (const group of groups) {
    try {
      const run = await resolvePaymentRunForGroup(supabase, group, {
        cycleKind,
        createdBy: auth.user.id,
        requesterEmail,
        requesterName,
      });
      runByGroupKey.set(`${group.period_start}|${group.period_end}`, run);
    } catch (e) {
      console.error("[self-bills send-email] payment run resolve failed", group, e);
    }
  }

  const ctx: SendContext = {
    supabase,
    resend: new Resend(resendKey),
    fromEmail,
    ccEmail,
    companyName,
    userId: auth.user.id,
    userName,
    runByGroupKey,
    cycleKind,
  };

  const sentIds: string[] = [];
  const skipped: Skipped[] = [];
  let emailsSent = 0;

  if (bundleByPartner) {
    const byPartner = new Map<string, string[]>();
    for (const id of selfBillIds) {
      const sb = sbById.get(id);
      if (!sb?.partner_id?.trim() || sb.bill_origin === "internal") continue;
      const pid = sb.partner_id;
      const list = byPartner.get(pid) ?? [];
      list.push(id);
      byPartner.set(pid, list);
    }

    for (const [partnerId, ids] of byPartner) {
      const ok = await sendPartnerBundle(ctx, partnerId, ids, sbById, sentIds, skipped);
      if (ok) emailsSent += 1;
    }

    for (const id of selfBillIds) {
      const sb = sbById.get(id);
      if (!sb) {
        if (!skipped.some((s) => s.id === id)) skipped.push({ id, reason: "Not found" });
        continue;
      }
      if (sb.bill_origin === "internal" && !skipped.some((s) => s.id === id)) {
        skipped.push({ id, reference: sb.reference, reason: "Internal payroll bill" });
      }
      if (!sb.partner_id?.trim() && sb.bill_origin !== "internal" && !skipped.some((s) => s.id === id)) {
        skipped.push({ id, reference: sb.reference, reason: "No partner linked" });
      }
    }
  } else {
    for (const id of selfBillIds) {
      const sb = sbById.get(id);
      if (!sb) {
        skipped.push({ id, reason: "Not found" });
        continue;
      }
      const before = sentIds.length;
      await sendSingleSelfBill(ctx, id, sb, sentIds, skipped);
      if (sentIds.length > before) emailsSent += 1;
    }
  }

  return NextResponse.json({
    sent: sentIds.length,
    emailsSent,
    sentIds,
    skipped,
  });
}
