import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isValidUUID } from "@/lib/auth-api";
import { getSupabase } from "@/services/base";
import { previewWorkforceCommission } from "@/services/workforce-commission";

export const dynamic = "force-dynamic";

/** GET /api/admin/workforce/[id]/commission-preview */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { id } = await ctx.params;
  if (!isValidUUID(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("payroll_internal_costs")
    .select("profile_id, commission_enabled, commission_rate_percent, commission_basis, pay_frequency, amount")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const preview = await previewWorkforceCommission(data);
  const fixedPay = Number(data.amount) || 0;
  return NextResponse.json({
    fixedPay,
    commission: preview,
    estimatedNet: fixedPay + (preview?.commissionAmount ?? 0),
    jobCount: preview?.jobs.length ?? 0,
  });
}
