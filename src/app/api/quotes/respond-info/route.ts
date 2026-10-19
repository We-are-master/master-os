import { categoriaDoServico } from "@/lib/report-category";
import { registrarReportLink } from "@/lib/report-link-events";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { quoteParaParceiro, nomesDeContas } from "@/lib/quote-para-parceiro";
import { parseBidProposalFromNotes } from "@/lib/quote-bid-payload";
import { normalizeJsonImageArray } from "@/lib/request-attachment-images";
import {
  verifyPartnerBidToken,
  verifyPartnerReportToken,
  verifyVisitReportToken,
  verifyQuoteResponseToken,
} from "@/lib/quote-response-token";

function getServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SERVICE_ROLE_KEY!,
  );
}

const fmtDate = (d: string | null | undefined) => {
  if (!d) return null;
  try {
    return new Date(d).toLocaleDateString(undefined, { dateStyle: "medium" });
  } catch {
    return d;
  }
};

/**
 * GET /api/quotes/respond-info?token=...
 * Public: quote summary for the customer Accept/Reject page (token must match).
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token || typeof token !== "string") {
    return NextResponse.json({ error: "Token is required" }, { status: 400 });
  }

  // Three token formats land on the same endpoint:
  //   - customer quote link  → carries quoteId only
  //   - partner bid link     → carries quoteId + partnerId, kind="bid"
  //   - partner report link  → carries jobId   + partnerId, kind="report"
  // We surface `tokenKind` so the page can pick the right UI.
  let quoteId: string | null = null;
  let tokenJobId: string | null = null;
  let tokenPartnerId: string | null = null;
  let tokenKind: "customer" | "partner_bid" | "partner_report" = "customer";
  /** Relatório de uma visita extra (19/10/2026): o token traz a visita, não o job. */
  let visitaDoToken: { visitId: string; partnerId: string } | null = null;

  const bidMatch = verifyPartnerBidToken(token);
  if (bidMatch) {
    quoteId = bidMatch.quoteId;
    tokenPartnerId = bidMatch.partnerId;
    tokenKind = "partner_bid";
  } else {
    const reportMatch = verifyPartnerReportToken(token);
    if (reportMatch) {
      tokenJobId = reportMatch.jobId;
      tokenPartnerId = reportMatch.partnerId;
      tokenKind = "partner_report";
    } else {
      const visitMatch = verifyVisitReportToken(token);
      if (visitMatch) {
        visitaDoToken = visitMatch;
        tokenPartnerId = visitMatch.partnerId;
        tokenKind = "partner_report";
      } else {
        quoteId = verifyQuoteResponseToken(token);
      }
    }
  }
  console.log(
    `[respond-info] tokenKind=${tokenKind} quoteId=${quoteId ?? "null"} tokenJobId=${tokenJobId ?? "null"} tokenPartnerId=${tokenPartnerId ?? "null"} tokenLen=${token.length}`,
  );
  const supabase = getServiceSupabase();

  type VisitaDoLink = { id: string; job_id: string; visit_index: number; partner_id: string | null; status: string; report_submitted_at: string | null };
  let visita = null as VisitaDoLink | null;
  if (visitaDoToken) {
    const { data } = await supabase
      .from("job_visits")
      .select("id, job_id, visit_index, partner_id, status, report_submitted_at")
      .eq("id", visitaDoToken.visitId)
      .is("deleted_at", null)
      .maybeSingle();
    visita = (data as VisitaDoLink | null) ?? null;
    if (visita) tokenJobId = visita.job_id;
  }

  if (!quoteId && !tokenJobId) {
    return NextResponse.json({ error: "Invalid or expired link" }, { status: 400 });
  }

  // For partner_report tokens, the token references a job directly (the job
  // may or may not have a parent quote). Resolve the job first, then pull
  // the optional parent quote for display context.
  if (!quoteId && tokenJobId) {
    const { data: jobByToken } = await supabase
      .from("jobs")
      .select("quote_id")
      .eq("id", tokenJobId)
      .is("deleted_at", null)
      .maybeSingle();
    quoteId = (jobByToken?.quote_id as string | null | undefined) ?? null;
  }

  // For partner_report jobs without a parent quote, fall back to job fields
  // so the page still has display context. Build a shaped "quote-ish" object.
  let quote:
    | {
        id: string;
        reference: string;
        title: string | null;
        client_name: string | null;
        property_address: string | null;
        scope: string | null;
        total_value: number | null;
        deposit_required: number | null;
        start_date_option_1: string | null;
        start_date_option_2: string | null;
        status: string;
        service_type: string | null;
      }
    | null = null;

  if (quoteId) {
    const { data: quoteRow, error: quoteError } = await supabase
      .from("quotes")
      .select(
        "id, reference, title, client_name, property_address, scope, total_value, deposit_required, start_date_option_1, start_date_option_2, status, service_type, request_id, images",
      )
      .eq("id", quoteId)
      .single();
    if (!quoteError && quoteRow) {
      quote = quoteRow as unknown as NonNullable<typeof quote>;
    }
  }

  // Synthetic display for jobs without a parent quote (partner_report only).
  // `jobs` table has no `service_type` column — that lives on `quotes` /
  // `service_requests`. Fall back to job.title for template detection on
  // the client (pickReportTemplate handles a null serviceType gracefully).
  if (!quote && tokenKind === "partner_report" && tokenJobId) {
    const { data: jobRow } = await supabase
      .from("jobs")
      .select("id, reference, title, client_name, property_address, scope, status")
      .eq("id", tokenJobId)
      .is("deleted_at", null)
      .maybeSingle();
    if (jobRow) {
      quote = {
        id: jobRow.id as string,
        reference: jobRow.reference as string,
        title: (jobRow.title as string | null) ?? null,
        client_name: (jobRow.client_name as string | null) ?? null,
        property_address: (jobRow.property_address as string | null) ?? null,
        scope: (jobRow.scope as string | null) ?? null,
        total_value: null,
        deposit_required: null,
        start_date_option_1: null,
        start_date_option_2: null,
        status: "converted_to_job",
        service_type: null,
      };
    }
  }

  if (!quote) {
    return NextResponse.json({ error: "Quote or job not found" }, { status: 404 });
  }

  // When the quote was already converted to a job, surface the linked job's
  // identity + report submission state so the public page can switch from
  // accept/reject UI to the report submission form.
  let linkedJob: {
    id: string;
    reference: string;
    serviceType: string | null;
    /** Categoria do serviço do job: decide o formulário do report. */
    categorySlug: string | null;
    status: string;
    title: string | null;
    propertyAddress: string | null;
    startReportSubmitted: boolean;
    finalReportSubmitted: boolean;
  } | null = null;

  /** Por que o formulário do report não abre, em palavras para o parceiro. */
  let reportBlock: { motivo: string; mensagem: string } | null = null;

  // Bid context: when this is a partner-bid token AND the quote is still in
  // bidding state, surface the partner display name + any existing bid the
  // partner has already submitted (so the form preloads / shows "you've
  // already bid X, update?").
  let bidContext:
    | {
        partnerName: string | null;
        existingBid: {
          amount: number;
          jobType: "fixed" | "hourly";
          notes: string | null;
          payload: ReturnType<typeof parseBidProposalFromNotes>;
        } | null;
      }
    | null = null;

  if (tokenKind === "partner_bid" && tokenPartnerId && quote.status === "bidding") {
    const { data: partner } = await supabase
      .from("partners")
      .select("contact_name, company_name")
      .eq("id", tokenPartnerId)
      .maybeSingle();
    const partnerName =
      (partner?.company_name?.trim() || partner?.contact_name?.trim()) ?? null;
    const { data: existing } = await supabase
      .from("quote_bids")
      .select("bid_amount, job_type, notes")
      .eq("quote_id", quote.id)
      .eq("partner_id", tokenPartnerId)
      .maybeSingle();
    const existingNotes = (existing?.notes as string | null) ?? null;
    bidContext = {
      partnerName,
      existingBid: existing
        ? {
            amount:  Number(existing.bid_amount) || 0,
            jobType: (existing.job_type as "fixed" | "hourly") ?? "fixed",
            notes:   existingNotes,
            payload: parseBidProposalFromNotes(existingNotes),
          }
        : null,
    };
  }

  if (tokenKind === "partner_report" && tokenJobId) {
    // `jobs` has no service_type column — template detection on the client
    // uses job.title (via pickReportTemplate) as the fallback.
    const { data: jobRow, error: jobLookupError } = await supabase
      .from("jobs")
      .select("id, reference, status, title, property_address, partner_id, start_report_submitted, final_report_submitted, catalog_service_id")
      .eq("id", tokenJobId)
      .is("deleted_at", null)
      .maybeSingle();
    console.log(
      `[respond-info] partner_report job lookup: id=${tokenJobId} found=${!!jobRow} jobPartnerId=${jobRow?.partner_id ?? "null"} tokenPartnerId=${tokenPartnerId} match=${!!jobRow && jobRow.partner_id === tokenPartnerId} err=${jobLookupError?.message ?? "none"}`,
    );
    /**
     * O motivo de não abrir, dito com todas as letras (15/10/2026): antes tudo virava
     * "link inválido" e o parceiro achava que o link tinha quebrado.
     */
    const statusJob = String((jobRow as { status?: string } | null)?.status ?? "");
    // Na visita, o dono do link é o parceiro DA VISITA, e o estado que conta é o dela.
    const parceiroDoLink = visitaDoToken ? visita?.partner_id ?? null : jobRow?.partner_id ?? null;
    reportBlock = !jobRow || (visitaDoToken && !visita)
      ? { motivo: "job_removido", mensagem: "This job is no longer in our system. Please contact the Fixfy team." }
      : visita?.status === "cancelled"
        ? { motivo: "cancelado", mensagem: "This visit was cancelled, so no report is needed. Thank you." }
      : !parceiroDoLink || parceiroDoLink !== tokenPartnerId
        ? { motivo: "outro_parceiro", mensagem: "This job is no longer assigned to you, so there is no report to send. If you think this is wrong, contact the Fixfy team." }
        : statusJob === "cancelled"
          ? { motivo: "cancelado", mensagem: "This job was cancelled, so no report is needed. Thank you." }
          : !visitaDoToken && (statusJob === "completed" || statusJob === "awaiting_payment")
            ? { motivo: "concluido", mensagem: "This job is already closed and approved. Thank you, nothing else is needed." }
            : null;
    await registrarReportLink(supabase, {
      jobId: jobRow?.id ?? tokenJobId,
      partnerId: tokenPartnerId,
      event: reportBlock ? "open_refused" : "open",
      ok: !reportBlock,
      detail: reportBlock?.motivo ?? null,
    });
    if (jobRow && parceiroDoLink === tokenPartnerId && !reportBlock) {
      const visitaEnviada = !!visita?.report_submitted_at;
      linkedJob = {
        id:                    jobRow.id,
        reference:             visita ? `${jobRow.reference} · Visit ${visita.visit_index}` : jobRow.reference,
        serviceType:           quote.service_type ?? null,
        categorySlug:          await categoriaDoServico(supabase, (jobRow as { catalog_service_id?: string | null }).catalog_service_id),
        status:                jobRow.status as string,
        title:                 (jobRow.title as string | null) ?? null,
        propertyAddress:       (jobRow.property_address as string | null) ?? null,
        startReportSubmitted:  visita ? visitaEnviada : !!jobRow.start_report_submitted,
        finalReportSubmitted:  visita ? visitaEnviada : !!jobRow.final_report_submitted,
      };
    }
  }

  const { data: rows } = await supabase
    .from("quote_line_items")
    .select("description, quantity, unit_price, total")
    .eq("quote_id", quoteId)
    .order("sort_order");

  const lineItems = (rows ?? []).map(
    (r: { description: string; quantity: number; unit_price: number; total: number }) => ({
      description: r.description,
      quantity: Number(r.quantity) || 1,
      unitPrice: Number(r.unit_price) || 0,
      total: Number(r.total) || (Number(r.quantity) || 1) * (Number(r.unit_price) || 0),
    }),
  );

  /**
   * As fotos do site, para a galeria da página (27/08): o email de Quote
   * Request só linkava o arquivo cru — clicava e abria UMA foto, sem galeria.
   * Mesma origem que o email usa: as imagens do service_request da quote.
   */
  /**
   * As fotos da PRÓPRIA quote primeiro, e só depois as do request.
   *
   * Mesma correção que o e-mail de convite já tinha recebido, no outro lado do
   * mesmo par: quote que nasce de um ticket do Zendesk não tem `request_id`,
   * então esta busca voltava vazia e a galeria da página de bid ficava sem
   * nada — mesmo com as fotos gravadas em `quotes.images`. O parceiro recebia
   * o e-mail com as fotos e clicava num "#photos" que não existia.
   *
   * Visto no QT-2026-1139 (07/09/2026), com as duas fotos do ticket 50156 já
   * no bucket.
   */
  let photoUrls: string[] = normalizeJsonImageArray((quote as { images?: unknown }).images);
  const requestId = (quote as { request_id?: string | null }).request_id;
  if (photoUrls.length === 0 && requestId) {
    const { data: sr } = await supabase
      .from("service_requests")
      .select("images")
      .eq("id", requestId)
      .maybeSingle();
    photoUrls = normalizeJsonImageArray((sr as { images?: unknown } | null)?.images);
  }

  /**
   * Esta rota serve as DUAS pontas: o cliente que responde a proposta e o
   * parceiro que dá o lance no mesmo `quoteId`. Só a ponta do parceiro é
   * filtrada. O cliente perderia o próprio nome se a limpeza fosse geral, e é
   * dele o nome que está ali.
   *
   * `partner_report` entra junto: é o parceiro de novo, na página de relatório.
   */
  const paraParceiro = tokenKind !== "customer";
  const seguro = paraParceiro
    ? quoteParaParceiro(quote, {
        scope: quote.scope ?? null,
        nomesProibidos: await nomesDeContas(supabase),
      })
    : null;

  const responseBody = {
    reference: quote.reference,
    title: seguro ? seguro.typeOfWork : quote.title,
    clientName: seguro ? seguro.clientName : quote.client_name,
    propertyAddress: quote.property_address ?? null,
    scope: seguro ? seguro.scope : (quote.scope ?? null),
    serviceType: seguro ? seguro.typeOfWork : (quote.service_type ?? null),
    totalValue: Number(quote.total_value) || 0,
    depositRequired: Number(quote.deposit_required) || 0,
    startDateOption1: fmtDate(quote.start_date_option_1 ?? undefined),
    startDateOption2: fmtDate(quote.start_date_option_2 ?? undefined),
    status: quote.status,
    lineItems,
    photoUrls,
    tokenKind,
    linkedJob,
    reportBlock,
    bidContext,
  };
  console.log(
    `[respond-info] response: tokenKind=${tokenKind} linkedJob=${linkedJob ? `{${linkedJob.reference}}` : "null"} bidContext=${bidContext ? "set" : "null"} status=${quote.status}`,
  );
  return NextResponse.json(responseBody);
}
