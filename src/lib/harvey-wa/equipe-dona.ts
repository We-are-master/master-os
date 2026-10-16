/**
 * Quem da equipe escreveu é dono da conversa por N horas (dono, 15/10/2026). Antes
 * isto era só uma lição no prompt; agora é trava no código, para qualquer pessoa da
 * equipe: o Harvey não responde nem cobra por cima de uma negociação humana.
 *
 * Equipe é o mesmo critério do "equipe assumiu" do motor: mensagem do negócio, com
 * nome, que não é do Harvey. Não contam: o Harvey no nome de alguém (metadata
 * harvey, de enviarTexto) nem template de automação (scNotificacao, metadata origem).
 *
 * HARVEY_WA_EQUIPE_DONA_HORAS (padrão 3; 0 desliga).
 */

import { ehDoHarvey, type MensagemSc } from "./sunshine";

/** Marca no motivo_passagem: a conversa foi para a equipe por esta trava (e volta sozinha). */
export const MARCA_EQUIPE_DONA = "team owns the chat:";

/**
 * Marca no motivo_passagem quando uma PESSOA devolve a conversa (botão Give back no OS
 * ou no Zendesk): é ordem explícita, então o que a equipe escreveu antes não trava mais.
 * A devolução automática depois do preço da equipe não leva marca: ali a trava vale.
 */
export const MARCA_DEVOLVIDA = "given back by";

export function motivoDaDevolucao(quem: string, agora = new Date()): string {
  return `${MARCA_DEVOLVIDA} ${quem} at ${agora.toISOString()}`;
}

/** Quando a pessoa devolveu (do motivo_passagem), ou null. */
export function devolvidaEm(motivo: string | null | undefined): number | null {
  if (!motivo?.startsWith(MARCA_DEVOLVIDA)) return null;
  const em = Date.parse(motivo.slice(motivo.lastIndexOf(" at ") + 4));
  return Number.isFinite(em) ? em : null;
}

export function horasDaEquipeDona(valor = process.env.HARVEY_WA_EQUIPE_DONA_HORAS): number {
  const n = Number(valor?.trim());
  return valor?.trim() && Number.isFinite(n) && n >= 0 ? n : 3;
}

/** Mensagem escrita por uma pessoa da equipe (Agent Workspace), não pelo Harvey nem por automação. */
export function ehDaEquipe(m: MensagemSc): boolean {
  if (m.author.type !== "business" || !m.author.displayName?.trim()) return false;
  if (ehDoHarvey(m)) return false;
  return !m.metadata?.origem;
}

export type DonaDaConversa = { dona: false } | { dona: true; quem: string; em: string; liberaEm: string };

/**
 * A conversa está com alguém da equipe? A última mensagem da equipe com menos de
 * `horas` horas manda. Sem data legível, não trava (melhor responder que sumir).
 * `desde`: a pessoa devolveu a conversa nesse instante; o que veio antes não conta.
 */
export function equipeDonaDaConversa(msgs: MensagemSc[], agora: number, horas: number, desde: number | null = null): DonaDaConversa {
  if (!(horas > 0)) return { dona: false };
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (!ehDaEquipe(m)) continue;
    const em = Date.parse(m.received);
    if (!Number.isFinite(em)) return { dona: false };
    if (desde !== null && em <= desde) return { dona: false };
    const libera = em + horas * 3_600_000;
    if (agora >= libera) return { dona: false };
    return { dona: true, quem: m.author.displayName!.trim(), em: m.received, liberaEm: new Date(libera).toISOString() };
  }
  return { dona: false };
}
