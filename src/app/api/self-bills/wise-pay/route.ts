import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isValidUUID } from "@/lib/auth-api";
import { createServiceClient } from "@/lib/supabase/service";
import { createClient } from "@/lib/supabase/server";
import {
  readWiseConfig,
  createGbpRecipient,
  createGbpQuote,
  createTransfer,
  fundTransfer,
} from "@/lib/wise-business";
import {
  nextOpenSelfBillInstallment,
  selfBillIsInstallmentDueForWisePay,
  selfBillWisePayAmount,
} from "@/lib/self-bill-payment-plan";
import { isSelfBillPayoutVoided } from "@/services/self-bills";
import {
  applySelfBillWiseInstallmentPayment,
  listInstallmentsForSelfBillIds,
} from "@/services/self-bill-payment-plan";
import type { SelfBill, Partner } from "@/types/database";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/self-bills/wise-pay
 *
 * Mints a Wise Business transfer for a self-bill — full payout (`scope=full`)
 * or a single job inside it (`scope=job`, requires `jobId`). The endpoint:
 *
 *   1. Loads the self-bill + linked partner.
 *   2. Ensures the partner has a `wise_recipient_id` (creates one from the
 *      stored bank_sort_code + bank_account_number on first pay).
 *   3. Quotes GBP→GBP for the payout amount.
 *   4. Creates the transfer (Wise reference = self-bill ref).
 *   5. Funds it from the Wise GBP balance.
 *   6. Stamps `wise_transfer_id` + `wise_status` + `wise_paid_at` (when scope=full
 *      and Wise reports success) and audit-logs the action.
 *
 * For `scope=job` we currently only record the transfer id on the parent self-bill
 * — fine-grained per-job tracking lands in a follow-up migration on `job_payments`.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  let body: { selfBillId?: unknown; scope?: unknown; jobId?: unknown; jobAmount?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const selfBillId = typeof body.selfBillId === "string" && isValidUUID(body.selfBillId.trim())
    ? body.selfBillId.trim()
    : null;
  if (!selfBillId) {
    return NextResponse.json({ error: "Valid selfBillId required" }, { status: 400 });
  }
  const scope = body.scope === "job" ? "job" : "full";
  const jobId = typeof body.jobId === "string" && isValidUUID(body.jobId.trim()) ? body.jobId.trim() : null;
  if (scope === "job" && !jobId) {
    return NextResponse.json({ error: "jobId required for scope=job" }, { status: 400 });
  }

  const cfg = readWiseConfig();
  if ("error" in cfg) {
    return NextResponse.json({ error: cfg.error }, { status: 503 });
  }

  const admin = createServiceClient();

  const { data: sbRow } = await admin.from("self_bills").select("*").eq("id", selfBillId).maybeSingle();
  if (!sbRow) return NextResponse.json({ error: "Self-bill not found" }, { status: 404 });
  const sb = sbRow as SelfBill;
  if (isSelfBillPayoutVoided(sb)) {
    return NextResponse.json({ error: "Self-bill is void or cancelled" }, { status: 400 });
  }
  if (!sb.partner_id?.trim()) {
    return NextResponse.json({ error: "No partner linked" }, { status: 400 });
  }
  if (!sb.email_sent_at) {
    return NextResponse.json({ error: "Send the self-bill before paying" }, { status: 400 });
  }
  if (!sb.approved_at) {
    return NextResponse.json({ error: "Self-bill not approved" }, { status: 400 });
  }

  const { data: partnerRow } = await admin
    .from("partners")
    .select("*")
    .eq("id", sb.partner_id)
    .maybeSingle();
  if (!partnerRow) {
    return NextResponse.json({ error: "Partner not found" }, { status: 404 });
  }
  const partner = partnerRow as Partner;

  const installmentMap =
    sb.payment_plan_active && scope === "full"
      ? await listInstallmentsForSelfBillIds([sb.id], admin)
      : {};
  const installments = installmentMap[sb.id] ?? [];
  const nextInstallment =
    scope === "full" && sb.payment_plan_active
      ? nextOpenSelfBillInstallment(installments)
      : null;

  if (scope === "full" && sb.payment_plan_active && nextInstallment) {
    const todayYmd = new Date().toISOString().slice(0, 10);
    if (!selfBillIsInstallmentDueForWisePay(sb, installments, todayYmd)) {
      const dueFmt = nextInstallment.due_date?.slice(0, 10) ?? "";
      return NextResponse.json(
        { error: `Next installment is not due until ${dueFmt}` },
        { status: 400 },
      );
    }
  }

  // Compute payout amount (pence not used — Wise accepts decimal targetAmount in GBP).
  let amount: number;
  let installmentId: string | null = null;
  if (scope === "full") {
    const fallback = Number(sb.net_payout ?? 0);
    amount = selfBillWisePayAmount(sb, installments, fallback);
    installmentId = nextInstallment?.id ?? null;
  } else {
    const ja = Number(body.jobAmount);
    if (!Number.isFinite(ja) || ja <= 0) {
      return NextResponse.json({ error: "jobAmount must be > 0 for scope=job" }, { status: 400 });
    }
    amount = ja;
  }
  if (amount <= 0) {
    return NextResponse.json({ error: "Payout amount must be > 0" }, { status: 400 });
  }

  // Ensure recipient.
  let wiseRecipientId = partner.wise_recipient_id?.trim() || null;
  if (!wiseRecipientId) {
    const holder = partner.bank_account_holder?.trim() || partner.company_name?.trim();
    if (!holder) return NextResponse.json({ error: "Partner missing bank_account_holder" }, { status: 400 });
    if (!partner.bank_sort_code?.trim()) return NextResponse.json({ error: "Partner missing bank_sort_code" }, { status: 400 });
    if (!partner.bank_account_number?.trim()) return NextResponse.json({ error: "Partner missing bank_account_number" }, { status: 400 });

    const created = await createGbpRecipient(cfg, {
      accountHolderName: holder,
      sortCode: partner.bank_sort_code,
      accountNumber: partner.bank_account_number,
    });
    if (!created.ok) {
      return NextResponse.json({ error: `Wise recipient creation failed: ${created.error}` }, { status: 502 });
    }
    wiseRecipientId = String(created.data.id);
    await admin.from("partners").update({ wise_recipient_id: wiseRecipientId }).eq("id", partner.id);
  }

  const quote = await createGbpQuote(cfg, amount);
  if (!quote.ok) {
    return NextResponse.json({ error: `Wise quote failed: ${quote.error}` }, { status: 502 });
  }

  const reference = (sb.reference ?? "self-bill").slice(0, 18);
  const transfer = await createTransfer(cfg, {
    targetAccount: Number(wiseRecipientId),
    quoteUuid: quote.data.id,
    reference,
    customerTransactionId: `${sb.id}-${scope}-${jobId ?? "full"}`,
  });
  if (!transfer.ok) {
    return NextResponse.json({ error: `Wise transfer creation failed: ${transfer.error}` }, { status: 502 });
  }

  const fund = await fundTransfer(cfg, transfer.data.id);
  const funded = fund.ok;
  const wiseStatus = funded ? (fund.data?.status ?? "funded") : transfer.data.status;

  const stamp = new Date().toISOString();
  const wiseTransferId = String(transfer.data.id);

  if (scope === "full" && installmentId) {
    await applySelfBillWiseInstallmentPayment(
      sb.id,
      installmentId,
      { wiseTransferId, wiseStatus, funded },
      admin,
    );
  } else {
    const update: Record<string, unknown> = {
      wise_transfer_id: wiseTransferId,
      wise_status: wiseStatus,
    };
    if (funded && scope === "full") {
      update.wise_paid_at = stamp;
      update.paid_at = stamp;
      update.status = "paid";
    }
    await admin.from("self_bills").update(update).eq("id", sb.id);
  }

  // Resolve user_name for audit.
  const profileClient = await createClient();
  const { data: profile } = await profileClient
    .from("profiles")
    .select("full_name")
    .eq("id", auth.user.id)
    .maybeSingle();
  const userName = profile?.full_name?.trim() || auth.user.email || "User";

  void admin.from("audit_logs").insert({
    entity_type: "self_bill",
    entity_id: sb.id,
    entity_ref: sb.reference,
    action: "paid",
    field_name: "wise_transfer",
    new_value: String(transfer.data.id),
    user_id: auth.user.id,
    user_name: userName,
    metadata: {
      wise_transfer_id: String(transfer.data.id),
      wise_status: wiseStatus,
      amount,
      scope,
      jobId,
      installmentId,
      funded,
      ...(fund.ok ? {} : { fund_error: fund.error }),
    },
  });

  return NextResponse.json({
    ok: true,
    wise_transfer_id: String(transfer.data.id),
    wise_status: wiseStatus,
    funded,
    fund_error: fund.ok ? null : fund.error,
  });
}
