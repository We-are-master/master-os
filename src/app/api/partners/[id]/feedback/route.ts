import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isValidUUID } from "@/lib/auth-api";
import { createServiceClient } from "@/lib/supabase/service";
import {
  addManualPartnerKudos,
  listPartnerFeedbackEvents,
} from "@/services/partner-rating";
import { partnerRatingBreakdown } from "@/lib/partner-rating";

const STAFF_ROLES = new Set(["admin", "manager", "operator"]);

async function requireStaffPartnerAccess(partnerId: string) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { createClient: createServerSupabase } = await import("@/lib/supabase/server");
  const serverSupabase = await createServerSupabase();
  const { data: profile } = await serverSupabase
    .from("profiles")
    .select("role")
    .eq("id", auth.user.id)
    .maybeSingle();

  const role = (profile as { role?: string } | null)?.role ?? "";
  if (!STAFF_ROLES.has(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!partnerId || !isValidUUID(partnerId)) {
    return NextResponse.json({ error: "Invalid partner id" }, { status: 400 });
  }

  return { auth, supabase: createServiceClient() };
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: partnerId } = await ctx.params;
  const gate = await requireStaffPartnerAccess(partnerId);
  if (gate instanceof NextResponse) return gate;

  try {
    const { events, rows } = await listPartnerFeedbackEvents(partnerId, gate.supabase);
    const breakdown = partnerRatingBreakdown(events);
    return NextResponse.json({
      ok: true,
      rating: breakdown.rating,
      complaintCount: breakdown.complaintCount,
      pointsLost: breakdown.pointsLost,
      praiseCount: breakdown.praiseCount,
      pointsGained: breakdown.pointsGained,
      feedback: rows,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to load feedback";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: partnerId } = await ctx.params;
  const gate = await requireStaffPartnerAccess(partnerId);
  if (gate instanceof NextResponse) return gate;

  let body: { notes?: unknown; jobId?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const notes = typeof body.notes === "string" ? body.notes : undefined;
  const jobId = typeof body.jobId === "string" ? body.jobId : undefined;

  try {
    const meta = await addManualPartnerKudos(
      partnerId,
      {
        notes,
        jobId,
        createdByUserId: gate.auth.user.id,
      },
      gate.supabase,
    );

    void gate.supabase
      .from("audit_logs")
      .insert({
        entity_type: "partner",
        entity_id: partnerId,
        action: "partner_kudos_added",
        metadata: { job_id: jobId ?? null, notes: notes?.trim().slice(0, 500) ?? null },
      })
      .then(({ error }) => {
        if (error) console.error("audit_logs partner_kudos_added", error);
      });

    return NextResponse.json({ ok: true, ...meta });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to add kudos";
    const status = message.includes("already recorded") ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
