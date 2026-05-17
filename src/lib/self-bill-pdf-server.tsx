import { renderToBuffer } from "@react-pdf/renderer";
import React from "react";
import { SelfBillPDF } from "@/lib/pdf/self-bill-template";
import { SELF_BILL_FINANCE_VOID_LABEL } from "@/lib/self-bill-display";
import { partnerFieldSelfBillPaymentDueDate } from "@/lib/self-bill-period";
import { isSupabaseMissingColumnError } from "@/lib/supabase-schema-compat";
import { isSelfBillPayoutVoided, selfBillJobPayoutStateLabel } from "@/services/self-bills";
import type { Job, SelfBill } from "@/types/database";
import type { SupabaseClient } from "@supabase/supabase-js";

export async function renderSelfBillPdfBuffer(
  supabase: SupabaseClient,
  selfBillId: string,
): Promise<{ buffer: Buffer; sb: SelfBill } | { error: string; status: number }> {
  const { data: sbRow, error } = await supabase.from("self_bills").select("*").eq("id", selfBillId).single();
  if (error || !sbRow) {
    return { error: "Self-bill not found", status: 404 };
  }
  const sb = sbRow as SelfBill;

  const jobsFull = await supabase
    .from("jobs")
    .select("id, reference, title, partner_cost, materials_cost, property_address, status, deleted_at, partner_cancelled_at")
    .eq("self_bill_id", selfBillId)
    .order("reference", { ascending: true });
  let jobs: Record<string, unknown>[] | null = (jobsFull.data ?? null) as Record<string, unknown>[] | null;
  let jobsErr = jobsFull.error;
  if (jobsErr && isSupabaseMissingColumnError(jobsErr)) {
    const jobsLegacy = await supabase
      .from("jobs")
      .select("id, reference, title, partner_cost, materials_cost, property_address, status, deleted_at")
      .eq("self_bill_id", selfBillId)
      .order("reference", { ascending: true });
    jobs = (jobsLegacy.data ?? null) as Record<string, unknown>[] | null;
    jobsErr = jobsLegacy.error;
  }
  if (jobsErr) {
    return { error: "Could not load jobs for self-bill", status: 500 };
  }

  const lines = (jobs ?? []).map((j: Record<string, unknown>) => {
    const row = j as Pick<
      Job,
      | "id"
      | "reference"
      | "title"
      | "partner_cost"
      | "materials_cost"
      | "property_address"
      | "status"
      | "deleted_at"
      | "partner_cancelled_at"
    >;
    const note = selfBillJobPayoutStateLabel(row);
    return {
      reference: String(j.reference ?? ""),
      title: String(j.title ?? ""),
      partner_cost: Number(j.partner_cost) || 0,
      materials_cost: Number(j.materials_cost) || 0,
      property_address: j.property_address ? String(j.property_address) : undefined,
      jobId: row.id ? String(row.id) : undefined,
      payoutStateNote: note ?? undefined,
    };
  });

  const voided = isSelfBillPayoutVoided({ status: sb.status });
  const billOrigin = sb.bill_origin;
  const weekEndStr = sb.week_end ?? "";
  const paymentDueDate =
    billOrigin !== "internal" && weekEndStr.trim()
      ? partnerFieldSelfBillPaymentDueDate(weekEndStr.trim())
      : undefined;

  const buffer = await renderToBuffer(
    <SelfBillPDF
      data={{
        reference: sb.reference,
        partnerName: sb.partner_name,
        weekLabel: sb.week_label ?? undefined,
        weekStart: sb.week_start ?? undefined,
        weekEnd: weekEndStr || undefined,
        paymentDueDate,
        period: sb.period,
        jobsCount: Number(sb.jobs_count) || 0,
        jobValue: Number(sb.job_value) || 0,
        materials: Number(sb.materials) || 0,
        commission: Number(sb.commission) || 0,
        netPayout: Number(sb.net_payout) || 0,
        status: String(sb.status),
        lines,
        originalNetPayout: sb.original_net_payout ?? null,
        payoutVoidReason: sb.payout_void_reason ?? null,
        partnerStatusLabel: sb.partner_status_label ?? null,
        financeStatusLabel: voided ? SELF_BILL_FINANCE_VOID_LABEL : null,
        payoutVoided: voided,
      }}
    />,
  );

  return { buffer: Buffer.from(buffer), sb };
}
