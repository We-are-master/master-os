import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { resolvePartnerPortalCredential } from "@/lib/partner-portal-session";
import {
  buildRequiredDocumentChecklist,
  resolvePartnerDocExpiresAt,
} from "@/lib/partner-required-docs";
import {
  removeStorageObjectsWithSupabase,
  uploadPartnerDocumentFileWithSupabase,
} from "@/services/partner-documents-storage";
import type { Partner } from "@/types/database";

export const dynamic = "force-dynamic";

function resolveUploadTarget(
  partner: Partner,
  trades: string[],
  requirementId: string,
  displayName: string | null,
): { docType: string; name: string } | null {
  const trimmed = requirementId.trim();
  if (trimmed === "dbs") {
    return { docType: "dbs", name: displayName?.trim() || "DBS certificate" };
  }
  if (trimmed === "other") {
    const n = displayName?.trim();
    if (!n) return null;
    return { docType: "other", name: n };
  }
  const list = buildRequiredDocumentChecklist(trades, partner);
  const found = list.find((r) => r.id === trimmed);
  if (!found) return null;
  const name = displayName?.trim() || found.name;
  return { docType: found.docType, name };
}

export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const code = String(form.get("code") ?? "").trim();
  const token = String(form.get("token") ?? "").trim();
  const credential = code || token;
  const requirementId = String(form.get("requirementId") ?? "").trim();
  const replaceDocumentId = String(form.get("replaceDocumentId") ?? "").trim();
  const displayNameRaw = form.get("displayName");
  const displayName = typeof displayNameRaw === "string" ? displayNameRaw : null;
  const file = form.get("file");

  if (!credential || !requirementId) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "missing_file" }, { status: 400 });
  }

  const session = await resolvePartnerPortalCredential(credential);
  if (!session) {
    return NextResponse.json({ error: "invalid_or_expired" }, { status: 401 });
  }

  if (session.requestedDocIds != null && session.requestedDocIds.length > 0) {
    if (!session.requestedDocIds.includes(requirementId)) {
      return NextResponse.json(
        { error: "This document type was not requested for this link." },
        { status: 403 },
      );
    }
  }

  const supabase = createServiceClient();
  const { data: partner, error: pErr } = await supabase
    .from("partners")
    .select("*")
    .eq("id", session.partnerId)
    .maybeSingle();

  if (pErr || !partner) {
    return NextResponse.json({ error: "partner_not_found" }, { status: 404 });
  }

  const p = partner as Partner;
  const trades = (p.trades?.length ? p.trades : null) ?? [p.trade];
  const target = resolveUploadTarget(p, trades, requirementId, displayName);
  if (!target) {
    return NextResponse.json({ error: "invalid_requirement" }, { status: 400 });
  }

  const expiresIso = resolvePartnerDocExpiresAt(target.docType);

  /** Replace an existing row (same requirement) instead of inserting a duplicate. */
  if (replaceDocumentId) {
    const { data: existing, error: exErr } = await supabase
      .from("partner_documents")
      .select("id, partner_id, doc_type, name, file_path, preview_image_path")
      .eq("id", replaceDocumentId)
      .maybeSingle();

    if (exErr || !existing) {
      return NextResponse.json({ error: "document_not_found" }, { status: 404 });
    }
    if (existing.partner_id !== session.partnerId) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    if (existing.doc_type !== target.docType) {
      return NextResponse.json({ error: "document_type_mismatch" }, { status: 400 });
    }
    const existingName = String(existing.name ?? "").trim().toLowerCase();
    const targetName = target.name.trim().toLowerCase();
    if (existingName !== targetName) {
      return NextResponse.json({ error: "document_name_mismatch" }, { status: 400 });
    }

    const paths: string[] = [];
    if (existing.file_path) paths.push(existing.file_path as string);
    if (existing.preview_image_path) paths.push(existing.preview_image_path as string);
    if (paths.length > 0) {
      try {
        await removeStorageObjectsWithSupabase(supabase, paths);
      } catch (e) {
        return NextResponse.json(
          { error: e instanceof Error ? e.message : "storage_delete_failed" },
          { status: 500 },
        );
      }
    }

    try {
      const main = await uploadPartnerDocumentFileWithSupabase(
        supabase,
        session.partnerId,
        existing.id as string,
        file,
      );
      const { error: upErr } = await supabase
        .from("partner_documents")
        .update({
          file_path: main.path,
          file_name: main.fileName,
          status: "pending",
          uploaded_by: "Partner portal",
          expires_at: expiresIso,
        })
        .eq("id", existing.id);
      if (upErr) throw new Error(upErr.message);
    } catch (uploadErr) {
      return NextResponse.json(
        { error: uploadErr instanceof Error ? uploadErr.message : "upload_failed" },
        { status: 400 },
      );
    }

    return NextResponse.json({ ok: true, documentId: existing.id, replaced: true });
  }

  const { data: row, error: insErr } = await supabase
    .from("partner_documents")
    .insert({
      partner_id: session.partnerId,
      name: target.name,
      doc_type: target.docType,
      status: "pending",
      uploaded_by: "Partner portal",
      expires_at: expiresIso,
      notes: null,
    })
    .select()
    .single();

  if (insErr || !row?.id) {
    return NextResponse.json({ error: insErr?.message ?? "insert_failed" }, { status: 500 });
  }

  try {
    const main = await uploadPartnerDocumentFileWithSupabase(supabase, session.partnerId, row.id as string, file);
    const { error: upErr } = await supabase
      .from("partner_documents")
      .update({
        file_path: main.path,
        file_name: main.fileName,
      })
      .eq("id", row.id);
    if (upErr) throw new Error(upErr.message);
  } catch (uploadErr) {
    try {
      const folder = `${session.partnerId}/${row.id}`;
      const { data: list } = await supabase.storage.from("partner-documents").list(folder);
      const paths = (list ?? []).map((f) => `${folder}/${f.name}`);
      if (paths.length > 0) await removeStorageObjectsWithSupabase(supabase, paths);
    } catch {
      /* ignore */
    }
    await supabase.from("partner_documents").delete().eq("id", row.id);
    return NextResponse.json(
      { error: uploadErr instanceof Error ? uploadErr.message : "upload_failed" },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true, documentId: row.id });
}
