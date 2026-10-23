/**
 * O painel do Harvey (dono, 23/10/2026): "quero ficar por dentro, saber se ele está
 * vendendo, se tem conversa parada, e se um lead some quando ele não classifica".
 *
 *   Vendas     conversas novas, passadas à equipe, cotações pedidas, links de
 *              pagamento, pagos e £, por dia (harvey_wa_conversas + quotes do WhatsApp)
 *   Paradas    conversa do WhatsApp aberta com o cliente esperando (Reply Status 🔴),
 *              há quanto tempo (Zendesk)
 *   Pendentes  o que o Harvey deixou para a equipe e ninguém fechou (harvey_diario)
 *
 * As contas são puras (testadas); `lerPainelDoHarvey` só busca.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { isZendeskConfigured, zendeskApi } from "@/lib/zendesk";

/** Conversa esperando mais que isso sem resposta é "parada". */
export const MINUTOS_PARA_PARADA = 20;
const REPLY_STATUS_FIELD_ID = Number(process.env.ZENDESK_REPLY_STATUS_FIELD_ID?.trim() || "5698641403423");
/** A marca que o Harvey põe no escopo da quote que nasce no WhatsApp (cotacao.ts). */
const MARCA_DA_QUOTE_DO_WHATSAPP = "Requested on WhatsApp with Harvey";

export type ConversaLida = {
  criado_em: string;
  estado: string | null;
  passou_em: string | null;
  checkout_ref: string | null;
  checkout_at: string | null;
  checkout_total: number | string | null;
};

export type QuoteLida = { created_at: string; status: string };

export type DiaDoHarvey = {
  dia: string;
  conversas: number;
  passadas: number;
  cotacoes: number;
  links: number;
  pagos: number;
  valor: number;
};

export type Funil = DiaDoHarvey & { conversao: number | null };

const diaDe = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : null);
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Os últimos `dias` dias (o de hoje incluído), do mais antigo para o mais novo. */
export function diasDaJanela(agora: Date, dias: number): string[] {
  const out: string[] = [];
  for (let i = dias - 1; i >= 0; i--) out.push(new Date(agora.getTime() - i * 86_400_000).toISOString().slice(0, 10));
  return out;
}

/**
 * Uma linha por dia. Cada coisa conta no dia em que aconteceu: a conversa no dia em
 * que começou, a passagem no dia em que passou, o pagamento no dia em que pagou.
 */
export function vendasPorDia(conversas: ConversaLida[], quotes: QuoteLida[], dias: string[]): DiaDoHarvey[] {
  const linha = new Map(dias.map((d) => [d, { dia: d, conversas: 0, passadas: 0, cotacoes: 0, links: 0, pagos: 0, valor: 0 }]));
  const em = (iso: string | null | undefined) => (diaDe(iso) ? linha.get(diaDe(iso)!) : undefined);
  for (const c of conversas) {
    const l = em(c.criado_em);
    if (l) {
      l.conversas++;
      if (c.checkout_ref) l.links++;
    }
    const p = em(c.passou_em);
    if (p && c.estado === "equipe") p.passadas++;
    const pg = em(c.checkout_at);
    if (pg) {
      pg.pagos++;
      pg.valor += num(c.checkout_total);
    }
  }
  for (const q of quotes) {
    const l = em(q.created_at);
    if (l) l.cotacoes++;
  }
  return [...linha.values()];
}

/** Soma da janela, com a conversão (pagos ÷ conversas). */
export function somaDoFunil(dias: DiaDoHarvey[]): Funil {
  const s = dias.reduce(
    (a, d) => ({ dia: "total", conversas: a.conversas + d.conversas, passadas: a.passadas + d.passadas, cotacoes: a.cotacoes + d.cotacoes, links: a.links + d.links, pagos: a.pagos + d.pagos, valor: a.valor + d.valor }),
    { dia: "total", conversas: 0, passadas: 0, cotacoes: 0, links: 0, pagos: 0, valor: 0 },
  );
  return { ...s, valor: Math.round(s.valor * 100) / 100, conversao: s.conversas ? Math.round((s.pagos / s.conversas) * 1000) / 10 : null };
}

export type TicketDoWhatsApp = {
  id: number;
  subject: string | null;
  updated_at: string;
  tags: string[];
  custom_fields?: Array<{ id: number; value: unknown }>;
};

export type ConversaParada = { ticketId: number; assunto: string; minutos: number; comHarvey: boolean };

/**
 * O cliente está esperando (Reply Status 🔴) há mais de `limite` minutos. O tempo conta
 * da última atualização do ticket, que é a mensagem do cliente quando ninguém respondeu.
 */
export function conversasParadas(tickets: TicketDoWhatsApp[], agora: Date, limite = MINUTOS_PARA_PARADA): ConversaParada[] {
  return tickets
    .filter((t) => t.custom_fields?.find((f) => Number(f.id) === REPLY_STATUS_FIELD_ID)?.value === "reply_awaiting")
    .map((t) => ({
      ticketId: t.id,
      assunto: (t.subject ?? "").trim() || `#${t.id}`,
      minutos: Math.max(0, Math.round((agora.getTime() - Date.parse(t.updated_at)) / 60_000)),
      comHarvey: !t.tags.includes("harvey_passou") && !t.tags.includes("harvey_off"),
    }))
    .filter((c) => c.minutos >= limite)
    .sort((a, b) => b.minutos - a.minutos);
}

export type PendenteDoHarvey = { ticketId: number | null; quando: string; decisao: string; pendente: string };

export type PainelDoHarvey = {
  dias: DiaDoHarvey[];
  semana: Funil;
  hoje: DiaDoHarvey;
  paradas: ConversaParada[];
  pendentes: PendenteDoHarvey[];
  falhas: string[];
  geradoEm: string;
};

/** Lê tudo. Fonte que falha entra em `falhas` em vez de derrubar o painel. */
export async function lerPainelDoHarvey(sb: SupabaseClient, agora = new Date(), janela = 14): Promise<PainelDoHarvey> {
  const dias = diasDaJanela(agora, janela);
  const desde = `${dias[0]}T00:00:00Z`;
  const falhas: string[] = [];

  const [conv, quotes, diario] = await Promise.all([
    sb.from("harvey_wa_conversas").select("criado_em, estado, passou_em, checkout_ref, checkout_at, checkout_total").or(`criado_em.gte.${desde},passou_em.gte.${desde},checkout_at.gte.${desde}`),
    sb.from("quotes").select("created_at, status").gte("created_at", desde).ilike("scope", `%${MARCA_DA_QUOTE_DO_WHATSAPP}%`).is("deleted_at", null),
    sb.from("harvey_diario").select("ticket_id, criado_em, decisao, pendente").eq("origem", "whatsapp").is("resolvido_em", null).not("pendente", "is", null).gte("criado_em", new Date(agora.getTime() - 7 * 86_400_000).toISOString()).order("criado_em", { ascending: false }).limit(200),
  ]);
  if (conv.error) falhas.push(`conversations (${conv.error.message})`);
  if (quotes.error) falhas.push(`quotes (${quotes.error.message})`);
  if (diario.error) falhas.push(`Harvey diary (${diario.error.message})`);

  const porDia = vendasPorDia((conv.data ?? []) as ConversaLida[], (quotes.data ?? []) as QuoteLida[], dias);

  // Uma pendência por ticket: a mais recente (o diário repete quando o Harvey decide de novo).
  const vistos = new Set<string>();
  const pendentes: PendenteDoHarvey[] = [];
  for (const d of (diario.data ?? []) as Array<{ ticket_id: number | null; criado_em: string; decisao: string; pendente: string }>) {
    const chave = d.ticket_id ? String(d.ticket_id) : `${d.criado_em}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    pendentes.push({ ticketId: d.ticket_id, quando: d.criado_em, decisao: d.decisao, pendente: d.pendente });
  }

  let paradas: ConversaParada[] = [];
  if (isZendeskConfigured()) {
    try {
      const q = encodeURIComponent(`type:ticket status<solved tags:harvey_wa custom_field_${REPLY_STATUS_FIELD_ID}:reply_awaiting`);
      const { results } = await zendeskApi<{ results?: TicketDoWhatsApp[] }>(`search.json?query=${q}&per_page=100`);
      paradas = conversasParadas(results ?? [], agora);
    } catch (e) {
      falhas.push(`Zendesk (${e instanceof Error ? e.message.slice(0, 80) : String(e)})`);
    }
  }

  return {
    dias: porDia,
    semana: somaDoFunil(porDia.slice(-7)),
    hoje: porDia[porDia.length - 1]!,
    paradas,
    pendentes,
    falhas,
    geradoEm: agora.toISOString(),
  };
}

/** O bloco do brief das 8h: ontem em uma linha, e as conversas paradas agora. */
export function resumoDoHarveyHtml(p: PainelDoHarvey): string {
  const ontem = p.dias[p.dias.length - 2];
  if (!ontem) return "";
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const fonte = "font-family:system-ui,sans-serif";
  const linha = `${ontem.conversas} new chats · ${ontem.passadas} handed to the team · ${ontem.cotacoes} quotes requested · ${ontem.links} payment links · ${ontem.pagos} paid (£${ontem.valor.toFixed(2)})`;
  const semana = `Last 7 days: ${p.semana.conversas} chats, ${p.semana.pagos} paid (£${p.semana.valor.toFixed(2)})${p.semana.conversao != null ? `, ${p.semana.conversao}% conversion` : ""}.`;
  const paradas = p.paradas.length
    ? `<p style="${fonte};font-size:13px;font-weight:700;color:#0f172a;margin:10px 0 4px">Customers waiting on WhatsApp (${p.paradas.length})</p>
      <ul style="${fonte};font-size:13px;color:#1e293b;margin:0;padding-left:18px">${p.paradas.slice(0, 10).map((c) => `<li style="margin:3px 0">#${c.ticketId} · ${esc(c.assunto)} · ${tempo(c.minutos)}</li>`).join("")}</ul>`
    : "";
  return `<div style="margin:0 0 20px;padding:16px;background:#f5f3ff;border-radius:12px;border:1px solid #ddd6fe">
      <p style="margin:0 0 4px;${fonte};font-size:12px;font-weight:700;color:#4c1d95;text-transform:uppercase">Harvey yesterday</p>
      <p style="${fonte};font-size:13px;color:#1e293b;margin:0">${esc(linha)}</p>
      <p style="${fonte};font-size:12px;color:#475569;margin:4px 0 0">${esc(semana)}</p>
      ${paradas}
    </div>`;
}

/** 25 min, 3h, 2d. */
export function tempo(minutos: number): string {
  if (minutos < 60) return `${minutos} min`;
  if (minutos < 48 * 60) return `${Math.round(minutos / 60)}h`;
  return `${Math.round(minutos / 1440)}d`;
}
