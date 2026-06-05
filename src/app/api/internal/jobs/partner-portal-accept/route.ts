import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { isValidUUID } from "@/lib/auth-api";
import { createServiceClient } from "@/lib/supabase/service";
import { partnerMissingRequiredDocs } from "@/lib/partner-docs-gate";
import {
  loadPartnerForAcceptance,
  partnerNameForJobRow,
  processAutoAssignJobAccept,
} from "@/lib/job-partner-acceptance";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function secretsMatch(a: string | null | undefined, b: string): boolean {
  if (!a) return false;
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

/**
 * POST /api/internal/jobs/partner-portal-accept
 *
 * Called by the trade portal when a partner accepts an auto-assign offer in-app.
 * Performs the atomic claim, finalises invites, sends Job booked Zendesk email,
 * and syncs ticket status + form fields.
 *
 * Auth: header `x-internal-secret` must match env `INTERNAL_SYNC_SECRET`.
 * Body: { jobId: uuid, partnerId: uuid }
 */
export async function POST(req: NextRequest) {
  const provided = req.headers.get("x-internal-secret");
  const expected = process.env.INTERNAL_SYNC_SECRET?.trim();
  if (!expected) {
    console.error("[internal/partner-portal-accept] INTERNAL_SYNC_SECRET not configured");
    return NextResponse.json({ ok: false, error: "Endpoint not configured." }, { status: 500 });
  }
  if (!secretsMatch(provided, expected)) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  let body: { jobId?: string; partnerId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
  }

  const jobId = body.jobId?.trim() ?? "";
  const partnerId = body.partnerId?.trim() ?? "";
  if (!isValidUUID(jobId) || !isValidUUID(partnerId)) {
    return NextResponse.json({ ok: false, error: "jobId and partnerId required" }, { status: 400 });
  }

  const supabase = createServiceClient();

  const missing = await partnerMissingRequiredDocs(supabase, partnerId);
  if (missing.length) {
    return NextResponse.json(
      {
        ok: false,
        error: `Upload your required documents first: ${missing.join(", ")}.`,
        code: "docs_required",
      },
      { status: 403 },
    );
  }

  const partner = await loadPartnerForAcceptance(supabase, partnerId);
  if (!partner) {
    return NextResponse.json({ ok: false, error: "partner_not_found" }, { status: 404 });
  }

  const partnerName = partnerNameForJobRow(partner);

  const result = await processAutoAssignJobAccept({
    supabase,
    jobId,
    partnerId,
    partnerName,
  });

  if (!result.ok) {
    const status = result.error === "partner_mismatch" ? 410 : 409;
    return NextResponse.json(
      {
        ok: false,
        accepted: false,
        error: result.error,
        message: result.message,
        jobReference: result.jobReference,
      },
      { status },
    );
  }

  return NextResponse.json({
    ok: true,
    accepted: true,
    jobReference: result.jobReference,
    partnerLabel: result.partnerLabel,
    partnerId,
    partnerName,
    alreadyConfirmed: result.alreadyConfirmed,
    claimed: result.claimed,
    bookedEmail: result.bookedEmail,
  });
}
