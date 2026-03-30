import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import React from "react";
import { SelfBillPDF } from "@/lib/pdf/self-bill-template";
import { requireAuth, isValidUUID } from "@/lib/auth-api";
import { createServiceClient } from "@/lib/supabase/service";

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

  const { data: jobs } = await supabase
    .from("jobs")
    .select("reference, title, partner_cost, materials_cost, property_address")
    .eq("self_bill_id", id)
    .order("reference", { ascending: true });

  const lines = (jobs ?? []).map((j: Record<string, unknown>) => ({
    reference: String(j.reference ?? ""),
    title: String(j.title ?? ""),
    partner_cost: Number(j.partner_cost) || 0,
    materials_cost: Number(j.materials_cost) || 0,
    property_address: j.property_address ? String(j.property_address) : undefined,
  }));

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
