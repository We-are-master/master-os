/**
 * Dono da conversa (dono, 10/11/2026): cada conversa tem UM dono, o Harvey (triagem),
 * o Alex (venda B2C) ou a equipe. Take over passa para a equipe; Give back devolve para
 * o agente que era dono antes. Pelo relógio, nunca: a conversa só volta por Give back.
 *
 * Sem migration: `estado` tem check ('harvey', 'equipe', 'parado', mig 303), então
 * "harvey" continua sendo "um agente nosso atende" (a integração da Sunshine é a mesma)
 * e QUAL agente vai numa marca no fim do motivo_passagem: "... [agent:alex]". Sem marca,
 * é o Harvey. A marca atravessa o Take over (estado equipe) e volta no Give back.
 *
 * HARVEY_DONO_POR_AGENTE=1 liga (padrão desligado). Desligada, nada aqui muda o que já
 * existia: o motivo sai igual, a trava de 3h devolve pelo tempo como antes e o
 * book_team_price fecha como antes.
 */

export const AGENTES = ["harvey", "alex"] as const;
export type Agente = (typeof AGENTES)[number];
export type DonoDaConversa = Agente | "equipe" | "parado";

export function donoPorAgenteLigado(valor = process.env.HARVEY_DONO_POR_AGENTE): boolean {
  return valor?.trim() === "1";
}

const MARCA = /\s*\[agent:([a-z]+)\]\s*$/;

/** O agente marcado no motivo_passagem; sem marca (ou marca desconhecida), o Harvey. */
export function agenteDoMotivo(motivo: string | null | undefined): Agente {
  const m = MARCA.exec(motivo ?? "");
  return m && (AGENTES as readonly string[]).includes(m[1]) ? (m[1] as Agente) : "harvey";
}

/** O motivo sem a marca do agente (para quem lê o texto: devolvidaEm, a tela). */
export function semAgente<T extends string | null | undefined>(motivo: T): T {
  return (typeof motivo === "string" ? motivo.replace(MARCA, "") : motivo) as T;
}

/** O motivo com a marca do agente. O Harvey é o padrão e não leva marca. */
export function comAgente(motivo: string | null | undefined, agente: Agente): string | null {
  const base = semAgente(motivo ?? null)?.trim() || null;
  if (agente === "harvey") return base;
  return base ? `${base} [agent:${agente}]` : `[agent:${agente}]`;
}

/**
 * O motivo novo de uma passagem (Take over, trava de dono, hand off, pausa) levando o
 * agente que era dono, para o Give back saber para quem volta. Porta desligada: o
 * motivo novo, igual a hoje.
 */
export function motivoComDono(novo: string | null, atual: string | null | undefined, ligado = donoPorAgenteLigado()): string | null {
  return ligado ? comAgente(novo, agenteDoMotivo(atual)) : novo;
}

/** Quem é o dono agora, pela linha de harvey_wa_conversas. */
export function donoDaConversa(est: { estado?: string | null; motivo_passagem?: string | null } | null | undefined): DonoDaConversa {
  if (!est || !est.estado || est.estado === "harvey") return agenteDoMotivo(est?.motivo_passagem);
  return est.estado === "parado" ? "parado" : "equipe";
}

/** A trava de 3h devolve a conversa ao agente pelo tempo? Só com a porta desligada (como hoje). */
export function tempoDevolveAConversa(ligado = donoPorAgenteLigado()): boolean {
  return !ligado;
}

/** Depois do preço da equipe no chat a conversa volta sozinha ao agente? Só com a porta desligada. */
export function precoDaEquipeDevolveAConversa(ligado = donoPorAgenteLigado()): boolean {
  return !ligado;
}

/**
 * O book_team_price pode fechar? Porta ligada: só quando uma pessoa da equipe devolveu a
 * conversa (Give back, marca "given back by" no motivo). Trava vencida não é ordem de fechar.
 */
export function podeFecharPeloPrecoDaEquipe(devolvidaPelaEquipe: boolean | undefined, ligado = donoPorAgenteLigado()): boolean {
  return !ligado || devolvidaPelaEquipe === true;
}
