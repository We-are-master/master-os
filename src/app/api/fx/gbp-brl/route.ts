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
 *
 * Primeiro a Wise (dono, 26/10/2026: é por ela que o dinheiro vai para o real; o
 * `wise.com/rates/live` é público, sem token). Em 26/10 a Wise dava 7,46 e o
 * open.er-api 6,74: a tela tem que bater com o que a gente recebe. Wise fora do
 * ar: open.er-api; os dois fora: a referência de 7.
 */
async function daWise(): Promise<number | null> {
  const res = await fetch("https://wise.com/rates/live?source=GBP&target=BRL", { next: { revalidate: 3600 } });
  if (!res.ok) return null;
  const body = (await res.json()) as { value?: number };
  const rate = Number(body?.value);
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}

async function doErApi(): Promise<number | null> {
  const res = await fetch("https://open.er-api.com/v6/latest/GBP", { next: { revalidate: 3600 } });
  if (!res.ok) return null;
  const body = (await res.json()) as { result?: string; rates?: Record<string, number> };
  const rate = Number(body?.rates?.BRL);
  return body?.result === "success" && Number.isFinite(rate) && rate > 0 ? rate : null;
}

export async function GET() {
  const wise = await daWise().catch(() => null);
  if (wise) return NextResponse.json({ rate: wise, source: "wise", fetchedAt: new Date().toISOString() });
  const erApi = await doErApi().catch(() => null);
  if (erApi) return NextResponse.json({ rate: erApi, source: "open.er-api.com", fetchedAt: new Date().toISOString() });
  return NextResponse.json({ rate: GBP_TO_BRL_FALLBACK, source: "fallback", fetchedAt: new Date().toISOString() });
}
