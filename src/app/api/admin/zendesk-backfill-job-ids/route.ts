import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-api";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  isZendeskConfigured,
  setTicketCustomField,
  ZENDESK_JOB_ID_FIELD_ID,
} from "@/lib/zendesk";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

const ALLOWED_ROLES = new Set(["admin", "manager", "operator"]);

interface JobRow {
  id: string;
  reference: string | null;
  external_ref: string | null;
}

/**
 * POST /api/admin/zendesk-backfill-job-ids
 *
 * Walks every job linked to a Zendesk ticket (external_source = 'zendesk',
 * external_ref not null) and writes the OS job reference (e.g. "JOB-1234")
 * into the ticket's job-id custom field (ZENDESK_JOB_ID_FIELD_ID).
 *
 * Idempotent. Use `dryRun: true` for a no-write preview of how many tickets
 * would be touched. For a large one-off run prefer the standalone script
 * (scripts/zendesk-backfill-job-ids.mjs) which throttles + dedupes via GET.
 *
 * Body: { dryRun?: boolean }
 * Auth: admin/manager/operator only.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const serverSb = await createServerSupabase();
  const { data: profile } = await serverSb
    .from("profiles").select("role").eq("id", auth.user.id).maybeSingle();
  const role = (profile as { role?: string } | null)?.role ?? "";
  if (!ALLOWED_ROLES.has(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!isZendeskConfigured()) {
    return NextResponse.json({ error: "Zendesk not configured" }, { status: 503 });
  }

  let body: { dryRun?: boolean } = {};
  try { body = (await req.json()) as { dryRun?: boolean }; } catch { /* empty body OK */ }
  const dryRun = body.dryRun === true;

  const sb = createServiceClient();

  // Page past Supabase's default 1000-row cap.
  const jobs: JobRow[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from("jobs")
      .select("id, reference, external_ref")
      .eq("external_source", "zendesk")
      .not("external_ref", "is", null)
      .order("created_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    const rows = (data ?? []) as JobRow[];
    jobs.push(...rows);
    if (rows.length < PAGE) break;
  }

  const report = {
    scanned: jobs.length,
    updated: [] as Array<{ id: string; ticketId: string; ref: string }>,
    wouldUpdate: [] as Array<{ id: string; ticketId: string; ref: string }>,
    skipped: [] as Array<{ id: string; reason: string }>,
    failed:  [] as Array<{ id: string; ticketId: string; error: string }>,
    dryRun,
  };

  for (const job of jobs) {
    const ticketId = job.external_ref?.toString().trim() ?? "";
    const ref = job.reference?.toString().trim() ?? "";
    if (!ticketId) { report.skipped.push({ id: job.id, reason: "no_ticket" }); continue; }
    if (!ref)      { report.skipped.push({ id: job.id, reason: "no_reference" }); continue; }

    if (dryRun) { report.wouldUpdate.push({ id: job.id, ticketId, ref }); continue; }

    const r = await setTicketCustomField({ ticketId, fieldId: ZENDESK_JOB_ID_FIELD_ID, value: ref });
    if (r.ok) report.updated.push({ id: job.id, ticketId, ref });
    else      report.failed.push({ id: job.id, ticketId, error: r.error ?? "unknown" });
  }

  return NextResponse.json(report);
}
