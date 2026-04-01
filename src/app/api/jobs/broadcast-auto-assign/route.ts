import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isValidUUID } from "@/lib/auth-api";
import { createServiceClient } from "@/lib/supabase/service";
import type { Job } from "@/types/database";
import {
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
 * Dashboard: after creating a job with status `auto_assigning`, call this to
 * set the expiry window, store invited partner ids, and push to all matching partners.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  let body: { jobId?: string; minutes?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const jobId = body.jobId;
  if (!jobId || !isValidUUID(jobId)) {
    return NextResponse.json({ error: "jobId is required" }, { status: 400 });
  }

  const minutesRaw = body.minutes;
  const minutesOverride =
    typeof minutesRaw === "number" && Number.isFinite(minutesRaw) && minutesRaw >= 1 && minutesRaw <= 240
      ? Math.floor(minutesRaw)
      : null;

  const admin = createServiceClient();

  const { data: job, error: jobErr } = await admin.from("jobs").select("*").eq("id", jobId).single();
  if (jobErr || !job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const j = job as Job;
  if (j.status !== "auto_assigning") {
    return NextResponse.json({ error: "Job is not in auto_assigning status" }, { status: 400 });
  }

  const { data: settings } = await admin.from("company_settings").select("job_auto_assign_offer_minutes").limit(1).maybeSingle();
  const defaultMins =
    settings && typeof (settings as { job_auto_assign_offer_minutes?: number }).job_auto_assign_offer_minutes === "number"
      ? Math.max(1, Math.min(240, Math.floor((settings as { job_auto_assign_offer_minutes: number }).job_auto_assign_offer_minutes)))
      : 5;
  const minutes = minutesOverride ?? defaultMins;

  const expiresAt = new Date(Date.now() + minutes * 60 * 1000).toISOString();

  const allPartners = await fetchActivePartners(admin);
  const titleKey = jobTitleForAutoAssignMatch(j);
  const matching = filterPartnersMatchingJobTitle(allPartners, titleKey);
  const invitedIds = matching.map((p) => p.id);

  const { error: upErr } = await admin
    .from("jobs")
    .update({
      auto_assign_expires_at: expiresAt,
      auto_assign_minutes: minutes,
      auto_assign_invited_partner_ids: invitedIds.length ? invitedIds : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId)
    .eq("status", "auto_assigning");

  if (upErr) {
    console.error("[broadcast-auto-assign] update", upErr);
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  if (invitedIds.length === 0) {
    return NextResponse.json({
      ok: true,
      pushed: 0,
      invited: 0,
      message: "No active partners match this type of work.",
      expiresAt,
    });
  }

  const { data: partnerRows } = await admin
    .from("partners")
    .select("id, auth_user_id, expo_push_token")
    .in("id", invitedIds)
    .eq("status", "active");
  const tokens = await resolveTokens(admin, (partnerRows ?? []) as PartnerTokenRow[]);

  const head = [j.reference, j.title].filter(Boolean).join(" · ") || "New job";
  const addr = j.property_address ? ` · ${j.property_address}` : "";
  const pushTitle = "New job — tap to accept";
  const pushBody = `${head}${addr}\nYou have ${minutes} min to accept.`;

  await sendExpoPush(tokens, pushTitle, pushBody.slice(0, 500), {
    type: "job_auto_assign_offer",
    jobId: j.id,
    expiresAt,
    minutes: String(minutes),
  });

  return NextResponse.json({
    ok: true,
    pushed: tokens.length,
    invited: invitedIds.length,
    expiresAt,
  });
}
