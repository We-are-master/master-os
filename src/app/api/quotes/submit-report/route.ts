import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyPartnerReportToken } from "@/lib/quote-response-token";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

const BUCKET = "job-reports";
const VALID_TEMPLATES = new Set(["general", "gardener", "cleaner"]);

function getServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SERVICE_ROLE_KEY!,
  );
}

/**
 * POST /api/quotes/submit-report   (public, token-authenticated)
 *
 * Used by the public quote link after the quote was accepted and a job was
 * created. Accepts the START and FINAL report fields together — there is no
 * timer here, the caller provides duration manually.
 *
 * Body: multipart/form-data
 *   token         JWT-like token from createQuoteResponseToken
 *   template      "general" | "gardener" | "cleaner"
 *   startData     JSON-stringified field map for start_report
 *   finalData     JSON-stringified field map for final_report  (includes duration_ms)
 *   photos[<slot>][]  one or more files per slot (already downscaled client-side):
 *     - general/gardener: slots "before" and "after"
 *     - cleaner:          slots "equipment" + room keys (living_room, hallways, …) for both start & final
 *
 * Behaviour:
 *   - Writes jobs.start_report + jobs.final_report JSONB in the partner-app
 *     V2 shape so the dashboard cards render identically.
 *   - Sets *_report_submitted = true and *_report_approved_at = now (the
 *     submission via public link counts as approval; office can revoke from
 *     the dashboard if needed).
 *   - Moves jobs.status → final_check so the office picks it up.
 *   - Idempotency: if both start_report and final_report were already
 *     submitted, returns 409.
 */
export async function POST(req: NextRequest) {
  // Per-IP rate limit — public endpoint.
  const ip = getClientIp(req);
  const rl = checkRateLimit(`submit-report:${ip}`, 10, 10 * 60 * 1000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many requests." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid multipart body." }, { status: 400 });
  }

  const token = String(form.get("token") ?? "").trim();
  if (!token) return NextResponse.json({ error: "Token is required." }, { status: 400 });
  const verified = verifyPartnerReportToken(token);
  if (!verified) {
    return NextResponse.json(
      { error: "Invalid or expired report link. Reports must be submitted from the partner-specific link." },
      { status: 400 },
    );
  }
  const { jobId: tokenJobId, partnerId: tokenPartnerId } = verified;

  const template = String(form.get("template") ?? "").trim();
  if (!VALID_TEMPLATES.has(template)) {
    return NextResponse.json({ error: "Invalid template." }, { status: 400 });
  }

  let startData: Record<string, unknown> = {};
  let finalData: Record<string, unknown> = {};
  try {
    startData = JSON.parse(String(form.get("startData") ?? "{}")) as Record<string, unknown>;
    finalData = JSON.parse(String(form.get("finalData") ?? "{}")) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid startData/finalData JSON." }, { status: 400 });
  }

  // Group photo slots: photos[<slot>][] -> { slotKey: File[] }
  const photoEntries: Record<string, File[]> = {};
  for (const [key, value] of form.entries()) {
    const m = key.match(/^photos\[([^\]]+)\]\[\]$/);
    if (!m || !(value instanceof File)) continue;
    const slot = m[1];
    if (!photoEntries[slot]) photoEntries[slot] = [];
    photoEntries[slot].push(value);
  }

  const supabase = getServiceSupabase();

  // Resolve job from the token directly — the token is bound to job.id.
  const { data: job, error: jobErr } = await supabase
    .from("jobs")
    .select("id, reference, status, partner_id, start_report_submitted, final_report_submitted")
    .eq("id", tokenJobId)
    .is("deleted_at", null)
    .maybeSingle();
  if (jobErr || !job) {
    return NextResponse.json(
      { error: "Job not found." },
      { status: 404 },
    );
  }

  // Lock to the assigned partner: token must match the job's current
  // partner_id. If the partner was reassigned, older links stop working.
  if (!job.partner_id) {
    return NextResponse.json(
      { error: "This job has no partner assigned. Ask the office to assign a partner first." },
      { status: 409 },
    );
  }
  if (job.partner_id !== tokenPartnerId) {
    return NextResponse.json(
      { error: "This report link is for a different partner. Ask the office for an updated link." },
      { status: 403 },
    );
  }

  if (job.start_report_submitted && job.final_report_submitted) {
    return NextResponse.json(
      { error: "A report has already been submitted for this job." },
      { status: 409 },
    );
  }

  // Upload photos. Cleaner template gets room-by-room maps; others get
  // a flat array per slot — matches what `normalizeReport` already handles.
  const startPhotos = await uploadSlotPhotos(supabase, job.id, "start", photoEntries, template);
  const finalPhotos = await uploadSlotPhotos(supabase, job.id, "final", photoEntries, template);

  const now = new Date().toISOString();
  const startPayload = {
    template,
    submitted_at: now,
    photos: startPhotos,
    ...startData,
  };
  const finalPayload = {
    template,
    submitted_at: now,
    photos: finalPhotos,
    ...finalData,
  };

  const { error: updErr } = await supabase
    .from("jobs")
    .update({
      start_report:               startPayload,
      start_report_submitted:     true,
      start_report_skipped:       false,
      start_report_approved_at:   now,
      final_report:               finalPayload,
      final_report_submitted:     true,
      final_report_skipped:       false,
      final_report_approved_at:   now,
      status:                     "final_check",
      updated_at:                 now,
    })
    .eq("id", job.id);

  if (updErr) {
    console.error("[submit-report] update failed:", updErr);
    return NextResponse.json({ error: "Could not save the report." }, { status: 500 });
  }

  void supabase.from("audit_logs").insert({
    entity_type: "job",
    entity_id:   job.id,
    entity_ref:  job.reference,
    action:      "report_submitted",
    field_name:  "start_report+final_report",
    old_value:   job.status,
    new_value:   "final_check",
    metadata:    { source: "public_quote_link", template },
  }).then(({ error }) => { if (error) console.error("audit_logs (submit-report)", error); });

  return NextResponse.json({ ok: true, jobReference: job.reference });
}

/** Cleaner: returns `{ slot: [urls...] }` map; others return flat array. */
async function uploadSlotPhotos(
  supabase: ReturnType<typeof getServiceSupabase>,
  jobId: string,
  kind: "start" | "final",
  photoEntries: Record<string, File[]>,
  template: string,
): Promise<string[] | Record<string, string[]>> {
  // Which slots belong to start vs final per template:
  const startSlots = template === "cleaner"
    ? new Set(["equipment", "living_room", "hallways", "kitchen", "bathrooms", "bedrooms", "steam_cleaning"])
    : new Set(["before"]);
  const finalSlots = template === "cleaner"
    ? new Set(["living_room", "hallways", "kitchen", "bathrooms", "bedrooms", "steam_cleaning"])
    : new Set(["after"]);

  // For start: cleaner has multiple, others have one flat "before".
  // For final: cleaner has multiple, others have one flat "after".
  // Cleaner reports start use the "equipment" + room maps on the START call,
  // and only rooms (no equipment) on the FINAL. To prevent FINAL photos
  // landing in start_report and vice-versa, slot prefix tells which call:
  // photos[<slot>][] is shared but we differentiate by which kind expects it.
  // To keep the public form simple, we let the same slot key participate in
  // BOTH start and final — except for `equipment` which only goes to start
  // and never appears in final. In practice, the form names slots clearly
  // ("before" / "after" / room).
  const isCleaner = template === "cleaner";
  const allowed = kind === "start" ? startSlots : finalSlots;

  if (!isCleaner) {
    // Flat array, single slot.
    const flatSlot = kind === "start" ? "before" : "after";
    const files = photoEntries[flatSlot] ?? [];
    return uploadFlat(supabase, jobId, kind, files);
  }

  // Cleaner: room map (and equipment only for start).
  const result: Record<string, string[]> = {};
  for (const [slot, files] of Object.entries(photoEntries)) {
    if (!allowed.has(slot)) continue;
    const urls = await uploadFlat(supabase, jobId, `${kind}-${slot}`, files);
    result[slot] = urls;
  }
  return result;
}

async function uploadFlat(
  supabase: ReturnType<typeof getServiceSupabase>,
  jobId: string,
  prefix: string,
  files: File[],
): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const bytes = new Uint8Array(await f.arrayBuffer());
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const path = `${jobId}/${prefix}-${i}-${ts}.jpg`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, bytes, {
      contentType: f.type || "image/jpeg",
      upsert: false,
    });
    if (error) {
      console.error("[submit-report] photo upload failed:", error);
      continue;
    }
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
    if (data?.publicUrl) out.push(data.publicUrl);
  }
  return out;
}
