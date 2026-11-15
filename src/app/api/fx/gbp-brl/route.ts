import { NextResponse } from "next/server";
import { cotacaoGbpBrl } from "@/lib/fx-gbp-brl";

export const runtime = "nodejs";
/** Cotação não precisa ser de segundo: uma hora de cache serve e poupa a API. */
export const revalidate = 3600;

/**
 * GBP → BRL para o seletor de moeda do Pulse.
 *
 * Vai pelo servidor, não pelo browser: evita CORS, deixa o cache de uma hora
 * valer para todo mundo, e mantém a origem externa fora do bundle do cliente.
 * A ordem das fontes (Wise, open.er-api, 7) mora em `@/lib/fx-gbp-brl`, a mesma do JARVIS.
 */
export async function GET() {
  return NextResponse.json(await cotacaoGbpBrl());
}
