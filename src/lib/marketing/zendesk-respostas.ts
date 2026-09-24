/**
 * As respostas do WhatsApp caem no Zendesk (o app dele está inscrito na WABA).
 * Esta varredura lê as conversas de WhatsApp que se mexeram há pouco e:
 *
 *   "Stop promotions" / STOP   tira o número de toda campanha, põe a tag
 *                              `marketing-stop` e resolve o ticket, para
 *                              ninguém do time perder tempo com ele
 *   qualquer outra resposta    carimba `replied_at` no toque e põe a tag
 *                              `campanha-week10`, para quem atende saber de
 *                              onde a pessoa veio. O ticket fica para o time.
 *
 * Tags passam por `addTicketTags` (lê, une e grava): gravar a lista direto
 * apagaria as tags que o Harvey pôs ([[zendesk-tags-duas-armadilhas]]).
 */

import { createServiceClient } from "@/lib/supabase/service";
import { addTicketTags, isZendeskConfigured } from "@/lib/zendesk";
import { ehPedidoDeSaida } from "./whatsapp";
import { tirarDaLista } from "./campanha";

const SUB = () => process.env.ZENDESK_SUBDOMAIN?.trim();
const auth = () =>
  "Basic " + Buffer.from(`${process.env.ZENDESK_EMAIL?.trim() || process.env.ZENDESK_API_EMAIL?.trim()}/token:${process.env.ZENDESK_API_TOKEN?.trim()}`).toString("base64");

async function zd<T>(caminho: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`https://${SUB()}.zendesk.com/api/v2/${caminho}`, {
    ...init,
    headers: { Authorization: auth(), "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!r.ok) throw new Error(`Zendesk ${r.status} em ${caminho.split("?")[0]}`);
  return (await r.json()) as T;
}

type Ticket = { id: number; requester_id: number; status: string; tags: string[] };
type Comentario = { id: number; author_id: number; body: string; public: boolean; created_at: string };

export async function varrerRespostasDoZendesk(opcoes: { minutos?: number; aplicar?: boolean } = {}) {
  if (!isZendeskConfigured()) return { ok: false, motivo: "Zendesk sem credenciais" };
  const minutos = opcoes.minutos ?? 30;
  const sb = createServiceClient();
  const res = { tickets: 0, stops: 0, respostas: 0, semTelefone: 0, detalhes: [] as Array<{ ticket: number; tipo: string }> };

  const busca = await zd<{ results: Ticket[] }>(
    `search.json?query=${encodeURIComponent(`type:ticket via:whatsapp updated>${minutos}minutes`)}&sort_by=updated_at&sort_order=desc&per_page=100`,
  );

  for (const t of busca.results ?? []) {
    res.tickets++;
    const { comments } = await zd<{ comments: Comentario[] }>(`tickets/${t.id}/comments.json?sort_order=desc&per_page=5`);
    const dela = (comments ?? []).find((c) => c.author_id === t.requester_id);
    if (!dela) continue;

    const { identities } = await zd<{ identities: Array<{ type: string; value: string }> }>(`users/${t.requester_id}/identities.json`);
    const tel = identities?.find((i) => i.type === "phone_number" || i.type === "whatsapp" || i.type === "messaging")?.value ?? "";
    const phone = tel.replace(/\D/g, "");
    if (!phone) { res.semTelefone++; continue; }

    if (ehPedidoDeSaida(dela.body)) {
      res.stops++;
      res.detalhes.push({ ticket: t.id, tipo: "stop" });
      if (!opcoes.aplicar) continue;
      await tirarDaLista({ phone }, `zendesk_${t.id}`);
      if (!t.tags.includes("marketing-stop")) {
        await addTicketTags(t.id, ["marketing-stop"]);
        await zd(`tickets/${t.id}.json`, { method: "PUT", body: JSON.stringify({ ticket: { status: "solved" } }) });
      }
      continue;
    }

    // Resposta a uma campanha só se houve toque de WhatsApp nos últimos 7 dias para esse número.
    const { data: toque } = await sb
      .from("marketing_touches")
      .select("id, replied_at")
      .eq("channel", "whatsapp")
      .eq("phone", phone)
      .gte("sent_at", new Date(Date.now() - 7 * 86400000).toISOString())
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!toque) continue;
    res.respostas++;
    res.detalhes.push({ ticket: t.id, tipo: "resposta" });
    if (!opcoes.aplicar) continue;
    if (!toque.replied_at) await sb.from("marketing_touches").update({ replied_at: dela.created_at }).eq("id", toque.id);
    if (!t.tags.includes("campanha-week10")) await addTicketTags(t.id, ["campanha-week10"]);
  }
  return { ok: true, ...res };
}
