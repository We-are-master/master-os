import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { isValidUUID } from "@/lib/auth-api";
import { createServiceClient } from "@/lib/supabase/service";

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
 * POST /api/internal/jobs/partner-portal-decline
 *
 * Parceiro recusou a oferta no portal (Fase 3 do auto-flow). A recusa:
 *   1. marca o invite como 'declined' (fallback 'lost' até a migração 279
 *      ser aplicada — o CHECK antigo não conhece 'declined');
 *   2. tira o parceiro da fila `auto_assign_invited_partner_ids`;
 * e com isso o job some da vitrine DELE (o vigia de ofertas nunca reconvida
 * quem recusou) e a fila anda em vez de esperar silêncio.
 *
 * Auth: header `x-internal-secret` = INTERNAL_SYNC_SECRET (mesmo do accept).
 * Body: { jobId: uuid, partnerId: uuid }
 */
export async function POST(req: NextRequest) {
  const provided = req.headers.get("x-internal-secret");
  const expected = process.env.INTERNAL_SYNC_SECRET?.trim();
  if (!expected) {
    console.error("[internal/partner-portal-decline] INTERNAL_SYNC_SECRET not configured");
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

  const { data: jobRow } = await supabase
    .from("jobs")
    .select("id, reference, status, partner_id, auto_assign_invited_partner_ids")
    .eq("id", jobId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!jobRow) {
    return NextResponse.json({ ok: false, error: "job_not_found" }, { status: 404 });
  }
  const job = jobRow as {
    id: string;
    reference: string;
    status: string;
    partner_id: string | null;
    auto_assign_invited_partner_ids: string[] | null;
  };
  if (job.partner_id === partnerId) {
    return NextResponse.json(
      { ok: false, error: "job_is_yours", message: "This job is already assigned to you — cancel it instead of declining." },
      { status: 409 },
    );
  }

  const now = new Date().toISOString();
  const upsertInvite = async (status: "declined" | "lost") =>
    supabase.from("job_partner_invites").upsert(
      {
        job_id: jobId,
        partner_id: partnerId,
        status,
        decided_at: now,
      },
      { onConflict: "job_id,partner_id" },
    );

  let { error: invErr } = await upsertInvite("declined");
  if (invErr && /check|23514/i.test(`${invErr.code} ${invErr.message}`)) {
    // Migração 279 ainda não aplicada: 'lost' preserva o efeito (some da
    // vitrine, nunca reconvida), só perde a distinção na métrica.
    ({ error: invErr } = await upsertInvite("lost"));
  }
  if (invErr) {
    console.error("[internal/partner-portal-decline] invite upsert failed:", invErr);
    return NextResponse.json({ ok: false, error: "decline_write_failed" }, { status: 500 });
  }

  const fila = (job.auto_assign_invited_partner_ids ?? []).filter((id) => id && id !== partnerId);
  await supabase
    .from("jobs")
    .update({ auto_assign_invited_partner_ids: fila })
    .eq("id", jobId)
    .eq("status", "auto_assigning")
    .is("partner_id", null);

  return NextResponse.json({ ok: true, declined: true, jobReference: job.reference });
}
