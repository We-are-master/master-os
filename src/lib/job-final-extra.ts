/**
 * Extra lançado no Final review (dono, 17/10/2026).
 *
 * Na hora de fechar o job a equipe acrescenta o que foi feito a mais: horas extras ou um
 * valor fechado. O cliente paga mais e o parceiro recebe mais; nada é gravado até o
 * "Send report & finalise", que aplica o extra pelo mesmo caminho do "Add extra charge".
 */

export type FinalReviewExtra = {
  kind: "hours" | "amount";
  hours?: number;
  clientRate?: number;
  partnerRate?: number;
  clientAmount: number;
  partnerAmount: number;
  reason: string;
};

/** Taxa do cliente por hora quando o job não é por hora (regra de preço do OS, £72/h). */
export const TAXA_CLIENTE_PADRAO_GBP = 72;

const centavos = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/** Horas extras viram valores: cliente e parceiro, cada um pela sua taxa. */
export function extraFromHours(a: { hours: number; clientRate: number; partnerRate: number }): {
  clientAmount: number;
  partnerAmount: number;
} {
  const h = Math.max(0, Number(a.hours) || 0);
  return { clientAmount: centavos(h * (Number(a.clientRate) || 0)), partnerAmount: centavos(h * (Number(a.partnerRate) || 0)) };
}

/**
 * Parte do parceiro no valor do cliente, pela margem atual do job: o parceiro leva no
 * extra a mesma fração que leva no job. Sem preço ou sem custo, 0.
 */
export function partnerShareOfJob(a: { clientTotal: number; partnerTotal: number }): number {
  const c = Number(a.clientTotal) || 0;
  const p = Number(a.partnerTotal) || 0;
  if (c <= 0.01 || p <= 0) return 0;
  return Math.min(1, p / c);
}

export function partnerAmountFromShare(clientAmount: number, share: number): number {
  return centavos((Number(clientAmount) || 0) * Math.min(1, Math.max(0, Number(share) || 0)));
}

/** Texto do motivo no razão de extras, quando a equipe não escreve um. */
export function motivoDoExtra(e: FinalReviewExtra): string {
  const proprio = e.reason.trim();
  const base =
    e.kind === "hours" && e.hours
      ? `${e.hours} extra hour${e.hours === 1 ? "" : "s"} at £${centavos(e.clientRate ?? 0).toFixed(2)}/h`
      : "Extra work";
  return `Extra at final review: ${proprio || base}`;
}
