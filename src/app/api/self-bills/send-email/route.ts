import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { requireAuth, isValidUUID } from "@/lib/auth-api";
import { createServiceClient } from "@/lib/supabase/service";
import { renderSelfBillPdfBuffer } from "@/lib/self-bill-pdf-server";
import { partnerFieldSelfBillPaymentDueDate } from "@/lib/self-bill-period";
import { formatCurrency } from "@/lib/utils";
import { isSelfBillPayoutVoided } from "@/services/self-bills";
import { createClient } from "@/lib/supabase/server";
import type { SelfBill } from "@/types/database";

type Skipped = { id: string; reference?: string; reason: string };

function buildSelfBillEmailHtml(sb: SelfBill, dueYmd: string | null): string {
  const week = sb.week_label ?? sb.period ?? "—";
  const dueLine = dueYmd ? `<p style="margin:0 0 12px;color:#3A3A55;">Payment due: <strong>${dueYmd}</strong></p>` : "";
  return `<div style="font-family:system-ui,sans-serif;color:#0A0A1F;max-width:560px;">
      <p style="margin:0 0 12px;">Hello,</p>
      <p style="margin:0 0 12px;">Please find your self-bill <strong>${sb.reference}</strong> for week <strong>${week}</strong> attached.</p>
      ${dueLine}
      <p style="margin:0 0 12px;">Amount due: <strong>${formatCurrency(Number(sb.net_payout ?? 0))}</strong></p>
      <p style="margin:0;color:#6B6B85;font-size:13px;">If you have questions, reply to this email.</p>
    </div>`;
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  let body: { selfBillIds?: unknown };
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

  const profileClient = await createClient();
  const { data: profile } = await profileClient
    .from("profiles")
    .select("full_name")
    .eq("id", auth.user.id)
    .maybeSingle();
  const userName = profile?.full_name?.trim() || auth.user.email || "User";

  const resend = new Resend(resendKey);
  const sentIds: string[] = [];
  const skipped: Skipped[] = [];

  for (const id of selfBillIds) {
    const { data: sbRow } = await supabase.from("self_bills").select("*").eq("id", id).maybeSingle();
    if (!sbRow) {
      skipped.push({ id, reason: "Not found" });
      continue;
    }
    const sb = sbRow as SelfBill;
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
      subject: `Self-bill ${sb.reference} — ${sb.week_label ?? sb.period ?? "weekly"}`,
      html: buildSelfBillEmailHtml(sb, dueYmd),
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

    void supabase
      .from("self_bills")
      .update({ pdf_generated_at: new Date().toISOString() })
      .eq("id", id)
      .then(({ error }) => {
        if (error) console.warn("[self-bills send-email] pdf_generated_at update failed", id, error);
      });

    void supabase.from("audit_logs").insert({
      entity_type: "self_bill",
      entity_id: id,
      entity_ref: sb.reference,
      action: "bulk_update",
      field_name: "email_sent",
      new_value: partnerEmail,
      user_id: auth.user.id,
      user_name: userName,
      metadata: { email_to: partnerEmail, cc: ccList ?? [], resend_id: emailResult?.id },
    });

    sentIds.push(id);
  }

  return NextResponse.json({
    sent: sentIds.length,
    sentIds,
    skipped,
  });
}
