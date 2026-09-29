/**
 * O que o Harvey pergunta ao site (master-website /api/b2c/agent): catálogo,
 * preço, datas e link de pagamento. Preço nunca é calculado aqui: a tabela
 * mora no site e o checkout é o mesmo da reserva online.
 */

export type ChamadaAoSite = (corpo: Record<string, unknown>) => Promise<{ status: number; data: Record<string, unknown> }>;

export const chamarSite: ChamadaAoSite = async (corpo) => {
  const base = (process.env.HARVEY_WA_SITE_URL || "https://www.getfixfy.com").replace(/\/$/, "");
  const chave = process.env.MASTER_OS_LEAD_WEBHOOK_API_KEY?.trim() || process.env.MASTER_OS_JOB_WEBHOOK_API_KEY?.trim() || "";
  const res = await fetch(`${base}/api/b2c/agent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Agent-Key": chave },
    body: JSON.stringify(corpo),
    signal: AbortSignal.timeout(20_000),
  });
  return { status: res.status, data: (await res.json().catch(() => ({}))) as Record<string, unknown> };
};
