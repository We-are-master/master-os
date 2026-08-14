/**
 * Lê o estado de uma conversa do Mike a partir dos custom fields do contato.
 *
 * É a peça que decide se um job nasce. Fica aqui, e não dentro do script do
 * poller, porque "esta conversa virou venda?" é a pergunta cujo erro custa
 * dinheiro nos dois sentidos: um falso positivo cria job para quem não comprou,
 * um falso negativo deixa venda fora do OS.
 */

import { parseBookingDay, parseArrivalWindow } from "./booking-day";

export type ConversationState =
  /** Fechou: preço, dia legível e janela confirmada. Vira job. */
  | { kind: "vendido"; data: string; janela: string; preco: number }
  /** Fechou, mas o dia não parseia. Vira pendência, nunca job com data chutada. */
  | { kind: "data_ilegivel"; bruto: string; preco: number }
  /** Fechou e tem dia, mas ninguém confirmou a hora de chegada. */
  | { kind: "sem_janela"; data: string; preco: number }
  /** O Mike pediu humano. Não vira job por cima disso. */
  | { kind: "handoff"; motivo: string }
  /** Marcou dia mas não gravou preço. Anomalia: uma venda pode estar escapando. */
  | { kind: "sem_preco"; dia: string }
  /** Cotou, o cliente não fechou. */
  | { kind: "cotado" }
  /** Ainda no meio da conversa. */
  | { kind: "conversando" };

export type CamposDaConversa = {
  handoff_reason?: string | null;
  booking_day?: string | null;
  /** Slug real no respond.io é `Booking_Window` (a API derivou o slug do nome). */
  booking_window?: string | null;
  quoted_price?: string | number | null;
  quoted_at?: string | null;
};

/**
 * `handoff` vence `venda` de propósito. Se o Mike pediu ajuda humana é porque
 * algo saiu do roteiro, e criar o job automaticamente por cima disso é
 * exatamente o que não se quer: o motivo do handoff costuma ser "o cliente quer
 * mudar o escopo" ou "o preço não fecha", e nos dois casos o job nasceria errado.
 */
export function conversationState(campos: CamposDaConversa, hoje: Date): ConversationState {
  const handoff = (campos.handoff_reason ?? "").trim();
  if (handoff) return { kind: "handoff", motivo: handoff };

  const dia = (campos.booking_day ?? "").trim();
  const preco = Number(campos.quoted_price ?? 0) || 0;

  if (dia && preco > 0) {
    const data = parseBookingDay(dia, hoje);
    if (!data) return { kind: "data_ilegivel", bruto: dia, preco };
    // Data e janela são as duas obrigatórias. Um job sem hora de chegada faz o
    // cliente esperar o dia inteiro e o parceiro chegar quando não tem ninguém
    // em casa. Sem a janela, isto vira pendência em vez de virar job com a
    // manhã chutada como padrão.
    const janela = parseArrivalWindow(campos.booking_window);
    return janela ? { kind: "vendido", data, janela, preco } : { kind: "sem_janela", data, preco };
  }
  // Dia sem preço é anomalia, não conversa em andamento: o cliente marcou data,
  // então fechou alguma coisa, e o preço não chegou ao campo. Deixar isso cair
  // em "conversando" faria a venda sumir sem ninguém ver.
  if (dia) return { kind: "sem_preco", dia };
  // Preço sem dia ainda é cotação: o cliente recebeu o número e não marcou.
  if ((campos.quoted_at ?? "").trim() || preco > 0) return { kind: "cotado" };
  return { kind: "conversando" };
}
