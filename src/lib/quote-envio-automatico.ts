/**
 * O preço do lance sai sozinho para o cliente? (Fase 1, dono 15/10/2026)
 *
 * Depois que a varredura de lances rascunha a quote, ela pode mandar ao cliente
 * sem gente, quando é seguro. Seguro quer dizer, TUDO junto:
 *  - a chave HARVEY_QUOTE_AUTO_SEND=1 (desligada por padrão, o dono liga);
 *  - total ao cliente até HARVEY_QUOTE_AUTO_MAX (padrão £1001);
 *  - escopo do lance conferido com o pedido, sem pergunta pendente ao parceiro;
 *  - cliente direto (conta Fixfy, conta de cliente direto, ou sem conta vindo
 *    do WhatsApp do Harvey), nunca B2B;
 *  - um canal para chegar no cliente (WhatsApp com a janela de 24h aberta, ou e-mail);
 *  - a equipe não está falando com o cliente no WhatsApp.
 * Faltou qualquer um: o comportamento de sempre, Action Required para gente.
 */
import { isDirectConsumerAccount } from "@/lib/direct-consumer-accounts";

import { limiteDoEnvioAutomatico } from "@/lib/quotes/preco-do-lance";
import { autonomiaLida, modoEfetivo, type Autonomia } from "@/lib/harvey/autonomia";

/** Teto único do envio automático (16/10/2026: era £1001 aqui e £600 nos outros caminhos). */
export const MAXIMO_PADRAO_GBP = 600;

/** A variável HARVEY_QUOTE_AUTO_SEND=1 e a área "envio" ligada na tela (quem chama lê a autonomia antes). */
export function envioAutomaticoLigado(a: Autonomia = autonomiaLida()): boolean {
  return modoEfetivo(a, "envio") === "on";
}

/** O teto da tela, se a equipe pôs um; senão o da variável (£600). */
export function maximoDoEnvioAutomatico(a: Autonomia = autonomiaLida()): number {
  return a.tetoEnvio ?? limiteDoEnvioAutomatico();
}

/**
 * Cliente direto: a conta de origem do cliente é a Fixfy ou uma conta de
 * cliente direto. Sem conta nenhuma só vale quando a quote veio do WhatsApp do
 * Harvey (cliente novo, que ainda não tem cadastro com conta).
 */
export function contaEhDireta(a: { contaDeOrigem: string | null | undefined; contaFixfy: string | null | undefined; daConversaDoHarvey: boolean }): boolean {
  const conta = String(a.contaDeOrigem ?? "").trim().toLowerCase();
  if (!conta) return a.daConversaDoHarvey;
  if (a.contaFixfy && conta === String(a.contaFixfy).trim().toLowerCase()) return true;
  return isDirectConsumerAccount(conta);
}

export type EntradaDoEnvio = {
  ligado: boolean;
  total: number;
  maximo: number;
  /** O escopo do lance foi conferido com o pedido do cliente e passou. */
  escopoConferido: boolean;
  /** Pergunta de escopo ao parceiro ainda sem resposta. */
  perguntaPendente: boolean;
  contaDireta: boolean;
  /** O cliente é de uma conta de empresa cadastrada (tem taxa, entrada e fatura da conta). */
  contaB2B?: boolean;
  b2b: boolean;
  /** WhatsApp com a janela aberta ou e-mail do cliente. */
  temCanal: boolean;
  /** Gente da equipe está com a conversa do WhatsApp. */
  equipeNaConversa: boolean;
  /**
   * Alguém da equipe já mandou a quote à mão (etapa 3, 22/10/2026): ver
   * `quoteJaEnviadaAMao`. Opcional: quem não passa fica como antes.
   */
  envioManualDetectado?: boolean;
  /** Conta B2B só com gente (process_rules v2): a quote para em Ready to send para revisão. */
  contaSoHumana?: boolean;
};

export type DecisaoDoEnvio = { enviar: boolean; motivos: string[] };

export function podeMandarSozinho(e: EntradaDoEnvio): DecisaoDoEnvio {
  const motivos: string[] = [];
  if (!e.ligado) motivos.push("auto send is off");
  if (!(e.total > 0)) motivos.push("no valid price");
  else if (e.total > e.maximo) motivos.push(`over £${e.maximo}`);
  if (!e.escopoConferido) motivos.push("scope not checked against the request");
  if (e.perguntaPendente) motivos.push("scope question pending with the partner");
  // B2B com conta cadastrada sai sozinho desde 20/10/2026 (dono: "um cálculo de preço só, com B2B").
  if (e.b2b && !e.contaB2B) motivos.push("business customer without an account in the OS");
  else if (!e.contaDireta && !e.contaB2B) motivos.push("not a direct customer account");
  if (!e.temCanal) motivos.push("no way to reach the customer (WhatsApp window closed and no email)");
  if (e.equipeNaConversa) motivos.push("the team is talking to the customer");
  if (e.envioManualDetectado) motivos.push("a quote was already sent by the team");
  if (e.contaSoHumana) motivos.push("B2B account is human-only: stops at Ready to send for review");
  return { enviar: motivos.length === 0, motivos };
}

/** Comentário do ticket como o Zendesk devolve em tickets/{id}/comments.json. */
export type ComentarioDoTicket = {
  public: boolean;
  author_id: number;
  created_at: string;
  body?: string | null;
  attachments?: Array<{ file_name?: string | null; content_type?: string | null }> | null;
};

/**
 * Alguém já mandou a quote ao cliente à mão? (etapa 3, 22/10/2026)
 *
 * Um comentário PÚBLICO de alguém que não é o cliente, depois que a quote foi
 * criada, com um preço (£ e número), a referência da quote, ou um PDF da quote
 * anexado. Na dúvida diz que sim: o pior caso é a quote ficar para gente, nunca
 * o cliente receber duas.
 *
 * `ignorarAutores`: ids de quem escreve automaticamente no ticket com £ sem ser
 * a quote (o Harvey, por exemplo), para não travar o envio por engano.
 */
export function quoteJaEnviadaAMao(
  comentarios: readonly ComentarioDoTicket[],
  desde: string | Date,
  opcoes: { requesterId?: number | null; referencia?: string | null; ignorarAutores?: readonly number[] } = {},
): boolean {
  const inicio = typeof desde === "string" ? Date.parse(desde) : desde.getTime();
  if (!Number.isFinite(inicio)) return false;
  const ref = String(opcoes.referencia ?? "").trim().toLowerCase();
  const ignorar = new Set(opcoes.ignorarAutores ?? []);
  return comentarios.some((c) => {
    if (!c.public) return false;
    if (opcoes.requesterId != null && c.author_id === opcoes.requesterId) return false;
    if (ignorar.has(c.author_id)) return false;
    if (!(Date.parse(c.created_at) > inicio)) return false;
    const corpo = String(c.body ?? "").toLowerCase();
    if (/£\s?\d/.test(corpo)) return true;
    if (ref && corpo.includes(ref)) return true;
    return (c.attachments ?? []).some((a) => {
      const nome = String(a.file_name ?? "").toLowerCase();
      const pdf = nome.endsWith(".pdf") || String(a.content_type ?? "").toLowerCase() === "application/pdf";
      return pdf && (/quote|quotation|estimate/.test(nome) || (!!ref && nome.includes(ref)));
    });
  });
}
