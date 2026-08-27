import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { verifyPartnerOnHoldToken } from "@/lib/quote-response-token";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { isZendeskConfigured, updateTicket, uploadAttachment } from "@/lib/zendesk";
import { syncJobZendeskOnHoldFields } from "@/lib/zendesk-job-on-hold-sync";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

const BUCKET = "job-photos";
const MAX_PHOTOS = 12;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * POST /api/jobs/on-hold-submit   (public, token-authenticated, multipart)
 *
 * The partner's reply to an on-hold complaint, sent from the "Resolve this
 * job" link in the on-hold email. Accepts a written summary + attachments
 * (images already downscaled client-side; PDFs and the rest come whole).
 *
 * Body: multipart/form-data
 *   token      partner-scoped on-hold token (createPartnerOnHoldToken)
 *   notes      written summary (required)
 *   photos[]   zero or more files, any format (photo, PDF receipt, certificate)
 *
 * Behaviour:
 *   - Uploads photos to the private `job-photos` bucket under
 *     `<jobId>/on-hold/...` (paths stored, never public URLs).
 *   - Saves jobs.on_hold_submission { notes, photos, partner_id, submitted_at }
 *     and on_hold_submission_at. New photos are appended to any prior ones.
 *   - Posts an INTERNAL note (private comment, customer never sees it) on the
 *     linked Zendesk ticket with the notes + the photos as attachments.
 *   - Does NOT resume the job — the office reviews and resumes manually.
 */
export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = checkRateLimit(`on-hold-submit:${ip}`, 10, 10 * 60 * 1000);
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
  const verified = verifyPartnerOnHoldToken(token);
  if (!verified) {
    return NextResponse.json(
      { error: "Invalid or expired link. Please use the most recent on-hold email." },
      { status: 401 },
    );
  }
  const { jobId, partnerId } = verified;

  const notes = String(form.get("notes") ?? "").trim();
  if (!notes) {
    return NextResponse.json({ error: "Please add a short summary of how you can resolve this." }, { status: 400 });
  }

  const photoFiles: File[] = [];
  for (const [key, value] of form.entries()) {
    if ((key === "photos[]" || key === "photos") && value instanceof File && value.size > 0) {
      photoFiles.push(value);
    }
  }
  if (photoFiles.length > MAX_PHOTOS) {
    return NextResponse.json({ error: `Please send at most ${MAX_PHOTOS} photos.` }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data: jobRow, error: jobErr } = await supabase
    .from("jobs")
    .select("id, reference, status, partner_id, external_source, external_ref, on_hold_submission")
    .eq("id", jobId)
    .is("deleted_at", null)
    .maybeSingle();

  if (jobErr || !jobRow) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }
  const job = jobRow as {
    id: string;
    reference: string;
    status: string;
    partner_id: string | null;
    external_source: string | null;
    external_ref: string | null;
    on_hold_submission: { notes?: string | null; photos?: string[] } | null;
  };

  if (job.partner_id !== partnerId) {
    return NextResponse.json(
      { error: "This link is for a different partner. Ask the office for an updated link." },
      { status: 403 },
    );
  }

  // ─── Upload photos: Supabase (record) + Zendesk (internal note attachments) ──
  const zendeskTicketId = job.external_source === "zendesk" ? job.external_ref : null;
  const zendeskReady = Boolean(zendeskTicketId) && isZendeskConfigured();

  const newPaths: string[] = [];
  const uploadTokens: string[] = [];
  for (let i = 0; i < photoFiles.length; i++) {
    const f = photoFiles[i];
    const bytes = new Uint8Array(await f.arrayBuffer());
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    /**
     * A extensão vem do ARQUIVO, não é `.jpg` chapado (27/08): o anexo agora
     * pode ser recibo em PDF, e um PDF salvo como `.jpg` não abre em lugar
     * nenhum — nem no storage, nem no Zendesk para quem for resolver.
     */
    const ext = (f.name.match(/\.[a-z0-9]{1,5}$/i)?.[0] ?? (f.type === "application/pdf" ? ".pdf" : ".jpg")).toLowerCase();
    const contentType = f.type || "application/octet-stream";
    const path = `${job.id}/on-hold/${ts}-${i}${ext}`;
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, bytes, {
      contentType,
      upsert: false,
    });
    if (upErr) {
      console.error("[on-hold-submit] attachment upload failed:", upErr);
      continue;
    }
    newPaths.push(path);

    if (zendeskReady) {
      try {
        const tk = await uploadAttachment(Buffer.from(bytes), `resolution-${i + 1}${ext}`, contentType);
        uploadTokens.push(tk);
      } catch (err) {
        console.error("[on-hold-submit] zendesk attachment upload failed:", err);
      }
    }
  }

  // ─── Persist on the job (append photos to any prior submission) ────
  const now = new Date().toISOString();
  const priorPhotos = Array.isArray(job.on_hold_submission?.photos) ? job.on_hold_submission!.photos! : [];
  const submission = {
    notes,
    photos: [...priorPhotos, ...newPaths],
    partner_id: partnerId,
    submitted_at: now,
  };
  const { error: updErr } = await supabase
    .from("jobs")
    .update({ on_hold_submission: submission, on_hold_submission_at: now, updated_at: now })
    .eq("id", job.id);

  if (updErr) {
    console.error("[on-hold-submit] job update failed:", updErr);
    return NextResponse.json({ error: "Could not save your update. Please try again." }, { status: 500 });
  }

  // ─── Post an internal note on the Zendesk ticket (best-effort) ─────
  if (zendeskReady && zendeskTicketId) {
    const html =
      `<p><strong>🔧 Partner submitted an on-hold resolution</strong> (job ${escapeHtml(job.reference)})</p>` +
      `<p style="white-space:pre-wrap;">${escapeHtml(notes)}</p>` +
      (newPaths.length
        ? `<p><em>${newPaths.length} photo${newPaths.length === 1 ? "" : "s"} attached.</em></p>`
        : `<p><em>No photos attached.</em></p>`);
    try {
      await updateTicket({
        ticketId: zendeskTicketId,
        htmlBody: html,
        publicComment: false,
        uploadTokens,
      });
    } catch (err) {
      console.error("[on-hold-submit] zendesk internal note failed:", err);
    }

    void syncJobZendeskOnHoldFields(job.id, supabase).catch((err) => {
      console.error("[on-hold-submit] zendesk solution field sync failed:", err);
    });
  }

  // ─── Audit ─────────────────────────────────────────────────────────
  void supabase.from("audit_logs").insert({
    entity_type: "job",
    entity_id:   job.id,
    entity_ref:  job.reference,
    action:      "updated",
    field_name:  "on_hold_submission",
    new_value:   `${newPaths.length} photo(s) + notes`,
    metadata:    { source: "partner_on_hold_form", photos_added: newPaths.length },
  }).then(({ error }) => { if (error) console.error("[on-hold-submit] audit insert failed:", error); });

  return NextResponse.json({ ok: true, jobReference: job.reference, photosUploaded: newPaths.length });
}
