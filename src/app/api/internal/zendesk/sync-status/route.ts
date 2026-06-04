import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { isValidUUID } from "@/lib/auth-api";
import { syncJobZendeskStatus, syncQuoteZendeskStatus } from "@/lib/zendesk-status-sync";
import { syncJobZendeskOnHoldFields } from "@/lib/zendesk-job-on-hold-sync";
import {
  dispatchJobCancelledZendesk,
  dispatchJobCompletedZendesk,
  dispatchJobCreatedZendesk,
  dispatchQuoteRejectedZendesk,
} from "@/lib/zendesk-lifecycle";
import { createServiceClient } from "@/lib/supabase/service";
import type { JobStatus, QuoteStatus } from "@/types/database";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

/**
 * Internal endpoint: sync a job/quote's status to its linked Zendesk ticket
 * AND dispatch any one-shot lifecycle notices that should accompany terminal
 * transitions (job created/completed/cancelled, quote rejected).
 *
 * Auth: header `x-internal-secret` must match env `ZENDESK_SYNC_INTERNAL_SECRET`.
 * Caller: Postgres trigger via pg_net (see migration 166_zendesk_status_sync_trigger.sql).
 *
 * Body: { entity: "job" | "quote", id: uuid }
 *
 * Always returns 200 (sync errors live in the body) so the trigger doesn't
 * accumulate retries on transient issues.
 */

interface SyncBody { entity?: string; id?: string }

function secretsMatch(a: string | null | undefined, b: string): boolean {
  if (!a) return false;
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

export async function POST(req: NextRequest) {
  const provided = req.headers.get("x-internal-secret");
  const expected = process.env.ZENDESK_SYNC_INTERNAL_SECRET?.trim();
  if (!expected) {
    console.error("[api/internal/zendesk/sync-status] ZENDESK_SYNC_INTERNAL_SECRET not configured");
    return NextResponse.json({ ok: false, error: "Endpoint not configured." }, { status: 500 });
  }
  if (!secretsMatch(provided, expected)) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  let body: SyncBody;
  try {
    body = (await req.json()) as SyncBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const entity = body.entity?.trim();
  const id = body.id?.trim();
  if (!id || !isValidUUID(id)) {
    return NextResponse.json({ ok: false, error: "Invalid id." }, { status: 400 });
  }
  if (entity !== "job" && entity !== "quote") {
    return NextResponse.json({ ok: false, error: "entity must be 'job' or 'quote'." }, { status: 400 });
  }

  const supabase = createServiceClient();

  // ─── Step 1: status sync ───────────────────────────────────────────────
  const syncResult = entity === "job"
    ? await syncJobZendeskStatus(id, supabase)
    : await syncQuoteZendeskStatus(id, supabase);

  if (!syncResult.ok) {
    console.error(`[zendesk sync] ${entity} ${id} status sync failed: ${syncResult.error}`);
  }

  let onHoldFieldsSync: Awaited<ReturnType<typeof syncJobZendeskOnHoldFields>> | null = null;
  if (entity === "job") {
    onHoldFieldsSync = await syncJobZendeskOnHoldFields(id, supabase);
    if (!onHoldFieldsSync.ok) {
      console.error(`[zendesk sync] job ${id} on-hold fields sync failed:`, onHoldFieldsSync.errors);
    }
  }

  // ─── Step 2: lifecycle side effects (idempotent via *_notice_sent_at) ──
  const lifecycle: Record<string, unknown> = {};
  try {
    if (entity === "job") {
      const { data } = await supabase
        .from("jobs")
        .select("status")
        .eq("id", id)
        .maybeSingle();
      const status = (data?.status as JobStatus | undefined) ?? null;

      // Always try the "created" dispatch — it self-skips when already sent.
      // This covers both new inserts and out-of-band re-sync requests.
      lifecycle.created = await dispatchJobCreatedZendesk({ jobId: id, client: supabase });

      if (status === "completed") {
        lifecycle.completed = await dispatchJobCompletedZendesk(id, supabase);
      } else if (status === "cancelled") {
        lifecycle.cancelled = await dispatchJobCancelledZendesk(id, supabase);
      }
    } else if (entity === "quote") {
      const { data } = await supabase
        .from("quotes")
        .select("status")
        .eq("id", id)
        .maybeSingle();
      const status = (data?.status as QuoteStatus | undefined) ?? null;
      if (status === "rejected") {
        lifecycle.rejected = await dispatchQuoteRejectedZendesk(id, supabase);
      }
    }
  } catch (err) {
    console.error(`[zendesk sync] ${entity} ${id} lifecycle dispatch failed:`, err);
    lifecycle.error = err instanceof Error ? err.message : String(err);
  }

  return NextResponse.json({ entity, id, sync: syncResult, onHoldFields: onHoldFieldsSync, lifecycle });
}
