/**
 * Confirmação ao CLIENTE de uma visita extra (V2, V3…) do job (dono, 19/10/2026).
 *
 * Até aqui só o parceiro da visita sabia dela: o cliente recebia o "Job confirmed"
 * da visita 1 e mais nada, e a visita 2 chegava na porta dele sem aviso.
 *
 * Vai SEMPRE no ticket do job, na mesma conversa da primeira confirmação. Sem
 * ticket não sai: nada de Resend nem de ticket novo (dono: "no mesmo ticket sempre").
 *
 * Uma vez por visita: `job_visits.client_confirmation_sent_at` é carimbado antes
 * do envio (mesma trava do `job_creation_notice_sent_at` do job).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { resolveNominalBillingParty } from "@/lib/account-billing-addressee";
import { mensagensAoClienteLigadas } from "@/lib/client-confirmation/policy";
import { getZendeskTicketId, isZendeskConfigured } from "@/lib/zendesk";
import { avisarNoTicketDoJob } from "@/lib/um-ticket/aviso-do-job";
import { resolveJobTypeOfWorkLabel } from "@/lib/zendesk-lifecycle";
import {
  buildJobConfirmationHtml,
  formatJobConfirmationArrivalWindow,
  formatJobConfirmationLongDate,
  loadAccountOrganizationName,
  resolveCustomerGreetingName,
  splitPropertyAddressAndPostcode,
} from "@/lib/zendesk-job-confirmation";

export type ResultadoConfirmacaoDaVisita =
  | { ok: true; to: string; ticketId: number }
  | { ok: false; skipped: string }
  | { ok: false; error: string };

export function assuntoDaVisita(visitIndex: number, reference: string): string {
  return `Visit ${visitIndex} confirmed · ${reference}`;
}

export async function avisarClienteDaVisita(
  jobId: string,
  visitId: string,
  client?: SupabaseClient,
): Promise<ResultadoConfirmacaoDaVisita> {
  const supabase = client ?? createServiceClient();

  const [{ data: job }, { data: visit }] = await Promise.all([
    supabase
      .from("jobs")
      .select("id, reference, title, property_address, client_id, client_name, catalog_service_id, external_source, external_ref")
      .eq("id", jobId)
      .maybeSingle(),
    supabase.from("job_visits").select("*").eq("id", visitId).eq("job_id", jobId).maybeSingle(),
  ]);
  if (!job || !visit) return { ok: false, error: "job or visit not found" };
  const j = job as Record<string, unknown>;
  const v = visit as Record<string, unknown>;

  if (v.client_confirmation_sent_at) return { ok: false, skipped: "already sent" };
  const dateStr = String(v.scheduled_date ?? "").slice(0, 10);
  if (!dateStr) return { ok: false, skipped: "visit has no date" };

  if (!isZendeskConfigured()) return { ok: false, skipped: "Zendesk not configured" };
  const ticketRaw = getZendeskTicketId(j as never);
  const ticketId = ticketRaw && /^\d+$/.test(String(ticketRaw)) ? Number(ticketRaw) : null;
  if (!ticketId) return { ok: false, skipped: "job has no ticket" };

  const clientId = typeof j.client_id === "string" ? j.client_id : "";
  if (!clientId) return { ok: false, skipped: "job has no client" };
  const billing = await resolveNominalBillingParty(supabase, {
    clientId,
    fallbackName: String(j.client_name ?? ""),
  });
  // A trava de mensagens vale para o morador; conta B2B recebe sempre (como na remarcação).
  if (billing.mode !== "account" && !mensagensAoClienteLigadas()) {
    return { ok: false, skipped: "client messaging is off (CLIENT_MESSAGING_ENABLED)" };
  }

  const { data: claimed, error: claimErr } = await supabase
    .from("job_visits")
    .update({ client_confirmation_sent_at: new Date().toISOString() })
    .eq("id", visitId)
    .is("client_confirmation_sent_at", null)
    .select("id")
    .maybeSingle();
  if (claimErr) return { ok: false, error: claimErr.message };
  if (!claimed) return { ok: false, skipped: "already sent" };

  const organizationName = await loadAccountOrganizationName(supabase, billing.sourceAccountId);
  const greetingName = resolveCustomerGreetingName(organizationName, billing.displayName || String(j.client_name ?? ""));
  const { propertyAddress, propertyPostcode } = splitPropertyAddressAndPostcode(String(j.property_address ?? ""));
  const typeOfWork = await resolveJobTypeOfWorkLabel(
    supabase,
    (v.catalog_service_id as string | null) ?? (j.catalog_service_id as string | null),
    String(j.title ?? ""),
  );
  const visitIndex = Number(v.visit_index ?? 2);
  const reference = String(j.reference ?? "");

  const html = buildJobConfirmationHtml({
    greetingName,
    jobReference: reference,
    jobTitle: `${String(j.title ?? "Maintenance job")} · Visit ${visitIndex}`,
    jobDate: formatJobConfirmationLongDate(dateStr),
    arrivalWindow: formatJobConfirmationArrivalWindow({
      scheduled_start_at: v.scheduled_start_at as string | null,
      scheduled_end_at: v.scheduled_end_at as string | null,
    }),
    propertyAddress,
    propertyPostcode,
    typeOfWork,
    eyebrow: `Visit ${visitIndex} confirmed`,
    intro: "another visit is booked for this job.",
  });

  try {
    await avisarNoTicketDoJob({
      ticketId,
      para: { email: billing.documentEmail?.trim() || null, nome: billing.displayName || null },
      assunto: assuntoDaVisita(visitIndex, reference),
      html,
    });
  } catch (err) {
    // Zendesk recusou: solta a trava para o reenvio funcionar.
    await supabase.from("job_visits").update({ client_confirmation_sent_at: null }).eq("id", visitId);
    return { ok: false, error: err instanceof Error ? err.message : "ticket delivery failed" };
  }
  return { ok: true, to: billing.documentEmail?.trim() || "", ticketId };
}
