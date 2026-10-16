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

/** Teto único do envio automático (16/10/2026: era £1001 aqui e £600 nos outros caminhos). */
export const MAXIMO_PADRAO_GBP = 600;

export function envioAutomaticoLigado(): boolean {
  return process.env.HARVEY_QUOTE_AUTO_SEND?.trim() === "1";
}

export function maximoDoEnvioAutomatico(): number {
  return limiteDoEnvioAutomatico();
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
  b2b: boolean;
  /** WhatsApp com a janela aberta ou e-mail do cliente. */
  temCanal: boolean;
  /** Gente da equipe está com a conversa do WhatsApp. */
  equipeNaConversa: boolean;
};

export type DecisaoDoEnvio = { enviar: boolean; motivos: string[] };

export function podeMandarSozinho(e: EntradaDoEnvio): DecisaoDoEnvio {
  const motivos: string[] = [];
  if (!e.ligado) motivos.push("auto send is off");
  if (!(e.total > 0)) motivos.push("no valid price");
  else if (e.total > e.maximo) motivos.push(`over £${e.maximo}`);
  if (!e.escopoConferido) motivos.push("scope not checked against the request");
  if (e.perguntaPendente) motivos.push("scope question pending with the partner");
  if (e.b2b) motivos.push("business customer");
  else if (!e.contaDireta) motivos.push("not a direct customer account");
  if (!e.temCanal) motivos.push("no way to reach the customer (WhatsApp window closed and no email)");
  if (e.equipeNaConversa) motivos.push("the team is talking to the customer");
  return { enviar: motivos.length === 0, motivos };
}
