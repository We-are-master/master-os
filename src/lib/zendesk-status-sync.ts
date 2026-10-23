/**
 * OS → Zendesk status sync.
 *
 * Single place that maps internal job/quote status onto the linked Zendesk
 * ticket's custom_status_id. Called both directly from API routes and
 * indirectly from the Postgres trigger that fires on `jobs.status` /
 * `quotes.status` updates (see migration 166_zendesk_status_sync_trigger.sql).
 *
 * Idempotent and side-effect-only — safe to call repeatedly. Skips silently
 * when the entity isn't Zendesk-linked or Zendesk isn't configured.
 *
 * Desde 23/10/2026 o ticket ESPELHA o OS inteiro (zendesk-espelho.ts): status, dono
 * por papel e o campo Action Required. Lê o ticket, calcula a diferença e escreve só
 * o que mudou, num PUT. Ticket closed não aceita mais nada: volta skip "ticket_closed".
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import {
  addTicketTags,
  getZendeskTicketId,
  isZendeskConfigured,
  removeTicketTags,
  zendeskApi,
  ZENDESK_AWAITING_PAYMENT_TAG,
} from "@/lib/zendesk";
import { jobStatusForZendeskSync, stalePartnerBookedJobPatch } from "@/lib/job-partner-assign";
import type { JobStatus, QuoteStatus } from "@/types/database";
import { espelhoDaQuote, espelhoDoJob, mudancasNoTicket, type Espelho, type Mudanca, type PapelDoTicket, type TicketAtual } from "@/lib/zendesk-espelho";
import { ACTION_REQUIRED_FIELD_ID, ACTION_REQUIRED_NO, ACTION_REQUIRED_YES, notaDaAcao, valorDoCampo } from "@/lib/fila-de-acao";
import { papeisDaEquipe } from "@/lib/responsavel-operacao";
import { jobOnHoldPorReclamacao } from "@/lib/job-on-hold-reasons";
import { MOTIVOS, type Motivo } from "@/lib/pendencias/motivos";
import { baseStatusForCustomStatusId } from "@/lib/zendesk-statuses";

// ─── Status maps (compatibilidade: quem só quer o número) ───────────────────

/** quote.status → custom_status_id do Zendesk (null = não fala com o ticket). */
export function quoteStatusToZendesk(status: QuoteStatus): number | null {
  return espelhoDaQuote(status)?.customStatusId ?? null;
}

/** job.status → custom_status_id da etapa, sem as camadas de dinheiro e reclamação. */
export function jobStatusToZendesk(status: JobStatus): number | null {
  if (status === "deleted") return null;
  return espelhoDoJob({ status, esperandoEntrada: false, motivos: [], reclamacao: false })?.customStatusId ?? null;
}

// ─── Sync result ─────────────────────────────────────────────────────────────

export type ZendeskSyncSkipReason =
  | "not_zendesk_linked"
  | "no_ticket_id"
  | "zendesk_not_configured"
  | "no_status_mapping"
  | "entity_not_found"
  /** O ticket está closed: o Zendesk não aceita mudança nenhuma. */
  | "ticket_closed"
  /** O ticket tem job: o job manda, a quote não mexe. */
  | "job_owns_ticket"
  /** Já estava igual ao OS. */
  | "already_mirrored";

export interface ZendeskSyncResult {
  ok: boolean;
  /** True when we made an API call to Zendesk. False when we skipped or errored. */
  synced: boolean;
  ticketId?: string;
  customStatusId?: number;
  /** O que foi (ou seria) escrito. */
  changes?: Mudanca;
  /** When synced=false, why we skipped. */
  skip?: ZendeskSyncSkipReason;
  /** When ok=false, the error message. */
  error?: string;
}

// ─── Leitura e escrita do ticket ────────────────────────────────────────────

/** Campos que o Zendesk exige para Solved. */
const WHAT_HAPPENED_FIELD_ID = Number(process.env.ZENDESK_WHAT_HAPPENED_FIELD_ID?.trim() || "5687150349343");
const CLOSING_SUMMARY_FIELD_ID = Number(process.env.ZENDESK_CLOSING_SUMMARY_FIELD_ID?.trim() || "6417950403231");

/** Campo Reply Status (🔴 reply_awaiting / 🟢 reply_replied). */
const REPLY_STATUS_FIELD_ID = Number(process.env.ZENDESK_REPLY_STATUS_FIELD_ID?.trim() || "5698641403423");

type TicketCru = {
  id: number;
  status: string | null;
  custom_status_id: number | null;
  assignee_id: number | null;
  custom_fields?: Array<{ id: number; value: unknown }>;
};

export function ticketAtualDe(t: TicketCru): TicketAtual {
  return {
    status: t.status,
    customStatusId: t.custom_status_id ?? null,
    assigneeId: t.assignee_id ?? null,
    actionRequired: valorDoCampo(t.custom_fields, ACTION_REQUIRED_FIELD_ID),
    replyStatus: valorDoCampo(t.custom_fields, REPLY_STATUS_FIELD_ID),
  };
}

async function lerTicketCru(ticketId: string): Promise<TicketCru | null> {
  const { ticket } = await zendeskApi<{ ticket?: TicketCru }>(`tickets/${ticketId}.json`);
  return ticket ?? null;
}

/** Os tickets em lotes de 100 (show_many). Id que não é número fica de fora. */
export async function lerTicketsCrus(ids: string[]): Promise<Map<string, TicketCru>> {
  const validos = [...new Set(ids.filter((i) => /^\d+$/.test(i)))];
  const out = new Map<string, TicketCru>();
  for (let i = 0; i < validos.length; i += 100) {
    const { tickets } = await zendeskApi<{ tickets?: TicketCru[] }>(`tickets/show_many.json?ids=${validos.slice(i, i + 100).join(",")}`);
    for (const t of tickets ?? []) out.set(String(t.id), t);
  }
  return out;
}

async function donoDoPapel(): Promise<(p: PapelDoTicket) => number> {
  const papeis = await papeisDaEquipe();
  return (p) => papeis[p].zendesk_user_id;
}

/**
 * Escreve a diferença. Dono fora do grupo do ticket faz o Zendesk recusar o PUT
 * inteiro: aí tenta de novo sem o dono, para o status nunca ficar para trás.
 */
export async function escreverEspelho(ticketId: string, alvo: Espelho, m: Mudanca, cru?: TicketCru | null): Promise<void> {
  const campos: Array<{ id: number; value: string }> = [];
  if (m.customStatusId != null && alvo.fechamento) {
    if (!valorDoCampo(cru?.custom_fields, WHAT_HAPPENED_FIELD_ID)) campos.push({ id: WHAT_HAPPENED_FIELD_ID, value: alvo.fechamento.whatHappened });
    if (!valorDoCampo(cru?.custom_fields, CLOSING_SUMMARY_FIELD_ID)) campos.push({ id: CLOSING_SUMMARY_FIELD_ID, value: alvo.fechamento.resumo });
  }
  const montar = (comDono: boolean) => {
    const ticket: Record<string, unknown> = {};
    if (m.customStatusId != null) {
      ticket.custom_status_id = m.customStatusId;
      const base = baseStatusForCustomStatusId(m.customStatusId);
      if (base) ticket.status = base;
    }
    if (comDono && m.assigneeId != null) ticket.assignee_id = m.assigneeId;
    const todos = [...campos];
    if (m.actionRequired != null) {
      todos.push({ id: ACTION_REQUIRED_FIELD_ID, value: m.actionRequired ? ACTION_REQUIRED_YES : ACTION_REQUIRED_NO });
      if (m.actionRequired && alvo.proximaAcao) ticket.comment = { public: false, body: notaDaAcao(alvo.proximaAcao) };
    }
    if (todos.length) ticket.custom_fields = todos;
    return { ticket };
  };
  try {
    await zendeskApi(`tickets/${ticketId}.json`, { method: "PUT", body: montar(true) });
  } catch (err) {
    if (m.assigneeId == null || !/assignee|group/i.test(String(err))) throw err;
    await zendeskApi(`tickets/${ticketId}.json`, { method: "PUT", body: montar(false) });
  }
}

/** Compara e escreve (ou só diz, com aplicar=false). */
export async function aplicarEspelho(
  ticketId: string,
  alvo: Espelho,
  opcoes: { aplicar?: boolean; ticket?: TicketCru | null; dono?: (p: PapelDoTicket) => number } = {},
): Promise<ZendeskSyncResult> {
  const cru = opcoes.ticket ?? (await lerTicketCru(ticketId));
  if (!cru) return { ok: false, synced: false, ticketId, error: "ticket not found", skip: "entity_not_found" };
  if (cru.status === "closed") return { ok: true, synced: false, ticketId, customStatusId: alvo.customStatusId, skip: "ticket_closed" };
  const m = mudancasNoTicket(alvo, ticketAtualDe(cru), opcoes.dono ?? (await donoDoPapel()));
  if (Object.keys(m).length === 0) return { ok: true, synced: false, ticketId, customStatusId: alvo.customStatusId, skip: "already_mirrored" };
  if (opcoes.aplicar === false) return { ok: true, synced: false, ticketId, customStatusId: alvo.customStatusId, changes: m };
  await escreverEspelho(ticketId, alvo, m, cru);
  return { ok: true, synced: true, ticketId, customStatusId: alvo.customStatusId, changes: m };
}

// ─── O espelho de um job ────────────────────────────────────────────────────

export const CAMPOS_DO_JOB_NO_ESPELHO =
  "id, reference, status, quote_id, external_source, external_ref, partner_id, partner_ids, auto_assign_invited_partner_ids, auto_assign_expires_at, on_hold_reason_preset_id, on_hold_reason, on_hold_complaint_description";

export type JobDoEspelho = {
  id: string;
  reference?: string | null;
  status: JobStatus;
  quote_id?: string | null;
  partner_id?: string | null;
  partner_ids?: string[] | null;
  on_hold_reason_preset_id?: string | null;
  on_hold_reason?: string | null;
  on_hold_complaint_description?: string | null;
};

/** O alvo do ticket de um job, com o que já foi lido (motivos e status da quote). */
export function alvoDoJob(job: JobDoEspelho, motivos: string[], statusDaQuote: string | null): Espelho | null {
  const status = jobStatusForZendeskSync(job as Parameters<typeof jobStatusForZendeskSync>[0]);
  if (status === "deleted") return null;
  return espelhoDoJob({
    status,
    esperandoEntrada: status === "unassigned" && statusDaQuote === "awaiting_payment",
    motivos: motivos.filter((m): m is Motivo => (MOTIVOS as readonly string[]).includes(m)),
    reclamacao: jobOnHoldPorReclamacao(job),
    motivoDoOnHold: job.on_hold_reason ?? null,
    referencia: job.reference ?? null,
  });
}

/**
 * Sync the linked Zendesk ticket to mirror the job: status, owner and Action Required.
 * No-ops if the job isn't Zendesk-linked.
 */
export async function syncJobZendeskStatus(
  jobId: string,
  client?: SupabaseClient,
): Promise<ZendeskSyncResult> {
  const supabase = client ?? createServiceClient();

  const { data: job, error } = await supabase.from("jobs").select(CAMPOS_DO_JOB_NO_ESPELHO).eq("id", jobId).single();
  if (error || !job) {
    return { ok: false, synced: false, error: error?.message ?? "Job not found", skip: "entity_not_found" };
  }

  const ticketId = getZendeskTicketId(job);
  if (!ticketId) {
    return { ok: true, synced: false, skip: job.external_source === "zendesk" ? "no_ticket_id" : "not_zendesk_linked" };
  }
  if (!isZendeskConfigured()) {
    return { ok: true, synced: false, skip: "zendesk_not_configured" };
  }

  const repairPatch = stalePartnerBookedJobPatch(job as Parameters<typeof stalePartnerBookedJobPatch>[0]);
  if (Object.keys(repairPatch).length > 0) {
    const { error: repairErr } = await supabase.from("jobs").update(repairPatch).eq("id", jobId);
    if (repairErr) console.error(`[zendesk-status-sync] stale partner repair failed job=${jobId}:`, repairErr);
    else Object.assign(job, repairPatch);
  }

  const syncStatus = jobStatusForZendeskSync(job as Parameters<typeof jobStatusForZendeskSync>[0]);

  // Awaiting Payment (dono, 18/08/2026): a view "Awaiting Payment" do Zendesk lista
  // pela tag. Best-effort: falha de tag não derruba o espelho.
  if (syncStatus !== "deleted") {
    try {
      if (syncStatus === "awaiting_payment") await addTicketTags(ticketId, [ZENDESK_AWAITING_PAYMENT_TAG]);
      else await removeTicketTags(ticketId, [ZENDESK_AWAITING_PAYMENT_TAG]);
    } catch (err) {
      console.error(`[zendesk-status-sync] awaiting_payment tag sync failed ticket=${ticketId}:`, err);
    }
  }

  let statusDaQuote: string | null = null;
  if (syncStatus === "unassigned" && job.quote_id) {
    const { data: cot } = await supabase.from("quotes").select("status").eq("id", job.quote_id).maybeSingle();
    statusDaQuote = (cot as { status?: string } | null)?.status ?? null;
  }
  const { data: abertos } = await supabase.from("job_attention_reasons").select("reason").eq("job_id", jobId).is("resolved_at", null);
  const alvo = alvoDoJob(job as JobDoEspelho, (abertos ?? []).map((r: { reason: string }) => r.reason), statusDaQuote);
  if (!alvo) return { ok: true, synced: false, ticketId, skip: "no_status_mapping" };

  try {
    return await aplicarEspelho(ticketId, alvo);
  } catch (err) {
    return { ok: false, synced: false, ticketId, customStatusId: alvo.customStatusId, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Sync the linked Zendesk ticket to mirror the quote (status and owner). No-ops if the
 * quote isn't Zendesk-linked, or if a job already lives on the same ticket.
 */
export async function syncQuoteZendeskStatus(
  quoteId: string,
  client?: SupabaseClient,
): Promise<ZendeskSyncResult> {
  const supabase = client ?? createServiceClient();

  const { data: quote, error } = await supabase.from("quotes").select("id, status, automation_status, external_source, external_ref").eq("id", quoteId).single();
  if (error || !quote) {
    return { ok: false, synced: false, error: error?.message ?? "Quote not found", skip: "entity_not_found" };
  }

  const ticketId = getZendeskTicketId(quote);
  if (!ticketId) {
    return { ok: true, synced: false, skip: quote.external_source === "zendesk" ? "no_ticket_id" : "not_zendesk_linked" };
  }
  if (!isZendeskConfigured()) {
    return { ok: true, synced: false, skip: "zendesk_not_configured" };
  }

  const alvo = espelhoDaQuote(quote.status as QuoteStatus, (quote as { automation_status?: string | null }).automation_status);
  if (!alvo) return { ok: true, synced: false, ticketId, skip: "no_status_mapping" };

  const { data: jobNoTicket } = await supabase
    .from("jobs")
    .select("id")
    .eq("external_source", "zendesk")
    .eq("external_ref", ticketId)
    .is("deleted_at", null)
    .limit(1);
  if ((jobNoTicket ?? []).length > 0) return { ok: true, synced: false, ticketId, skip: "job_owns_ticket" };

  try {
    return await aplicarEspelho(ticketId, alvo);
  } catch (err) {
    return { ok: false, synced: false, ticketId, customStatusId: alvo.customStatusId, error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── Job aberto com ticket closed ───────────────────────────────────────────

/**
 * Ticket closed não aceita mudança nenhuma, e o job ainda está aberto no OS (o ticket foi
 * resolvido à mão e o Zendesk fechou de vez). O OS abre um follow-up do ticket antigo
 * (mesmo cliente, mesma organização, ligado pelo Zendesk), só com nota interna, e o job
 * passa a apontar para ele. Dali em diante o espelho segue normal.
 */
export async function abrirFollowUpDoJob(
  supabase: SupabaseClient,
  job: { id: string; reference?: string | null; status: string },
  ticketAntigoId: string,
  alvo: Espelho,
): Promise<{ ok: boolean; novoTicketId?: string; error?: string }> {
  try {
    const { ticket: antigo } = await zendeskApi<{ ticket?: { subject?: string; requester_id?: number; organization_id?: number | null; group_id?: number | null } }>(`tickets/${ticketAntigoId}.json`);
    if (!antigo?.requester_id) return { ok: false, error: "old ticket has no requester" };
    const dono = alvo.papel ? (await donoDoPapel())(alvo.papel) : undefined;
    const base = baseStatusForCustomStatusId(alvo.customStatusId);
    const { ticket: novo } = await zendeskApi<{ ticket?: { id: number } }>("tickets.json", {
      method: "POST",
      body: {
        ticket: {
          via_followup_source_id: Number(ticketAntigoId),
          subject: antigo.subject ?? `${job.reference ?? "Job"}`,
          requester_id: antigo.requester_id,
          ...(antigo.organization_id ? { organization_id: antigo.organization_id } : {}),
          ...(antigo.group_id ? { group_id: antigo.group_id } : {}),
          ...(dono ? { assignee_id: dono } : {}),
          custom_status_id: alvo.customStatusId,
          ...(base ? { status: base } : {}),
          comment: {
            public: false,
            body: `Follow-up of #${ticketAntigoId}: ${job.reference ?? "the job"} is still open in the OS (${job.status}), but that ticket was closed and can no longer change. The OS mirrors the job here from now on. Close or finish it in the OS and this ticket closes by itself.`,
          },
        },
      },
    });
    if (!novo?.id) return { ok: false, error: "Zendesk did not return the new ticket" };
    const { error } = await supabase.from("jobs").update({ external_ref: String(novo.id) }).eq("id", job.id);
    if (error) return { ok: false, novoTicketId: String(novo.id), error: `ticket created, job not relinked: ${error.message}` };
    await zendeskApi(`tickets/${ticketAntigoId}/tags.json`, { method: "PUT", body: { tags: [`followup_${novo.id}`] } }).catch(() => null);
    return { ok: true, novoTicketId: String(novo.id) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
