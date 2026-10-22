import { NextRequest, NextResponse, after } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyPartnerReportToken, verifyVisitReportToken } from "@/lib/quote-response-token";
import { jobAfterVisitReport } from "@/lib/job-visit-advance-server";
import { ensureWeeklySelfBillForVisit } from "@/services/self-bills";
import type { Job, JobVisit } from "@/types/database";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import {
  isReportTemplate,
  parseReportPhotoEntries,
  persistReportSubmission,
  plannedPhotoShape,
  uploadedPhotoShape,
} from "@/lib/report-submission";
import { photosRefused } from "@/lib/public-report-templates";
import { registrarReportLink } from "@/lib/report-link-events";
import { validarSubmissaoDeReport } from "@/lib/report-health";
import { fillCertificateExpiry } from "@/lib/certificate-reader";
import { aplicarMaterialDaVisita, aplicarMaterialExtraDoReport, pendenciasDeMaterial } from "@/lib/report-material-extra";
import { FINAL_CHECK_AUTO_ON, runFinalCheckAutomatico } from "@/lib/final-check-automatico";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";
// Folga para o final check automático que roda em `after()` (fatura, PDF, e-mail).
export const maxDuration = 120;

function getServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SERVICE_ROLE_KEY!,
  );
}

/**
 * POST /api/quotes/submit-report   (public, token-authenticated)
 *
 * Used by the public quote link after the quote was accepted and a job was
 * created. Accepts the START and FINAL report fields together — there is no
 * timer here, the caller provides duration manually.
 *
 * Body: multipart/form-data
 *   token         JWT-like token from createQuoteResponseToken
 *   template      "general" | "gardener" | "cleaner" | "certificate"
 *   startData     JSON-stringified field map for start_report
 *   finalData     JSON-stringified field map for final_report  (includes duration_ms)
 *   photos[<slot>][]  one or more files per slot (already downscaled client-side):
 *     - general/gardener: slots "before" and "after"
 *     - cleaner:          slots "equipment" + room keys (living_room, hallways, …) for both start & final
 *     - certificate:      final "certificate" only (PDF or image)
 *
 * The write itself lives in `lib/report-submission`, shared with the office
 * modal — both doors have to produce the same payload for Stefane to read.
 * Idempotency: if both start_report and final_report were already submitted,
 * returns 409.
 */
export async function POST(req: NextRequest) {
  // Per-IP rate limit — public endpoint.
  const ip = getClientIp(req);
  const rl = checkRateLimit(`submit-report:${ip}`, 10, 10 * 60 * 1000);
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
  const verified = verifyPartnerReportToken(token);
  // Relatório de uma visita extra (19/10/2026): outro caminho, grava na visita.
  const daVisita = verified ? null : verifyVisitReportToken(token);
  if (daVisita) return enviarRelatorioDaVisita(form, daVisita.visitId, daVisita.partnerId);
  if (!verified) {
    return NextResponse.json(
      { error: "Invalid or expired report link. Reports must be submitted from the partner-specific link." },
      { status: 400 },
    );
  }
  const { jobId: tokenJobId, partnerId: tokenPartnerId } = verified;

  const template = String(form.get("template") ?? "").trim();
  if (!isReportTemplate(template)) {
    return NextResponse.json({ error: "Invalid template." }, { status: 400 });
  }

  let startData: Record<string, unknown> = {};
  let finalData: Record<string, unknown> = {};
  try {
    startData = JSON.parse(String(form.get("startData") ?? "{}")) as Record<string, unknown>;
    finalData = JSON.parse(String(form.get("finalData") ?? "{}")) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid startData/finalData JSON." }, { status: 400 });
  }

  const supabase = getServiceSupabase();

  // Resolve job from the token directly — the token is bound to job.id.
  const { data: job, error: jobErr } = await supabase
    .from("jobs")
    // Single-line literal: supabase-js infers the row type from the select
    // string, and a concatenated one degrades every column to `unknown`.
    .select("id, reference, status, partner_id, start_report_submitted, final_report_submitted, final_report, partner_timer_started_at, partner_timer_ended_at")
    .eq("id", tokenJobId)
    .is("deleted_at", null)
    .maybeSingle();
  if (jobErr || !job) {
    return NextResponse.json(
      { error: "Job not found." },
      { status: 404 },
    );
  }

  // Lock to the assigned partner: token must match the job's current
  // partner_id. If the partner was reassigned, older links stop working.
  if (!job.partner_id) {
    return NextResponse.json(
      { error: "This job has no partner assigned. Ask the office to assign a partner first." },
      { status: 409 },
    );
  }
  if (job.partner_id !== tokenPartnerId) {
    return NextResponse.json(
      { error: "This report link is for a different partner. Ask the office for an updated link." },
      { status: 403 },
    );
  }

  // Job cancelado não recebe report (15/10/2026): antes o envio o empurrava para Final checks.
  if (job.status === "cancelled") {
    await registrarReportLink(supabase, { jobId: job.id, partnerId: tokenPartnerId, event: "submit_refused", ok: false, detail: "cancelado" });
    return NextResponse.json({ error: "This job was cancelled, so no report is needed." }, { status: 409 });
  }

  if (job.start_report_submitted && job.final_report_submitted) {
    return NextResponse.json(
      { error: "A report has already been submitted for this job." },
      { status: 409 },
    );
  }

  /**
   * O portão da plataforma, na porta do parceiro: o que a Housekeep exige é
   * obrigatório aqui, e a recusa chega enquanto ele ainda está no imóvel —
   * não horas depois na revisão do escritório. A resposta de sucesso traz a
   * nota pelo mesmo motivo: submeteu, já sabe como ficou.
   */
  const fotos = parseReportPhotoEntries(form);
  /** Fotos que já subiram uma a uma pelo /report-upload (15/10/2026). */
  let enviadas: Record<string, string[]> = {};
  try {
    enviadas = JSON.parse(String(form.get("uploaded") ?? "{}")) as Record<string, string[]>;
  } catch {
    enviadas = {};
  }
  const jaNoStart = uploadedPhotoShape(template, "start", enviadas, job.id);
  const jaNoFinal = uploadedPhotoShape(template, "final", enviadas, job.id);
  const veredito = validarSubmissaoDeReport({
    template,
    finalData,
    // A limpeza guarda escopo e dano na chegada, e "cliente recusou foto" tira a exigência:
    // o link público não passava nenhum dos dois e prendia quem dizia a verdade.
    startData,
    photosRefused: photosRefused({ ...startData, ...finalData }),
    startPhotos: plannedPhotoShape(template, "start", fotos, jaNoStart),
    finalPhotos: plannedPhotoShape(template, "final", fotos, jaNoFinal),
    timerStartedAt: job.partner_timer_started_at ?? null,
    timerEndedAt: job.partner_timer_ended_at ?? null,
  });
  // Material comprado (19/10/2026): resposta obrigatória; Yes exige valor e foto do recibo.
  const faltaMaterial = pendenciasDeMaterial(template, finalData, (fotos.receipt ?? []).length);
  if (faltaMaterial.length) {
    veredito.ok = false;
    veredito.motivos.push(...faltaMaterial);
  }
  if (!veredito.ok) {
    await registrarReportLink(supabase, { jobId: job.id, partnerId: tokenPartnerId, event: "submit_refused", ok: false, detail: veredito.motivos.join(" · ").slice(0, 500) });
    return NextResponse.json(
      {
        error: "The report is missing what the client platform requires.",
        pendencias: veredito.motivos,
        nota: veredito.nota,
      },
      { status: 422 },
    );
  }

  const result = await persistReportSubmission(
    supabase,
    {
      id: job.id,
      reference: job.reference,
      status: job.status,
      partner_timer_started_at: job.partner_timer_started_at,
      partner_timer_ended_at: job.partner_timer_ended_at,
    },
    {
      template,
      source: "partner_link",
      startData,
      finalData,
      photos: fotos,
      writeStart: true,
      existingStartPhotos: jaNoStart,
      existingFinalPhotos: jaNoFinal,
    },
  );

  await registrarReportLink(supabase, {
    jobId: job.id,
    partnerId: tokenPartnerId,
    event: result.ok ? "submit" : "submit_refused",
    ok: result.ok,
    detail: result.ok ? null : result.error ?? "save failed",
    meta: { fotosNaHora: Object.values(enviadas).reduce((n, l) => n + (Array.isArray(l) ? l.length : 0), 0), fotosNoPacote: Object.values(fotos).reduce((n, l) => n + l.length, 0) },
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? "Could not save the report." }, { status: 500 });
  }

  // Material comprado on site vira dinheiro do job na hora: reembolso do
  // parceiro (materials_cost) + cobrança do cliente (extras_amount, custo+30%
  // quando o parceiro não deu o valor). Delta contra o final anterior, para o
  // caso raro de regravação com só o start submetido — nunca soma duas vezes.
  await aplicarMaterialExtraDoReport(supabase, job.id, {
    finalData,
    // O envelope guarda os campos no topo (buildReportPayload), não em `.data`.
    previousFinalData: job.final_report_submitted
      ? ((job.final_report as { data?: Record<string, unknown> } | null)?.data ?? (job.final_report as Record<string, unknown> | null) ?? null)
      : null,
  });

  // The partner is on a phone, on site, and the read takes several seconds:
  // it runs after the response so the form closes at the speed it always did.
  if (template === "certificate") {
    after(() => fillCertificateExpiry(supabase, job.id));
  }

  // Final check automático (FINAL_CHECK_AUTO=1): aprova e manda o e-mail final, ou deixa
  // para a equipe com nota no ticket. Em `after()`, esperado pela Vercel (um `void` morreria
  // com a resposta), para o formulário do parceiro não esperar fatura, PDF e e-mail.
  if (FINAL_CHECK_AUTO_ON()) {
    after(async () => {
      const r = await runFinalCheckAutomatico(supabase, job.id, { origem: "report_submitted" });
      console.log(`[final-check-auto] ${job.reference}: ${r.feito}`);
    });
  }

  return NextResponse.json({ ok: true, jobReference: job.reference, nota: veredito.nota, faixa: veredito.faixa });
}

/**
 * Relatório de UMA visita extra, pelo link dela (19/10/2026).
 *
 * Mesmo formulário e mesma checagem da plataforma; grava em `job_visits` e não no
 * job. Enviar o relatório é dizer que a visita aconteceu: ela fecha, entra no
 * self-bill do parceiro dela, e o job segue (próxima visita, ou Final review se
 * era a última).
 */
async function enviarRelatorioDaVisita(form: FormData, visitId: string, tokenPartnerId: string) {
  const template = String(form.get("template") ?? "").trim();
  if (!isReportTemplate(template)) {
    return NextResponse.json({ error: "Invalid template." }, { status: 400 });
  }
  let startData: Record<string, unknown> = {};
  let finalData: Record<string, unknown> = {};
  try {
    startData = JSON.parse(String(form.get("startData") ?? "{}")) as Record<string, unknown>;
    finalData = JSON.parse(String(form.get("finalData") ?? "{}")) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid startData/finalData JSON." }, { status: 400 });
  }

  const supabase = getServiceSupabase();
  const { data: visitRow } = await supabase
    .from("job_visits")
    .select("*")
    .eq("id", visitId)
    .is("deleted_at", null)
    .maybeSingle();
  const visit = visitRow as (JobVisit & { report_submitted_at?: string | null }) | null;
  if (!visit) return NextResponse.json({ error: "This visit is no longer in our system." }, { status: 404 });
  if (visit.partner_id !== tokenPartnerId) {
    return NextResponse.json({ error: "This visit is no longer assigned to you. Ask the office for an updated link." }, { status: 403 });
  }
  if (visit.status === "cancelled") {
    return NextResponse.json({ error: "This visit was cancelled, so no report is needed." }, { status: 409 });
  }
  if (visit.report_submitted_at) {
    return NextResponse.json({ error: "A report has already been submitted for this visit." }, { status: 409 });
  }
  const { data: jobRow } = await supabase
    .from("jobs")
    .select("id, reference, status")
    .eq("id", visit.job_id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!jobRow) return NextResponse.json({ error: "Job not found." }, { status: 404 });
  const job = jobRow as { id: string; reference: string; status: string };

  const fotos = parseReportPhotoEntries(form);
  let enviadas: Record<string, string[]> = {};
  try {
    enviadas = JSON.parse(String(form.get("uploaded") ?? "{}")) as Record<string, string[]>;
  } catch {
    enviadas = {};
  }
  const jaNoStart = uploadedPhotoShape(template, "start", enviadas, job.id);
  const jaNoFinal = uploadedPhotoShape(template, "final", enviadas, job.id);
  const veredito = validarSubmissaoDeReport({
    template,
    finalData,
    startData,
    photosRefused: photosRefused({ ...startData, ...finalData }),
    startPhotos: plannedPhotoShape(template, "start", fotos, jaNoStart),
    finalPhotos: plannedPhotoShape(template, "final", fotos, jaNoFinal),
    timerStartedAt: null,
    timerEndedAt: null,
  });
  const faltaMaterial = pendenciasDeMaterial(template, finalData, (fotos.receipt ?? []).length);
  if (faltaMaterial.length) {
    veredito.ok = false;
    veredito.motivos.push(...faltaMaterial);
  }
  if (!veredito.ok) {
    return NextResponse.json(
      { error: "The report is missing what the client platform requires.", pendencias: veredito.motivos, nota: veredito.nota },
      { status: 422 },
    );
  }

  const result = await persistReportSubmission(
    supabase,
    { id: job.id, reference: job.reference, status: job.status, partner_timer_started_at: null, partner_timer_ended_at: null },
    {
      template,
      source: "partner_link",
      startData,
      finalData,
      photos: fotos,
      writeStart: true,
      existingStartPhotos: jaNoStart,
      existingFinalPhotos: jaNoFinal,
      visit: { id: visit.id, index: visit.visit_index },
    },
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? "Could not save the report." }, { status: 500 });
  }

  // Material da visita: reembolso no parceiro DELA, cobrança somada no job (19/10/2026).
  await aplicarMaterialDaVisita(supabase, visit, { finalData, previousFinalData: null });

  // A visita aconteceu: fecha, paga o parceiro dela e o job segue.
  if (visit.status !== "completed") {
    const { data: fechada } = await supabase
      .from("job_visits")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", visit.id)
      .select()
      .single();
    after(async () => {
      try {
        const { data: fullJob } = await supabase.from("jobs").select("*").eq("id", job.id).maybeSingle();
        if (fullJob && fechada) await ensureWeeklySelfBillForVisit(fullJob as Job, fechada as JobVisit, { client: supabase });
        // O job segue: próxima visita, ou Final review se era a última (22/10/2026).
        await jobAfterVisitReport(supabase, job.id, { id: visit.id, visit_index: visit.visit_index });
      } catch (e) {
        console.error("[submit-report] visit close failed", e);
      }
    });
  }

  return NextResponse.json({ ok: true, jobReference: `${job.reference} · Visit ${visit.visit_index}`, nota: veredito.nota, faixa: veredito.faixa });
}
