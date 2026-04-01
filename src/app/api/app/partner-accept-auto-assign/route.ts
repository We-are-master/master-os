import { NextRequest, NextResponse } from "next/server";
import { getUserFromBearer } from "@/lib/supabase/bearer-auth";
import { createServiceClient } from "@/lib/supabase/service";
import { isValidUUID } from "@/lib/auth-api";
import type { Job, Partner } from "@/types/database";
import {
  buildAutoAssignAcceptPatch,
  fetchActivePartners,
  filterPartnersMatchingJobTitle,
  jobTitleForAutoAssignMatch,
} from "@/lib/job-auto-assign";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

async function sendExpoPush(
  tokens: string[],
  title: string,
  body: string,
  data: Record<string, unknown>
): Promise<void> {
  if (!tokens.length) return;
  const messages = tokens.map((to) => ({ to, title, body, data, sound: "default" }));
  await fetch(EXPO_PUSH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(messages),
  }).catch(() => {});
}

type PartnerTokenRow = {
  id: string;
  auth_user_id: string | null;
  expo_push_token: string | null;
};

async function resolveTokens(
  admin: ReturnType<typeof createServiceClient>,
  rows: PartnerTokenRow[]
): Promise<string[]> {
  const byPartner = (rows ?? [])
    .map((r) => r.expo_push_token)
    .filter((t): t is string => !!t);
  const missingAuthUserIds = (rows ?? [])
    .filter((r) => !r.expo_push_token && !!r.auth_user_id)
    .map((r) => r.auth_user_id!) as string[];
  if (missingAuthUserIds.length === 0) return [...new Set(byPartner)];

  const { data: users } = await admin
    .from("users")
    .select("id, fcmToken")
    .in("id", missingAuthUserIds)
    .not("fcmToken", "is", null);
  const fromUsers = (users ?? [])
    .map((u: { fcmToken: string | null }) => u.fcmToken)
    .filter((t): t is string => !!t);
  return [...new Set([...byPartner, ...fromUsers])];
}

/**
 * Partner app: first to accept wins while the job is `auto_assigning` and before expiry.
 */
export async function POST(req: NextRequest) {
  const auth = await getUserFromBearer(req);
  if (!auth.user) {
    return NextResponse.json({ error: "Unauthorized", message: auth.message }, { status: 401 });
  }

  let body: { jobId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const jobId = body.jobId;
  if (!jobId || !isValidUUID(jobId)) {
    return NextResponse.json({ error: "jobId is required" }, { status: 400 });
  }

  const admin = createServiceClient();

  const { data: partner, error: pErr } = await admin
    .from("partners")
    .select("*")
    .eq("auth_user_id", auth.user.id)
    .eq("status", "active")
    .maybeSingle();

  if (pErr || !partner) {
    return NextResponse.json({ error: "Active partner profile not found" }, { status: 403 });
  }

  const me = partner as Partner;

  const { data: job, error: jobErr } = await admin.from("jobs").select("*").eq("id", jobId).single();
  if (jobErr || !job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const j = job as Job;
  const titleKey = jobTitleForAutoAssignMatch(j);
  const allPartners = await fetchActivePartners(admin);
  const matching = filterPartnersMatchingJobTitle(allPartners, titleKey);
  const allowed = matching.some((p) => p.id === me.id);
  if (!allowed) {
    return NextResponse.json({ error: "This job does not match your trades" }, { status: 403 });
  }

  if (j.status !== "auto_assigning") {
    return NextResponse.json({ error: "This job is no longer open for auto-assign" }, { status: 409 });
  }

  if (j.partner_id) {
    return NextResponse.json({ error: "This job is already assigned" }, { status: 409 });
  }

  if (!j.auto_assign_expires_at) {
    return NextResponse.json({ error: "This offer is not active" }, { status: 409 });
  }

  const exp = new Date(j.auto_assign_expires_at).getTime();
  if (!Number.isFinite(exp) || exp <= Date.now()) {
    return NextResponse.json({ error: "The offer window has expired" }, { status: 409 });
  }

  const patch = buildAutoAssignAcceptPatch(me);
  const nowIso = new Date().toISOString();
  const { data: updated, error: upErr } = await admin
    .from("jobs")
    .update(patch as Record<string, unknown>)
    .eq("id", jobId)
    .eq("status", "auto_assigning")
    .is("partner_id", null)
    .gt("auto_assign_expires_at", nowIso)
    .select("id, reference, title, property_address, auto_assign_invited_partner_ids")
    .maybeSingle();

  if (upErr) {
    console.error("[partner-accept-auto-assign]", upErr);
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  if (!updated) {
    return NextResponse.json({ error: "Someone else accepted this job first" }, { status: 409 });
  }

  const invited = (j.auto_assign_invited_partner_ids ?? []) as string[] | null;
  const others = (invited ?? []).filter((id) => id !== me.id);

  if (others.length > 0) {
    const { data: partnerRows } = await admin
      .from("partners")
      .select("id, auth_user_id, expo_push_token")
      .in("id", others)
      .eq("status", "active");
    const tokens = await resolveTokens(admin, (partnerRows ?? []) as PartnerTokenRow[]);
    const head = [j.reference, j.title].filter(Boolean).join(" · ") || "Job";
    await sendExpoPush(tokens, "Job taken", `${head} was assigned to another partner.`, {
      type: "job_auto_assign_taken",
      jobId: j.id,
    });
  }

  return NextResponse.json({
    ok: true,
    jobId: updated.id,
    reference: updated.reference,
  });
}
