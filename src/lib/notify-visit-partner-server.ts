import type { SupabaseClient } from "@supabase/supabase-js";
import { buildPartnerJobConfirmationEmail } from "@/lib/emails/partner-job-confirmation";
import { partnerEmailGreetingName } from "@/lib/emails/partner-greeting-name";
import { loadPartnerJobEmailNotes } from "@/lib/partner-job-email-notes";
import { createSideConversation, replyToSideConversation } from "@/lib/zendesk";
import { isSupabaseMissingColumnError } from "@/lib/supabase-schema-compat";

/**
 * Confirmação de trabalho para o parceiro de UMA visita.
 *
 * Por que não entrou dentro de `notifyPartnerJobZendesk`: aquela função lê
 * `jobs.partner_id`, o preço do job e a thread do job em ~15 pontos. Visita 2 é
 * outro parceiro, outro preço, outra data e precisa de outra thread — costurar
 * isso lá dentro mexeria no caminho de comunicação de todos os jobs para
 * atender um caso novo. Aqui reusa-se o mesmo template de email, que é o que
 * o parceiro precisa ver igual.
 *
 * Thread: cada visita guarda a sua em `job_visits.zendesk_side_conversation_id`
 * (mig 275). A do job pertence ao parceiro primário — responder nela mandaria a
 * conversa do eletricista para o handyman.
 */

export type NotifyVisitPartnerResult = {
  ok: boolean;
  skipped?: string;
  sideConversationId?: string | null;
  error?: string;
};

type VisitRow = {
  id: string;
  job_id: string;
  visit_index: number;
  partner_id: string | null;
  catalog_service_id: string | null;
  scheduled_date: string | null;
  scheduled_start_at: string | null;
  scheduled_end_at: string | null;
  partner_cost: number | null;
  scope: string | null;
  zendesk_side_conversation_id: string | null;
};

type JobRow = {
  id: string;
  reference: string;
  title: string | null;
  client_id: string | null;
  client_name: string | null;
  property_address: string | null;
  scope: string | null;
  external_source: string | null;
  external_ref: string | null;
};

type PartnerRow = {
  id: string;
  contact_name: string | null;
  company_name: string | null;
  email: string | null;
  zendesk_user_id: string | null;
};

export async function notifyVisitPartner(
  supabase: SupabaseClient,
  jobId: string,
  visitId: string,
): Promise<NotifyVisitPartnerResult> {
  const { data: visitRow } = await supabase
    .from("job_visits")
    .select("id, job_id, visit_index, partner_id, catalog_service_id, scheduled_date, scheduled_start_at, scheduled_end_at, partner_cost, scope, zendesk_side_conversation_id")
    .eq("id", visitId)
    .eq("job_id", jobId)
    .is("deleted_at", null)
    .maybeSingle();
  const visit = visitRow as VisitRow | null;
  if (!visit) return { ok: false, skipped: "visit_not_found" };
  if (!visit.partner_id) return { ok: false, skipped: "no_partner" };

  const { data: jobRow } = await supabase
    .from("jobs")
    .select("id, reference, title, client_id, client_name, property_address, scope, external_source, external_ref")
    .eq("id", jobId)
    .maybeSingle();
  const job = jobRow as JobRow | null;
  if (!job) return { ok: false, skipped: "job_not_found" };

  const { data: partnerRow } = await supabase
    .from("partners")
    .select("id, contact_name, company_name, email, zendesk_user_id")
    .eq("id", visit.partner_id)
    .maybeSingle();
  const partner = partnerRow as PartnerRow | null;
  if (!partner) return { ok: false, skipped: "partner_not_found" };
  if (!partner.email) return { ok: false, skipped: "partner_has_no_email" };

  // Email de parceiro sai por Side Conversation, que exige ticket do Zendesk.
  const zendeskTicketId = job.external_source === "zendesk" ? job.external_ref : null;
  if (!zendeskTicketId) return { ok: false, skipped: "not_a_zendesk_job" };

  let clientPhone: string | null = null;
  if (job.client_id) {
    const { data: client } = await supabase
      .from("clients")
      .select("phone")
      .eq("id", job.client_id)
      .maybeSingle();
    clientPhone = (client?.phone as string | null) ?? null;
  }

  const partnerNotes = await loadPartnerJobEmailNotes(supabase, {
    catalogServiceId: visit.catalog_service_id,
    jobTitle: job.title,
    jobType: "fixed",
  });

  const email = buildPartnerJobConfirmationEmail({
    partnerFirstName: partnerEmailGreetingName(partner),
    // A referência carrega a visita: o parceiro da visita 3 precisa saber que
    // não é o mesmo trabalho do parceiro da visita 1 no mesmo endereço.
    jobReference: `${job.reference} · Visit ${visit.visit_index}`,
    jobTitle: job.title || "Maintenance job",
    clientName: job.client_name || "—",
    clientPhone,
    propertyAddress: job.property_address || "—",
    scheduledDate: visit.scheduled_date,
    scheduledStartAt: visit.scheduled_start_at,
    scheduledEndAt: visit.scheduled_end_at,
    scheduledFinishDate: null,
    // Escopo da visita quando existir; senão o do job, que é melhor que nada.
    scope: visit.scope?.trim() || job.scope || "(no scope provided)",
    jobType: "fixed",
    priceDisplay: `£${Number(visit.partner_cost ?? 0).toFixed(2)}`,
    partnerNotes,
    // Sem link de relatório: o token de relatório valida contra `jobs.partner_id`
    // e daria 403 para o parceiro da visita. Relatório por visita é etapa própria.
    reportUrl: null,
  });

  const reply = visit.zendesk_side_conversation_id
    ? await replyToSideConversation({
        ticketId: zendeskTicketId,
        sideConversationId: visit.zendesk_side_conversation_id,
        toEmail: partner.email,
        toName: partner.contact_name || partner.company_name || undefined,
        toUserId: partner.zendesk_user_id ?? undefined,
        htmlBody: email.html,
        bodyText: email.text,
      })
    : await createSideConversation({
        ticketId: zendeskTicketId,
        toEmail: partner.email,
        toName: partner.contact_name || partner.company_name || undefined,
        toUserId: partner.zendesk_user_id ?? undefined,
        subject: email.subject,
        htmlBody: email.html,
        bodyText: email.text,
      });

  const sideConversationId = visit.zendesk_side_conversation_id
    ?? (reply as { id?: string | null }).id
    ?? null;

  if (reply.ok && !visit.zendesk_side_conversation_id && sideConversationId) {
    const { error } = await supabase
      .from("job_visits")
      .update({ zendesk_side_conversation_id: sideConversationId })
      .eq("id", visit.id);
    // Sem a mig 275 o email já foi: guardar a thread é o que se perde, e a
    // próxima mensagem abre uma conversa nova em vez de responder nesta.
    if (error && !isSupabaseMissingColumnError(error, "zendesk_side_conversation_id")) {
      console.error("Failed to store visit side conversation id", error.message);
    }
  }

  return { ok: reply.ok, sideConversationId, error: reply.error };
}
