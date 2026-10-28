/**
 * O que fazer com a resposta pronta do Harvey (dono, 28/10/2026: "um preço só").
 *
 * Duas mensagens seguidas do cliente viram dois turnos em paralelo, e cada um pensa
 * sem ver a resposta do outro. Saíam dois preços no mesmo minuto (#51852: £329,
 * £144 e £180; #51787: £144 e, um segundo depois, £72). A resposta que só fala
 * (preço do catálogo incluído) é descartada quando o cliente escreveu de novo, e
 * pensa de novo, uma vez, quando outro turno já respondeu depois da mensagem dela.
 * Link de pagamento, pedido de cotação e passagem já aconteceram: esses sempre saem.
 *
 * Puro: o motor (motor.ts) busca o histórico e decide por aqui.
 */

export type DestinoDaResposta = "enviar" | "descartar_cliente_escreveu" | "repensar" | "descartar_outro_turno" | "descartar_repetida";

export function destinoDaResposta(a: {
  resposta: string;
  /** Link de pagamento, cotação pedida ou passagem: algo que já aconteceu e precisa ser dito. */
  comEfeito: boolean;
  /** O cliente mandou outra mensagem depois da deste turno. */
  clienteEscreveuDeNovo: boolean;
  /** O Harvey já respondeu, por outro turno, depois da mensagem deste. */
  outroTurnoRespondeu: boolean;
  /** Este turno já é o que pensou de novo. */
  refeito: boolean;
  /** A última fala do Harvey na conversa. */
  ultimaDoHarvey: string | null;
}): DestinoDaResposta {
  if (!a.comEfeito && a.clienteEscreveuDeNovo) return "descartar_cliente_escreveu";
  if (!a.comEfeito && a.outroTurnoRespondeu) return a.refeito ? "descartar_outro_turno" : "repensar";
  if (a.ultimaDoHarvey && normalizar(a.ultimaDoHarvey) === normalizar(a.resposta)) return "descartar_repetida";
  return "enviar";
}

function normalizar(t: string): string {
  return t.toLowerCase().replace(/[^a-z0-9£]+/g, " ").trim();
}

/**
 * Ele disse ao cliente que vai chamar alguém. Sem a ferramenta ninguém fica sabendo,
 * então a passagem acontece do mesmo jeito (#51654, #51825, #51199). Pergunta
 * ("Shall I get someone?") não conta.
 */
export function prometeuAEquipe(resposta: string): boolean {
  if (/\?\s*$/.test(resposta)) return false;
  const quem = String.raw`(?:someone|somebody|a person|a colleague|the team|someone from (?:the|our) team|(?:the |our )?office|victor|leo|leonardo)`;
  return (
    new RegExp(String.raw`\b(?:I['’]ll|I will|let me|I['’]m (?:going to|getting)|I am (?:going to|getting))\s+(?:just\s+)?(?:grab|get|bring in|ask|pull in|loop in|pass (?:this|it|you) (?:on )?to)\s+${quem}\b`, "i").test(resposta) ||
    new RegExp(String.raw`\b(?:someone|a person) from (?:the|our) team will (?:message|get back|be in touch|pick this up|call)\b`, "i").test(resposta)
  );
}
