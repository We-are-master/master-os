import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isValidUUID } from "@/lib/auth-api";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BUCKET = "job-photos";
const SIGNED_TTL = 60 * 60;

interface OnHoldSubmission {
  notes?: string | null;
  photos?: string[];
  partner_id?: string | null;
  submitted_at?: string | null;
}

/**
 * GET /api/jobs/[id]/on-hold-submission
 *
 * Staff read of the partner's reply to an on-hold complaint (notes + photos),
 * captured via the public /job/on-hold form. Photos live in the private
 * job-photos bucket and are served as short-lived signed URLs. Read-only.
 * Returns { submission: null } when the partner hasn't replied yet.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { id } = await ctx.params;
  if (!isValidUUID(id)) return NextResponse.json({ error: "Invalid job id" }, { status: 400 });

  const svc = createServiceClient();
  const { data: job, error } = await svc
    .from("jobs")
    .select("on_hold_submission, on_hold_submission_at, on_hold_reason")
    .eq("id", id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const submission = (job as { on_hold_submission: OnHoldSubmission | null } | null)?.on_hold_submission ?? null;
  if (!submission || (!submission.notes && !(submission.photos?.length))) {
    return NextResponse.json({ submission: null });
  }

  const photoPaths = Array.isArray(submission.photos) ? submission.photos : [];
  const signedPhotos = await Promise.all(
    photoPaths.map(async (path, i) => {
      const { data } = await svc.storage.from(BUCKET).createSignedUrl(path, SIGNED_TTL);
      return { id: `${i}`, url: data?.signedUrl ?? null };
    }),
  );

  // Resolve the partner name for display (best-effort).
  let partnerName: string | null = null;
  if (submission.partner_id) {
    const { data: p } = await svc
      .from("partners")
      .select("company_name, contact_name")
      .eq("id", submission.partner_id)
      .maybeSingle();
    const pr = p as { company_name: string | null; contact_name: string | null } | null;
    partnerName = pr?.company_name?.trim() || pr?.contact_name?.trim() || null;
  }

  return NextResponse.json({
    submission: {
      notes: submission.notes ?? null,
      submittedAt: submission.submitted_at ?? (job as { on_hold_submission_at: string | null }).on_hold_submission_at ?? null,
      partnerName,
      photos: signedPhotos,
    },
  });
}
