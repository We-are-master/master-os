/**
 * Leitura da seção "Where you need to step in" do brief da manhã: três views
 * do Zendesk, quotes `quote_ready` e jobs em on hold por reclamação no OS, e as
 * pendências de ontem do diário do Harvey. Cada fonte falha sozinha: o que não
 * deu para ler vira `falhas` e o resto do brief sai igual.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { isZendeskConfigured, zendeskApi } from "@/lib/zendesk";
import { jobOnHoldPorReclamacao } from "@/lib/job-on-hold-reasons";
import { oQuePrecisaDoTicket, pendentesDeOntem, type FonteDeAtencao, type ItemDeAtencao, type PendenteDoDiario } from "@/lib/brief-atencao";

const VIEWS: { fonte: FonteDeAtencao; id: number }[] = [
  { fonte: "action_required", id: Number(process.env.ZENDESK_VIEW_ACTION_REQUIRED?.trim() || "5685314898719") },
  { fonte: "quoting", id: Number(process.env.ZENDESK_VIEW_QUOTING?.trim() || "5685293799071") },
  { fonte: "needs_attention", id: Number(process.env.ZENDESK_VIEW_NEEDS_ATTENTION?.trim() || "5773144244767") },
];

type TicketDaView = { id: number; subject?: string | null; requester_id?: number | null; created_at?: string; updated_at?: string };

async function nomesDosRequesters(ids: number[]): Promise<Map<number, string>> {
  const nomes = new Map<number, string>();
  const unicos = [...new Set(ids.filter((n) => Number.isFinite(n) && n > 0))];
  for (let i = 0; i < unicos.length; i += 100) {
    const lote = unicos.slice(i, i + 100);
    const { users } = await zendeskApi<{ users?: { id: number; name?: string | null }[] }>(`users/show_many.json?ids=${lote.join(",")}`);
    for (const u of users ?? []) if (u.name) nomes.set(u.id, u.name);
  }
  return nomes;
}

export async function lerAtencao(
  sb: SupabaseClient,
  agora = new Date(),
): Promise<{ itens: ItemDeAtencao[]; pendentes: PendenteDoDiario[]; falhas: string[] }> {
  const itens: ItemDeAtencao[] = [];
  const falhas: string[] = [];

  // Zendesk: as três views, o requester vira o nome do cliente.
  if (isZendeskConfigured()) {
    const porView: { fonte: FonteDeAtencao; tickets: TicketDaView[] }[] = [];
    for (const v of VIEWS) {
      try {
        const { tickets } = await zendeskApi<{ tickets?: TicketDaView[] }>(`views/${v.id}/tickets.json?per_page=100`);
        porView.push({ fonte: v.fonte, tickets: tickets ?? [] });
      } catch (e) {
        console.error(`[brief-atencao] view ${v.fonte}:`, e instanceof Error ? e.message : e);
        falhas.push(`Zendesk ${v.fonte.replace(/_/g, " ")}`);
      }
    }
    const nomes = await nomesDosRequesters(porView.flatMap((p) => p.tickets.map((t) => Number(t.requester_id)))).catch(() => new Map<number, string>());
    for (const p of porView)
      for (const t of p.tickets)
        itens.push({
          fonte: p.fonte,
          ticketId: t.id,
          cliente: nomes.get(Number(t.requester_id)) ?? null,
          oQuePrecisa: oQuePrecisaDoTicket(p.fonte, t.subject),
          desde: t.created_at ?? t.updated_at ?? null,
        });
  } else falhas.push("Zendesk (not configured)");

  // OS: preço pronto esperando alguém clicar enviar.
  const quotes = await sb
    .from("quotes")
    .select("reference, title, client_name, external_ref, updated_at")
    .eq("status", "quote_ready")
    .is("deleted_at", null)
    .order("updated_at", { ascending: true })
    .limit(50);
  if (quotes.error) falhas.push("OS quotes");
  for (const q of quotes.data ?? [])
    itens.push({
      fonte: "quote_ready",
      ticketId: Number(q.external_ref) > 0 ? Number(q.external_ref) : null,
      ref: q.reference as string,
      cliente: (q.client_name as string | null) ?? null,
      oQuePrecisa: oQuePrecisaDoTicket("quote_ready", q.title as string | null),
      desde: (q.updated_at as string | null) ?? null,
    });

  // OS: job parado por reclamação.
  const jobs = await sb
    .from("jobs")
    .select("reference, title, client_name, external_ref, on_hold_at, on_hold_reason_preset_id, on_hold_reason, on_hold_complaint_description")
    .eq("status", "on_hold")
    .is("deleted_at", null)
    .limit(200);
  if (jobs.error) falhas.push("OS jobs on hold");
  for (const j of jobs.data ?? []) {
    if (!jobOnHoldPorReclamacao(j)) continue;
    itens.push({
      fonte: "complaint",
      ticketId: Number(j.external_ref) > 0 ? Number(j.external_ref) : null,
      ref: j.reference as string,
      cliente: (j.client_name as string | null) ?? null,
      oQuePrecisa: oQuePrecisaDoTicket("complaint", (j.on_hold_complaint_description as string | null) || (j.title as string | null)),
      desde: (j.on_hold_at as string | null) ?? null,
    });
  }

  // Diário do Harvey: o que ele deixou aberto ontem. Sem a tabela (migration 327), fica de fora calado.
  let pendentes: PendenteDoDiario[] = [];
  const diario = await sb
    .from("harvey_diario")
    .select("criado_em, origem, ticket_id, quote_ref, job_ref, decisao, pendente, resolvido_em")
    .not("pendente", "is", null)
    .is("resolvido_em", null)
    .gte("criado_em", new Date(agora.getTime() - 3 * 24 * 3_600_000).toISOString())
    .limit(500);
  if (diario.error) {
    if (!/PGRST205|42P01|could not find the table|does not exist/i.test(`${diario.error.code ?? ""} ${diario.error.message}`)) falhas.push("Harvey diary");
    else console.warn("[brief-atencao] harvey_diario não existe ainda (migration 327)");
  } else pendentes = pendentesDeOntem((diario.data ?? []) as PendenteDoDiario[], agora);

  return { itens, pendentes, falhas };
}
