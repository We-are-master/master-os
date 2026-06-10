import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isValidUUID } from "@/lib/auth-api";
import { closeWorkforceMonthlyPeriod } from "@/services/workforce-self-bills";

export const dynamic = "force-dynamic";

/** POST /api/workforce/close-pay-period — month-end close: workforce self-bills → ready_to_pay (due day 5). */
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  let anchor = new Date();
  try {
    const body = await req.json();
    if (body?.anchorDate && typeof body.anchorDate === "string") {
      const d = new Date(body.anchorDate);
      if (!Number.isNaN(d.getTime())) anchor = d;
    }
  } catch {
    /* default today */
  }

  const bills = await closeWorkforceMonthlyPeriod(anchor);
  return NextResponse.json({ ok: true, count: bills.length, ids: bills.map((b) => b.id) });
}
