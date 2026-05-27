import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isValidUUID } from "@/lib/auth-api";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BUCKET = "job-photos";
const SIGNED_TTL = 60 * 60;

/**
 * GET /api/jobs/[id]/partner-media
 *
 * Staff read of what the partner captured in the Fixfy Trade Portal for this job:
 * the checklist (job_checklist_items) and before/after photos (job_photos, served as
 * short-lived signed URLs from the private bucket). Read-only.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { id } = await ctx.params;
  if (!isValidUUID(id)) return NextResponse.json({ error: "Invalid job id" }, { status: 400 });

  const svc = createServiceClient();
  const [{ data: checklist, error: cErr }, { data: photos, error: pErr }] = await Promise.all([
    svc.from("job_checklist_items").select("id,label,done,required,note,sort_order").eq("job_id", id).order("sort_order", { ascending: true }),
    svc.from("job_photos").select("id,kind,path,created_at").eq("job_id", id).order("created_at", { ascending: true }),
  ]);
  if (cErr || pErr) {
    return NextResponse.json({ error: (cErr ?? pErr)?.message ?? "Failed" }, { status: 500 });
  }

  const signedPhotos = await Promise.all(
    (photos ?? []).map(async (p) => {
      const { data } = await svc.storage.from(BUCKET).createSignedUrl(p.path as string, SIGNED_TTL);
      return { id: p.id as string, kind: p.kind as "before" | "after", url: data?.signedUrl ?? null };
    }),
  );

  return NextResponse.json({
    checklist: (checklist ?? []).map((r) => ({
      id: r.id as string,
      label: (r.label as string) ?? "",
      done: !!r.done,
      required: !!r.required,
      note: (r.note as string | null) ?? null,
    })),
    photos: signedPhotos,
  });
}
