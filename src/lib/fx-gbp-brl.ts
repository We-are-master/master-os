/**
 * GBP → BRL do seletor de moeda do Pulse (rota `/api/fx/gbp-brl`) e do JARVIS.
 *
 * Primeiro a Wise (dono, 26/10/2026: é por ela que o dinheiro vai para o real; o
 * `wise.com/rates/live` é público, sem token). Em 26/10 a Wise dava 7,46 e o
 * open.er-api 6,74: a tela tem que bater com o que a gente recebe. Wise fora do
 * ar: open.er-api; os dois fora: a referência de 7.
 */

/** Fallback quando a API não responde: é a cotação que o escritório já usa de cabeça. */
export const GBP_TO_BRL_FALLBACK = 7;

export type CotacaoGbpBrl = { rate: number; source: "wise" | "open.er-api.com" | "fallback"; fetchedAt: string };

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

/** Nunca lança: sem as duas fontes, devolve a referência de 7. */
export async function cotacaoGbpBrl(): Promise<CotacaoGbpBrl> {
  const fetchedAt = new Date().toISOString();
  const wise = await daWise().catch(() => null);
  if (wise) return { rate: wise, source: "wise", fetchedAt };
  const erApi = await doErApi().catch(() => null);
  if (erApi) return { rate: erApi, source: "open.er-api.com", fetchedAt };
  return { rate: GBP_TO_BRL_FALLBACK, source: "fallback", fetchedAt };
}
