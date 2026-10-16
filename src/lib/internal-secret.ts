import { timingSafeEqual } from "node:crypto";

/** Header `x-internal-secret` confere com INTERNAL_SYNC_SECRET (chamadas entre serviços da casa). */
export function segredoInternoValido(dado: string | null | undefined): boolean {
  const segredo = process.env.INTERNAL_SYNC_SECRET?.trim();
  if (!segredo || !dado || dado.length !== segredo.length) return false;
  return timingSafeEqual(Buffer.from(dado), Buffer.from(segredo));
}
