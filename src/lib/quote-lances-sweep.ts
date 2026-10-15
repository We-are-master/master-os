/**
 * A varredura que transforma lance de parceiro em rascunho pronto para enviar.
 *
 * O buraco que ela fecha: o `submit-bid` grava o lance e retorna. Ninguém é
 * avisado. O escritório tinha que abrir a tela de Quotes e reparar num ponto
 * verde. É a doença de sempre no OS: avisar a partir de onde alguém clicou, e
 * não a partir do fato que mudou.
 *
 * A janela é de 2 horas contadas do PRIMEIRO convite, e não um relógio de 2 em
 * 2 horas. É a mesma intenção do dono ("checa a cada duas horas") com uma
 * diferença que importa: com relógio fixo, uma quote convidada às 13h59 seria
 * fechada às 14h com um minuto de leilão. Contando do convite, todo parceiro
 * tem as duas horas inteiras, sempre.
 *
 * O que ela NÃO faz: não escreve na quote e não fala com o cliente. Põe uma
 * nota INTERNA na thread com o preço pronto e o leque de lances, e marca a
 * quote para não repetir. Quem clica enviar é gente, por enquanto.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { syncQuoteZendeskStatus } from "@/lib/zendesk-status-sync";
import { assumirConversa, conversaDoTicket } from "@/lib/harvey-wa/controle";
import { addTicketTags, getZendeskTicketSnapshot, zendeskApi, ZENDESK_REPLY_STATUS_FIELD_ID } from "@/lib/zendesk";
import { escolherMelhorLance, MARGEM_PADRAO, type Lance } from "@/lib/quote-melhor-lance";
import { montarEmailDaQuote, scopeEmInglesUk, lerPayloadDoLance } from "@/lib/quote-email-cliente";
import { registrarDecisao } from "@/lib/harvey-wa/diario";

/** O leilão fecha 2h depois do primeiro convite. */
export const JANELA_HORAS = 2;
/**
 * Até quando ele insiste antes de desistir e chamar gente.
 *
 * Fechada a janela sem nenhum lance, ele NÃO desiste: continua olhando a cada
 * ciclo por mais 24 horas, porque parceiro responde tarde e um lance que chega
 * às 19h de sexta ainda vale. Passado o prazo sem nada, o silêncio vira nota
 * interna: 26h caladas é resposta, e alguém precisa decidir o que fazer.
 *
 * O dono pediu "de 30 em 30 minutos". O ciclo do Harvey é de 5, e olhar mais
 * vezes só acha o lance mais cedo — a conta que importa é o prazo, não o passo.
 */
export const PRAZO_SEM_LANCE_HORAS = JANELA_HORAS + 24;
/** Marca de "já avisei que ninguém cotou", no banco para não repetir a nota. */
const AVISEI_SEM_LANCE = "no_bids_reported";
/** Mesma coisa quando não há onde avisar: o ticket já estava fechado. */
const TICKET_FECHADO_SEM_LANCE = "no_bids_ticket_closed";
/** Tag no ticket para o silêncio aparecer no Action Required. */
export const TAG_SEM_LANCE = "harvey_no_bids";
/** Teto por ciclo: sem ele a primeira rodada despeja o backlog inteiro. */
const MAX_POR_CICLO = 5;
/**
 * Quote velha não entra, nunca.
 *
 * Havia 7 quotes paradas em `bidding` desde abril e junho de 2026, algumas com
 * lance de teste de £4.999,97. Sem esta trava a primeira rodada mandaria
 * rascunho de preço para tickets de cinco meses atrás. É a mesma lição das
 * rotas de cron que soltaram 52 convites reais em 20/08.
 */
const IDADE_MAXIMA_DIAS = 14;

export type ResultadoDaVarredura = {
  armado: boolean;
  analisados: number;
  rascunhados: number;
  semLance: number;
  /** Quotes que passaram das 26h sem um lance e viraram nota interna. */
  silenciosas: number;
  janelaAberta: number;
  detalhes: string[];
};

function horasDesde(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / 36e5;
}

function libras(v: number): string {
  return `£${v.toFixed(2)}`;
}

export async function varrerLancesParaRascunho(
  supabase: SupabaseClient,
  postarNotaInterna: (ticketId: number, corpo: string) => Promise<void>,
): Promise<ResultadoDaVarredura> {
  const armado = process.env.HARVEY_RASCUNHO_LANCE === "1";
  const r: ResultadoDaVarredura = {
    armado, analisados: 0, rascunhados: 0, semLance: 0, silenciosas: 0, janelaAberta: 0, detalhes: [],
  };

  const desde = new Date(Date.now() - IDADE_MAXIMA_DIAS * 864e5).toISOString();
  const { data: quotes, error } = await supabase
    .from("quotes")
    .select("id, reference, title, service_type, scope, status, external_source, external_ref, created_at, partner_id, automation_status")
    .eq("status", "bidding")
    .eq("external_source", "zendesk")
    .not("external_ref", "is", null)
    .is("deleted_at", null)
    .gte("created_at", desde)
    .order("created_at", { ascending: true })
    .limit(50);
  if (error) {
    r.detalhes.push(`nao consegui ler as quotes: ${error.message}`);
    return r;
  }
  if ((quotes ?? []).length === 0) return r;


  for (const bruta of (quotes ?? []) as Array<Record<string, unknown>>) {
    if (r.rascunhados >= MAX_POR_CICLO) break;
    const q = bruta as unknown as {
      id: string; reference: string; title: string | null; service_type: string | null;
      scope: string | null; external_ref: string; created_at: string;
    };
    r.analisados++;

    // A janela conta do primeiro convite. Sem convite não há leilão para fechar.
    const { data: convites } = await supabase
      .from("quote_partner_invitations")
      .select("invited_at")
      .eq("quote_id", q.id)
      .order("invited_at", { ascending: true })
      .limit(1);
    const primeiro = (convites ?? [])[0] as { invited_at?: string } | undefined;
    if (!primeiro?.invited_at) continue;
    if (horasDesde(primeiro.invited_at) < JANELA_HORAS) {
      r.janelaAberta++;
      continue;
    }

    const { data: lancesBrutos } = await supabase
      .from("quote_bids")
      .select("id, partner_id, partner_name, bid_amount, status, created_at, notes")
      .eq("quote_id", q.id);
    const escolha = escolherMelhorLance((lancesBrutos ?? []) as unknown as Lance[], { margem: MARGEM_PADRAO });
    if (!escolha) {
      r.semLance++;
      /**
       * Ninguém cotou. Ele segue olhando até o prazo, e só então chama gente.
       *
       * Sem este ramo a quote ficava em `bidding` para sempre, calada: o
       * escritório não tinha como saber a diferença entre "os parceiros ainda
       * vão responder" e "não vem lance nenhum". As duas coisas eram um número
       * parado na tela.
       */
      const horas = horasDesde(primeiro.invited_at);
      if (horas < PRAZO_SEM_LANCE_HORAS) continue;
      const marca = bruta.automation_status as string | null;
      if (marca === AVISEI_SEM_LANCE || marca === TICKET_FECHADO_SEM_LANCE) continue;

      const convidados = (await supabase
        .from("quote_partner_invitations")
        .select("partner_id", { count: "exact", head: true })
        .eq("quote_id", q.id)).count ?? 0;
      const nota = [
        `🤖 HARVEY — nobody bid on ${q.reference}`,
        "",
        `${convidados} partner(s) invited, first invite ${Math.round(horas)}h ago. No valid bid came back.`,
        "",
        "This needs a person: widen the trade or postcode, call a partner, or tell the customer we cannot cover it.",
      ].join("\n");

      if (!armado) {
        r.detalhes.push(`[ensaio] ${q.reference}: ${Math.round(horas)}h sem lance de ${convidados} convidado(s)`);
        continue;
      }
      /**
       * Ticket fechado não aceita nota: o Zendesk devolve 422 e, sem a marca,
       * ele tentava de novo a cada ciclo (QT-2026-1150 no #50536, 24/09/2026).
       * Conversa encerrada não precisa de aviso, então marca e segue.
       */
      const snap = await getZendeskTicketSnapshot(q.external_ref);
      if (snap.ok && snap.ticket?.status === "closed") {
        await supabase
          .from("quotes")
          .update({ automation_status: TICKET_FECHADO_SEM_LANCE, updated_at: new Date().toISOString() })
          .eq("id", q.id);
        r.detalhes.push(`${q.reference}: sem lance, mas o ticket #${q.external_ref} está fechado — não aviso`);
        continue;
      }
      try {
        await postarNotaInterna(Number(q.external_ref), nota);
        await addTicketTags(q.external_ref, [TAG_SEM_LANCE]);
      } catch (err) {
        r.detalhes.push(`${q.reference}: aviso de silêncio falhou, não marco — ${String(err)}`);
        continue;
      }
      await supabase
        .from("quotes")
        .update({ automation_status: AVISEI_SEM_LANCE, updated_at: new Date().toISOString() })
        .eq("id", q.id);
      r.silenciosas++;
      r.detalhes.push(`${q.reference}: ${Math.round(horas)}h sem lance — nota pro humano`);
      await registrarDecisao({ origem: "lances", ticketId: q.external_ref, quoteRef: q.reference, decisao: `No bids on ${q.reference} after ${Math.round(horas)}h from ${convidados} invited partner(s): asked the team to step in`, regra: `no bid within ${PRAZO_SEM_LANCE_HORAS}h of the first invite`, pendente: "Team: widen the trade, call a partner or tell the customer" }, supabase);
      continue;
    }

    const nota = await rascunhoDaQuote(q, escolha);

    if (!armado) {
      r.detalhes.push(
        `[ensaio] ${q.reference}: ${escolha.ordenados.length} lance(s), melhor ${libras(escolha.melhor.valor)} ` +
          `(${escolha.melhor.partner_name ?? "parceiro"}) → cliente ${libras(escolha.precoAoCliente)}`,
      );
      continue;
    }

    try {
      await postarNotaInterna(Number(q.external_ref), nota);
    } catch (err) {
      r.detalhes.push(`${q.reference}: nota falhou, nao marco — ${String(err)}`);
      continue;
    }
    /**
     * Grava DEPOIS da nota sair: se gravasse antes e a nota falhasse, a quote
     * mudaria de estado sem que ninguém tivesse o texto para enviar.
     *
     * Gravar o número é o ponto todo. Enquanto o Harvey só punha a nota, o OS
     * e o cliente podiam divergir: a QT-2026-1139 está gravada com £633,33 e o
     * cliente recebeu £520, digitado à mão às 00:09 de 08/09/2026. Com o preço
     * na quote, o botão de enviar manda o que o sistema tem.
     *
     * O que ele NÃO faz continua igual: não envia. `quote_ready` quer dizer
     * pronto para uma pessoa olhar e clicar.
     */
    const { error: upErr } = await supabase
      .from("quotes")
      .update({
        status: "quote_ready",
        partner_id: escolha.melhor.partner_id,
        partner_name: escolha.melhor.partner_name,
        partner_cost: escolha.melhor.valor,
        margin_percent: escolha.margem,
        total_value: escolha.precoAoCliente,
        updated_at: new Date().toISOString(),
      })
      .eq("id", q.id);
    if (upErr) r.detalhes.push(`${q.reference}: nota saiu mas a quote não mudou — ${upErr.message}`);
    else {
      const aviso = await chamarEquipeParaOLance(supabase, q.id, Number(q.external_ref));
      if (aviso) r.detalhes.push(`${q.reference}: ${aviso}`);
    }
    r.rascunhados++;
    r.detalhes.push(`${q.reference}: rascunho na thread, cliente ${libras(escolha.precoAoCliente)}`);
    if (!upErr) await registrarDecisao({ origem: "lances", ticketId: q.external_ref, quoteRef: q.reference, decisao: `Drafted ${q.reference} at ${libras(escolha.precoAoCliente)} from the ${libras(escolha.melhor.valor)} bid (${escolha.ordenados.length} bid(s))`, regra: `best bid after the ${JANELA_HORAS}h window, margin ${escolha.margem}%`, pendente: "Team: review the draft and send the quote" }, supabase);
  }

  return r;
}

/**
 * Lance entrou: o ticket tem de aparecer na Action Required, venha de onde vier.
 *
 * Em 15/10/2026 três quotes com lance ficaram paradas sem ninguém ver. A
 * QT-2026-1170 tinha preço no OS e o ticket continuou em Bidding: o sync do
 * status era `void` depois da resposta, e na Vercel isso morre no meio. A
 * QT-2026-1171 virou Quote Ready, mas o ticket ainda tinha `harvey_ai` (a
 * conversa estava com o Harvey), e a Action Required ignora essa tag.
 *
 * Então, em ordem, cada passo sem derrubar o próximo:
 *  1. o status do ticket acompanha a quote (com `await`);
 *  2. se o Harvey segura a conversa do WhatsApp, ela passa para a equipe;
 *  3. Reply Status 🔴 e sem `harvey_ai`: a view mostra o ticket.
 * Devolve uma linha para o relatório quando algum passo falha.
 */
async function chamarEquipeParaOLance(supabase: SupabaseClient, quoteId: string, ticketId: number): Promise<string | null> {
  const falhas: string[] = [];
  await syncQuoteZendeskStatus(quoteId, supabase).catch((err: unknown) => falhas.push(`sync do status: ${String(err).slice(0, 120)}`));
  if (!Number.isFinite(ticketId) || ticketId <= 0) return falhas.length ? falhas.join("; ") : null;
  try {
    const conversa = await conversaDoTicket(supabase, ticketId);
    if (conversa?.estado === "harvey") await assumirConversa(supabase, conversa.conversation_id, "Team", "a partner bid (quote ready)");
  } catch (err) {
    falhas.push(`passar a conversa: ${String(err).slice(0, 120)}`);
  }
  try {
    await zendeskApi(`tickets/${ticketId}.json`, { method: "PUT", body: { ticket: { custom_fields: [{ id: ZENDESK_REPLY_STATUS_FIELD_ID, value: "reply_awaiting" }] } } });
    await zendeskApi(`tickets/${ticketId}/tags.json`, { method: "DELETE", body: { tags: ["harvey_ai"] } });
  } catch (err) {
    falhas.push(`marcar o ticket: ${String(err).slice(0, 120)}`);
  }
  return falhas.length ? falhas.join("; ") : null;
}

/**
 * O rascunho inteiro de UMA quote, do lance ao texto pronto.
 *
 * Fica exportado e separado do laço porque duas coisas precisam dele e não
 * podem divergir: a varredura, que posta sozinha, e a simulação, que mostra ao
 * dono o que sairia. Se o montador morasse dentro do laço, a tela e a
 * realidade se afastariam no primeiro ajuste.
 */
export async function rascunhoDaQuote(
  q: { reference: string; title: string | null; scope: string | null },
  escolha: NonNullable<ReturnType<typeof escolherMelhorLance>>,
): Promise<string> {
  /**
   * O corpo do e-mail sai do LANCE, não de um preço nosso: o parceiro separa
   * labour de materials e a soma bate com o lance. Cada metade sobe pela
   * margem sozinha, e o total é a soma das linhas escritas.
   */
  const paga = lerPayloadDoLance((escolha.melhor as { notes?: string | null }).notes);
  const traducao = await scopeEmInglesUk(
    { escopoDaQuote: q.scope, labour: paga.labourDescription, materials: paga.materialsDescription },
    process.env.OPENAI_API_KEY?.trim(),
  );
  // Sem separação, a mão de obra leva o lance inteiro e material fica zerado.
  const labourCost = paga.labourCost > 0 ? paga.labourCost : escolha.melhor.valor - paga.materialsCost;
  const email = montarEmailDaQuote({
    scope: traducao.scope,
    labourCost,
    materialsCost: paga.materialsCost,
    margem: escolha.margem,
  });
  return montarNota(q, escolha, email?.corpo ?? null, traducao.traduzido ? null : (traducao.motivo ?? "não traduzido"));
}

function montarNota(
  q: { reference: string; title: string | null },
  e: NonNullable<ReturnType<typeof escolherMelhorLance>>,
  corpoDoEmail: string | null,
  avisoDeTraducao: string | null,
): string {
  const leque = e.ordenados
    .map((l, i) => `  ${i === 0 ? "→" : " "} ${libras(l.valor)}  ${l.partner_name?.trim() || "partner"}`)
    .join("\n");
  const descartados = e.descartados.length
    ? `\n(${e.descartados.length} bid(s) ignored: not submitted or no valid amount)`
    : "";

  return [
    `🤖 HARVEY — bids are in for ${q.reference} (draft, nothing sent yet)`,
    "",
    `Best bid: ${libras(e.melhor.valor)} from ${e.melhor.partner_name?.trim() || "partner"}`,
    `At ${e.margem}% margin, price to the customer: ${libras(e.precoAoCliente)}`,
    "",
    `All bids (${e.ordenados.length}), cheapest first:`,
    leque + descartados,
    ...(avisoDeTraducao
      ? ["", `⚠️ Scope NOT translated (${avisoDeTraducao}). Read it before sending: it may be in the partner's own language.`]
      : []),
    "",
    "── Ready to send to the customer (copy from here) ──",
    corpoDoEmail ?? "(no bid breakdown, cannot build the email)",
    "",
    "── To apply in the OS ──",
    `Quotes → ${q.reference} → pick the ${libras(e.melhor.valor)} bid, margin ${e.margem}%.`,
  ].join("\n");
}
