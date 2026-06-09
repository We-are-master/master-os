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

type Skipped = { id: string; reference?: string; reason: string };

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function fmtSbDate(ymd?: string | null): string {
  const raw = ymd?.trim();
  if (!raw) return "—";
  const d = new Date(raw.length === 10 ? `${raw}T12:00:00` : raw);
  if (Number.isNaN(d.getTime())) return raw.slice(0, 10);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** Branded "Self-Bill Issued" partner email — mirrors the Fixfy statement
 *  design (navy header, orange accent, reference bar, summary, HMRC notice).
 *  The full job-by-job breakdown rides along as the attached PDF. */
function buildSelfBillEmailHtml(
  sb: SelfBill,
  dueYmd: string | null,
  args?: { partnerName?: string | null; companyName?: string | null },
): string {
  const firstName = esc((args?.partnerName?.trim() || sb.partner_name || "").split(/\s+/)[0] || "there");
  const ref = esc(sb.reference || "");
  const periodStart = sb.week_start ? fmtSbDate(sb.week_start) : null;
  const periodEnd = sb.week_end ? fmtSbDate(sb.week_end) : null;
  const periodText = periodStart && periodEnd ? `${periodStart} — ${periodEnd}` : esc(sb.week_label ?? sb.period ?? "—");
  const issueDate = fmtSbDate(sb.created_at);
  const payout = formatCurrency(Number(sb.net_payout ?? 0));
  const labour = formatCurrency(Number(sb.job_value ?? 0));
  const materials = formatCurrency(Number(sb.materials ?? 0));
  const commission = Number(sb.commission ?? 0);
  const jobsCount = Number(sb.jobs_count ?? 0);
  const paidAt = sb.paid_at?.trim() ? fmtSbDate(sb.paid_at) : null;

  // Banner adapts to whether the payout has actually been sent yet.
  const banner = paidAt
    ? `<tr><td bgcolor="#DCFCE7" style="background:#DCFCE7; padding:18px 40px; border-bottom:3px solid #22C55E;">
         <p style="margin:0; font-size:11px; font-weight:700; letter-spacing:2px; color:#166534; text-transform:uppercase;">PAYOUT SENT</p>
         <p style="margin:2px 0 0 0; font-size:14px; color:#166534;">${payout} transferred on ${paidAt}</p>
       </td></tr>`
    : `<tr><td bgcolor="#F2F0FA" style="background:#F2F0FA; padding:18px 40px; border-bottom:3px solid #020040;">
         <p style="margin:0; font-size:11px; font-weight:700; letter-spacing:2px; color:#020040; text-transform:uppercase;">PAYOUT SCHEDULED</p>
         <p style="margin:2px 0 0 0; font-size:14px; color:#020040;">${payout}${dueYmd ? ` · payment due ${fmtSbDate(dueYmd)}` : ""}</p>
       </td></tr>`;

  const commissionRow = commission > 0.01
    ? `<tr><td style="padding:14px 20px; border-bottom:1px solid #F2F0FA;">
         <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
           <td style="font-size:14px; color:#1A1A1A;">Commission</td>
           <td align="right" style="font-size:14px; color:#020040; font-weight:600;">-${formatCurrency(commission)}</td>
         </tr></table></td></tr>`
    : "";

  const dueRow = dueYmd
    ? `<tr><td valign="middle" style="padding-top:6px; font-size:11px; font-weight:700; letter-spacing:1.5px; color:#9A9AA8; text-transform:uppercase;">Payment due</td>
         <td valign="middle" align="right" style="padding-top:6px; font-size:13px; color:#020040; font-weight:700;">${fmtSbDate(dueYmd)}</td></tr>`
    : "";

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light only"></head>
<body style="margin:0; padding:0; background:#F5F5F7; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="display:none; max-height:0; overflow:hidden; font-size:1px; line-height:1px; color:#F5F5F7;">Self-bill issued — ${payout} for jobs completed this period. PDF attached.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F5F5F7;"><tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px; max-width:600px; background:#FFFFFF; border-radius:12px; overflow:hidden; box-shadow:0 4px 20px rgba(2,0,64,0.06);">

      <tr><td align="center" bgcolor="#020040" style="background:#020040; padding:24px;">
        <img src="https://www.getfixfy.com/brand/fixfy-primary-white.png" alt="Fixfy" width="100" height="auto" style="display:block; width:100px; height:auto;">
      </td></tr>
      <tr><td style="background:#ED4B00; line-height:5px; font-size:5px; height:5px;" height="5">&nbsp;</td></tr>

      ${banner}

      <tr><td style="padding:32px 40px 8px 40px;">
        <p style="margin:0; font-size:11px; font-weight:700; letter-spacing:3px; color:#ED4B00; text-transform:uppercase;">SELF-BILL ISSUED</p>
      </td></tr>
      <tr><td style="padding:0 40px 8px 40px;">
        <h1 style="margin:0; font-size:26px; line-height:32px; font-weight:700; color:#020040;">Hi ${firstName},</h1>
      </td></tr>
      <tr><td style="padding:0 40px 28px 40px;">
        <p style="margin:0; font-size:15px; line-height:24px; color:#4A4A55;">Your self-bill for the period is now available. No action required — this email is for your records, and the full job-by-job breakdown is attached as a PDF.</p>
      </td></tr>

      <tr><td style="padding:0 40px 24px 40px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F2F0FA; border-radius:8px;"><tr><td style="padding:14px 18px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr><td valign="middle" style="font-size:11px; font-weight:700; letter-spacing:1.5px; color:#9A9AA8; text-transform:uppercase;">Self-bill Ref</td>
                <td valign="middle" align="right" style="font-size:14px; font-weight:700; color:#020040;">${ref}</td></tr>
            <tr><td valign="middle" style="padding-top:6px; font-size:11px; font-weight:700; letter-spacing:1.5px; color:#9A9AA8; text-transform:uppercase;">Period</td>
                <td valign="middle" align="right" style="padding-top:6px; font-size:13px; color:#020040;">${periodText}</td></tr>
            <tr><td valign="middle" style="padding-top:6px; font-size:11px; font-weight:700; letter-spacing:1.5px; color:#9A9AA8; text-transform:uppercase;">Issue date</td>
                <td valign="middle" align="right" style="padding-top:6px; font-size:13px; color:#020040;">${issueDate}</td></tr>
            ${dueRow}
          </table>
        </td></tr></table>
      </td></tr>

      <tr><td style="padding:0 40px 8px 40px;">
        <p style="margin:0 0 12px 0; font-size:11px; font-weight:700; letter-spacing:2px; color:#020040; text-transform:uppercase;">SUMMARY</p>
      </td></tr>
      <tr><td style="padding:0 40px 24px 40px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #E8E8EE; border-radius:8px;">
          <tr><td style="padding:14px 20px; border-bottom:1px solid #F2F0FA;"><table role="presentation" width="100%"><tr>
            <td style="font-size:14px; color:#1A1A1A;">Jobs completed</td><td align="right" style="font-size:14px; color:#020040; font-weight:600;">${jobsCount}</td></tr></table></td></tr>
          <tr><td style="padding:14px 20px; border-bottom:1px solid #F2F0FA;"><table role="presentation" width="100%"><tr>
            <td style="font-size:14px; color:#1A1A1A;">Labour</td><td align="right" style="font-size:14px; color:#020040; font-weight:600;">${labour}</td></tr></table></td></tr>
          <tr><td style="padding:14px 20px; border-bottom:1px solid #F2F0FA;"><table role="presentation" width="100%"><tr>
            <td style="font-size:14px; color:#1A1A1A;">Materials reimbursed</td><td align="right" style="font-size:14px; color:#020040; font-weight:600;">${materials}</td></tr></table></td></tr>
          ${commissionRow}
          <tr><td bgcolor="#F2F0FA" style="background:#F2F0FA; padding:16px 20px;"><table role="presentation" width="100%"><tr>
            <td style="font-size:13px; font-weight:700; color:#020040; letter-spacing:1px; text-transform:uppercase;">Total payout</td>
            <td align="right" style="font-size:22px; font-weight:700; color:#020040;">${payout}</td></tr></table></td></tr>
        </table>
      </td></tr>

      <tr><td style="padding:0 40px 28px 40px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F2F0FA; border-radius:6px;"><tr><td style="padding:12px 16px;">
          <p style="margin:0; font-size:13px; line-height:20px; color:#4A4A55;">📎 The full self-bill with job-by-job breakdown is attached as a PDF (<strong style="color:#020040;">${ref}.pdf</strong>) for your accounting records.</p>
        </td></tr></table>
      </td></tr>

      <tr><td style="padding:0 40px 28px 40px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FFF1EA; border-left:4px solid #ED4B00; border-radius:0 6px 6px 0;"><tr><td style="padding:14px 18px;">
          <p style="margin:0 0 4px 0; font-size:10px; font-weight:700; letter-spacing:2px; color:#ED4B00; text-transform:uppercase;">ABOUT SELF-BILLING</p>
          <p style="margin:0; font-size:13px; line-height:19px; color:#020040;">This is a self-billed invoice issued by Getfixfy Ltd on your behalf, as agreed in your Service Agreement. Please do not issue a separate invoice for these jobs.</p>
        </td></tr></table>
      </td></tr>

      <tr><td style="padding:0 40px 32px 40px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F2F0FA; border-radius:8px;"><tr><td style="padding:14px 18px;">
          <p style="margin:0 0 4px 0; font-size:12px; font-weight:700; color:#020040;">Questions about your payout?</p>
          <p style="margin:0; font-size:13px; line-height:20px; color:#4A4A55;">Reply to this email or contact <a href="mailto:support@getfixfy.com" style="color:#020040; font-weight:600; text-decoration:none;">support@getfixfy.com</a> &middot; <a href="tel:+442045384668" style="color:#020040; font-weight:600; text-decoration:none;">020 4538 4668</a></p>
        </td></tr></table>
      </td></tr>

      <tr><td bgcolor="#020040" style="background:#020040; padding:24px 40px; text-align:center;">
        <img src="https://www.getfixfy.com/brand/fixfy-primary-white.png" alt="Fixfy" width="70" height="auto" style="display:inline-block; width:70px; height:auto; margin-bottom:10px;">
        <p style="margin:0; font-size:11px; line-height:18px; color:#AAAAD0;">Getfixfy Ltd &middot; Co. No. 15406523<br>124 City Road, London EC1V 2NX, United Kingdom<br><a href="https://getfixfy.com" style="color:#AAAAD0; text-decoration:none;">getfixfy.com</a></p>
      </td></tr>

    </table>
  </td></tr></table>
</body></html>`;
}

/**
 * Mirror of the partner Resend email, posted as a Zendesk side conversation under the
 * payment-run master ticket so finance has a single thread per partner per cycle.
 * Side conversations don't carry PDF attachments — the partner gets the PDF via Resend;
 * Zendesk just records the activity.
 */
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

function parseCycleHint(raw: unknown): PaymentRunCycleKind | "auto" {
  if (raw === "standard" || raw === "off_cycle" || raw === "auto") return raw;
  return "auto";
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  let body: { selfBillIds?: unknown; paymentRunHint?: unknown };
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

  // Load all self-bills up front so we can group by (week_start, week_end) and
  // resolve a payment run per group BEFORE we start sending — guarantees every
  // partner side-conv lands under the right master ticket.
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

  const resend = new Resend(resendKey);
  const sentIds: string[] = [];
  const skipped: Skipped[] = [];

  for (const id of selfBillIds) {
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
    if (!sb.partner_id?.trim()) {
      skipped.push({ id, reference: sb.reference, reason: "No partner linked" });
      continue;
    }

    const { data: partner } = await supabase
      .from("partners")
      .select("email, name")
      .eq("id", sb.partner_id)
      .maybeSingle();
    const partnerEmail = partner?.email?.trim().toLowerCase();
    const partnerName = partner?.name?.trim() ?? null;
    if (!partnerEmail) {
      skipped.push({ id, reference: sb.reference, reason: "Partner has no email" });
      continue;
    }

    const pdfResult = await renderSelfBillPdfBuffer(supabase, id);
    if ("error" in pdfResult) {
      skipped.push({ id, reference: sb.reference, reason: pdfResult.error });
      continue;
    }

    const weekEndStr = sb.week_end?.trim() ?? "";
    const dueYmd =
      sb.due_date?.trim() ||
      (weekEndStr ? partnerFieldSelfBillPaymentDueDate(weekEndStr) : null);
    const safeName = String(sb.reference ?? "self-bill").replace(/[^\w.-]+/g, "_");

    const ccList = ccEmail && ccEmail.toLowerCase() !== partnerEmail ? [ccEmail] : undefined;

    const { data: emailResult, error: emailError } = await resend.emails.send({
      from: fromEmail,
      to: [partnerEmail],
      cc: ccList,
      subject: `Self-Billing Statement | ${sb.week_label ?? sb.period ?? "weekly"}`,
      html: buildSelfBillEmailHtml(sb, dueYmd, { partnerName, companyName }),
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
        reason: typeof emailError === "object" && emailError && "message" in emailError
          ? String((emailError as { message: unknown }).message)
          : "Email delivery failed",
      });
      continue;
    }

    // Zendesk side conversation — recorded under the master payment-run ticket.
    // On Resend, prefer replyToSideConversation so finance keeps one thread per
    // partner per cycle.
    const groupKey = `${sb.week_start ?? ""}|${sb.week_end ?? ""}`;
    const run = runByGroupKey.get(groupKey) ?? null;
    let sideConvId: string | null = sb.zendesk_side_conversation_id?.trim() || null;

    if (run?.zendesk_ticket_id) {
      const subject = `Self-bill ${sb.reference} — ${partnerName ?? partnerEmail}`;
      const htmlBody = buildSelfBillSideConvHtml(sb, dueYmd, partnerEmail);

      if (sideConvId) {
        const reply = await replyToSideConversation({
          ticketId: run.zendesk_ticket_id,
          sideConversationId: sideConvId,
          htmlBody,
          toEmail: partnerEmail,
          toName: partnerName,
        });
        if (!reply.ok) {
          console.warn("[self-bills send-email] side conv reply failed; opening fresh thread", reply.error);
          const fresh = await createSideConversation({
            ticketId: run.zendesk_ticket_id,
            toEmail: partnerEmail,
            toName: partnerName,
            subject,
            htmlBody,
          });
          if (fresh.ok && fresh.id) sideConvId = String(fresh.id);
        }
      } else {
        const opened = await createSideConversation({
          ticketId: run.zendesk_ticket_id,
          toEmail: partnerEmail,
          toName: partnerName,
          subject,
          htmlBody,
        });
        if (opened.ok && opened.id) {
          sideConvId = String(opened.id);
        } else {
          console.warn("[self-bills send-email] side conv create failed", opened.error);
        }
      }
    }

    const stamp = new Date().toISOString();
    const { error: stampErr } = await supabase
      .from("self_bills")
      .update({
        pdf_generated_at: stamp,
        email_sent_at: stamp,
        payment_run_id: run?.id ?? null,
        zendesk_ticket_id: run?.zendesk_ticket_id ?? null,
        zendesk_ticket_url: run?.zendesk_ticket_url ?? null,
        zendesk_side_conversation_id: sideConvId,
      })
      .eq("id", id);
    if (stampErr) console.warn("[self-bills send-email] state stamp failed", id, stampErr);

    void supabase.from("audit_logs").insert({
      entity_type: "self_bill",
      entity_id: id,
      entity_ref: sb.reference,
      action: "bulk_update",
      field_name: "email_sent",
      new_value: partnerEmail,
      user_id: auth.user.id,
      user_name: userName,
      metadata: {
        email_to: partnerEmail,
        cc: ccList ?? [],
        resend_id: emailResult?.id,
        payment_run_id: run?.id ?? null,
        zendesk_ticket_id: run?.zendesk_ticket_id ?? null,
        zendesk_ticket_url: run?.zendesk_ticket_url ?? null,
        zendesk_side_conversation_id: sideConvId,
        cycle_kind: run?.cycle_kind ?? cycleKind,
      },
    });

    sentIds.push(id);
  }

  return NextResponse.json({
    sent: sentIds.length,
    sentIds,
    skipped,
  });
}
