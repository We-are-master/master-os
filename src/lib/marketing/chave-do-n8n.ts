import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

/**
 * As rotas que o n8n chama pedem o CRON_SECRET, igual aos crons: elas mandam
 * mensagem de verdade e não podem ficar abertas.
 */
export function chaveDoN8nOk(req: NextRequest): boolean {
  const header = req.headers.get("authorization");
  const dado = header?.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const esperado = process.env.CRON_SECRET?.trim() ?? "";
  if (!dado || !esperado) return false;
  const a = Buffer.from(dado);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}
