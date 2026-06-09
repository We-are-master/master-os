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

function escapeHtmlSimple(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Branded HTML body for the partner self-bill email — Fixfy navy header,
 * white card, summary table and footer. Replaces the earlier minimal body so
 * the partner sees the period, amount, payment date and jobs count at a
 * glance. The actual PDF is attached separately by Resend.
 */
function buildSelfBillEmailHtml(
  sb: SelfBill,
  dueYmd: string | null,
  args: { partnerName?: string | null; companyName?: string | null },
): string {
  const week = sb.week_label ?? sb.period ?? "—";
  const amount = formatCurrency(Number(sb.net_payout ?? 0));
  const firstName = (args.partnerName?.trim() || "").split(/\s+/)[0] || "there";
  const periodLine =
    sb.week_start && sb.week_end
      ? `${new Date(sb.week_start).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} – ${new Date(
          sb.week_end,
        ).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`
      : week;
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
