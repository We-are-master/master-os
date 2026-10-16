/**
 * Duas contas no Checkatrade (dono, 11/10/2026). Cada Ruben roda com CHECKATRADE_ACCOUNT
 * (`main` ou `second`) e carimba o que cria com `checkatrade-account:<conta>` nas notas.
 * Sem carimbo = conta principal (tudo o que existia antes do segundo Ruben).
 */
export const CONTA_PRINCIPAL = "main";

export function contaValida(v: string | null | undefined): string | null {
  const s = String(v ?? "").trim().toLowerCase();
  return /^[a-z0-9_-]{2,20}$/.test(s) ? s : null;
}

/** A conta carimbada nas notas, ou a principal quando não há carimbo. */
export function contaDasNotas(notas: string | null | undefined): string {
  const todas = [...String(notas ?? "").matchAll(/checkatrade-account:\s*([a-z0-9_-]+)/gi)];
  // Notas de contato acumulam: vale o carimbo MAIS RECENTE.
  return contaValida(todas.at(-1)?.[1]) ?? CONTA_PRINCIPAL;
}

export function rotuloDaConta(conta: string): string {
  return conta === CONTA_PRINCIPAL ? "Checkatrade account: main (Fixfy)" : `Checkatrade account: ${conta}`;
}
