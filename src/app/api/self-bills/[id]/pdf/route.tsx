import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import React from "react";
import { SelfBillPDF } from "@/lib/pdf/self-bill-template";
import { requireAuth, isValidUUID } from "@/lib/auth-api";
import { createServiceClient } from "@/lib/supabase/service";
import { SELF_BILL_FINANCE_VOID_LABEL } from "@/lib/self-bill-display";
import { isSelfBillPayoutVoided, selfBillJobPayoutStateLabel } from "@/services/self-bills";
import type { Job, SelfBill } from "@/types/database";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { id } = await ctx.params;
  if (!isValidUUID(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data: sb, error } = await supabase.from("self_bills").select("*").eq("id", id).single();
  if (error || !sb) {
    return NextResponse.json({ error: "Self-bill not found" }, { status: 404 });
  }

  const jobsFull = await supabase
    .from("jobs")
    .select("id, reference, title, partner_cost, materials_cost, property_address, status, deleted_at, partner_cancelled_at")
    .eq("self_bill_id", id)
    .order("reference", { ascending: true });
  let jobs: Record<string, unknown>[] | null = (jobsFull.data ?? null) as Record<string, unknown>[] | null;
  let jobsErr = jobsFull.error;
  if (jobsErr) {
    const msg = String((jobsErr as { message?: string }).message ?? "");
    const looksMissingCol =
      (jobsErr as { code?: string }).code === "PGRST204" ||
      msg.includes("Could not find") ||
      msg.includes("schema cache");
    if (looksMissingCol) {
      const jobsLegacy = await supabase
        .from("jobs")
        .select("id, reference, title, partner_cost, materials_cost, property_address, status, deleted_at")
        .eq("self_bill_id", id)
        .order("reference", { ascending: true });
      jobs = (jobsLegacy.data ?? null) as Record<string, unknown>[] | null;
      jobsErr = jobsLegacy.error;
    }
  }
  if (jobsErr) {
    return NextResponse.json({ error: "Could not load jobs for self-bill" }, { status: 500 });
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

  const voided = isSelfBillPayoutVoided({ status: sb.status as SelfBill["status"] });

  const buffer = await renderToBuffer(
    <SelfBillPDF
      data={{
        reference: sb.reference as string,
        partnerName: sb.partner_name as string,
        weekLabel: (sb.week_label as string) ?? undefined,
        weekStart: (sb.week_start as string) ?? undefined,
        weekEnd: (sb.week_end as string) ?? undefined,
        period: sb.period as string,
        jobsCount: Number(sb.jobs_count) || 0,
        jobValue: Number(sb.job_value) || 0,
        materials: Number(sb.materials) || 0,
        commission: Number(sb.commission) || 0,
        netPayout: Number(sb.net_payout) || 0,
        status: String(sb.status),
        lines,
        originalNetPayout: (sb as { original_net_payout?: number | null }).original_net_payout ?? null,
        payoutVoidReason: (sb as { payout_void_reason?: string | null }).payout_void_reason ?? null,
        partnerStatusLabel: (sb as { partner_status_label?: string | null }).partner_status_label ?? null,
        financeStatusLabel: voided ? SELF_BILL_FINANCE_VOID_LABEL : null,
        payoutVoided: voided,
      }}
    />
  );

  const safeName = String(sb.reference ?? "self-bill").replace(/[^\w.-]+/g, "_");
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${safeName}.pdf"`,
    },
  });
}
