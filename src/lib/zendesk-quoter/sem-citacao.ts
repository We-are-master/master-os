/**
 * O que é novo num ticket de e-mail, e o que é a conversa de ontem colada junto.
 *
 * E-mail de helpdesk carrega o histórico inteiro embaixo da mensagem nova. Para
 * um modelo que lê a thread toda, isso é veneno: o bloco antigo quase sempre é
 * mais rico que a mensagem nova (tem endereço, escopo, preço), e o mais rico
 * ganha.
 *
 * Foi assim que o JOB-9493 nasceu em 22/08/2026. O ticket 49174 dizia "Job is
 * taken but we have this job available tomorrow — Deep clean, SW8 1EN, 23/08".
 * Quatro mil caracteres abaixo estava a NOSSA mensagem de 21/08 citada de
 * volta, com Freddie, 51b Clanricarde Gardens, o escopo e £325 — e, no meio,
 * a Housekeep escrevendo "It's already taken team. No longer needed". O job
 * saiu com os dados do bloco antigo, para um dia que já tinha passado,
 * duplicando um job que já existia.
 */

/** `>` no começo da linha é a marca universal de texto citado. */
const LINHA_CITADA = /^\s*>+/;

/**
 * Onde o cliente de e-mail corta a mensagem nova do histórico. Todas terminam
 * em dois-pontos ou em linha própria, logo antes do bloco antigo.
 */
const COMECA_O_HISTORICO = [
  /^##-\s*Please type your reply above this line\s*-##/i,
  /^-{2,}\s*Original Message\s*-{2,}/i,
  /^_{5,}$/,
  /^On .{10,80}\bwrote:\s*$/i,
  /^From:\s.+$/i,
  /^Em .{10,80}\bescreveu:\s*$/i,
];

/**
 * Corta um corpo de comentário no que é novo.
 *
 * Só o que vem ANTES do marcador de histórico, e sem as linhas citadas. Se
 * sobrar nada, devolve vazio: um comentário que é 100% histórico não tem
 * informação nova, e fingir que tem é como o JOB-9493 aconteceu.
 */
export function soOqueENovo(corpo: string): string {
  const linhas = corpo.split("\n");
  const novas: string[] = [];
  for (const linha of linhas) {
    if (COMECA_O_HISTORICO.some((re) => re.test(linha.trim()))) break;
    if (LINHA_CITADA.test(linha)) continue;
    novas.push(linha);
  }
  return novas.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
