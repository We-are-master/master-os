/**
 * POST /api/internal/jobs/partner-portal-cancel
 *
 * O parceiro cancela, no portal, um job que era dele.
 *   { jobId, partnerId, reason?, preview?: true }
 *
 * Com `preview`, só devolve a penalidade (o portal mostra antes de confirmar).
 * Sem ele:
 *   1. registra o cancelamento com a penalidade pela regra em vigor
 *      (305; v1 £50/24h do contrato atual, v2 50%/36h com PENALIDADE_V2=1);
 *   2. tira o parceiro do job e marca o convite dele como recusado (a
 *      oferta nunca volta para ele);
 *   3. o job volta para a oferta na hora, para os outros elegíveis; sem
 *      ninguém, vira unassigned com nota;
 *   4. nota interna no ticket do job.
 *
 * Auth: x-internal-secret = INTERNAL_SYNC_SECRET (mesmo do accept/decline).
 */

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { isValidUUID } from "@/lib/auth-api";
import { createServiceClient } from "@/lib/supabase/service";
import { horasAteAChegada, penalidadePelaRegra, regraEmVigor } from "@/lib/elegibilidade-parceiro";
import { matchPartnerIdsForWork } from "@/lib/partner-work-matching";
import { dispatchAutoAssignJobInvites } from "@/lib/auto-assign-job-invites";
import { resolveJobMatchServiceType } from "@/lib/zendesk-job-ingest";
import { extractUkPostcode } from "@/lib/uk-postcode";
import { updateTicket, addTicketTags } from "@/lib/zendesk";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function secretsMatch(a: string | null | undefined, b: string): boolean {
  if (!a) return false;
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  return aBuf.length === bBuf.length && timingSafeEqual(aBuf, bBuf);
}

const CANCELAVEL = new Set(["scheduled", "late"]);

export async function POST(req: NextRequest) {
  const expected = process.env.INTERNAL_SYNC_SECRET?.trim();
  if (!expected) return NextResponse.json({ ok: false, error: "Endpoint not configured." }, { status: 500 });
  if (!secretsMatch(req.headers.get("x-internal-secret"), expected)) return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { jobId?: string; partnerId?: string; reason?: string; preview?: boolean } | null;
  const jobId = body?.jobId?.trim() ?? "";
  const partnerId = body?.partnerId?.trim() ?? "";
  if (!isValidUUID(jobId) || !isValidUUID(partnerId)) return NextResponse.json({ ok: false, error: "jobId and partnerId required" }, { status: 400 });

  const supabase = createServiceClient();
  const { data: job } = await supabase.from("jobs").select("*").eq("id", jobId).is("deleted_at", null).maybeSingle();
  if (!job) return NextResponse.json({ ok: false, error: "job_not_found" }, { status: 404 });
  if (job.partner_id !== partnerId) return NextResponse.json({ ok: false, error: "not_your_job" }, { status: 409 });
  if (!CANCELAVEL.has(job.status)) return NextResponse.json({ ok: false, error: "not_cancellable", message: "This job can no longer be cancelled in the portal. Please call us." }, { status: 409 });

  const { data: empresa } = await supabase.from("company_settings").select("partner_cancellation_fee_gbp").limit(1).maybeSingle();
  const taxaV1 = Number((empresa as { partner_cancellation_fee_gbp?: number } | null)?.partner_cancellation_fee_gbp ?? 50) || 50;
  const regra = regraEmVigor();
  const inicio = (job.scheduled_start_at as string | null) ?? (job.scheduled_date ? `${String(job.scheduled_date).slice(0, 10)}T09:00:00Z` : null);
  const repasse = Number(job.partner_cost) || null;
  const penalidade = penalidadePelaRegra(regra, inicio, repasse, new Date(), taxaV1);
  const horas = inicio ? Math.round(horasAteAChegada(inicio) * 10) / 10 : null;
  const regraTexto = regra === "v1_50gbp_24h" ? `£${taxaV1} if cancelled less than 24 hours before arrival` : "50% of your pay if cancelled less than 36 hours before arrival";

  if (body?.preview) {
    return NextResponse.json({ ok: true, preview: true, penalty: penalidade, hoursBefore: horas, rule: regra, ruleText: regraTexto });
  }

  // 1. Registro
  const { error: regErr } = await supabase.from("partner_cancellations").insert({
    job_id: jobId,
    partner_id: partnerId,
    hours_before: horas,
    partner_pay: repasse,
    penalty_amount: penalidade,
    rule: regra,
    reason: body?.reason?.trim().slice(0, 500) || null,
  });
  if (regErr) {
    console.error("[partner-portal-cancel] registro falhou:", regErr);
    return NextResponse.json({ ok: false, error: "cancel_write_failed" }, { status: 500 });
  }

  // 2. Sai do job e nunca mais recebe esta oferta
  await supabase.from("job_partner_invites").upsert(
    { job_id: jobId, partner_id: partnerId, status: "declined", decided_at: new Date().toISOString() },
    { onConflict: "job_id,partner_id" },
  );

  // 3. De volta à oferta, sem quem cancelou
  const { serviceType, catalogServiceId } = await resolveJobMatchServiceType(supabase, job);
  const candidatos = (
    await matchPartnerIdsForWork(supabase, {
      serviceType,
      catalogServiceId,
      postcode: extractUkPostcode(job.property_address ?? ""),
      latitude: job.latitude ?? null,
      longitude: job.longitude ?? null,
      kind: "job",
      availabilitySlot: { scheduledDate: job.scheduled_date, startAt: job.scheduled_start_at, endAt: job.scheduled_end_at },
      jobId,
      partnerCost: repasse,
      degrau: "categoria",
    })
  ).filter((id) => id !== partnerId);

  await supabase
    .from("jobs")
    .update({
      partner_id: null,
      partner_name: null,
      partner_confirmed_at: null,
      status: candidatos.length ? "auto_assigning" : "unassigned",
      auto_assign_invited_partner_ids: candidatos.length ? candidatos : null,
    })
    .eq("id", jobId)
    .eq("partner_id", partnerId);

  if (candidatos.length) {
    await dispatchAutoAssignJobInvites({
      supabase,
      jobId,
      jobReference: job.reference,
      jobTitle: job.title || "Job",
      clientName: job.client_name || "·",
      propertyAddress: job.property_address || "·",
      scope: job.scope || "(no scope provided)",
      scheduledDate: job.scheduled_date,
      partnerIds: candidatos,
      zendeskTicketId: job.external_source === "zendesk" ? job.external_ref : null,
    }).catch((e) => console.error("[partner-portal-cancel] nova oferta falhou:", e));
  }

  // 4. Nota no ticket
  const ticket = job.external_source === "zendesk" ? String(job.external_ref ?? "").trim() : "";
  if (ticket) {
    const nota =
      `⚠️ PARTNER CANCELLED · ${job.reference}. ${horas != null ? `${horas}h before arrival. ` : ""}` +
      `Penalty under the current rule (${regraTexto}): £${penalidade.toFixed(2)}, waiting for approval in the OS. ` +
      (candidatos.length ? `Offered again to ${candidatos.length} partner(s).` : "No other eligible partner: the job is back in Unassigned.") +
      (body?.reason ? ` Reason given: ${body.reason.slice(0, 300)}` : "");
    await updateTicket({ ticketId: ticket, commentBody: nota, publicComment: false }).catch((e) => console.error("[partner-portal-cancel] nota falhou", e));
    await addTicketTags(ticket, ["partner_cancelled"]).catch(() => {});
  }

  return NextResponse.json({ ok: true, penalty: penalidade, rule: regra, reoffered: candidatos.length });
}
