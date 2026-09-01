/**
 * O nome do cliente com a inicial de cada parte em maiúscula.
 *
 * Regra do dono (30/08/2026): job que nasce no OS não pode carregar
 * "jahzia delpeche" nem "NOEL KENNEDY". O cliente digita como quer, e o que
 * ele digitou aparece no e-mail do parceiro, no card, na fatura e na conversa
 * com o morador. Quem escreve o nome errado somos nós, não ele.
 *
 * Mora aqui, e é chamado no `POST /api/jobs`, porque é por ali que TODO agente
 * cria job. É a mesma decisão do `limparScope`: regra espalhada por agente é
 * regra que o próximo agente esquece.
 *
 * **Só mexe no que está claramente quebrado.** Nome que já vem com maiúscula E
 * minúscula misturadas fica intocado, e isso é de propósito: "McDonald",
 * "de Souza", "van der Berg" e "O'Brien" foram escritos assim por alguém que
 * sabia o que estava fazendo, e arrumar por cima estragaria os quatro. O que
 * se conserta é o tudo-minúsculo e o TUDO-MAIÚSCULO, que são erro de digitação
 * e de caps lock, nunca escolha.
 */

/** Maiúscula depois do começo, de espaço, de hífen e de apóstrofo. */
function capitalizarPartes(s: string): string {
  return s.replace(/(^|[\s\-'’])([\p{L}])/gu, (_, antes: string, letra: string) => antes + letra.toUpperCase());
}

export function nomeProprio(bruto: string | null | undefined): string {
  const t = String(bruto ?? "").replace(/\s+/g, " ").trim();
  if (!t) return "";

  const temMinuscula = /\p{Ll}/u.test(t);
  const temMaiuscula = /\p{Lu}/u.test(t);
  // Já veio com as duas caixas: alguém decidiu, e a decisão vale mais que a regra.
  if (temMinuscula && temMaiuscula) return t;

  const capitalizado = capitalizarPartes(t.toLowerCase());

  /**
   * `Mc` seguido de letra vira `McDonald`, não `Mcdonald`.
   *
   * Vale para Mc e não para Mac: "Mac" abre nomes que NÃO são patronímicos
   * ("Macey", "Mackenzie" escrito assim), e maiuscular no meio deles inventa
   * um nome que ninguém tem. Mc quase não tem esse caso.
   */
  return capitalizado.replace(/\bMc(\p{Ll})/gu, (_, l: string) => `Mc${l.toUpperCase()}`);
}
