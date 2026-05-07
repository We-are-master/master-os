import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getUserFromBearer } from "@/lib/supabase/bearer-auth";
import { createServiceClient } from "@/lib/supabase/service";
import { isValidUUID } from "@/lib/auth-api";
import { cancelOpenInvoicesForJobCancellation } from "@/services/invoices";
import { cancelOpenSelfBillsForJobCancellation, syncSelfBillAfterJobChange } from "@/services/self-bills";
import type { Job } from "@/types/database";

/** Authorization: Bearer (partner user JWT — required for RPC `partner_cancel_job`). */
function bearerToken(headers: Headers): string | null {
  const raw = headers.get("authorization");
  if (!raw?.toLowerCase().startsWith("bearer ")) return null;
  const t = raw.slice(7).trim();
  return t || null;
}

/**
 * Wraps DB `partner_cancel_job` (`auth.uid()` + partner row) plus service-role invoice / self-bill void
 * parity with `updateJob(..., cancelled)`.
 *
 * Intended for the Fixfy Partner app — same bearer pattern as `/api/app/partner-cancel-notify`.
 */
export async function POST(req: NextRequest) {
  const auth = await getUserFromBearer(req);
  if (!auth.user) {
    return NextResponse.json({ error: "Unauthorized", message: auth.message }, { status: 401 });
  }

  const token = bearerToken(req.headers);
  if (!token) {
    return NextResponse.json({ error: "Unauthorized", message: "Missing Bearer token" }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !anon) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  let body: { jobId?: string; reason?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const jobId = body.jobId;
  if (!jobId || typeof jobId !== "string" || !isValidUUID(jobId)) {
    return NextResponse.json({ error: "jobId is required" }, { status: 400 });
  }

  const reasonRaw = typeof body.reason === "string" ? body.reason.trim() : "";
  const reason = reasonRaw.slice(0, 8000);

  const admin = createServiceClient();

  const { data: partner, error: pErr } = await admin.from("partners").select("id").eq("auth_user_id", auth.user.id).maybeSingle();

  if (pErr || !partner?.id) {
    return NextResponse.json({ error: "Not a linked partner" }, { status: 403 });
  }

  const sbUser = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: rpcData, error: rpcErr } = await sbUser.rpc("partner_cancel_job", {
    p_job_id: jobId,
    p_reason: reason,
  });

  if (rpcErr) {
    const msg = rpcErr.message?.trim() || "partner_cancel_job failed";
    const status =
      msg.includes("Not authenticated") || msg.includes("Only linked partners") ? 403 : msg.includes("not found") ? 404 : 400;
    return NextResponse.json({ error: msg }, { status });
  }

  const payload = rpcData as { ok?: boolean; idempotent?: boolean; partner_cancellation_fee?: unknown } | null;
  if (!payload || payload.ok !== true) {
    return NextResponse.json({ error: "Unexpected RPC response", rpc: rpcData ?? null }, { status: 500 });
  }

  const { data: jobRow, error: jobErr } = await admin.from("jobs").select("*").eq("id", jobId).maybeSingle();
  if (jobErr || !jobRow) {
    return NextResponse.json({ error: "Job not found after cancel" }, { status: 500 });
  }

  const job = jobRow as Job;

  if (job.partner_id !== partner.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await syncSelfBillAfterJobChange(job);

  await Promise.all([
    cancelOpenInvoicesForJobCancellation(
      {
        jobReference: job.reference,
        cancellationReason:
          job.partner_cancellation_reason?.trim() || job.cancellation_reason?.trim() || "Job cancelled.",
        primaryInvoiceId: job.invoice_id,
      },
      admin,
    ),
    cancelOpenSelfBillsForJobCancellation(
      {
        jobReference: job.reference,
        primarySelfBillId: job.self_bill_id ?? null,
      },
      admin,
    ),
  ]);

  return NextResponse.json({
    ok: true,
    jobId,
    rpc: rpcData,
    partnerCancellationFee:
      typeof payload.partner_cancellation_fee === "number" ? payload.partner_cancellation_fee : null,
  });
}
