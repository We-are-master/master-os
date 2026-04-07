import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { resolvePartnerPortalCredential } from "@/lib/partner-portal-session";
import { removeStorageObjectsWithSupabase } from "@/services/partner-documents-storage";

export const dynamic = "force-dynamic";

export async function DELETE(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code")?.trim();
  const token = req.nextUrl.searchParams.get("token")?.trim();
  const credential = code || token;
  const documentId = req.nextUrl.searchParams.get("id")?.trim();
  if (!credential || !documentId) {
    return NextResponse.json({ error: "missing_params" }, { status: 400 });
  }

  const session = await resolvePartnerPortalCredential(credential);
  if (!session) {
    return NextResponse.json({ error: "invalid_or_expired" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const { data: doc, error: dErr } = await supabase
    .from("partner_documents")
    .select("id, partner_id, status, file_path, preview_image_path")
    .eq("id", documentId)
    .maybeSingle();

  if (dErr || !doc) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (doc.partner_id !== session.partnerId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  // Partner portal: allow removing any uploaded file (pending → approved) so they can replace or clear a requirement.
  const allowed = ["pending", "rejected", "approved", "expired"].includes(String(doc.status ?? ""));
  if (!allowed) {
    return NextResponse.json({ error: "cannot_delete" }, { status: 400 });
  }

  const paths: string[] = [];
  if (doc.file_path) paths.push(doc.file_path as string);
  if (doc.preview_image_path) paths.push(doc.preview_image_path as string);

  try {
    if (paths.length > 0) await removeStorageObjectsWithSupabase(supabase, paths);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "storage_delete_failed" },
      { status: 500 },
    );
  }

  const { error: delErr } = await supabase.from("partner_documents").delete().eq("id", documentId);
  if (delErr) {
    return NextResponse.json({ error: delErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
