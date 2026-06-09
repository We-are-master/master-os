import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-api";
import { syncAllActiveWorkforceSelfBills } from "@/services/workforce-self-bills";

export const dynamic = "force-dynamic";

/** POST /api/workforce/sync-self-bills — ensure workforce self-bills for the current monthly period. */
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  let anchor = new Date();
  let personId: string | undefined;
  try {
    const body = await req.json();
    if (body?.anchorDate && typeof body.anchorDate === "string") {
      const d = new Date(body.anchorDate);
      if (!Number.isNaN(d.getTime())) anchor = d;
    }
    if (body?.personId && typeof body.personId === "string") {
      personId = body.personId.trim();
    }
  } catch {
    /* default today */
  }

  if (personId) {
    const { ensureWorkforceSelfBillForPeriod } = await import("@/services/workforce-self-bills");
    const bill = await ensureWorkforceSelfBillForPeriod(personId, anchor);
    return NextResponse.json({ ok: true, count: bill ? 1 : 0, ids: bill ? [bill.id] : [] });
  }

  const bills = await syncAllActiveWorkforceSelfBills(anchor);
  return NextResponse.json({ ok: true, count: bills.length, ids: bills.map((b) => b.id) });
}
