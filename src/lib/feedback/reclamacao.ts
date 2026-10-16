/**
 * "Este job teve reclamação?" Pergunta de quem vai pedir feedback ou avaliação.
 *
 * Pedir "was everything done to your satisfaction?" a quem reclamou é pior do
 * que não pedir nada (dono, 14/10/2026). A reclamação aparece em lugares
 * diferentes, e nenhum deles sozinho basta:
 *
 *   OS       on hold com preset/descrição/texto de complaint (`jobOnHoldPorReclamacao`;
 *            os campos ficam no job depois que ele sai de on hold), nota de
 *            reclamação do parceiro (`partner_feedback`), job de retrabalho
 *            (`remedial-of:JOB-X`) ou o próprio job ser um retrabalho.
 *   Zendesk  o ticket do job em 🚨 Complaint, com a tag `in_complaint`, no
 *            formulário de reclamação, ou que PASSOU por um desses (auditoria):
 *            reclamação resolvida continua sendo reclamação.
 *
 * As funções puras decidem sobre dados já lidos; as de leitura buscam.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { jobOnHoldPorReclamacao } from "@/lib/job-on-hold-reasons";
import { MARCA_RETRABALHO } from "@/lib/retrabalho";
import { ZD_STATUS_COMPLAINT } from "@/lib/zendesk-statuses";
import { zendeskApi } from "@/lib/zendesk";

/** Formulário "Complaint" do Zendesk (macro Move to Complaint). */
export const ZD_FORM_COMPLAINT = () => Number(process.env.ZENDESK_COMPLAINT_FORM_ID?.trim() || "5834299713951");

const TAG_DE_RECLAMACAO = /(^|_)complaints?($|_)/i;

export type JobParaReclamacao = {
  title?: string | null;
  internal_notes?: string | null;
  on_hold_reason_preset_id?: string | null;
  on_hold_reason?: string | null;
  on_hold_complaint_description?: string | null;
};

/** O que o próprio job diz. Null = nada; texto = o motivo, para o log. */
export function reclamacaoNoJob(job: JobParaReclamacao): string | null {
  if (jobOnHoldPorReclamacao(job)) return "job went on hold for a complaint";
  if (/^remedial:/i.test(String(job.title ?? "").trim()) || String(job.internal_notes ?? "").includes(MARCA_RETRABALHO)) {
    return "job is a remedial visit for a complaint";
  }
  return null;
}

export type TicketParaReclamacao = {
  custom_status_id?: number | null;
  ticket_form_id?: number | null;
  tags?: string[] | null;
};

export type EventoDeAuditoria = { type?: string; field_name?: string; value?: unknown };

/** O que o ticket diz, agora e no histórico. */
export function reclamacaoNoTicket(
  ticket: TicketParaReclamacao,
  auditorias: { events?: EventoDeAuditoria[] }[] = [],
): string | null {
  if (Number(ticket.custom_status_id) === ZD_STATUS_COMPLAINT) return "ticket is in 🚨 Complaint";
  if (Number(ticket.ticket_form_id) === ZD_FORM_COMPLAINT()) return "ticket is on the Complaint form";
  if ((ticket.tags ?? []).some((t) => TAG_DE_RECLAMACAO.test(t))) return "ticket has a complaint tag";
  for (const a of auditorias) {
    for (const e of a.events ?? []) {
      if (e.field_name === "custom_status_id" && Number(e.value) === ZD_STATUS_COMPLAINT) return "ticket went through 🚨 Complaint";
      if (e.field_name === "ticket_form_id" && Number(e.value) === ZD_FORM_COMPLAINT()) return "ticket went through the Complaint form";
      if (e.field_name === "tags") {
        const tags = Array.isArray(e.value) ? e.value : String(e.value ?? "").split(/\s+/);
        if (tags.some((t) => TAG_DE_RECLAMACAO.test(String(t)))) return "ticket had a complaint tag";
      }
    }
  }
  return null;
}

/** Reclamação registrada no OS por outro caminho: nota do parceiro ou retrabalho aberto. */
export async function reclamacaoNoBanco(
  sb: SupabaseClient,
  job: { id: string; reference: string },
): Promise<string | null> {
  const [notas, retrabalho] = await Promise.all([
    sb.from("partner_feedback").select("id").eq("job_id", job.id).eq("kind", "complaint").limit(1),
    sb.from("jobs").select("id").ilike("internal_notes", `%${MARCA_RETRABALHO}${job.reference}%`).limit(1),
  ]);
  // A tabela da mig 233 não existe em produção (14/10/2026): sem ela, esta
  // fonte só não conta. Qualquer outro erro sobe.
  const semTabela = notas.error && /could not find the table|does not exist|PGRST205|42P01/i.test(`${notas.error.code ?? ""} ${notas.error.message}`);
  if (notas.error && !semTabela) throw new Error(`partner_feedback: ${notas.error.message}`);
  if (retrabalho.error) throw new Error(`remedial lookup: ${retrabalho.error.message}`);
  if ((notas.data ?? []).length) return "partner has a complaint logged for this job";
  if ((retrabalho.data ?? []).length) return "a remedial visit was opened for this job";
  return null;
}

/** Lê o ticket e a auditoria. Erro sobe: quem chama decide (feedback: na dúvida, não pede). */
export async function reclamacaoNoZendesk(ticketId: string | number): Promise<string | null> {
  const t = await zendeskApi<{ ticket?: TicketParaReclamacao }>(`tickets/${encodeURIComponent(String(ticketId))}.json`);
  const agora = reclamacaoNoTicket(t.ticket ?? {});
  if (agora) return agora;
  const a = await zendeskApi<{ audits?: { events?: EventoDeAuditoria[] }[] }>(
    `tickets/${encodeURIComponent(String(ticketId))}/audits.json?per_page=100`,
  );
  return reclamacaoNoTicket({}, a.audits ?? []);
}

/**
 * Clientes com reclamação em algum job desde `desde` (só o OS: o e-mail de
 * avaliação roda em lote, e ler um ticket por cliente não cabe ali). Pega
 * também o retrabalho, que nasce no nome do mesmo cliente.
 */
export async function clientesComReclamacaoRecente(
  sb: SupabaseClient,
  clientIds: string[],
  desde: string,
): Promise<Set<string>> {
  const fora = new Set<string>();
  for (let i = 0; i < clientIds.length; i += 200) {
    const lote = clientIds.slice(i, i + 200);
    const { data, error } = await sb
      .from("jobs")
      .select("client_id, title, internal_notes, on_hold_reason_preset_id, on_hold_reason, on_hold_complaint_description")
      .in("client_id", lote)
      .gte("created_at", desde)
      .is("deleted_at", null);
    if (error) throw new Error(`complaint lookup: ${error.message}`);
    for (const j of data ?? []) if (j.client_id && reclamacaoNoJob(j)) fora.add(j.client_id);
  }
  return fora;
}
