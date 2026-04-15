import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { requirePortalUser } from "@/lib/portal-auth";
import { createServiceClient } from "@/lib/supabase/service";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { isUuid } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

const ALLOWED_IMAGE_MIME = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_IMAGES      = 6;
const BUCKET          = "quote-invite-images";

function safeExtForMime(mime: string): string {
  switch (mime.toLowerCase()) {
    case "image/jpeg":
    case "image/jpg":  return "jpg";
    case "image/png":  return "png";
    case "image/webp": return "webp";
    case "image/heic": return "heic";
    case "image/heif": return "heif";
    default:           return "bin";
  }
}

/**
 * POST /api/portal/requests
 * multipart/form-data:
 *   - serviceType, description, propertyId (account property / asset), desiredDate (optional), images[]
 *
 * Creates a service_requests row scoped to the caller's account, uploads
 * any images to the quote-invite-images bucket, and emails hello@wearemaster.com
 * to notify the internal team.
 */
export async function POST(req: NextRequest) {
  // ─── Auth ─────────────────────────────────────────────────────────────
  const auth = await requirePortalUser();
  if (auth instanceof NextResponse) return auth;
  const { accountId, portalUser } = auth;

  // ─── Rate limit per portal user (10/hour) ────────────────────────────
  const ip = getClientIp(req);
  const rl = checkRateLimit(`portal-req:${portalUser.id}:${ip}`, 10, 60 * 60 * 1000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "You've created too many requests recently. Please try again in an hour." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  // ─── Parse form ──────────────────────────────────────────────────────
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const serviceType = String(form.get("serviceType") ?? "").trim();
  const description = String(form.get("description") ?? "").trim();
  const desiredDate = String(form.get("desiredDate") ?? "").trim();
  const propertyId  = String(form.get("propertyId") ?? "").trim();

  if (!serviceType || !description || !propertyId) {
    return NextResponse.json(
      { error: "Service type, description, and property (asset) are required." },
      { status: 400 },
    );
  }
  if (!isUuid(propertyId)) {
    return NextResponse.json({ error: "Please select a valid property." }, { status: 400 });
  }
  if (serviceType.length > 80 || description.length > 4000) {
    return NextResponse.json({ error: "One of your fields is too long." }, { status: 400 });
  }

  const imageFiles = form
    .getAll("images")
    .filter((f): f is File => f instanceof File && f.size > 0)
    .slice(0, MAX_IMAGES);

  for (const f of imageFiles) {
    if (f.size > MAX_IMAGE_BYTES) {
      return NextResponse.json({ error: "One of your photos is too large (max 10 MB)." }, { status: 413 });
    }
    if (f.type && !ALLOWED_IMAGE_MIME.has(f.type.toLowerCase())) {
      return NextResponse.json({ error: "One of your photos has an unsupported file type." }, { status: 400 });
    }
  }

  const supabase = createServiceClient();

  const { data: propRow } = await supabase
    .from("account_properties")
    .select("id, full_address, primary_contact_id, account_id")
    .eq("id", propertyId)
    .eq("account_id", accountId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!propRow) {
    return NextResponse.json(
      { error: "That property is not part of your account. Add it under Assets first." },
      { status: 400 },
    );
  }
  const prop = propRow as { id: string; full_address: string; primary_contact_id?: string | null };
  const propertyAddress = prop.full_address.trim();
  if (!propertyAddress || propertyAddress.length > 1000) {
    return NextResponse.json({ error: "Property address on file is invalid." }, { status: 400 });
  }

  // ─── Resolve / create the client row for this account ──────────────────
  const { data: account } = await supabase
    .from("accounts")
    .select("id, company_name, contact_name, email, address")
    .eq("id", accountId)
    .maybeSingle();
  if (!account) {
    return NextResponse.json({ error: "Your account could not be found." }, { status: 404 });
  }
  const acc = account as { id: string; company_name: string; contact_name: string; email: string; address: string | null };

  const portalContact = portalUser.contact_id && isUuid(portalUser.contact_id) ? portalUser.contact_id : null;
  const primaryOnProperty =
    prop.primary_contact_id && isUuid(String(prop.primary_contact_id)) ? String(prop.primary_contact_id) : null;

  let clientId: string | null = portalContact ?? primaryOnProperty;

  if (clientId) {
    const { data: cchk } = await supabase
      .from("clients")
      .select("id")
      .eq("id", clientId)
      .eq("source_account_id", accountId)
      .is("deleted_at", null)
      .maybeSingle();
    if (!cchk) clientId = null;
  }

  if (!clientId) {
    const { data: existingClient } = await supabase
      .from("clients")
      .select("id")
      .eq("source_account_id", accountId)
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (existingClient) {
      clientId = (existingClient as { id: string }).id;
    } else {
      const { data: newClient, error: clientErr } = await supabase
        .from("clients")
        .insert({
          full_name:         acc.contact_name || acc.company_name,
          email:             acc.email,
          address:           acc.address,
          source_account_id: accountId,
          client_type:       "commercial",
          source:            "portal",
          status:            "active",
        })
        .select("id")
        .single();
      if (clientErr || !newClient) {
        console.error("[portal/requests] failed to seed client row:", clientErr);
        return NextResponse.json({ error: "Could not initialise your client record." }, { status: 500 });
      }
      clientId = (newClient as { id: string }).id;
    }
  }

  let clientName = acc.contact_name || acc.company_name;
  let clientEmail = portalUser.email;
  const { data: contactRow } = await supabase
    .from("clients")
    .select("full_name, email, phone")
    .eq("id", clientId)
    .maybeSingle();
  if (contactRow) {
    const cr = contactRow as { full_name: string; email?: string | null; phone?: string | null };
    clientName = cr.full_name || clientName;
    clientEmail = (cr.email && String(cr.email).trim()) || clientEmail;
  }

  // ─── Generate reference + insert request ─────────────────────────────
  const { data: refData, error: refErr } = await supabase.rpc("next_request_ref");
  if (refErr || !refData) {
    console.error("[portal/requests] next_request_ref failed:", refErr);
    return NextResponse.json({ error: "Could not generate a request reference." }, { status: 500 });
  }
  const reference = String(refData);

  const requestNotes = desiredDate
    ? `Desired date: ${desiredDate}`
    : null;

  const { data: requestRow, error: requestErr } = await supabase
    .from("service_requests")
    .insert({
      reference,
      account_id:       accountId,
      property_id:      propertyId,
      client_id:        clientId,
      client_name:      clientName,
      client_email:     clientEmail,
      property_address: propertyAddress,
      service_type:     serviceType,
      description,
      status:           "new",
      priority:         "medium",
      source:           "portal",
      notes:            requestNotes,
      images:           [],
    })
    .select("id, reference")
    .single();

  if (requestErr || !requestRow) {
    console.error("[portal/requests] insert failed:", requestErr);
    return NextResponse.json({ error: "Could not create the request." }, { status: 500 });
  }
  const newRequestId = (requestRow as { id: string }).id;

  // ─── Upload images and update the row with public URLs ───────────────
  const imageUrls: string[] = [];
  for (let i = 0; i < imageFiles.length; i++) {
    const file = imageFiles[i]!;
    try {
      const ext  = safeExtForMime(file.type ?? "");
      const path = `portal/${accountId}/${newRequestId}/${i + 1}.${ext}`;
      const buf  = Buffer.from(await file.arrayBuffer());
      const { error: uploadErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, buf, {
          contentType: file.type || "application/octet-stream",
          upsert: true,
          cacheControl: "3600",
        });
      if (uploadErr) {
        console.error(`[portal/requests] image upload ${i} failed:`, uploadErr);
        continue;
      }
      const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(path);
      if (urlData?.publicUrl) imageUrls.push(urlData.publicUrl);
    } catch (err) {
      console.error(`[portal/requests] image processing ${i} error:`, err);
    }
  }

  if (imageUrls.length > 0) {
    await supabase
      .from("service_requests")
      .update({ images: imageUrls })
      .eq("id", newRequestId);
  }

  // ─── Notify hello@wearemaster.com ────────────────────────────────────
  try {
    const resendKey = process.env.RESEND_API_KEY?.trim();
    if (resendKey) {
      const resend  = new Resend(resendKey);
      const fromEmail =
        process.env.RESEND_FROM_EMAIL?.trim() ||
        "Master Group <hello@wearemaster.com>";
      const appUrl =
        process.env.NEXT_PUBLIC_APP_URL?.trim()?.replace(/\/$/, "") ||
        "https://app.getfixfy.com";
      const dashboardLink = `${appUrl}/requests`;
      const subject = `New portal request ${reference} from ${acc.company_name}`;
      const html = `
        <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0f172a">
          <h1 style="font-size:20px;margin:0 0 8px">New request from ${escapeHtml(acc.company_name)}</h1>
          <p style="color:#64748b;margin:0 0 24px">A portal user just created a service request.</p>
          <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
            <tr><td style="padding:8px 0;color:#64748b;width:140px">Reference</td><td style="padding:8px 0;font-weight:600">${escapeHtml(reference)}</td></tr>
            <tr><td style="padding:8px 0;color:#64748b">Account</td><td style="padding:8px 0">${escapeHtml(acc.company_name)}</td></tr>
            <tr><td style="padding:8px 0;color:#64748b">Submitted by</td><td style="padding:8px 0">${escapeHtml(portalUser.full_name ?? portalUser.email)} (${escapeHtml(portalUser.email)})</td></tr>
            <tr><td style="padding:8px 0;color:#64748b">Service type</td><td style="padding:8px 0">${escapeHtml(serviceType)}</td></tr>
            <tr><td style="padding:8px 0;color:#64748b">Address</td><td style="padding:8px 0">${escapeHtml(propertyAddress)}</td></tr>
            ${desiredDate ? `<tr><td style="padding:8px 0;color:#64748b">Desired date</td><td style="padding:8px 0">${escapeHtml(desiredDate)}</td></tr>` : ""}
            <tr><td style="padding:8px 0;color:#64748b">Photos</td><td style="padding:8px 0">${imageUrls.length}</td></tr>
          </table>
          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px;margin-bottom:24px">
            <p style="margin:0 0 4px;font-size:12px;text-transform:uppercase;color:#94a3b8;font-weight:600">Description</p>
            <p style="margin:0;white-space:pre-wrap;line-height:1.5">${escapeHtml(description)}</p>
          </div>
          <a href="${dashboardLink}" style="display:inline-block;background:#E94A02;color:white;padding:12px 24px;border-radius:12px;text-decoration:none;font-weight:700">Open in dashboard</a>
        </div>
      `;
      await resend.emails.send({
        from:    fromEmail,
        to:      ["hello@wearemaster.com"],
        subject,
        html,
      });
    }
  } catch (err) {
    // Email failure is non-blocking — the request is already saved.
    console.error("[portal/requests] email notification failed:", err);
  }

  return NextResponse.json({ ok: true, requestId: newRequestId, reference });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
