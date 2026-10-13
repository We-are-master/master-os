/**
 * Prefixo do documento de cobrança que o cliente vê: INV (dono, 13/10/2026).
 *
 * Foi RCP de julho a outubro de 2026. O que está GRAVADO no banco não muda
 * (334 faturas antigas com INV-, 394 com RCP-): o número depois do prefixo é
 * único entre os dois, então a mesma fatura é achada pelos dois nomes. Quem
 * procura uma fatura pelo que o cliente digitou ou clicou usa
 * `billingReferenceCandidates`.
 */
export const BILLING_REFERENCE_PREFIX = "INV";

const LEGACY_PREFIX_RE = /^(INV|RCP|RC)-/i;

/** Strip legacy prefixes, keeping year-sequence (e.g. 2026-357). */
export function billingReferenceShort(reference: string): string {
  const trimmed = (reference ?? "").trim();
  if (!trimmed) return "";
  return trimmed.replace(LEGACY_PREFIX_RE, "").trim() || trimmed;
}

/** Display ref as INV-YYYY-NNN (maps stored RCP-/RC- rows for UI/PDF/email). */
export function displayBillingReference(reference: string): string {
  const short = billingReferenceShort(reference);
  if (!short) return `${BILLING_REFERENCE_PREFIX}-`;
  return `${BILLING_REFERENCE_PREFIX}-${short}`;
}

/**
 * Todas as formas em que a mesma fatura pode estar gravada: como veio, e com
 * cada prefixo que já existiu. Um link antigo `/pay/RCP-2026-915` e um novo
 * `/pay/INV-2026-915` acham a mesma linha.
 */
export function billingReferenceCandidates(reference: string): string[] {
  const trimmed = (reference ?? "").trim();
  const short = billingReferenceShort(trimmed);
  if (!short) return trimmed ? [trimmed] : [];
  return [...new Set([trimmed, `INV-${short}`, `RCP-${short}`, `RC-${short}`])];
}
