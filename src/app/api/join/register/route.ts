import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { resolvePartnerDocExpiresAt } from "@/lib/partner-required-docs";

export const dynamic = "force-dynamic";

const BUCKET = "partner-documents";

// Maps form field name → partner_documents metadata
const DOC_DEFS = [
  { key: "photo_id",         name: "Photo ID",                  docType: "id_proof"        },
  { key: "public_liability", name: "Public Liability Insurance", docType: "insurance"       },
  { key: "proof_of_address", name: "Proof of Address",          docType: "proof_of_address" },
  { key: "right_to_work",    name: "Right to Work",             docType: "right_to_work"   },
] as const;

async function uploadToStorage(
  supabase: ReturnType<typeof createServiceClient>,
  partnerId: string,
  docId: string,
  file: File,
): Promise<{ path: string; fileName: string }> {
  const ext  = file.name.split(".").pop()?.toLowerCase() ?? "bin";
  const path = `${partnerId}/${docId}/document.${ext}`;
  const buf  = Buffer.from(await file.arrayBuffer());

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, buf, { contentType: file.type, upsert: true });

  if (error) throw new Error(`Storage upload failed: ${error.message}`);
  return { path, fileName: file.name };
}

export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const email            = String(form.get("email")            ?? "").trim().toLowerCase();
  const password         = String(form.get("password")         ?? "").trim();
  const fullName         = String(form.get("fullName")         ?? "").trim();
  const companyName      = String(form.get("companyName")      ?? "").trim();
  const tradesRaw        = String(form.get("trades")           ?? "").trim();
  const trades           = tradesRaw ? tradesRaw.split(",").map((t) => t.trim()).filter(Boolean) : [];
  const servicesProvided = String(form.get("servicesProvided") ?? "").trim();
  const utr              = String(form.get("utr")              ?? "").trim();
  const website          = String(form.get("website")          ?? "").trim();
  const profilePhoto     = form.get("profile_photo");
  const profilePhotoFile = profilePhoto instanceof File && profilePhoto.size > 0 ? profilePhoto : null;

  if (!email || !password || !fullName) {
    return NextResponse.json({ error: "Name, email and password are required." }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters with uppercase, lowercase, and a number." },
      { status: 400 },
    );
  }

  // Validate all documents are present
  const missingDocs = DOC_DEFS.filter(({ key }) => {
    const f = form.get(key);
    return !(f instanceof File) || f.size === 0;
  }).map(({ name }) => name);

  if (missingDocs.length > 0) {
    return NextResponse.json(
      { error: `Missing required documents: ${missingDocs.join(", ")}.` },
      { status: 400 },
    );
  }

  const supabase = createServiceClient();

  // 1. Create auth user (auto-confirm so they can log in immediately)
  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, user_type: "external_partner" },
  });

  if (authError) {
    const msg  = authError.message ?? "";
    const code = (authError as { code?: string }).code ?? "";
    const low  = msg.toLowerCase();

    if (low.includes("already") || low.includes("registered") || code === "email_exists") {
      return NextResponse.json(
        { error: "An account with this email already exists." },
        { status: 409 },
      );
    }
    if (
      low.includes("pattern") ||
      low.includes("expected pattern") ||
      low.includes("weak") ||
      low.includes("password should") ||
      low.includes("strength") ||
      code === "weak_password"
    ) {
      return NextResponse.json(
        {
          error:
            "Password was rejected. Use at least 8 characters with uppercase, lowercase, and a number (avoid common words).",
        },
        { status: 422 },
      );
    }
    if (low.includes("invalid") && low.includes("email")) {
      return NextResponse.json(
        { error: "Please enter a valid email address." },
        { status: 422 },
      );
    }
    return NextResponse.json({ error: `Account creation failed: ${msg}` }, { status: 500 });
  }

  const userId = authData.user.id;

  // 2. Update public.users with extra profile data
  // (trigger handle_new_app_user already created the base row on auth user creation)
  await supabase
    .from("users")
    .update({
      company_name:      companyName               || null,
      website:           website                   || null,
      services_provided: servicesProvided          || null,
      utr:               utr                       || null,
      work_type:         trades[0]                 || null,
      service_type:      trades[0]                 || null,
    })
    .eq("id", userId);

  // 3. Create partner directory row
  const { data: partnerRow, error: partnerErr } = await supabase
    .from("partners")
    .insert({
      company_name: companyName || fullName,
      contact_name: fullName,
      email,
      phone:        null,
      trade:        trades[0] || "General",
      trades:       trades.length > 0 ? trades : null,
      status:       "onboarding",
      location:     "UK",
      auth_user_id: userId,
      utr:          utr || null,
      verified:     false,
    })
    .select("id")
    .single();

  if (partnerErr || !partnerRow?.id) {
    console.error("Partner insert error:", partnerErr);
    return NextResponse.json({ error: "Failed to create partner record." }, { status: 500 });
  }

  const partnerId = partnerRow.id as string;

  // 4. Upload documents + insert into partner_documents
  for (const { key, name, docType } of DOC_DEFS) {
    const file = form.get(key) as File;

    // Insert placeholder row first to get the document ID for the storage path
    const { data: docRow, error: docInsertErr } = await supabase
      .from("partner_documents")
      .insert({
        partner_id:   partnerId,
        name,
        doc_type:     docType,
        status:       "pending",
        uploaded_by:  "Web registration",
        expires_at:   resolvePartnerDocExpiresAt(docType),
      })
      .select("id")
      .single();

    if (docInsertErr || !docRow?.id) {
      console.error(`partner_documents insert error for ${key}:`, docInsertErr);
      continue; // don't block the whole registration over one doc
    }

    try {
      const { path, fileName } = await uploadToStorage(supabase, partnerId, docRow.id as string, file);
      await supabase
        .from("partner_documents")
        .update({ file_path: path, file_name: fileName })
        .eq("id", docRow.id);
    } catch (uploadErr) {
      console.error(`Upload error for ${key}:`, uploadErr);
      // Leave the row with status "pending" but no file — team can request re-upload
    }
  }

  // 5. Upload profile photo / logo if provided
  if (profilePhotoFile) {
    try {
      const ext      = profilePhotoFile.name.split(".").pop()?.toLowerCase() ?? "jpg";
      const path     = `${userId}/profile.${ext}`;
      const buf      = Buffer.from(await profilePhotoFile.arrayBuffer());
      const { error: photoErr } = await supabase.storage
        .from("partner-documents")
        .upload(path, buf, { contentType: profilePhotoFile.type, upsert: true });

      if (!photoErr) {
        const { data: urlData } = supabase.storage.from("partner-documents").getPublicUrl(path);
        await supabase.from("users").update({ avatar_url: urlData.publicUrl }).eq("id", userId);
      }
    } catch (photoUploadErr) {
      console.error("Profile photo upload error:", photoUploadErr);
      // Non-blocking — registration still succeeds
    }
  }

  return NextResponse.json({ ok: true });
}
