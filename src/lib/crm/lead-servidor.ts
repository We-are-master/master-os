/**
 * CRM do lado do servidor (rotas, rotinas do fixfy-workers, Harvey).
 *
 * Tudo recebe o SupabaseClient de quem chama (normalmente o de serviço). As
 * mesmas regras de src/lib/crm/etapas.ts: quem move a etapa é a aplicação,
 * nunca trigger, e Won não volta.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Lead,
  LeadEventActor,
  LeadEventChannel,
  LeadEventKind,
  LeadLostReason,
  LeadStage,
  QuoteStatus,
} from "@/types/database";
import { isOpenStage, legacyStatusFromStage, stageFromQuoteStatus } from "./etapas";

export type EventoDoLead = {
  leadId: string;
  kind: LeadEventKind;
  channel?: LeadEventChannel | null;
  actorType?: LeadEventActor;
  actorId?: string | null;
  fromStage?: LeadStage | null;
  toStage?: LeadStage | null;
  summary?: string | null;
  payload?: Record<string, unknown>;
  /** Mesma chave = mesmo evento (webhook repetido não duplica). */
  idempotencyKey?: string | null;
};

/** Grava na timeline. Nunca derruba quem chamou. Devolve false se já existia ou falhou. */
export async function registrarEvento(sb: SupabaseClient, e: EventoDoLead): Promise<boolean> {
  const row = {
    lead_id: e.leadId,
    kind: e.kind,
    channel: e.channel ?? null,
    actor_type: e.actorType ?? "system",
    actor_id: e.actorId ?? null,
    from_stage: e.fromStage ?? null,
    to_stage: e.toStage ?? null,
    summary: e.summary ?? null,
    payload: e.payload ?? {},
    idempotency_key: e.idempotencyKey ?? null,
  };
  try {
    if (e.idempotencyKey) {
      const { data, error } = await sb
        .from("lead_events")
        .upsert(row, { onConflict: "idempotency_key", ignoreDuplicates: true })
        .select("id");
      if (error) {
        console.warn("[lead_events]", error.message);
        return false;
      }
      return (data ?? []).length > 0;
    }
    const { error } = await sb.from("lead_events").insert(row);
    if (error) {
      console.warn("[lead_events]", error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn("[lead_events]", err instanceof Error ? err.message : err);
    return false;
  }
}

const COLUNAS_LEAD =
  "id, reference, name, stage, segment, status, job_id, account_id, client_id, external_source, external_ref, next_action, next_action_at, customer_replied_at, last_contact_at, nurture_until, deleted_at";

/** O lead vivo de um ticket do Zendesk, se houver. */
export async function acharLeadPorTicket(sb: SupabaseClient, ticketId: string | number): Promise<Lead | null> {
  const ref = String(ticketId ?? "").trim();
  if (!ref) return null;
  const { data } = await sb
    .from("leads")
    .select(COLUNAS_LEAD)
    .eq("external_source", "zendesk")
    .eq("external_ref", ref)
    .is("deleted_at", null)
    .maybeSingle();
  return (data as Lead | null) ?? null;
}

export type MoverEtapa = {
  to: LeadStage;
  actorType?: LeadEventActor;
  actorId?: string | null;
  lostReason?: LeadLostReason | null;
  lostNote?: string | null;
  nurtureUntil?: string | null;
  jobId?: string | null;
  summary?: string | null;
  channel?: LeadEventChannel | null;
  /** Para não repetir o mesmo evento numa rotina que passa de novo. */
  idempotencyKey?: string | null;
};

/**
 * Move a etapa no servidor. Regras de proteção (rotina automática não erra
 * para pior): Won nunca sai de Won; Lost sem motivo vira "other".
 * Devolve a etapa final (igual à de antes quando não mexeu).
 */
export async function moverEtapa(sb: SupabaseClient, lead: Pick<Lead, "id" | "stage" | "job_id">, m: MoverEtapa): Promise<LeadStage> {
  const from = (lead.stage ?? "new") as LeadStage;
  if (from === m.to) return from;
  if (from === "won") return from;
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {
    stage: m.to,
    stage_changed_at: now,
    status: legacyStatusFromStage(m.to),
    updated_at: now,
  };
  if (m.to === "lost") {
    patch.lost_reason = m.lostReason ?? "other";
    patch.lost_note = m.lostNote ?? null;
    patch.lost_at = now;
    // Data de volta (ex-Nurture): no dia o lead volta sozinho para New lead.
    patch.nurture_until = m.nurtureUntil ?? null;
  } else if (from === "lost") {
    patch.nurture_until = null;
  }
  if (m.to === "won") {
    const jobId = m.jobId ?? lead.job_id;
    if (!jobId) return from;
    patch.job_id = jobId;
    patch.won_at = now;
  }
  const { error } = await sb.from("leads").update(patch).eq("id", lead.id).is("deleted_at", null);
  if (error) throw new Error(`lead ${lead.id}: ${error.message}`);
  await registrarEvento(sb, {
    leadId: lead.id,
    kind: "stage_changed",
    channel: m.channel ?? "os",
    actorType: m.actorType ?? "system",
    actorId: m.actorId ?? null,
    fromStage: from,
    toStage: m.to,
    summary: m.summary ?? null,
    idempotencyKey: m.idempotencyKey ?? null,
  });
  return m.to;
}

/**
 * Etapa que o lead deve ter pelas quotes dele. A quote mais avançada vence;
 * se todas foram recusadas, Lost. Sem quote: null (a etapa é do lead).
 */
export function etapaPelasQuotes(statuses: QuoteStatus[]): LeadStage | null {
  if (!statuses.length) return null;
  const ordem: LeadStage[] = ["quoting", "quoted", "won"];
  let melhor: LeadStage | null = null;
  for (const s of statuses) {
    const e = stageFromQuoteStatus(s);
    if (e === "lost") continue;
    if (!melhor || ordem.indexOf(e) > ordem.indexOf(melhor)) melhor = e;
  }
  return melhor ?? "lost";
}

/**
 * A etapa pelas quotes e pelos jobs delas. O job do aceite com entrada nasce
 * junto com o aceite (quote em awaiting_payment, job esperando o pagamento):
 * isso ainda é Quoted. Won é quote convertida, job de quote em outro status
 * ou o job já ligado no lead.
 */
export function alvoPelasQuotes(
  quotes: { status: QuoteStatus; jobId?: string | null }[],
  jobDoLead: string | null | undefined,
): { stage: LeadStage | null; jobId: string | null } {
  if (jobDoLead) return { stage: "won", jobId: jobDoLead };
  const ganha = quotes.find((q) => q.jobId && q.status !== "awaiting_payment" && q.status !== "rejected");
  if (ganha) return { stage: "won", jobId: ganha.jobId ?? null };
  const alvo = etapaPelasQuotes(quotes.map((q) => q.status));
  // converted_to_job sem job achado: fica em Quoted até o job aparecer.
  return { stage: alvo === "won" ? "quoted" : alvo, jobId: null };
}

export type ResultadoSync = { lidos: number; movidos: number; ganhos: number; erros: string[] };

const LOTE = 200;

/**
 * Alinha a etapa dos leads com as quotes e os jobs deles. Roda depois de
 * qualquer mudança de quote e também na rotina do espelho (10 min), então
 * nenhum caminho que muda quote precisa lembrar de mexer no lead.
 *
 * - Lead em Lost só é puxado de volta se uma quote dele estiver viva.
 * - Won exige job: pega o job que nasceu de uma quote do lead.
 */
export async function sincronizarEtapasPelasQuotes(
  sb: SupabaseClient,
  opts: { leadIds?: string[]; aplicar?: boolean } = {},
): Promise<ResultadoSync> {
  const aplicar = opts.aplicar ?? true;
  const r: ResultadoSync = { lidos: 0, movidos: 0, ganhos: 0, erros: [] };
  type QuoteDoLead = { id: string; lead_id: string; status: QuoteStatus; rejection_reason?: string | null };
  const quotes: QuoteDoLead[] = [];
  // Global: de mil em mil (o PostgREST corta em 1000). Por lead: os ids em lotes.
  const filtros = opts.leadIds?.length ? chunks(opts.leadIds, LOTE) : [null];
  for (const ids of filtros) {
    for (let de = 0; ; de += 1000) {
      let q = sb
        .from("quotes")
        .select("id, lead_id, status, rejection_reason")
        .not("lead_id", "is", null)
        .is("deleted_at", null)
        .order("id")
        .range(de, de + 999);
      if (ids) q = q.in("lead_id", ids);
      const { data, error } = await q;
      if (error) {
        r.erros.push(error.message);
        return r;
      }
      quotes.push(...((data ?? []) as QuoteDoLead[]));
      if ((data ?? []).length < 1000) break;
    }
  }
  const porLead = new Map<string, QuoteDoLead[]>();
  for (const x of quotes) {
    const l = porLead.get(x.lead_id) ?? [];
    l.push(x);
    porLead.set(x.lead_id, l);
  }
  const ids = [...porLead.keys()];
  if (!ids.length) return r;

  const leads: Pick<Lead, "id" | "stage" | "job_id">[] = [];
  for (const lote of chunks(ids, LOTE)) {
    const { data } = await sb.from("leads").select("id, stage, job_id").in("id", lote).is("deleted_at", null);
    leads.push(...((data ?? []) as Pick<Lead, "id" | "stage" | "job_id">[]));
  }
  const jobPorQuote = new Map<string, string>();
  for (const lote of chunks(quotes.map((x) => x.id), LOTE)) {
    const { data: jobs } = await sb.from("jobs").select("id, quote_id, status").in("quote_id", lote).is("deleted_at", null);
    for (const j of (jobs ?? []) as { id: string; quote_id: string; status: string }[]) {
      if (j.status !== "cancelled" && j.status !== "deleted") jobPorQuote.set(j.quote_id, j.id);
    }
  }

  for (const lead of leads) {
    r.lidos++;
    const qs = porLead.get(lead.id) ?? [];
    const { stage: alvo, jobId } = alvoPelasQuotes(
      qs.map((x) => ({ status: x.status, jobId: jobPorQuote.get(x.id) ?? null })),
      lead.job_id,
    );
    if (!alvo) continue;
    const atual = (lead.stage ?? "new") as LeadStage;
    if (atual === alvo || atual === "won") continue;
    // Lead pausado ou perdido à mão: só volta se a quote estiver viva.
    if (atual === "lost" && alvo === "lost") continue;
    if (!aplicar) {
      r.movidos++;
      if (alvo === "won") r.ganhos++;
      continue;
    }
    try {
      const recusa = qs.find((x) => x.status === "rejected")?.rejection_reason ?? null;
      const fim = await moverEtapa(sb, lead, {
        to: alvo,
        jobId,
        lostReason: alvo === "lost" ? "other" : null,
        lostNote: alvo === "lost" ? recusa : null,
        summary: alvo === "won" ? "Job created from the quote" : "Stage follows the quote",
      });
      if (fim !== atual) {
        r.movidos++;
        if (fim === "won") {
          r.ganhos++;
          await registrarEvento(sb, {
            leadId: lead.id,
            kind: "job_created",
            channel: "os",
            payload: { job_id: jobId },
            idempotencyKey: `job_created:${lead.id}:${jobId}`,
          });
        }
      }
    } catch (e) {
      r.erros.push(e instanceof Error ? e.message : String(e));
    }
  }
  return r;
}

function chunks<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

/**
 * Depois de qualquer escrita de status de quote no servidor: liga a quote ao
 * lead do mesmo ticket (se ainda não tem lead) e alinha a etapa. Nunca lança:
 * quem chamou (envio da quote, aceite, varredura) não pode quebrar por causa
 * do CRM. Antes da mig 356 a coluna lead_id não existe e isto só não faz nada.
 */
export async function sincronizarLeadDaQuote(
  sb: SupabaseClient,
  quoteId: string | null | undefined,
  opts: { evento?: "quote_created" | "quote_sent"; chaveDoEvento?: string | null } = {},
): Promise<void> {
  if (!quoteId) return;
  try {
    const { data: q, error } = await sb
      .from("quotes")
      .select("id, reference, lead_id, external_source, external_ref, total_value")
      .eq("id", quoteId)
      .maybeSingle();
    if (error || !q) return;
    let leadId = (q.lead_id as string | null) ?? null;
    if (!leadId && q.external_source === "zendesk" && q.external_ref) {
      const lead = await acharLeadPorTicket(sb, String(q.external_ref));
      if (lead && lead.stage !== "won") {
        const { error: e2 } = await sb.from("quotes").update({ lead_id: lead.id }).eq("id", quoteId).is("lead_id", null);
        if (!e2) leadId = lead.id;
      }
    }
    if (!leadId) return;
    if (opts.evento) {
      const valor = Number(q.total_value ?? 0);
      await registrarEvento(sb, {
        leadId,
        kind: opts.evento,
        channel: "os",
        summary: `${q.reference ?? "Quote"}${valor > 0 ? ` · £${valor.toFixed(2)}` : ""}`,
        payload: { quote_id: quoteId },
        idempotencyKey: `${opts.evento}:${quoteId}:${opts.chaveDoEvento ?? ""}`,
      });
    }
    const r = await sincronizarEtapasPelasQuotes(sb, { leadIds: [leadId] });
    if (r.erros.length) console.warn("[crm] sync da quote", quoteId, r.erros.join("; "));
  } catch (e) {
    console.warn("[crm] sync da quote", quoteId, e instanceof Error ? e.message : e);
  }
}

/** O lead pelo id (vivo). */
async function acharLeadPorId(sb: SupabaseClient, id: string): Promise<Lead | null> {
  const { data } = await sb.from("leads").select(COLUNAS_LEAD).eq("id", id).is("deleted_at", null).maybeSingle();
  return (data as Lead | null) ?? null;
}

type OndeEstaOLead = { ticketId?: string | number | null; leadId?: string | null };

async function acharLead(sb: SupabaseClient, onde: OndeEstaOLead): Promise<Lead | null> {
  if (onde.leadId) return acharLeadPorId(sb, onde.leadId);
  if (onde.ticketId != null) return acharLeadPorTicket(sb, onde.ticketId);
  return null;
}

/**
 * O cliente escreveu no ticket (webhook do Zendesk ou do Harvey). Marca a
 * resposta para a Fila Today e registra a mensagem. Lead em Nurture volta
 * para Talking: ele respondeu. Sem ticket conhecido, `leadId` acha o lead.
 */
export async function marcarRespostaDoCliente(
  sb: SupabaseClient,
  input: OndeEstaOLead & { at?: string; channel?: LeadEventChannel; resumo?: string | null; eventoId?: string | null },
): Promise<{ leadId: string | null; novo: boolean }> {
  const lead = await acharLead(sb, input);
  if (!lead) return { leadId: null, novo: false };
  const at = input.at ?? new Date().toISOString();
  const onde = input.ticketId ?? lead.id;
  const novo = await registrarEvento(sb, {
    leadId: lead.id,
    kind: "message_in",
    channel: input.channel ?? "zendesk",
    actorType: "customer",
    summary: input.resumo ? input.resumo.slice(0, 280) : null,
    idempotencyKey: input.eventoId ? `in:${onde}:${input.eventoId}` : null,
  });
  if (!novo && input.eventoId) return { leadId: lead.id, novo: false };
  await sb
    .from("leads")
    .update({ customer_replied_at: at, last_contact_at: at, updated_at: new Date().toISOString() })
    .eq("id", lead.id);
  // Perdido com data de volta (ex-Nurture) e o cliente escreveu: volta antes da data.
  if (lead.stage === "lost" && lead.nurture_until) {
    await moverEtapa(sb, lead, { to: "qualifying", actorType: "customer", channel: input.channel ?? "zendesk", summary: "Customer replied" });
  }
  return { leadId: lead.id, novo: true };
}

/** Nós respondemos no ticket: a resposta do cliente deixa de estar pendente. */
export async function marcarRespostaNossa(
  sb: SupabaseClient,
  input: OndeEstaOLead & { at?: string; channel?: LeadEventChannel; actorType?: LeadEventActor; resumo?: string | null; eventoId?: string | null },
): Promise<{ leadId: string | null }> {
  const lead = await acharLead(sb, input);
  if (!lead) return { leadId: null };
  const at = input.at ?? new Date().toISOString();
  const onde = input.ticketId ?? lead.id;
  const novo = await registrarEvento(sb, {
    leadId: lead.id,
    kind: "message_out",
    channel: input.channel ?? "zendesk",
    actorType: input.actorType ?? "staff",
    summary: input.resumo ? input.resumo.slice(0, 280) : null,
    idempotencyKey: input.eventoId ? `out:${onde}:${input.eventoId}` : null,
  });
  if (!novo && input.eventoId) return { leadId: lead.id };
  const patch: Record<string, unknown> = { last_contact_at: at, customer_replied_at: null, updated_at: new Date().toISOString() };
  const { error } = await sb.from("leads").update(patch).eq("id", lead.id);
  if (error) console.warn("[crm] resposta nossa:", error.message);
  if (lead.stage === "new") {
    await moverEtapa(sb, lead, { to: "qualifying", actorType: input.actorType ?? "staff", channel: input.channel ?? "zendesk", summary: "First reply sent" });
  }
  return { leadId: lead.id };
}

/** Lead perdido com data de volta: no dia ele volta para New lead com próximo passo. */
export async function acordarNurture(sb: SupabaseClient, hoje: string, aplicar = true): Promise<number> {
  const { data } = await sb
    .from("leads")
    .select("id, stage, job_id, nurture_until")
    .eq("stage", "lost")
    .not("nurture_until", "is", null)
    .lte("nurture_until", hoje)
    .is("deleted_at", null);
  let n = 0;
  for (const lead of (data ?? []) as Pick<Lead, "id" | "stage" | "job_id">[]) {
    n++;
    if (!aplicar) continue;
    await moverEtapa(sb, lead, { to: "new", summary: "Come-back date reached", idempotencyKey: `nurture_back:${lead.id}:${hoje}` });
    await sb
      .from("leads")
      .update({ next_action: "Check in with the customer", next_action_at: new Date().toISOString() })
      .eq("id", lead.id);
  }
  return n;
}

export { isOpenStage };
