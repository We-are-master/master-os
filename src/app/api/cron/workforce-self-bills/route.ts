import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { syncAllActiveWorkforceSelfBills } from "@/services/workforce-self-bills";

function secretsMatch(provided: string | null | undefined, expected: string | null | undefined): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Daily cron — sync workforce self-bills; month-end cutoff auto-promotes to ready_to_pay (pay day 5). */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
  const expected = process.env.CRON_SECRET?.trim();
  if (!secretsMatch(bearer, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const admin = createServiceClient();
    const bills = await syncAllActiveWorkforceSelfBills(new Date(), admin);
    return NextResponse.json({ ok: true, count: bills.length, ids: bills.map((b) => b.id) });
  } catch (e) {
    console.error("workforce-self-bills cron:", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "sync failed" },
      { status: 500 },
    );
  }
}
