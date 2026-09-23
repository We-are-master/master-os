import { timingSafeEqual } from "node:crypto";

/**
 * Regras do `POST /api/contacts/ingest` que não dependem do banco.
 *
 * Quem chama: o RPA do Checkatrade (chave de lead) e, desde 23/09/2026, o
 * site B2C com o lead do primeiro passo da reserva (a chave de job, que ele
 * já tinha). As duas chaves são de agentes nossos, e a de job já cria job.
 */

function secretsMatch(provided: string | null | undefined, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** A chave do pedido bate com alguma das aceitas (as vazias não contam). */
export function apiKeyAllowed(provided: string | null | undefined, keys: Array<string | null | undefined>): boolean {
  return keys.some((k) => {
    const expected = k?.trim();
    return Boolean(expected) && secretsMatch(provided, expected as string);
  });
}

export const NO_MARKETING_TAG = "no-marketing";

/**
 * Quem marcou "Don't email me offers" no site ganha a etiqueta que o
 * pós-venda respeita. Devolve as etiquetas novas, ou null quando não muda
 * nada (quem não recusou não perde uma recusa antiga).
 */
export function tagsAfterOptOut(current: unknown, optOut: boolean | null | undefined): string[] | null {
  if (!optOut) return null;
  const tags = Array.isArray(current) ? current.filter((t): t is string => typeof t === "string") : [];
  if (tags.includes(NO_MARKETING_TAG)) return null;
  return [...tags, NO_MARKETING_TAG];
}
