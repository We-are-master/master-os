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

/**
 * Dono, 24/10/2026 (ticket 51755): respostas sempre entre 14 e 17 segundos, até
 * depois de um vídeo de 6 MB, e o cliente disse "feels like chatting to AI".
 * O alvo agora é o ritmo de uma pessoa atendendo três clientes ao mesmo tempo,
 * sem perder venda: a demora fica onde não decide nada, e o fechamento é rápido.
 *
 *   curta (até 120 caracteres)   25 a 40 s
 *   média                        35 a 55 s
 *   longa (300 ou mais)          50 a 70 s
 *   primeira resposta ao lead    40 a 70 s (concorrente leva horas: 1 min ainda ganha)
 *   foto, vídeo ou arquivo       +15 s
 *   conversa quente              ×0,75 (o cliente respondeu em até 90 s)
 *   ocupado com outro cliente    1 em 5 respostas, +30 a 60 s (nunca na primeira nem no fechamento)
 *   fechamento (link de pagamento) no máximo 35 s
 *   teto                         2 min
 */
export const TETO_DA_ESPERA_MS = 120_000;
const TETO_DO_FECHAMENTO_MS = 35_000;
const MIDIA_MS = 15_000;
const CHANCE_OCUPADO = 0.2;

export type Ritmo = {
  /** Tamanho da resposta que vai sair. */
  caracteres: number;
  /** O cliente mandou foto, vídeo ou arquivo: uma pessoa pararia para olhar. */
  temMidia?: boolean;
  /** O Harvey ainda não falou nesta conversa. */
  primeiraResposta?: boolean;
  /** O cliente respondeu à nossa última mensagem em até 90 s: a conversa está viva. */
  quente?: boolean;
  /** A resposta leva o link de pagamento: é a hora de fechar, ninguém espera. */
  fechamento?: boolean;
  /** 0 a 1, onde cai dentro da faixa. Injetável no teste. */
  sorteio?: number;
  /** 0 a 1, se está "ocupado com outro cliente" e quanto. Injetável no teste. */
  sorteioOcupado?: number;
};

/** A faixa [mín, máx] em ms pelo tamanho da resposta. */
export function faixaPeloTamanho(caracteres: number, primeiraResposta?: boolean): [number, number] {
  if (primeiraResposta) return [40_000, 70_000];
  if (caracteres < 120) return [25_000, 40_000];
  if (caracteres < 300) return [35_000, 55_000];
  return [50_000, 70_000];
}

/** Quanto tempo uma pessoa levaria, do momento em que a mensagem chegou até responder. */
export function esperaHumana(r: Ritmo): number {
  const caracteres = Math.max(0, Number(r.caracteres) || 0);
  const sorteio = Math.min(1, Math.max(0, r.sorteio ?? Math.random()));
  const [min, max] = faixaPeloTamanho(caracteres, r.primeiraResposta);
  let alvo = min + sorteio * (max - min) + (r.temMidia ? MIDIA_MS : 0);
  if (r.quente) alvo *= 0.75;
  if (r.fechamento) return Math.round(Math.min(alvo, TETO_DO_FECHAMENTO_MS));
  const ocupado = r.sorteioOcupado ?? Math.random();
  if (!r.primeiraResposta && ocupado < CHANCE_OCUPADO) alvo += 30_000 + (ocupado / CHANCE_OCUPADO) * 30_000;
  return Math.round(Math.min(TETO_DA_ESPERA_MS, alvo));
}

/** Quanto do fim da espera mostra "digitando": quem atende três conversas não digita o tempo todo. */
export function tempoDigitando(caracteres: number, esperaMs: number): number {
  return Math.round(Math.min(esperaMs, 6_000 + Math.max(0, caracteres) * 40));
}

/** O que ainda falta esperar, descontado o que já passou desde a primeira mensagem sem resposta. */
export function faltaEsperar(alvoMs: number, decorridoMs: number): number {
  return Math.max(0, Math.min(alvoMs, TETO_DA_ESPERA_MS) - Math.max(0, decorridoMs));
}
