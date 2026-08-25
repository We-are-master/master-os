import { NextResponse } from "next/server";

export const runtime = "nodejs";
/** Cotação não precisa ser de segundo: uma hora de cache serve e poupa a API. */
export const revalidate = 3600;

/** Fallback quando a API não responde: é a cotação que o escritório já usa de cabeça. */
export const GBP_TO_BRL_FALLBACK = 7;

/**
 * GBP → BRL para o seletor de moeda do Pulse.
 *
 * Vai pelo servidor, não pelo browser: evita CORS, deixa o cache de uma hora
 * valer para todo mundo, e mantém a origem externa fora do bundle do cliente.
 */
export async function GET() {
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/GBP", {
      next: { revalidate: 3600 },
    });
    if (!res.ok) throw new Error(`fx upstream ${res.status}`);
    const body = (await res.json()) as { result?: string; rates?: Record<string, number> };
    const rate = Number(body?.rates?.BRL);
    if (body?.result !== "success" || !Number.isFinite(rate) || rate <= 0) {
      throw new Error("fx payload without a usable BRL rate");
    }
    return NextResponse.json({ rate, source: "open.er-api.com", fetchedAt: new Date().toISOString() });
  } catch {
    return NextResponse.json({ rate: GBP_TO_BRL_FALLBACK, source: "fallback", fetchedAt: new Date().toISOString() });
  }
}
