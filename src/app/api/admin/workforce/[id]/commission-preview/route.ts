import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isValidUUID } from "@/lib/auth-api";
import { getSupabase } from "@/services/base";
import { previewWorkforceCommission } from "@/services/workforce-commission";
import type { WorkforceCommissionBasis } from "@/types/database";

export const dynamic = "force-dynamic";

/** GET /api/admin/workforce/[id]/commission-preview — optional ?enabled=1&rate=10&basis=revenue&fixedPay=3000 for unsaved UI preview */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
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

  const sp = req.nextUrl.searchParams;
  const enabledOverride = sp.get("enabled");
  const rateOverride = sp.get("rate");
  const basisOverride = sp.get("basis");
  const fixedOverride = sp.get("fixedPay");

  const person = {
    ...data,
    commission_enabled:
      enabledOverride === "1" ? true : enabledOverride === "0" ? false : Boolean(data.commission_enabled),
    commission_rate_percent:
      rateOverride != null && rateOverride.trim() !== ""
        ? Number(rateOverride)
        : data.commission_rate_percent,
    commission_basis:
      basisOverride === "revenue" || basisOverride === "gross_profit"
        ? (basisOverride as WorkforceCommissionBasis)
        : data.commission_basis,
  };

  const fixedPay =
    fixedOverride != null && fixedOverride.trim() !== "" ? Number(fixedOverride) : Number(data.amount) || 0;

  const preview = await previewWorkforceCommission(person);
  return NextResponse.json({
    fixedPay,
    commission: preview,
    estimatedNet: fixedPay + (preview?.commissionAmount ?? 0),
    jobCount: preview?.jobs.length ?? 0,
    commissionRatePercent: person.commission_rate_percent,
    commissionBasis: person.commission_basis,
  });
}
