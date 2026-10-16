/**
 * Desconto do Harvey (dono, 09/10/2026): até 5% para quem PEDIR, uma vez, e nunca
 * deixando a margem abaixo de 30% do preço. Acima disso, ou sem saber o custo do
 * parceiro, a decisão é da equipe.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export const DESCONTO_MAXIMO = 0.05;
export const MARGEM_MINIMA = 0.3;

export type DecisaoDeDesconto =
  | { ok: true; percent: number; novoTotal: number; margemDepois: number }
  | { ok: false; motivo: "sem_custo" | "margem"; margemAtual: number | null };

/** Maior desconto (até 5%, em pontos inteiros) que mantém a margem em 30% ou mais. */
export function decidirDesconto(total: number, custoParceiro: number | null): DecisaoDeDesconto {
  if (!custoParceiro || custoParceiro <= 0 || total <= 0) return { ok: false, motivo: "sem_custo", margemAtual: null };
  for (let pct = Math.round(DESCONTO_MAXIMO * 100); pct >= 1; pct--) {
    const novo = Math.round(total * (1 - pct / 100) * 100) / 100;
    const margem = (novo - custoParceiro) / novo;
    if (margem >= MARGEM_MINIMA) return { ok: true, percent: pct, novoTotal: novo, margemDepois: Math.round(margem * 1000) / 1000 };
  }
  return { ok: false, motivo: "margem", margemAtual: Math.round(((total - custoParceiro) / total) * 1000) / 1000 };
}

type Preset = { label?: string; fixed_price?: number; partner_cost?: number };

/**
 * Custo do parceiro para o que foi cotado, pelos Services do OS (fonte única).
 * Casa cada linha da cotação com a faixa de mesmo preço do serviço; sem casar, null.
 */
export async function custoDoParceiroParaCotacao(
  sb: SupabaseClient,
  linhas: Array<{ label?: string; amount?: number }>,
): Promise<number | null> {
  const { data } = await sb.from("service_catalog").select("name, pricing_presets, pricing_addons, partner_cost").eq("is_active", true);
  const servicos = (data ?? []) as Array<{ name: string; pricing_presets: Preset[] | null; pricing_addons: Preset[] | null; partner_cost: number | null }>;
  let custo = 0;
  for (const l of linhas) {
    const preco = Number(l.amount ?? 0);
    const rotulo = (l.label ?? "").toLowerCase();
    let achou: number | null = null;
    for (const s of servicos) {
      if (rotulo && !rotulo.includes(s.name.toLowerCase().split(" ")[0])) continue;
      for (const p of [...(s.pricing_presets ?? []), ...(s.pricing_addons ?? [])]) {
        if (Math.abs(Number(p.fixed_price ?? -1) - preco) < 0.01 && Number(p.partner_cost) > 0) { achou = Number(p.partner_cost); break; }
      }
      if (achou != null) break;
    }
    if (achou == null) return null;
    custo += achou;
  }
  return Math.round(custo * 100) / 100;
}
