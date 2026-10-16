import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * O job em andamento do cliente, para a conversa do WhatsApp cair no ticket dele.
 *
 * A junção da conversa só olhava o harvey_wa_leads (quem recebeu template nosso).
 * Cliente que fechou por outro caminho (lead de e-mail, ligação, a equipe no
 * WhatsApp) não tem linha lá: quando escrevia de novo, o Zendesk abria um ticket
 * novo numa pessoa nova e o do job ficava de fora (Jessica Rooney, JOB-9725:
 * #51482 nasceu em 16/10/2026 enquanto o job morava no #51255).
 */

/** Job que ainda está acontecendo: concluído, cancelado e apagado não puxam conversa. */
const STATUS_EM_ANDAMENTO = new Set(["unassigned", "scheduled", "in_progress", "late", "on_hold", "final_check", "awaiting_payment"]);

export type JobDoCliente = {
  id: string;
  status: string | null;
  scheduled_date: string | null;
  updated_at: string | null;
  external_source: string | null;
  external_ref: string | null;
};

export type TicketDoJob = { ticketId: number; jobId: string };

/**
 * Entre os jobs do cliente, o que tem ticket no Zendesk e ainda está em andamento.
 * Mais de um: o de data mais próxima de hoje para frente; sem data futura, o mexido por último.
 */
export function escolherJobAtivo(jobs: JobDoCliente[], hoje: string): TicketDoJob | null {
  const comTicket = jobs.filter(
    (j) => j.status && STATUS_EM_ANDAMENTO.has(j.status) && j.external_source === "zendesk" && /^\d+$/.test(j.external_ref ?? ""),
  );
  if (!comTicket.length) return null;
  const futuros = comTicket.filter((j) => (j.scheduled_date ?? "") >= hoje).sort((a, b) => (a.scheduled_date ?? "").localeCompare(b.scheduled_date ?? ""));
  const recentes = [...comTicket].sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""));
  const j = futuros[0] ?? recentes[0];
  return { ticketId: Number(j.external_ref), jobId: j.id };
}

export async function ticketDoJobAtivo(sb: SupabaseClient, clientId: string | null | undefined): Promise<TicketDoJob | null> {
  if (!clientId) return null;
  const { data } = await sb
    .from("jobs")
    .select("id, status, scheduled_date, updated_at, external_source, external_ref")
    .eq("client_id", clientId)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(20);
  const hoje = new Date().toISOString().slice(0, 10);
  return escolherJobAtivo((data ?? []) as JobDoCliente[], hoje);
}
