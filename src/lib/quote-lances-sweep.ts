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
import { addTicketTags, getZendeskTicketSnapshot, replyToSideConversation, zendeskApi, ZENDESK_REPLY_STATUS_FIELD_ID } from "@/lib/zendesk";
import { ZD_STATUS_AWAITING_APPROVAL } from "@/lib/zendesk-statuses";
import { escolherMelhorLance, MARGEM_PADRAO, type Escolha, type Lance } from "@/lib/quote-melhor-lance";
import { montarEmailDaQuote, scopeEmInglesUk, lerPayloadDoLance } from "@/lib/quote-email-cliente";
import { registrarDecisao } from "@/lib/harvey-wa/diario";
import {
  ESCOPO_PRECISA_DE_GENTE, TAG_ESCOPO, escopoDoLance, htmlDaPergunta, lerMarcaDeEspera, lerRespostaDoParceiro,
  marcaDeEspera, notasComNovoValor, passoDepoisDaResposta, pedidoDoCliente, respostaDoParceiro, verificarEscopoDoLance,
  type EsperaDeEscopo, type EventoDeSideConversation,
} from "@/lib/quote-lance-escopo";
import { modoDe } from "@/lib/harvey/autonomia";
import { contaEhDireta, envioAutomaticoLigado, maximoDoEnvioAutomatico, podeMandarSozinho } from "@/lib/quote-envio-automatico";
import { acaoFeita, precisaDeAcao } from "@/lib/fila-de-acao";

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
/**
 * Quanto ele espera o parceiro responder à pergunta de escopo. Passou, gente
 * decide: o cliente está esperando preço e um dia calado já é resposta.
 */
export const PRAZO_RESPOSTA_ESCOPO_HORAS = 24;

export type ResultadoDaVarredura = {
  armado: boolean;
  analisados: number;
  rascunhados: number;
  semLance: number;
  /** Quotes que passaram das 26h sem um lance e viraram nota interna. */
  silenciosas: number;
  /** Lances que não batiam com o pedido: pergunta ao parceiro, sem preço. */
  perguntasDeEscopo: number;
  /** Escopo que voltou para gente (parceiro não confirmou, não respondeu, ou não deu para perguntar). */
  escopoParaGente: number;
  /** Quotes que saíram sozinhas para o cliente (HARVEY_QUOTE_AUTO_SEND=1). */
  enviadasSozinhas: number;
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
  // Lê a tela antes de tudo: "lances" decide o rascunho, "envio" e o teto valem lá embaixo.
  const armado = (await modoDe("lances")) === "on";
  const r: ResultadoDaVarredura = {
    armado, analisados: 0, rascunhados: 0, semLance: 0, silenciosas: 0,
    perguntasDeEscopo: 0, escopoParaGente: 0, enviadasSozinhas: 0, janelaAberta: 0, detalhes: [],
  };
  // Desligável sem deploy, caso o modelo comece a perguntar demais.
  const checarEscopo = process.env.HARVEY_ESCOPO_LANCE !== "0";

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
    // Pergunta ao parceiro também é escrita para fora: conta no mesmo teto.
    if (r.rascunhados + r.perguntasDeEscopo >= MAX_POR_CICLO) break;
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
      const fila = await precisaDeAcao(q.external_ref, `No bids after ${Math.round(horas)}h on ${q.reference}: invite more partners or call`);
      if (!fila.ok) r.detalhes.push(`${q.reference}: ${fila.linha}`);
      await supabase
        .from("quotes")
        .update({ automation_status: AVISEI_SEM_LANCE, updated_at: new Date().toISOString() })
        .eq("id", q.id);
      r.silenciosas++;
      r.detalhes.push(`${q.reference}: ${Math.round(horas)}h sem lance — nota pro humano`);
      await registrarDecisao({ origem: "lances", ticketId: q.external_ref, quoteRef: q.reference, decisao: `No bids on ${q.reference} after ${Math.round(horas)}h from ${convidados} invited partner(s): asked the team to step in`, regra: `no bid within ${PRAZO_SEM_LANCE_HORAS}h of the first invite`, pendente: "Team: widen the trade, call a partner or tell the customer" }, supabase);
      continue;
    }

    /**
     * Antes do preço, o escopo. Ver `quote-lance-escopo.ts` (QT-2026-1166).
     *
     * Três caminhos: a quote já está parada com gente (não toca), está
     * esperando o parceiro responder (lê a side conversation), ou é lance novo
     * (compara com o pedido e, se divergir, pergunta em vez de precificar).
     */
    const marcaDoEscopo = bruta.automation_status as string | null;
    if (marcaDoEscopo === ESCOPO_PRECISA_DE_GENTE) {
      r.detalhes.push(`${q.reference}: escopo do lance parado com gente, não precifico`);
      continue;
    }
    const lances = (lancesBrutos ?? []) as unknown as LanceComNotas[];
    let escolhaFinal: Escolha = escolha;
    const avisosDeEscopo: string[] = [];
    let escopoConfirmado: string | null = null;
    // Escopo conferido de verdade (o envio automático só sai assim): o parceiro confirmou, ou o modelo comparou e bateu.
    let escopoConferido = false;
    const espera = lerMarcaDeEspera(marcaDoEscopo);
    if (espera) {
      const res = await acompanharPerguntaDeEscopo(supabase, q, espera, lances, armado, postarNotaInterna);
      r.detalhes.push(`${q.reference}: ${res.linha}`);
      if (res.tipo === "pessoa") r.escopoParaGente++;
      if (res.tipo !== "seguir") continue;
      escolhaFinal = res.escolha;
      escopoConfirmado = res.resumo || null;
      avisosDeEscopo.push(res.aviso);
      escopoConferido = true;
    } else if (checarEscopo) {
      const chec = await checarEscopoDoLance(supabase, q, escolha, armado, postarNotaInterna);
      if (chec.tipo !== "seguir") {
        r.detalhes.push(`${q.reference}: ${chec.linha}`);
        if (chec.tipo === "perguntou") r.perguntasDeEscopo++;
        if (chec.tipo === "pessoa") r.escopoParaGente++;
        continue;
      }
      if (chec.aviso) avisosDeEscopo.push(chec.aviso);
      else escopoConferido = true;
    }

    const nota = await rascunhoDaQuote(q, escolhaFinal, { escopoDoParceiro: escopoConfirmado, avisos: avisosDeEscopo });

    if (!armado) {
      r.detalhes.push(
        `[ensaio] ${q.reference}: ${escolhaFinal.ordenados.length} lance(s), melhor ${libras(escolhaFinal.melhor.valor)} ` +
          `(${escolhaFinal.melhor.partner_name ?? "parceiro"}) → cliente ${libras(escolhaFinal.precoAoCliente)}`,
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
        partner_id: escolhaFinal.melhor.partner_id,
        partner_name: escolhaFinal.melhor.partner_name,
        partner_cost: escolhaFinal.melhor.valor,
        margin_percent: escolhaFinal.margem,
        total_value: escolhaFinal.precoAoCliente,
        // A marca de escopo já cumpriu o papel: limpa para a cotação automática não tropeçar nela.
        ...(espera ? { automation_status: "scope_check_resolved" } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("id", q.id);
    let enviada = false;
    if (upErr) r.detalhes.push(`${q.reference}: nota saiu mas a quote não mudou — ${upErr.message}`);
    else {
      // Fase 1: quando é seguro, o preço sai sozinho para o cliente e o Harvey segue com a conversa.
      const envio = envioAutomaticoLigado()
        ? await mandarSozinho(supabase, q, escolhaFinal, escopoConferido, postarNotaInterna).catch((err: unknown) => ({ enviado: false, linha: `envio automático falhou: ${String(err).slice(0, 120)}` }))
        : { enviado: false, linha: null };
      if (envio.linha) r.detalhes.push(`${q.reference}: ${envio.linha}`);
      enviada = envio.enviado;
      if (enviada) r.enviadasSozinhas++;
      else {
        const aviso = await chamarEquipeParaOLance(supabase, q.id, q.reference, Number(q.external_ref));
        if (aviso) r.detalhes.push(`${q.reference}: ${aviso}`);
      }
    }
    r.rascunhados++;
    r.detalhes.push(`${q.reference}: rascunho na thread, cliente ${libras(escolhaFinal.precoAoCliente)}`);
    if (!upErr && enviada) await registrarDecisao({ origem: "lances", ticketId: q.external_ref, quoteRef: q.reference, decisao: `Sent ${q.reference} to the customer at ${libras(escolhaFinal.precoAoCliente)} from the ${libras(escolhaFinal.melhor.valor)} bid (${escolhaFinal.ordenados.length} bid(s)), no person needed`, regra: `auto send: scope checked, direct customer, up to £${maximoDoEnvioAutomatico()}, margin ${escolhaFinal.margem}%`, pendente: "Customer: accept the quote" }, supabase);
    else if (!upErr) await registrarDecisao({ origem: "lances", ticketId: q.external_ref, quoteRef: q.reference, decisao: `Drafted ${q.reference} at ${libras(escolhaFinal.precoAoCliente)} from the ${libras(escolhaFinal.melhor.valor)} bid (${escolhaFinal.ordenados.length} bid(s))`, regra: `best bid after the ${JANELA_HORAS}h window, margin ${escolhaFinal.margem}%`, pendente: "Team: review the draft and send the quote" }, supabase);
  }

  return r;
}

/**
 * O preço sai sozinho para o cliente (Fase 1, dono 15/10/2026). Quem decide é
 * `podeMandarSozinho` (quote-envio-automatico.ts); aqui só se junta o que ela
 * precisa e se usa o canal de sempre:
 *  - WhatsApp com o Harvey na conversa e a janela de 24h aberta: o texto da
 *    quote da cotação automática (textoDaQuote) com o link para aceitar;
 *  - senão, e-mail com o PDF pela mesma rota do botão (send-pdf, segredo interno).
 * Depois: ticket em 🟠 Approval, Reply Status 🟢, nota interna, e a conversa
 * continua com o Harvey. Não deu para mandar: devolve false e a equipe é chamada.
 */
async function mandarSozinho(
  supabase: SupabaseClient,
  q: { id: string; reference: string; title: string | null; service_type: string | null; external_ref: string },
  escolha: Escolha,
  escopoConferido: boolean,
  postarNotaInterna: (ticketId: number, corpo: string) => Promise<void>,
): Promise<{ enviado: boolean; linha: string | null }> {
  const ticketId = Number(q.external_ref);
  const { data: qq } = await supabase.from("quotes").select("client_id, client_name, client_email").eq("id", q.id).maybeSingle();
  const quote = (qq ?? {}) as { client_id?: string | null; client_name?: string | null; client_email?: string | null };
  let contaDeOrigem: string | null = null;
  if (quote.client_id) {
    const { data: c } = await supabase.from("clients").select("source_account_id").eq("id", quote.client_id).maybeSingle();
    contaDeOrigem = ((c as { source_account_id?: string | null } | null)?.source_account_id ?? null) || null;
  }
  const { tryGetFixfyAccountId } = await import("@/lib/fixfy-account");
  const contaFixfy = await tryGetFixfyAccountId(supabase).catch(() => null);
  const tags = await zendeskApi<{ ticket: { tags?: string[] } }>(`tickets/${ticketId}.json`).then((t) => t.ticket?.tags ?? []).catch(() => [] as string[]);
  const conversa = await conversaDoTicket(supabase, ticketId).catch(() => null);
  const { historico, enviarTexto, vozDaConversa } = await import("@/lib/harvey-wa/sunshine");
  const msgs = conversa ? await historico(conversa.conversation_id, 50).catch(() => []) : [];
  const ultimaDoCliente = [...msgs].reverse().find((m) => m.author.type === "user");
  const janelaAberta = !!ultimaDoCliente && Date.now() - Date.parse(ultimaDoCliente.received) < 23 * 36e5;
  const email = quote.client_email?.includes("@") && !/@getfixfy\.com$/i.test(quote.client_email) ? quote.client_email.trim() : null;
  const pelaConversa = !!conversa && conversa.estado === "harvey" && janelaAberta;
  const total = escolha.precoAoCliente;
  const decisao = podeMandarSozinho({
    ligado: envioAutomaticoLigado(),
    total,
    maximo: maximoDoEnvioAutomatico(),
    escopoConferido,
    perguntaPendente: false,
    contaDireta: contaEhDireta({ contaDeOrigem, contaFixfy, daConversaDoHarvey: !!conversa }),
    b2b: tags.includes("b2b"),
    temCanal: pelaConversa || !!email,
    equipeNaConversa: conversa?.estado === "equipe",
  });
  if (!decisao.enviar) return { enviado: false, linha: `não sai sozinha: ${decisao.motivos.join(", ")}` };

  // O PDF e a tela de Quotes leem as linhas: uma linha com o preço, se ainda não houver.
  const { count } = await supabase.from("quote_line_items").select("id", { count: "exact", head: true }).eq("quote_id", q.id);
  if (!count) {
    const { insertQuoteLineItemsResilient } = await import("@/lib/quote-line-items-insert");
    await insertQuoteLineItemsResilient(supabase, [
      { quote_id: q.id, description: (q.title || q.service_type || "Works as described").slice(0, 300), quantity: 1, unit_price: total, sort_order: 0, partner_unit_cost: escolha.melhor.valor, notes: `From ${escolha.melhor.partner_name?.trim() || "partner"}'s bid` },
    ]);
  }

  let via: string;
  if (pelaConversa && conversa) {
    const { createQuoteResponseToken } = await import("@/lib/quote-response-token");
    const { appBaseUrl } = await import("@/lib/app-base-url");
    const { textoDaQuote } = await import("@/lib/harvey-wa/cotacao-automatica");
    const { firstName } = await import("@/lib/agent/sales/lead-brief");
    const link = `${appBaseUrl()}/quote/respond?token=${encodeURIComponent(createQuoteResponseToken(q.id))}&action=accept`;
    // Entrada da conta também no WhatsApp (16/10/2026): sem isto a quote saía com entrada 0, o
    // aceite marcava o job direto com o parceiro e ninguém pagava nada antes.
    const { aplicarEntradaDaConta } = await import("@/lib/deposito-da-cotacao");
    const { data: atual } = await supabase.from("quotes").select("total_value, deposit_required").eq("id", q.id).maybeSingle();
    const entradaAtual = Number((atual as { deposit_required?: number | null } | null)?.deposit_required ?? 0);
    const aplicada = await aplicarEntradaDaConta(
      supabase,
      { id: q.id, total_value: Number((atual as { total_value?: number | null } | null)?.total_value ?? total) || total, deposit_required: entradaAtual },
      contaDeOrigem,
    );
    const entrada = aplicada?.deposit_required ?? entradaAtual;
    const texto = textoDaQuote({ nome: firstName(conversa.name ?? quote.client_name ?? null) ?? "there", servico: q.service_type, total, referencia: q.reference, link, entrada });
    await enviarTexto(conversa.conversation_id, texto, vozDaConversa(msgs));
    const { persistQuoteSentToCustomer } = await import("@/lib/quotes/persist-quote-sent-to-customer");
    const gravado = await persistQuoteSentToCustomer(supabase, q.id, new Date().toISOString(), email ?? undefined);
    if (gravado.error) console.error(`[lances] ${q.reference}: enviada no WhatsApp mas o status não gravou`, gravado.error.message);
    via = "WhatsApp";
  } else {
    const { appBaseUrl } = await import("@/lib/app-base-url");
    const res = await fetch(`${appBaseUrl()}/api/quotes/send-pdf`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-internal-secret": process.env.INTERNAL_SYNC_SECRET?.trim() ?? "" },
      body: JSON.stringify({ quoteId: q.id }),
      signal: AbortSignal.timeout(90_000),
    }).catch(() => null);
    if (!res?.ok) return { enviado: false, linha: `envio automático por e-mail falhou (${res?.status ?? "sem resposta"}), vai para gente` };
    via = "email (PDF)";
  }

  // Ticket em 🟠 Approval e 🟢 (fomos nós por último). Cada passo falha sozinho: a quote já saiu.
  try {
    await zendeskApi(`tickets/${ticketId}.json`, {
      method: "PUT",
      body: { ticket: { custom_status_id: ZD_STATUS_AWAITING_APPROVAL, custom_fields: [{ id: ZENDESK_REPLY_STATUS_FIELD_ID, value: "reply_replied" }] } },
    });
  } catch (err) {
    console.error(`[lances] ${q.reference}: status do ticket após envio`, err);
  }
  // A quote saiu: nada nosso a fazer até o cliente responder.
  await acaoFeita(ticketId);
  await postarNotaInterna(ticketId, [
    `🤖 HARVEY — ${q.reference} SENT to the customer by ${via}: ${libras(total)}`,
    "",
    `Best bid ${libras(escolha.melhor.valor)} from ${escolha.melhor.partner_name?.trim() || "partner"}, ${escolha.margem}% margin. Scope checked, direct customer, under £${maximoDoEnvioAutomatico()}.`,
    "Harvey keeps the WhatsApp chat. The approval follow-up takes it from here.",
  ].join("\n")).catch((err: unknown) => console.error(`[lances] ${q.reference}: nota do envio`, err));
  return { enviado: true, linha: `enviada sozinha ao cliente (${via}), ${libras(total)}` };
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
 *  3. Reply Status 🔴 e sem `harvey_ai`: a view mostra o ticket;
 *  4. Action Required Yes com a próxima ação (fila-de-acao.ts).
 * Devolve uma linha para o relatório quando algum passo falha.
 */
async function chamarEquipeParaOLance(supabase: SupabaseClient, quoteId: string, referencia: string, ticketId: number): Promise<string | null> {
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
  const fila = await precisaDeAcao(ticketId, `Bids are in on ${referencia}: review the draft and send the quote`);
  if (!fila.ok) falhas.push(fila.linha);
  return falhas.length ? falhas.join("; ") : null;
}

/* ============================ escopo do lance ============================ */

type LanceComNotas = Lance & { notes?: string | null };
type QuoteDaVarredura = { id: string; reference: string; title: string | null; scope: string | null; external_ref: string };
type Parceiro = { id: string; email: string | null; company_name: string | null; contact_name: string | null; zendesk_user_id: string | number | null };

async function parceiroDoLance(supabase: SupabaseClient, partnerId: string | null): Promise<Parceiro | null> {
  if (!partnerId) return null;
  const { data } = await supabase
    .from("partners")
    .select("id, email, company_name, contact_name, zendesk_user_id")
    .eq("id", partnerId)
    .maybeSingle();
  return (data as Parceiro | null) ?? null;
}

/** O pedido do cliente: scope da quote + o que o requester escreveu no ticket. */
async function lerPedidoDoCliente(q: QuoteDaVarredura): Promise<string> {
  try {
    const { ticket } = await zendeskApi<{ ticket: { requester_id?: number } }>(`tickets/${q.external_ref}.json`);
    const { comments } = await zendeskApi<{ comments: Array<{ author_id?: number; public?: boolean; body?: string }> }>(
      `tickets/${q.external_ref}/comments.json?sort_order=asc&per_page=100`,
    );
    return pedidoDoCliente(q.scope, comments ?? [], ticket?.requester_id ?? null);
  } catch {
    // Sem o ticket, o scope da quote ainda é o pedido; melhor checar com menos do que não checar.
    return pedidoDoCliente(q.scope, [], null);
  }
}

/**
 * Chama gente para o escopo: nota interna, Reply Status 🔴, sem `harvey_ai`, e
 * a quote marcada para a varredura não voltar a mexer. Nunca fala com o cliente.
 */
async function escopoParaGente(
  supabase: SupabaseClient,
  q: QuoteDaVarredura,
  nota: string,
  postarNotaInterna: (ticketId: number, corpo: string) => Promise<void>,
): Promise<string | null> {
  const ticketId = Number(q.external_ref);
  try {
    await postarNotaInterna(ticketId, nota);
  } catch (err) {
    return `nota falhou, não marco: ${String(err).slice(0, 120)}`;
  }
  await supabase
    .from("quotes")
    .update({ automation_status: ESCOPO_PRECISA_DE_GENTE, updated_at: new Date().toISOString() })
    .eq("id", q.id);
  try {
    await zendeskApi(`tickets/${ticketId}.json`, { method: "PUT", body: { ticket: { custom_fields: [{ id: ZENDESK_REPLY_STATUS_FIELD_ID, value: "reply_awaiting" }] } } });
    await addTicketTags(ticketId, [TAG_ESCOPO]);
    await zendeskApi(`tickets/${ticketId}/tags.json`, { method: "DELETE", body: { tags: ["harvey_ai"] } });
  } catch (err) {
    return `nota saiu, mas marcar o ticket falhou: ${String(err).slice(0, 120)}`;
  }
  const fila = await precisaDeAcao(ticketId, `Scope check on ${q.reference}: read the partner's side conversation and decide the price`);
  return fila.ok ? null : fila.linha;
}

type ResultadoDaChecagem =
  | { tipo: "seguir"; aviso: string | null }
  | { tipo: "perguntou" | "pessoa" | "esperar"; linha: string };

/**
 * Lance novo: bate com o pedido? Se não bate, pergunta ao parceiro na side
 * conversation do convite e NÃO precifica. A quote fica em `bidding` com a
 * marca de espera (ver `marcaDeEspera`).
 */
async function checarEscopoDoLance(
  supabase: SupabaseClient,
  q: QuoteDaVarredura,
  escolha: Escolha,
  armado: boolean,
  postarNotaInterna: (ticketId: number, corpo: string) => Promise<void>,
): Promise<ResultadoDaChecagem> {
  const lance = escolha.melhor as LanceComNotas & { valor: number };
  const escopo = escopoDoLance(lerPayloadDoLance(lance.notes), lance.notes);
  const pedido = await lerPedidoDoCliente(q);
  const v = await verificarEscopoDoLance(pedido, escopo);
  if (!v.verificado) {
    return { tipo: "seguir", aviso: `⚠️ Scope NOT checked against the customer's request (${v.motivo}). Compare them before sending.` };
  }
  if (!v.diverge) return { tipo: "seguir", aviso: null };

  const nomeDoParceiro = lance.partner_name?.trim() || "partner";
  if (!armado) {
    return { tipo: "perguntou", linha: `[ensaio] escopo diverge (${v.motivo}); perguntaria a ${nomeDoParceiro}: "${v.pergunta}"` };
  }

  const ticketId = Number(q.external_ref);
  const parceiro = await parceiroDoLance(supabase, lance.partner_id);
  const email = parceiro?.email?.trim().toLowerCase() ?? "";
  let sc: { id: string } | undefined;
  if (email) {
    try {
      const { side_conversations } = await zendeskApi<{ side_conversations: Array<{ id: string; participants?: Array<{ email?: string }> }> }>(
        `tickets/${ticketId}/side_conversations.json`,
      );
      sc = (side_conversations ?? []).find((s) => s.participants?.some((x) => x.email?.toLowerCase() === email));
    } catch {
      sc = undefined;
    }
  }

  if (!sc || !email) {
    const nota = [
      `🤖 HARVEY — scope check on ${q.reference}: NOT priced`,
      "",
      `The ${libras(lance.valor)} bid from ${nomeDoParceiro} does not match what the customer asked for.`,
      `Why: ${v.motivo}`,
      "",
      "I could not find the partner's side conversation on this ticket to ask them, so this needs a person.",
      `Suggested question: ${v.pergunta}`,
    ].join("\n");
    const falha = await escopoParaGente(supabase, q, nota, postarNotaInterna);
    return { tipo: "pessoa", linha: `escopo diverge e não achei a side conversation de ${nomeDoParceiro}${falha ? ` (${falha})` : ""}` };
  }

  const perguntadoEm = Date.now();
  const enviado = await replyToSideConversation({
    ticketId,
    sideConversationId: sc.id,
    htmlBody: htmlDaPergunta(q.reference, v.pergunta),
    toEmail: email,
    toName: parceiro?.contact_name || parceiro?.company_name || undefined,
    toUserId: parceiro?.zendesk_user_id ?? null,
  });
  if (!enviado.ok) {
    // Não marca: a próxima rodada tenta perguntar de novo, e o preço continua segurado.
    return { tipo: "esperar", linha: `escopo diverge, mas a pergunta ao parceiro falhou (${String(enviado.error ?? enviado.status).slice(0, 120)})` };
  }
  // Marca logo depois de perguntar: se a nota falhar, ao menos não pergunta duas vezes.
  await supabase
    .from("quotes")
    .update({ automation_status: marcaDeEspera({ bidId: lance.id, sideConversationId: sc.id, perguntadoEm }), updated_at: new Date().toISOString() })
    .eq("id", q.id);
  try {
    await postarNotaInterna(ticketId, [
      `🤖 HARVEY — scope check on ${q.reference}: asked the partner before pricing`,
      "",
      `The ${libras(lance.valor)} bid from ${nomeDoParceiro} does not match what the customer asked for.`,
      `Why: ${v.motivo}`,
      "",
      `Asked in their side conversation: "${v.pergunta}"`,
      "",
      `Nothing goes to the customer. When they answer I carry on: confirmed or revised price becomes the draft; anything else comes back here for a person. No answer in ${PRAZO_RESPOSTA_ESCOPO_HORAS}h also comes back here.`,
    ].join("\n"));
    await addTicketTags(ticketId, [TAG_ESCOPO]);
  } catch {
    /* a pergunta saiu e a marca está gravada; a nota é só o rastro */
  }
  return { tipo: "perguntou", linha: `escopo diverge, perguntei a ${nomeDoParceiro} na side conversation` };
}

/** A escolha presa a UM lance (o que perguntamos), com o leque inteiro para a nota. */
function escolhaDoLance(lances: LanceComNotas[], bidId: string, novoValor?: number, novasNotas?: string): Escolha | null {
  const ajustados = lances.map((l) =>
    l.id === bidId && novoValor !== undefined ? { ...l, bid_amount: novoValor, notes: novasNotas ?? l.notes } : l,
  );
  const so = escolherMelhorLance(ajustados.filter((l) => l.id === bidId), { margem: MARGEM_PADRAO });
  const todos = escolherMelhorLance(ajustados, { margem: MARGEM_PADRAO });
  if (!so || !todos) return null;
  return { ...todos, melhor: so.melhor, precoAoCliente: so.precoAoCliente, margem: so.margem };
}

type ResultadoDaEspera =
  | { tipo: "seguir"; escolha: Escolha; resumo: string; aviso: string; linha: string }
  | { tipo: "esperar" | "pessoa"; linha: string };

/**
 * Quote esperando o parceiro: lê a side conversation e decide.
 *
 *  - confirmou o que o cliente pediu → segue para `quote_ready` com o lance;
 *  - confirmou com outro valor → grava o valor no lance e segue;
 *  - recusou, ficou ambíguo, ou calou por 24h → nota para gente, 🔴, sem preço.
 */
async function acompanharPerguntaDeEscopo(
  supabase: SupabaseClient,
  q: QuoteDaVarredura,
  espera: EsperaDeEscopo,
  lances: LanceComNotas[],
  armado: boolean,
  postarNotaInterna: (ticketId: number, corpo: string) => Promise<void>,
): Promise<ResultadoDaEspera> {
  const ticketId = Number(q.external_ref);
  const lance = lances.find((l) => l.id === espera.bidId);
  const original = lance ? escolhaDoLance(lances, espera.bidId) : null;
  const nomeDoParceiro = lance?.partner_name?.trim() || "partner";

  const paraGente = async (porque: string, extra: string[] = []): Promise<ResultadoDaEspera> => {
    if (!armado) return { tipo: "pessoa", linha: `[ensaio] escopo voltaria para gente: ${porque}` };
    const nota = [
      `🤖 HARVEY — scope check on ${q.reference}: needs a person`,
      "",
      porque,
      ...extra,
      "",
      "Not priced and nothing sent to the customer. Read the partner's side conversation and decide.",
    ].join("\n");
    const falha = await escopoParaGente(supabase, q, nota, postarNotaInterna);
    return { tipo: "pessoa", linha: `escopo para gente: ${porque}${falha ? ` (${falha})` : ""}` };
  };

  if (!lance || !original) return paraGente(`The bid I asked ${nomeDoParceiro} about is gone or no longer valid.`);

  const parceiro = await parceiroDoLance(supabase, lance.partner_id);
  const email = parceiro?.email?.trim().toLowerCase() ?? "";
  let eventos: EventoDeSideConversation[] = [];
  try {
    const r = await zendeskApi<{ events?: EventoDeSideConversation[] }>(
      `tickets/${ticketId}/side_conversations/${espera.sideConversationId}/events.json`,
    );
    eventos = r.events ?? [];
  } catch (err) {
    return { tipo: "esperar", linha: `não consegui ler a side conversation (${String(err).slice(0, 120)}), tento no próximo ciclo` };
  }

  const resposta = respostaDoParceiro(eventos, espera.perguntadoEm, email);
  if (!resposta) {
    const horas = horasDesde(new Date(espera.perguntadoEm).toISOString());
    if (horas < PRAZO_RESPOSTA_ESCOPO_HORAS) return { tipo: "esperar", linha: `esperando ${nomeDoParceiro} responder o escopo (${Math.round(horas)}h)` };
    return paraGente(`${nomeDoParceiro} did not answer the scope question in ${PRAZO_RESPOSTA_ESCOPO_HORAS}h.`);
  }

  // Nossa pergunta é a última mensagem que não é do parceiro, a partir da hora em que perguntamos.
  const nossa = eventos
    .filter((e) => e.message && e.created_at && new Date(e.created_at).getTime() >= espera.perguntadoEm - 60_000)
    .filter((e) => (e.message?.from?.email ?? "").trim().toLowerCase() !== email)
    .filter((e) => e.created_at! <= resposta.em)
    .map((e) => e.message?.body ?? "")
    .pop() ?? "";
  const lida = await lerRespostaDoParceiro(nossa, resposta.texto);
  const passo = passoDepoisDaResposta(lida, original.melhor.valor);
  const citacao = `Partner's reply: "${resposta.texto.slice(0, 600)}"`;

  if (passo === "pessoa") {
    const porque = !lida
      ? `I could not read ${nomeDoParceiro}'s reply.`
      : !lida.confirma
        ? `${nomeDoParceiro} did not confirm the work the customer asked for.`
        : `${nomeDoParceiro} gave a price far from their bid (${libras(original.melhor.valor)} → ${libras(lida.novo_valor ?? 0)}).`;
    return paraGente(porque, ["", citacao]);
  }

  if (passo === "seguir") {
    return {
      tipo: "seguir",
      escolha: original,
      resumo: lida!.resumo,
      aviso: `✅ Scope checked: ${nomeDoParceiro} confirmed in the side conversation that the ${libras(original.melhor.valor)} covers what the customer asked.${lida!.resumo ? ` Agreed scope: ${lida!.resumo}` : ""}`,
      linha: `${nomeDoParceiro} confirmou o escopo, sigo com ${libras(original.melhor.valor)}`,
    };
  }

  // revisar
  const novo = lida!.novo_valor!;
  const novasNotas = notasComNovoValor(lance.notes, novo, new Date().toISOString().slice(0, 16).replace("T", " "));
  const revisada = escolhaDoLance(lances, espera.bidId, novo, novasNotas);
  if (!revisada) return paraGente(`${nomeDoParceiro}'s revised price could not be applied.`, ["", citacao]);
  if (!armado) {
    return { tipo: "esperar", linha: `[ensaio] ${nomeDoParceiro} revisou ${libras(original.melhor.valor)} → ${libras(novo)}` };
  }
  const { error } = await supabase.from("quote_bids").update({ bid_amount: novo, notes: novasNotas }).eq("id", espera.bidId);
  if (error) return { tipo: "esperar", linha: `não consegui gravar o valor revisado (${error.message}), tento no próximo ciclo` };
  return {
    tipo: "seguir",
    escolha: revisada,
    resumo: lida!.resumo,
    aviso: `✅ Scope checked: ${nomeDoParceiro} revised the bid in the side conversation from ${libras(original.melhor.valor)} to ${libras(novo)} to do what the customer asked.${lida!.resumo ? ` Agreed scope: ${lida!.resumo}` : ""}`,
    linha: `${nomeDoParceiro} revisou o lance ${libras(original.melhor.valor)} → ${libras(novo)}, sigo`,
  };
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
  extra?: {
    /**
     * O que o parceiro confirmou na side conversation. Quando existe, manda
     * no lugar da descrição original do lance: era ela que contradizia o
     * cliente (o "wood filler" da QT-2026-1166).
     */
    escopoDoParceiro?: string | null;
    /** Linhas da checagem de escopo que a pessoa tem de ler antes de enviar. */
    avisos?: string[];
  },
): Promise<string> {
  /**
   * O corpo do e-mail sai do LANCE, não de um preço nosso: o parceiro separa
   * labour de materials e a soma bate com o lance. Cada metade sobe pela
   * margem sozinha, e o total é a soma das linhas escritas.
   */
  const paga = lerPayloadDoLance((escolha.melhor as { notes?: string | null }).notes);
  const traducao = await scopeEmInglesUk(
    { escopoDaQuote: q.scope, labour: extra?.escopoDoParceiro?.trim() || paga.labourDescription, materials: paga.materialsDescription },
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
  return montarNota(q, escolha, email?.corpo ?? null, traducao.traduzido ? null : (traducao.motivo ?? "não traduzido"), extra?.avisos ?? []);
}

function montarNota(
  q: { reference: string; title: string | null },
  e: NonNullable<ReturnType<typeof escolherMelhorLance>>,
  corpoDoEmail: string | null,
  avisoDeTraducao: string | null,
  avisosDeEscopo: string[] = [],
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
    ...(avisosDeEscopo.length ? ["", ...avisosDeEscopo] : []),
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
