/**
 * Junta os candidatos a "ticket do pedido" (Supabase + Zendesk, só leitura) e
 * escolhe com escolha.ts. Nunca lança: na dúvida devolve "nenhum" e quem chama
 * segue como antes.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { zendeskApi, isZendeskConfigured } from "@/lib/zendesk";
import { tryGetFixfyAccountId } from "@/lib/fixfy-account";
import { isDirectConsumerAccount } from "@/lib/direct-consumer-accounts";
import { escolherTicketDoPedido, emailDoCliente, type CandidatoDoPedido, type EscolhaDoPedido } from "./escolha";

type TicketZd = { id: number; status: string; via?: { channel?: string }; updated_at?: string; created_at?: string; tags?: string[] };

export type PedidoProcurado = {
  /** O job do e-mail (ou o job que está nascendo, para não contar ele como "outro job"). */
  jobId?: string | null;
  quoteId?: string | null;
  clientId?: string | null;
  email?: string | null;
  telefone?: string | null;
  /** Criação de job: só reusa quando há UM ticket aberto do cliente. */
  exigirUnico?: boolean;
  /** Ignora o vínculo do job/cotação (o job ainda não tem; a cotação não é dele). */
  semVinculo?: boolean;
  /** Ensaio (scripts/um-ticket-ensaio.mts): tickets a ignorar e o momento medido. */
  excluir?: number[];
  criadoAntesDe?: string | null;
};

export type AchadoDoPedido = EscolhaDoPedido & { candidatos: CandidatoDoPedido[]; b2b: boolean; email: string | null; telefone: string | null };

async function ticketsPorId(ids: string[]): Promise<TicketZd[]> {
  const limpos = [...new Set(ids.filter((i) => /^\d+$/.test(i)))];
  if (!limpos.length) return [];
  const r = await zendeskApi<{ tickets: TicketZd[] }>(`tickets/show_many.json?ids=${limpos.join(",")}`);
  return r.tickets ?? [];
}

async function ticketsDoUsuario(query: string): Promise<TicketZd[]> {
  const { users } = await zendeskApi<{ users: Array<{ id: number; role: string }> }>(`users/search.json?query=${encodeURIComponent(query)}`);
  const out: TicketZd[] = [];
  for (const u of (users ?? []).filter((x) => x.role === "end-user").slice(0, 3)) {
    const r = await zendeskApi<{ tickets: TicketZd[] }>(`users/${u.id}/tickets/requested.json?sort_by=updated_at&sort_order=desc&per_page=25`);
    out.push(...(r.tickets ?? []));
  }
  return out;
}

const candidato = (t: TicketZd, origem: CandidatoDoPedido["origem"]): CandidatoDoPedido => ({
  id: t.id,
  status: t.status,
  canal: t.via?.channel ?? null,
  origem,
  atualizadoEm: t.updated_at ?? null,
  criadoEm: t.created_at ?? null,
  tags: t.tags ?? [],
});

export async function acharTicketDoPedido(sb: SupabaseClient, p: PedidoProcurado): Promise<AchadoDoPedido> {
  const nada = (): AchadoDoPedido => ({ tipo: "nenhum", candidatos: [], b2b: false, email: null, telefone: null });
  if (!isZendeskConfigured()) return nada();
  try {
    let quoteId = p.quoteId ?? null;
    let clientId = p.clientId ?? null;
    const candidatos: CandidatoDoPedido[] = [];

    if (p.jobId && !p.semVinculo) {
      const { data: j } = await sb.from("jobs").select("external_source, external_ref, quote_id, client_id").eq("id", p.jobId).maybeSingle();
      const job = j as { external_source?: string | null; external_ref?: string | null; quote_id?: string | null; client_id?: string | null } | null;
      if (job?.external_source === "zendesk" && job.external_ref) candidatos.push(...(await ticketsPorId([String(job.external_ref)])).map((t) => candidato(t, "job")));
      quoteId = quoteId ?? job?.quote_id ?? null;
      clientId = clientId ?? job?.client_id ?? null;
    }
    if (quoteId && !p.semVinculo) {
      const { data: q } = await sb.from("quotes").select("external_source, external_ref, client_id").eq("id", quoteId).maybeSingle();
      const quote = q as { external_source?: string | null; external_ref?: string | null; client_id?: string | null } | null;
      if (quote?.external_source === "zendesk" && quote.external_ref) candidatos.push(...(await ticketsPorId([String(quote.external_ref)])).map((t) => candidato(t, "quote")));
      clientId = clientId ?? quote?.client_id ?? null;
    }

    let email = emailDoCliente(p.email);
    let telefone = (p.telefone ?? "").replace(/[^\d+]/g, "") || null;
    let b2b = false;
    if (clientId) {
      const { data: c } = await sb.from("clients").select("email, phone, source_account_id").eq("id", clientId).maybeSingle();
      const cl = c as { email?: string | null; phone?: string | null; source_account_id?: string | null } | null;
      email = email ?? emailDoCliente(cl?.email);
      telefone = telefone ?? ((cl?.phone ?? "").replace(/[^\d+]/g, "") || null);
      const conta = cl?.source_account_id ?? null;
      if (conta && !isDirectConsumerAccount(conta)) b2b = conta !== (await tryGetFixfyAccountId(sb));
      // Cotações recentes do cliente com ticket: o ticket do pedido costuma ser o delas.
      const desde = new Date(Date.now() - 60 * 86400_000).toISOString();
      const { data: qs } = await sb.from("quotes").select("external_ref").eq("client_id", clientId).eq("external_source", "zendesk").gte("created_at", desde).limit(10);
      const refs = ((qs ?? []) as Array<{ external_ref: string | null }>).map((x) => String(x.external_ref ?? ""));
      candidatos.push(...(await ticketsPorId(refs)).map((t) => candidato(t, "cliente")));
    }

    // Só quando nenhum vínculo explícito resolve: a busca por pessoa custa chamadas.
    // Conta B2B não entra na busca por pessoa: o gerente da conta tem vários pedidos
    // abertos ao mesmo tempo (Sabrina, Li & Fung: #49928, #51028, #51294), e o ticket
    // mais recente dele quase nunca é o deste job. Lá vale só o vínculo e a cotação.
    const temVinculo = candidatos.some((c) => (c.origem === "job" || c.origem === "quote") && c.status !== "closed");
    if (!temVinculo && !b2b) {
      if (email) candidatos.push(...(await ticketsDoUsuario(`email:${email}`)).map((t) => candidato(t, "cliente")));
      if (telefone && telefone.replace(/\D/g, "").length >= 10) candidatos.push(...(await ticketsDoUsuario(telefone)).map((t) => candidato(t, "cliente")));
    }

    // Ticket que já é de outro job é outro pedido.
    const ids = [...new Set(candidatos.filter((c) => c.origem === "cliente").map((c) => String(c.id)))];
    if (ids.length) {
      let q = sb.from("jobs").select("id, external_ref").eq("external_source", "zendesk").in("external_ref", ids).is("deleted_at", null);
      if (p.jobId) q = q.neq("id", p.jobId);
      const { data: js } = await q;
      const deOutro = new Set(((js ?? []) as Array<{ external_ref: string }>).map((x) => String(x.external_ref)));
      for (const c of candidatos) if (c.origem === "cliente" && deOutro.has(String(c.id))) c.ligadoAOutroJob = true;
    }

    const escolha = escolherTicketDoPedido(candidatos, { b2b, exigirUnico: p.exigirUnico, excluir: p.excluir, criadoAntesDe: p.criadoAntesDe });
    return { ...escolha, candidatos, b2b, email, telefone };
  } catch (e) {
    console.warn("[um-ticket] achar:", e instanceof Error ? e.message : e);
    return nada();
  }
}
