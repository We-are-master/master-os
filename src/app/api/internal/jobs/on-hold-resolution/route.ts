import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { isValidUUID } from "@/lib/auth-api";
import { createServiceClient } from "@/lib/supabase/service";
import { updateTicket, isZendeskConfigured } from "@/lib/zendesk";
import { syncJobZendeskOnHoldFields } from "@/lib/zendesk-job-on-hold-sync";
import {
  normalizarDatasDeRetorno,
  hojeEmLondres,
} from "@/lib/job-on-hold-datas-de-retorno";
import { lerResolucao, notaDaResolucao, type Resolucao } from "@/lib/job-on-hold-resolucao";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function secretsMatch(a: string | null | undefined, b: string): boolean {
  if (!a) return false;
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * POST /api/internal/jobs/on-hold-resolution
 *
 * O parceiro respondeu a espera PELO PORTAL, não pelo link do e-mail.
 *
 * A porta do e-mail existe desde sempre e nunca foi usada: 19 jobs passaram por
 * on hold e nenhum parceiro respondeu, nem uma vez. O link é canal frio. O
 * portal é onde ele já entra para dar preço em quote, então a resolução passa a
 * morar lá também — mesma informação, canal onde ele está.
 *
 * O que grava, e o que NÃO grava: escreve `on_hold_submission` (o que foi feito
 * mais as datas em que pode voltar) e põe nota INTERNA no ticket. Não tira o
 * job da espera e não fala com o cliente: quem retoma é o escritório, e quem
 * escolhe as datas a oferecer é o passo seguinte.
 *
 * Auth: header `x-internal-secret` = INTERNAL_SYNC_SECRET (mesmo do accept).
 * Body: { jobId: uuid, partnerId: uuid, notes: string, availableDates?: string[] }
 */
export async function POST(req: NextRequest) {
  const provided = req.headers.get("x-internal-secret");
  const expected = process.env.INTERNAL_SYNC_SECRET?.trim();
  if (!expected) {
    console.error("[internal/on-hold-resolution] INTERNAL_SYNC_SECRET not configured");
    return NextResponse.json({ ok: false, error: "Endpoint not configured." }, { status: 500 });
  }
  if (!secretsMatch(provided, expected)) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  let body: { jobId?: string; partnerId?: string; notes?: string; availableDates?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const jobId = body.jobId?.trim() ?? "";
  const partnerId = body.partnerId?.trim() ?? "";
  const notes = body.notes?.trim() ?? "";
  if (!isValidUUID(jobId) || !isValidUUID(partnerId)) {
    return NextResponse.json({ ok: false, error: "jobId and partnerId must be UUIDs." }, { status: 400 });
  }
  // A trava de nota vale só para o formato antigo: no novo, quem cobra os
  // campos é o `lerResolucao`, e ele devolve TODOS de uma vez em vez de o
  // parceiro descobrir um por vez, no celular, a caminho de outro job.
  if (!notes && typeof (body as Record<string, unknown>).remedy !== "string") {
    return NextResponse.json({ ok: false, error: "Tell us what happened before sending." }, { status: 400 });
  }

  /**
   * Formato novo: ESCOLHA (voltar ou desconto) mais duas janelas.
   *
   * O antigo (texto livre + datas soltas) continua aceito porque o portal
   * deploya separado do OS: se este subir primeiro, o parceiro que já estava
   * com o formulário aberto ainda consegue mandar. Sem `remedy` no corpo, é o
   * caminho velho.
   */
  const hoje = hojeEmLondres();
  const temEscolha = typeof (body as Record<string, unknown>).remedy === "string";
  let resolucao: Resolucao | null = null;
  if (temEscolha) {
    const v = lerResolucao(body, hoje);
    if (!v.ok) {
      return NextResponse.json({ ok: false, error: v.erros.join(" "), errors: v.erros }, { status: 400 });
    }
    resolucao = v.resolucao;
  }
  const { datas, recusadas } = resolucao
    ? { datas: resolucao.ofertas.map((o) => o.data), recusadas: [] as Array<{ valor: string; motivo: string }> }
    : normalizarDatasDeRetorno(body.availableDates, hoje);

  const supabase = createServiceClient();
  const { data: jobRow, error: jobErr } = await supabase
    .from("jobs")
    .select("id, reference, status, partner_id, external_source, external_ref, on_hold_submission, property_address")
    .eq("id", jobId)
    .is("deleted_at", null)
    .maybeSingle();
  if (jobErr || !jobRow) {
    return NextResponse.json({ ok: false, error: "Job not found." }, { status: 404 });
  }
  const job = jobRow as unknown as {
    id: string;
    reference: string;
    status: string;
    partner_id: string | null;
    external_source: string | null;
    external_ref: string | null;
    on_hold_submission: { notes?: string | null; photos?: string[]; available_dates?: string[] } | null;
  };

  /**
   * Só o parceiro DO job responde por ele, e só enquanto ele está em espera.
   * Sem as duas travas, o segredo interno viraria uma porta para escrever em
   * qualquer job a partir do portal de qualquer parceiro.
   */
  if (job.partner_id !== partnerId) {
    return NextResponse.json({ ok: false, error: "This job is not yours." }, { status: 403 });
  }
  if (job.status !== "on_hold") {
    return NextResponse.json(
      { ok: false, error: `This job is not on hold (it is ${job.status}).` },
      { status: 409 },
    );
  }

  // As fotos que já existirem seguem intactas: a outra porta é quem as manda.
  const now = new Date().toISOString();
  const priorPhotos = Array.isArray(job.on_hold_submission?.photos) ? job.on_hold_submission!.photos! : [];
  const submission = {
    notes,
    photos: priorPhotos,
    // `available_dates` continua existindo: é o que o card do OS já lê hoje.
    available_dates: datas,
    remedy: resolucao?.remedio ?? null,
    offers: resolucao?.ofertas ?? [],
    discount_gbp: resolucao?.descontoGbp ?? null,
    partner_id: partnerId,
    submitted_at: now,
  };
  const { error: updErr } = await supabase
    .from("jobs")
    .update({ on_hold_submission: submission, on_hold_submission_at: now, updated_at: now })
    .eq("id", job.id);
  if (updErr) {
    console.error("[internal/on-hold-resolution] job update failed:", updErr);
    return NextResponse.json({ ok: false, error: "Could not save. Please try again." }, { status: 500 });
  }

  const { data: parceiroRow } = await supabase
    .from("partners").select("company_name, contact_name").eq("id", partnerId).maybeSingle();
  const nomeDoParceiro =
    (parceiroRow as { company_name?: string | null; contact_name?: string | null } | null)?.company_name?.trim() ||
    (parceiroRow as { contact_name?: string | null } | null)?.contact_name?.trim() ||
    null;

  const ticketId = job.external_source === "zendesk" ? job.external_ref : null;
  if (ticketId && isZendeskConfigured()) {
    /**
     * Com a escolha, a nota já sai com o texto pronto para o cliente. É o mesmo
     * desenho do preço: a máquina redige, uma pessoa lê e manda. Reclamação é a
     * conversa mais cara que a gente tem para o Harvey mandar sozinho.
     */
    const html = resolucao
      ? `<pre style="white-space:pre-wrap;font-family:inherit;margin:0;">${escapeHtml(
          notaDaResolucao(resolucao, {
            referencia: job.reference,
            endereco: (jobRow as { property_address?: string | null }).property_address ?? null,
            parceiro: nomeDoParceiro,
          }),
        )}</pre>`
      : `<p><strong>🔧 Partner submitted an on-hold resolution</strong> (job ${escapeHtml(job.reference)}, from the partner portal)</p>` +
        `<p style="white-space:pre-wrap;">${escapeHtml(notes)}</p>` +
        (datas.length
          ? `<p><strong>Can return on:</strong> ${datas.map(escapeHtml).join(" · ")}</p>`
          : `<p><em>No return dates given.</em></p>`);
    try {
      await updateTicket({ ticketId, htmlBody: html, publicComment: false });
    } catch (err) {
      console.error("[internal/on-hold-resolution] zendesk internal note failed:", err);
    }
    void syncJobZendeskOnHoldFields(job.id, supabase).catch((err: unknown) => {
      console.error("[internal/on-hold-resolution] zendesk field sync failed:", err);
    });
  }

  void supabase.from("audit_logs").insert({
    entity_type: "job",
    entity_id: job.id,
    entity_ref: job.reference,
    action: "updated",
    field_name: "on_hold_submission",
    new_value: `${datas.length} return date(s) + notes`,
    metadata: { source: "partner_portal", available_dates: datas },
  }).then(({ error }) => { if (error) console.error("[internal/on-hold-resolution] audit insert failed:", error); });

  return NextResponse.json({ ok: true, jobReference: job.reference, availableDates: datas, rejectedDates: recusadas });
}
