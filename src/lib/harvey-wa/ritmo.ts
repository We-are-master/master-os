/**
 * O ritmo de uma pessoa (dono, 13/10/2026: "esperar uns segundos pra enviar a
 * resposta, quando envia na hora parece muito IA").
 *
 * O Harvey respondia em 10 a 20 segundos a uma mensagem longa com foto, com 2,5
 * segundos fixos de "digitando". Ninguém lê uma foto, pensa no preço e digita
 * três linhas nesse tempo, e foi um cliente que disse "I just don't like the AI"
 * ao cancelar meio dia já reservado.
 *
 * A espera aqui é o tempo TOTAL entre a mensagem do cliente e a resposta: o que
 * o modelo já gastou pensando conta. Tem teto, porque a função da Vercel morre
 * aos 60 segundos e ainda há trabalho depois de responder.
 */

/** Teto do tempo total até a resposta. Sobra folga para o que vem depois dela (Zendesk, banco). */
export const TETO_DA_ESPERA_MS = 38_000;
const PISO_MS = 6_000;
/** Primeira resposta a um lead: ele escreveu para três empresas, quem demora perde. */
const TETO_DA_PRIMEIRA_MS = 15_000;

export type Ritmo = {
  /** Tamanho da resposta que vai sair. */
  caracteres: number;
  /** O cliente mandou foto, vídeo ou arquivo: uma pessoa pararia para olhar. */
  temMidia?: boolean;
  /** O Harvey ainda não falou nesta conversa. */
  primeiraResposta?: boolean;
  /** 0 a 1, para a espera não ser sempre igual. Injetável no teste. */
  sorteio?: number;
};

/** Quanto tempo uma pessoa levaria, do momento em que a mensagem chegou até responder. */
export function esperaHumana(r: Ritmo): number {
  const caracteres = Math.max(0, Number(r.caracteres) || 0);
  // Ler, pensar e digitar: 6 s de saída e 45 ms por caractere (200 caracteres = 15 s).
  let alvo = PISO_MS + caracteres * 45 + (r.temMidia ? 6_000 : 0);
  if (r.primeiraResposta) alvo = Math.min(alvo, TETO_DA_PRIMEIRA_MS);
  const sorteio = Math.min(1, Math.max(0, r.sorteio ?? Math.random()));
  alvo *= 0.8 + sorteio * 0.4;
  return Math.round(Math.min(TETO_DA_ESPERA_MS, Math.max(PISO_MS, alvo)));
}

/** O que ainda falta esperar, descontado o que o modelo já demorou. */
export function faltaEsperar(alvoMs: number, decorridoMs: number): number {
  return Math.max(0, Math.min(alvoMs, TETO_DA_ESPERA_MS) - Math.max(0, decorridoMs));
}
