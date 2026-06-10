import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAuth } from "@/lib/auth-api";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { createServiceClient, isServiceRoleConfigured } from "@/lib/supabase/service";
import {
  syncAllActiveWorkforceSelfBills,
  syncWorkforceSelfBillsForBounds,
  type WorkforceSelfBillSyncBounds,
} from "@/services/workforce-self-bills";

export const dynamic = "force-dynamic";

function parseYmd(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const ymd = raw.trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? ymd : null;
}

async function workforceSyncSupabase(): Promise<SupabaseClient> {
  if (isServiceRoleConfigured()) return createServiceClient();
  return createServerSupabase();
}

function syncErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "object" && e !== null && "message" in e) {
    const msg = (e as { message?: unknown }).message;
    if (typeof msg === "string" && msg.trim()) return msg;
  }
  return "Workforce self-bill sync failed";
}

/** POST /api/workforce/sync-self-bills — ensure workforce self-bills for monthly period(s). */
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  let anchor = new Date();
  let personId: string | undefined;
  let bounds: WorkforceSelfBillSyncBounds | null = null;

  try {
    const body = await req.json();
    if (body?.anchorDate && typeof body.anchorDate === "string") {
      const d = new Date(body.anchorDate);
      if (!Number.isNaN(d.getTime())) anchor = d;
    }
    if (body?.personId && typeof body.personId === "string") {
      personId = body.personId.trim();
    }
    const from = parseYmd(body?.from);
    const to = parseYmd(body?.to);
    if (from && to) bounds = { from, to };
  } catch {
    /* default today */
  }

  const supabase = await workforceSyncSupabase();

  try {
    const { purgeStaleWorkforceSelfBillDrafts, ensureWorkforceSelfBillForPeriod } = await import(
      "@/services/workforce-self-bills"
    );
    const purged = await purgeStaleWorkforceSelfBillDrafts(anchor, supabase);

    if (personId) {
      const bill = await ensureWorkforceSelfBillForPeriod(personId, anchor, supabase);
      return NextResponse.json({
        ok: true,
        count: bill ? 1 : 0,
        ids: bill ? [bill.id] : [],
        purged: purged.deleted,
      });
    }

    const bills = bounds
      ? await syncWorkforceSelfBillsForBounds(bounds, anchor, supabase)
      : await syncAllActiveWorkforceSelfBills(anchor, supabase);

    return NextResponse.json({
      ok: true,
      count: bills.length,
      ids: bills.map((b) => b.id),
      purged: purged.deleted,
    });
  } catch (e) {
    console.error("workforce sync-self-bills:", e);
    return NextResponse.json(
      { ok: false, error: syncErrorMessage(e) },
      { status: 500 },
    );
  }
}
