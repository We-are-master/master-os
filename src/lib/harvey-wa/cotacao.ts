/**
 * Pedido de cotação que nasce no WhatsApp (dono, 30/09/2026): o cliente mandou
 * fotos de um serviço que o catálogo não precifica e disse que quer orçamento.
 *
 * Mesmo formato da quote do Harvey do e-mail (zendesk-quoter/quoter.ts): nasce
 * `draft` + `internal`, ligada ao ticket da conversa, com as fotos no bucket
 * público de convite (o parceiro vê no bid).
 *
 * Fase 1 (dono, 15/10/2026): o mínimo para chamar parceiro é descrição +
 * postcode + fotos (ou o motivo de não ter). Endereço completo, ocupação e
 * prazo ajudam mas não seguram o convite: o Harvey pede o endereço antes de
 * reservar. Os parceiros do ofício são convidados na hora e o Harvey continua
 * na conversa.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { guardarFotosDoTicket } from "@/lib/zendesk-quoter/guardar-fotos";
import { ticketPeloTelefone } from "./zendesk-wa";
import type { Identidade } from "./identidade";
import { classificarPedido } from "@/lib/classificar-pedido";
import { catalogoAtivo } from "@/lib/catalogo-ativo";

export type PedidoDeCotacao = { serviceType: string; description: string; postcode: string; address?: string; name?: string; email?: string };

export async function pedirCotacao(
  sb: SupabaseClient,
  a: { telefone: string | null; quem: Identidade; nomeNoWhatsApp: string | null; fotos: string[]; pedido: PedidoDeCotacao },
): Promise<{ reference?: string; invited?: number; ticket?: string | null; error?: string }> {
  // O tipo sempre do catálogo (dono, 19/10/2026): o nome livre do LLM não casa parceiro nenhum.
  const classe = classificarPedido({ servico: a.pedido.serviceType, descricao: a.pedido.description }, await catalogoAtivo(sb));
  a = { ...a, pedido: { ...a.pedido, serviceType: classe.tipo } };
  const ticket = await ticketPeloTelefone(a.telefone).catch(() => null);
  const ref = ticket ? String(ticket) : null;

  // Um pedido por conversa: se já existe (e ainda está sendo cotado), só completa o escopo e as fotos.
  if (ref) {
    const { data: lista } = await sb
      .from("quotes")
      .select("id, reference, title, images, status, property_address, catalog_service_id")
      .eq("external_source", "zendesk")
      .eq("external_ref", ref)
      .in("status", ["draft", "bidding"])
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1);
    const ja = (lista ?? [])[0] as Record<string, unknown> | undefined;
    if (ja) {
      const novas = await guardarFotosDoTicket(ref, a.fotos.map((dataUrl, i) => ({ filename: `whatsapp-${Date.now()}-${i}.jpg`, dataUrl })), sb);
      const scope = `${a.pedido.description}\n\nRequested on WhatsApp with Harvey${a.telefone ? ` (${a.telefone})` : ""}.`;
      const postcode = a.pedido.postcode.trim().toUpperCase();
      const endereco = a.pedido.address?.trim() ? `${a.pedido.address.trim()}, ${postcode}` : ((ja.property_address as string | null) ?? postcode);
      await sb.from("quotes").update({ scope, property_address: endereco, postcode, title: classe.tipo, service_type: classe.tipo, ...(classe.catalogServiceId ? { catalog_service_id: classe.catalogServiceId } : {}), images: [...((ja.images as string[] | null) ?? []), ...novas] }).eq("id", ja.id);
      // Pedido que ficou em rascunho (sem convite): convida agora. Já em leilão: conta quem foi convidado.
      const convidados =
        ja.status === "draft"
          ? await convidarParceiros(sb, { id: ja.id as string, reference: ja.reference as string, title: classe.tipo, catalog_service_id: classe.catalogServiceId ?? (ja.catalog_service_id as string | null), property_address: endereco, scope }, a.pedido.serviceType, postcode)
          : ((await sb.from("quote_partner_invitations").select("id", { count: "exact", head: true }).eq("quote_id", ja.id as string)).count ?? 0);
      return { reference: ja.reference as string, invited: convidados, ticket: ref };
    }
  }

  const fotos = ref ? await guardarFotosDoTicket(ref, a.fotos.map((dataUrl, i) => ({ filename: `whatsapp-${i + 1}.jpg`, dataUrl })), sb) : [];
  const { data: numero, error: refErr } = await sb.rpc("next_quote_ref");
  if (refErr || !numero) return { error: "could not create the quote" };
  const cliente = a.quem.tipo === "cliente" ? a.quem.cliente : null;
  const postcode = a.pedido.postcode.trim().toUpperCase();
  const { data, error } = await sb
    .from("quotes")
    .insert({
      reference: String(numero),
      title: a.pedido.serviceType,
      service_type: a.pedido.serviceType,
      catalog_service_id: classe.catalogServiceId,
      client_id: cliente?.id ?? null,
      client_name: a.pedido.name || cliente?.full_name || a.nomeNoWhatsApp || "WhatsApp customer",
      client_email: a.pedido.email || cliente?.email || null,
      // Sem a rua, o postcode serve de endereço: o convite ao parceiro casa por área.
      property_address: a.pedido.address ? `${a.pedido.address}, ${postcode}` : postcode,
      postcode,
      status: "draft",
      quote_type: "internal",
      total_value: 0,
      cost: 0,
      sell_price: 0,
      margin_percent: 0,
      partner_cost: 0,
      partner_quotes_count: 0,
      deposit_percent: 0,
      deposit_required: 0,
      scope: `${a.pedido.description}\n\nRequested on WhatsApp with Harvey${a.telefone ? ` (${a.telefone})` : ""}.`,
      customer_accepted: false,
      customer_deposit_paid: false,
      ...(ref ? { external_source: "zendesk", external_ref: ref } : {}),
      images: fotos,
    })
    .select("id, reference, title, property_address, scope, catalog_service_id")
    .single();
  if (error || !data) {
    console.error("[harvey-wa] quote", error);
    return { error: "could not create the quote" };
  }

  const convidados = await convidarParceiros(sb, data as QuoteParaConvite, a.pedido.serviceType, postcode);
  return { reference: data.reference as string, invited: convidados, ticket: ref };
}

type QuoteParaConvite = { id: string; reference: string; title: string | null; catalog_service_id: string | null; property_address: string | null; scope: string | null };

/**
 * Concorrência de verdade (Fase 2, dono 09/10/2026; Fase 1, 15/10/2026; 19/10/2026):
 * TODOS os parceiros do ofício que cobrem o postcode são convidados agora, igual ao
 * Harvey do e-mail. O postcode basta: o casamento de parceiro é por área.
 * Porta: HARVEY_QUOTE_INVITES=1 (a mesma do Harvey do e-mail).
 */
async function convidarParceiros(sb: SupabaseClient, q: QuoteParaConvite, serviceType: string, postcode: string): Promise<number> {
  if (process.env.HARVEY_QUOTE_INVITES?.trim() !== "1" || !postcode) return 0;
  try {
    await sb.from("quotes").update({ status: "bidding", quote_type: "partner" }).eq("id", q.id);
    const { dispatchQuoteBidInvites } = await import("@/lib/quote-bid-invites");
    const soEste = process.env.HARVEY_CONVITE_PARCEIRO_UNICO?.trim();
    // Todos que atendem o serviço na área, melhores primeiro (dono, 19/10/2026: "manda para todos").
    const { melhoresParceirosParaCotacao } = await import("./melhores-parceiros");
    const melhores = soEste
      ? [soEste]
      : (await melhoresParceirosParaCotacao(sb, { serviceType, catalogServiceId: q.catalog_service_id ?? null, postcode })).escolhidos.map((p) => p.id);
    // Lista vazia faria o dispatch casar a área inteira de novo: sem ninguém, não chama.
    const r = melhores.length === 0 ? { partnerIds: [] as string[] } : await dispatchQuoteBidInvites(sb, {
      quoteId: q.id,
      quoteReference: q.reference,
      title: q.title?.trim() || serviceType,
      serviceType,
      catalogServiceId: q.catalog_service_id ?? null,
      propertyAddress: q.property_address ?? postcode,
      scope: q.scope ?? "",
      startIso: null,
      invitedBy: null,
      partnerIds: melhores,
    });
    if (r.partnerIds.length === 0) await sb.from("quotes").update({ status: "draft", quote_type: "internal" }).eq("id", q.id);
    return r.partnerIds.length;
  } catch (e) {
    console.error("[harvey-wa] bid invites", e);
    return 0;
  }
}
