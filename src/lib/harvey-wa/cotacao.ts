/**
 * Pedido de cotação que nasce no WhatsApp (dono, 30/09/2026): o cliente mandou
 * fotos de um serviço que o catálogo não precifica e disse que quer orçamento.
 *
 * Mesmo formato da quote do Harvey do e-mail (zendesk-quoter/quoter.ts): nasce
 * `draft` + `internal`, ligada ao ticket da conversa, com as fotos no bucket
 * público de convite (o parceiro vê no bid). Quem precifica e transmite é a
 * equipe; o ticket fica em 🟩 WhatsApp no Action Required até ela mover.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { guardarFotosDoTicket } from "@/lib/zendesk-quoter/guardar-fotos";
import { ticketPeloTelefone } from "./zendesk-wa";
import type { Identidade } from "./identidade";

export type PedidoDeCotacao = { serviceType: string; description: string; postcode: string; address?: string; name?: string; email?: string };

export async function pedirCotacao(
  sb: SupabaseClient,
  a: { telefone: string | null; quem: Identidade; nomeNoWhatsApp: string | null; fotos: string[]; pedido: PedidoDeCotacao },
): Promise<{ reference?: string; error?: string }> {
  const ticket = await ticketPeloTelefone(a.telefone).catch(() => null);
  const ref = ticket ? String(ticket) : null;

  // Um pedido por conversa: se já existe, só completa o escopo e as fotos.
  if (ref) {
    const { data: ja } = await sb.from("quotes").select("id, reference, images").eq("external_source", "zendesk").eq("external_ref", ref).maybeSingle();
    if (ja) {
      const novas = await guardarFotosDoTicket(ref, a.fotos.map((dataUrl, i) => ({ filename: `whatsapp-${Date.now()}-${i}.jpg`, dataUrl })), sb);
      await sb.from("quotes").update({ scope: a.pedido.description, images: [...((ja.images as string[] | null) ?? []), ...novas] }).eq("id", ja.id);
      return { reference: ja.reference as string };
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
    .select("reference")
    .single();
  if (error || !data) {
    console.error("[harvey-wa] quote", error);
    return { error: "could not create the quote" };
  }
  return { reference: data.reference as string };
}
