import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-api";
import { createServiceClient } from "@/lib/supabase/service";
import { PROFILE_PHOTO_DOC_KEY } from "@/lib/payroll-doc-checklist";

export const dynamic = "force-dynamic";

const BUCKET = "payroll-internal-documents";
const MAX_BYTES = 10 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);

function safeFileName(name: string): string {
  return name.replace(/[^\w.\-]+/g, "_").slice(0, 180) || "photo.jpg";
}

async function linkedPerson(admin: ReturnType<typeof createServiceClient>, profileId: string) {
  const { data, error } = await admin
    .from("payroll_internal_costs")
    .select("id, payroll_document_files")
    .eq("profile_id", profileId)
    .maybeSingle();
  if (error) throw error;
  return data as { id: string; payroll_document_files: Record<string, { path?: string }> | null } | null;
}

async function signedPhotoUrl(
  admin: ReturnType<typeof createServiceClient>,
  path: string,
): Promise<string | null> {
  const { data, error } = await admin.storage
    .from(BUCKET)
    .createSignedUrl(path, 3600, {
      transform: { width: 256, height: 256, resize: "cover" },
    });
  if (error) return null;
  return data.signedUrl;
}

/** GET — workforce profile photo for the signed-in user (if linked to payroll). */
export async function GET() {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    const admin = createServiceClient();
    const person = await linkedPerson(admin, auth.user.id);
    if (!person) {
      return NextResponse.json({ ok: true, hasWorkforce: false, photoUrl: null });
    }
    const path = person.payroll_document_files?.[PROFILE_PHOTO_DOC_KEY]?.path;
    const photoUrl = path ? await signedPhotoUrl(admin, path) : null;
    return NextResponse.json({ ok: true, hasWorkforce: true, photoUrl });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not load photo";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** POST — upload or replace workforce profile photo. */
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file required" }, { status: 400 });
  }
  const type = (file.type || "").toLowerCase();
  if (!IMAGE_TYPES.has(type)) {
    return NextResponse.json({ error: "Use JPEG, PNG, or WebP" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File must be 10 MB or less" }, { status: 400 });
  }

  try {
    const admin = createServiceClient();
    const person = await linkedPerson(admin, auth.user.id);
    if (!person) {
      return NextResponse.json({ error: "No workforce profile linked to this account" }, { status: 404 });
    }

    const path = `${person.id}/${PROFILE_PHOTO_DOC_KEY}/${safeFileName(file.name)}`;
    const { error: uploadErr } = await admin.storage.from(BUCKET).upload(path, file, {
      upsert: true,
      contentType: type || "image/jpeg",
    });
    if (uploadErr) {
      return NextResponse.json({ error: uploadErr.message }, { status: 500 });
    }

    const prev = (person.payroll_document_files ?? {}) as Record<string, { path: string; file_name: string }>;
    const next = {
      ...prev,
      [PROFILE_PHOTO_DOC_KEY]: { path, file_name: safeFileName(file.name) },
    };

    const { error: updateErr } = await admin
      .from("payroll_internal_costs")
      .update({ payroll_document_files: next, updated_at: new Date().toISOString() })
      .eq("id", person.id);
    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    const photoUrl = await signedPhotoUrl(admin, path);
    return NextResponse.json({ ok: true, photoUrl });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Upload failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
