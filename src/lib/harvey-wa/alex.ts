/**
 * Alex, B2C Sales (dono, 10/11/2026). O Harvey vira a triagem: entende o pedido e, quando
 * o job cabe nas regras de preço (call out do handyman £72 a 1ª hora, meia diária £180,
 * diária £329 ou um pacote do catálogo), passa a conversa para o Alex, que dá o preço,
 * manda o link do sinal de 50% e confirma depois do pagamento. Fora das regras vira quote
 * para o dono. Nenhum agente fecha por dedução (sem accept_quote por texto).
 *
 * Mesmo motor e mesmo cérebro do Harvey: o Alex é um perfil (lista de ferramentas e blocos
 * de prompt próprios, "secao:alex:<id>"). O dono da conversa vai na marca "[agent:alex]"
 * do motivo_passagem (dono.ts); depois da passagem o Harvey não fala mais nela.
 *
 * HARVEY_ALEX=1 liga, e só vale com HARVEY_DONO_POR_AGENTE=1 (sem ela o Give back não
 * saberia devolver ao Alex): sem a outra porta, o Alex fica desligado e avisa uma vez no log.
 */

import { agenteDoMotivo, comAgente, donoDaConversa, donoPorAgenteLigado } from "./dono";

export const NOME_DO_ALEX = "Alex";

let avisouSemDono = false;

export function alexLigado(env: Record<string, string | undefined> = process.env): boolean {
  if (env.HARVEY_ALEX?.trim() !== "1") return false;
  if (donoPorAgenteLigado(env.HARVEY_DONO_POR_AGENTE)) return true;
  if (!avisouSemDono) {
    avisouSemDono = true;
    console.warn("[harvey-wa] HARVEY_ALEX=1 sem HARVEY_DONO_POR_AGENTE=1: o Alex fica desligado");
  }
  return false;
}

/** As ferramentas do Alex: vender pelo catálogo e passar para a equipe. Nada de accept_quote por texto. */
export const FERRAMENTAS_DO_ALEX = ["get_quote", "check_discount", "get_available_dates", "create_payment_link", "get_my_bookings", "hand_off_to_team"] as const;

/** O que o Harvey (triagem) perde com o Alex ligado: preço, agenda, link e o aceite por texto. */
export const FERRAMENTAS_QUE_O_HARVEY_PERDE = ["get_quote", "check_discount", "get_available_dates", "create_payment_link", "accept_quote"] as const;

/** Quem responde este turno: o Alex só quando a porta está ligada, a conversa é dele e não é parceiro. */
export function agenteDaVez(
  est: { estado?: string | null; motivo_passagem?: string | null } | null | undefined,
  tipo: string | null | undefined,
  ligado = alexLigado(),
): "harvey" | "alex" {
  return ligado && tipo !== "parceiro" && donoDaConversa(est) === "alex" ? "alex" : "harvey";
}

/** O motivo_passagem depois que o Harvey passa ao Alex: a marca do Give back (se houver) fica. */
export function motivoDaPassagemParaAlex(atual: string | null | undefined): string | null {
  return comAgente(atual, "alex");
}

/** A conversa é do Alex (para o chase e o aviso de pagamento, que só têm o motivo). */
export function conversaDoAlex(motivo: string | null | undefined, ligado = alexLigado()): boolean {
  return ligado && agenteDoMotivo(motivo) === "alex";
}
