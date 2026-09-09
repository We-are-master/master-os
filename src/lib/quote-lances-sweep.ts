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
import { escolherMelhorLance, MARGEM_PADRAO, type Lance } from "@/lib/quote-melhor-lance";
import { quoteParaParceiro, nomesDeContas } from "@/lib/quote-para-parceiro";
import { montarEmailDaQuote, scopeEmInglesUk, lerPayloadDoLance } from "@/lib/quote-email-cliente";

/** O leilão fecha 2h depois do primeiro convite. */
export const JANELA_HORAS = 2;
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
/** A marca de "já rascunhei", no banco para sobreviver a troca de máquina. */
const MARCA = "bid_draft_posted";

export type ResultadoDaVarredura = {
  armado: boolean;
  analisados: number;
  rascunhados: number;
  semLance: number;
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
    armado, analisados: 0, rascunhados: 0, semLance: 0, janelaAberta: 0, detalhes: [],
  };

  const desde = new Date(Date.now() - IDADE_MAXIMA_DIAS * 864e5).toISOString();
  const { data: quotes, error } = await supabase
    .from("quotes")
    .select("id, reference, title, service_type, scope, status, external_source, external_ref, created_at, automation_status")
    .eq("status", "bidding")
    .eq("external_source", "zendesk")
    .not("external_ref", "is", null)
    .is("automation_status", null)
    .is("deleted_at", null)
    .gte("created_at", desde)
    .order("created_at", { ascending: true })
    .limit(50);
  if (error) {
    r.detalhes.push(`nao consegui ler as quotes: ${error.message}`);
    return r;
  }
  if ((quotes ?? []).length === 0) return r;

  const nomesProibidos = await nomesDeContas(supabase);

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
      continue;
    }

    const seguro = quoteParaParceiro(q, { scope: q.scope, nomesProibidos });

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
    const nota = montarNota(q, escolha, email?.corpo ?? null, traducao.traduzido ? null : traducao.motivo ?? "não traduzido");

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
    // Marca só DEPOIS da nota sair: se marcasse antes e a nota falhasse, a
    // quote ficaria calada para sempre.
    const { error: upErr } = await supabase
      .from("quotes")
      .update({ automation_status: MARCA, updated_at: new Date().toISOString() })
      .eq("id", q.id);
    if (upErr) r.detalhes.push(`${q.reference}: nota saiu mas a marca falhou — ${upErr.message}`);
    r.rascunhados++;
    r.detalhes.push(`${q.reference}: rascunho na thread, cliente ${libras(escolha.precoAoCliente)}`);
  }

  return r;
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
