/**
 * Aceite escrito da cotação (B3, dono 20/10/2026). Hoje só o clique no link aceitava; o
 * cliente que responde "approved, go ahead" no e-mail ou "yes" no WhatsApp ficava parado.
 *
 * O aceite em si é SEMPRE a rota do link (`/api/quotes/respond`) com o token da cotação:
 * mesma criação de job, mesma fatura de entrada, mesmo aviso ao parceiro, mesma data
 * escolhida (startDate). Aqui só se decide se o texto é um aceite claro.
 *
 *  - e-mail: `lerAceitesPorEmail`, a cada ciclo do poll, nas cotações enviadas (awaiting_customer);
 *  - WhatsApp: a ferramenta `accept_quote` do Harvey (`aceitarPeloWhatsApp`).
 * Condição, dúvida ou recusa: Action Required com o resumo. Área "aceite" da tela de autonomia.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { chamarModeloJson, type ChamadaAoModelo } from "@/lib/quote-lance-escopo";
import { createQuoteResponseToken } from "@/lib/quote-response-token";
import { appBaseUrl } from "@/lib/app-base-url";
import { datasDisponiveis } from "@/lib/quote-accept-job-fields";
import { precisaDeAcao, acaoFeita } from "@/lib/fila-de-acao";
import { modoDe } from "@/lib/harvey/autonomia";
import { falarComClienteDoTicket, respostaDoClienteDesde } from "@/lib/harvey/ponte-cliente-parceiro";

export type TipoDeResposta = "accept" | "accept_with_condition" | "reject" | "question" | "other";
export type LeituraDoAceite = { tipo: TipoDeResposta; data: string | null; resumo: string };

const SISTEMA = [
  "A customer replied to a quote we sent them for home maintenance work. Read ONLY their reply.",
  'Answer in strict JSON: {"type":"accept"|"accept_with_condition"|"reject"|"question"|"other","date":"YYYY-MM-DD"|"none"|null,"summary":string}.',
  "accept = they clearly approve the quote as it is (\"approved\", \"go ahead\", \"yes please book it\", \"happy to proceed\").",
  "accept_with_condition = they approve but ask for something that changes it (a discount, different scope, a date not offered, paying differently).",
  "reject = they decline. question = they ask something before deciding. other = anything else.",
  "date = only when they pick one of the OFFERED start dates (copy it as YYYY-MM-DD); \"none\" if they say none of the offered dates work; else null.",
  "summary = one plain sentence in UK English of what they said. No em dashes.",
].join("\n");

export function lerLeituraJson(cru: string, datas: string[]): LeituraDoAceite | null {
  try {
    const j = JSON.parse(String(cru ?? "").trim()) as Record<string, unknown>;
    const tipos: TipoDeResposta[] = ["accept", "accept_with_condition", "reject", "question", "other"];
    const tipo = tipos.includes(j.type as TipoDeResposta) ? (j.type as TipoDeResposta) : null;
    if (!tipo) return null;
    const d = typeof j.date === "string" ? j.date.trim() : null;
    const data = d === "none" ? "none" : d && datas.includes(d) ? d : null;
    return { tipo, data, resumo: typeof j.summary === "string" ? j.summary.slice(0, 300) : "" };
  } catch {
    return null;
  }
}

export async function lerRespostaDoCliente(
  texto: string,
  a: { referencia: string; total: number; datas: string[] },
  chamar: ChamadaAoModelo = chamarModeloJson,
): Promise<LeituraDoAceite | null> {
  const usuario = [
    `QUOTE ${a.referencia}: £${a.total.toFixed(2)}.`,
    a.datas.length ? `OFFERED START DATES: ${a.datas.join(", ")}` : "No start dates were offered.",
    `\nTHEIR REPLY:\n${texto.slice(0, 3000)}`,
  ].join("\n");
  return lerLeituraJson(await chamar(SISTEMA, usuario), a.datas);
}

/** Aceita pela rota do link (a mesma do botão), com a data escolhida. */
export async function aceitarCotacao(
  quoteId: string,
  startDate: string | null,
): Promise<{ ok: true; paymentLinkUrl: string | null; jobReference: string | null } | { ok: false; erro: string }> {
  const res = await fetch(`${appBaseUrl()}/api/quotes/respond`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: createQuoteResponseToken(quoteId), action: "accept", ...(startDate ? { startDate } : {}) }),
    signal: AbortSignal.timeout(60_000),
  }).catch((e: unknown) => ({ ok: false, status: 0, json: async () => ({ error: String(e) }) }) as unknown as Response);
  const j = (await res.json().catch(() => ({}))) as { error?: string; paymentLinkUrl?: string; jobReference?: string };
  if (!res.ok) return { ok: false, erro: j.error ?? `status ${res.status}` };
  return { ok: true, paymentLinkUrl: j.paymentLinkUrl ?? null, jobReference: j.jobReference ?? null };
}

const diaCurto = (ymd: string) =>
  new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/London" }).format(new Date(`${ymd}T12:00:00Z`));

/** O que dizer ao cliente depois do aceite. */
export function textoDoAceite(a: { referencia: string; data: string | null; paymentLinkUrl: string | null; entrada: number }): string {
  const quando = a.data && a.data !== "none" ? ` for ${diaCurto(a.data)}` : "";
  if (a.paymentLinkUrl && a.entrada > 0.01) {
    return `Thank you, ${a.referencia} is accepted${quando}. To secure the booking, please pay the £${a.entrada.toFixed(2)} deposit here: ${a.paymentLinkUrl}\n\nOnce it's paid we'll confirm the professional and the arrival time.`;
  }
  return `Thank you, ${a.referencia} is accepted${quando}. We'll confirm the professional and the arrival time shortly.`;
}

type QuoteEnviada = { id: string; reference: string; total_value: number | null; deposit_required: number | null; external_ref: string; customer_pdf_sent_at: string | null; updated_at: string; start_date_option_1: string | null; start_date_option_2: string | null };

/** A cada ciclo: cotações enviadas com resposta nova do cliente por e-mail. */
export async function lerAceitesPorEmail(
  sb: SupabaseClient,
  postarNotaInterna: (ticketId: number, corpo: string) => Promise<void>,
  opcoes: { chamar?: ChamadaAoModelo } = {},
): Promise<string[]> {
  const out: string[] = [];
  const modo = await modoDe("aceite");
  if (modo === "off") return out;
  const desde = new Date(Date.now() - 14 * 864e5).toISOString();
  const { data } = await sb
    .from("quotes")
    .select("id, reference, total_value, deposit_required, external_ref, customer_pdf_sent_at, updated_at, start_date_option_1, start_date_option_2")
    .eq("status", "awaiting_customer")
    .eq("external_source", "zendesk")
    .not("external_ref", "is", null)
    .is("deleted_at", null)
    .gte("updated_at", desde)
    .limit(30);
  for (const q of (data ?? []) as QuoteEnviada[]) {
    const ticketId = Number(q.external_ref);
    if (!Number.isFinite(ticketId) || ticketId <= 0) continue;
    const { zendeskApi } = await import("@/lib/zendesk");
    const tags = await zendeskApi<{ ticket: { tags?: string[] } }>(`tickets/${ticketId}.json`).then((t) => t.ticket?.tags ?? []).catch(() => [] as string[]);
    if (tags.includes("harvey_off")) continue;
    const enviadaEm = Date.parse(q.customer_pdf_sent_at ?? q.updated_at);
    const resposta = await respostaDoClienteDesde(sb, ticketId, enviadaEm).catch(() => null);
    if (!resposta) continue;
    const marca = `cliente:${q.id}:${resposta.em}`;
    const { data: lida } = await sb.from("quote_partner_messages").select("message_id").eq("message_id", marca).maybeSingle();
    if (lida) continue;

    const datas = datasDisponiveis(q);
    const total = Number(q.total_value) || 0;
    const leitura = await lerRespostaDoCliente(resposta.texto, { referencia: q.reference, total, datas }, opcoes.chamar).catch(() => null);
    if (!leitura) continue;
    let linha: string;
    if (leitura.tipo !== "accept") {
      const motivo = { accept_with_condition: "accepted with a condition", reject: "declined", question: "has a question", other: "replied" }[leitura.tipo];
      await precisaDeAcao(ticketId, `Customer ${motivo} on ${q.reference}: ${leitura.resumo}`).catch(() => null);
      linha = `Customer ${motivo}: ${leitura.resumo}. Passed to the team.`;
    } else if (modo !== "on") {
      await precisaDeAcao(ticketId, `Customer accepted ${q.reference} in writing: accept it in the OS`).catch(() => null);
      linha = `Customer accepted in writing (DRY RUN, nothing done). I would accept ${q.reference}${leitura.data && leitura.data !== "none" ? ` for ${leitura.data}` : ""} and reply with the next step.`;
    } else {
      const r = await aceitarCotacao(q.id, leitura.data);
      if (!r.ok) {
        await precisaDeAcao(ticketId, `Customer accepted ${q.reference} in writing but the acceptance failed (${r.erro}): accept it in the OS`).catch(() => null);
        linha = `Customer accepted in writing, but accepting failed (${r.erro}). Passed to the team.`;
      } else {
        const fala = await falarComClienteDoTicket(sb, ticketId, textoDoAceite({ referencia: q.reference, data: leitura.data, paymentLinkUrl: r.paymentLinkUrl, entrada: Number(q.deposit_required) || 0 }));
        if (leitura.data === "none") await precisaDeAcao(ticketId, `${q.reference} accepted, but none of the partner's dates work: agree a day`).catch(() => null);
        else await acaoFeita(ticketId).catch(() => null);
        linha = `Customer accepted in writing. ${q.reference} accepted${r.jobReference ? `, ${r.jobReference} created` : ""}${r.paymentLinkUrl ? ", deposit link sent" : ""}${fala.via ? ` (${fala.via})` : ` (reply NOT sent: ${fala.motivo})`}.`;
      }
    }
    await postarNotaInterna(ticketId, `🤖 HARVEY — reply on ${q.reference}: "${resposta.texto.slice(0, 400)}"\n\n${linha}`).catch(() => null);
    await sb.from("quote_partner_messages").insert({ message_id: marca, quote_id: q.id, ticket_id: ticketId, kind: "customer_reply", body: resposta.texto.slice(0, 4000) });
    out.push(`${q.reference}: ${leitura.tipo}`);
  }
  return out;
}

/** WhatsApp: a ferramenta accept_quote do Harvey. */
export async function aceitarPeloWhatsApp(
  sb: SupabaseClient,
  a: { telefone: string | null; clienteId?: string | null; data?: string | null },
): Promise<Record<string, unknown>> {
  const { cotacoesDoCliente } = await import("@/lib/harvey-wa/contas");
  const { quotes } = await cotacoesDoCliente(sb, a);
  const enviada = quotes.find((q) => q.status === "awaiting_customer");
  if (!enviada) return { error: "There is no sent quote waiting for their answer. Check get_quote_status." };
  const { data: q } = await sb.from("quotes").select("id, reference, deposit_required, external_ref, start_date_option_1, start_date_option_2").eq("id", enviada.id).maybeSingle();
  const qq = q as { id: string; reference: string; deposit_required: number | null; external_ref: string | null; start_date_option_1: string | null; start_date_option_2: string | null };
  const datas = datasDisponiveis(qq);
  const data = a.data === "none" ? "none" : a.data && datas.includes(a.data) ? a.data : null;
  if (datas.length && !data) return { needs_date: true, offered_dates: datas, note: "Ask which of these start dates they prefer (or if none works), then call accept_quote again with the date." };
  const modo = await modoDe("aceite");
  const ticketId = Number(qq.external_ref);
  if (modo !== "on") {
    if (ticketId) await precisaDeAcao(ticketId, `Customer accepted ${qq.reference} on WhatsApp${data ? ` (${data})` : ""}: accept it in the OS`).catch(() => null);
    return { accepted: false, note: "Thank them and say in one line the team will confirm the booking shortly. Do not send a link." };
  }
  const r = await aceitarCotacao(qq.id, data);
  if (!r.ok) return { error: `Could not accept right now (${r.erro}). Hand off to the team.` };
  if (data === "none" && ticketId) await precisaDeAcao(ticketId, `${qq.reference} accepted on WhatsApp, none of the partner's dates work: agree a day`).catch(() => null);
  return {
    accepted: true,
    quote: qq.reference,
    job: r.jobReference,
    deposit: Number(qq.deposit_required) || 0,
    payment_link: r.paymentLinkUrl,
    note: r.paymentLinkUrl
      ? "Thank them, say the booking is secured once the deposit is paid, and send the payment link."
      : "Thank them and say we'll confirm the professional and the arrival time shortly.",
  };
}
