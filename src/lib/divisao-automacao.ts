/**
 * Quem fez o trabalho (Fase 5, dono 09/10/2026: "Harvey faz 50% do job, sistema 30%,
 * humano 20%"). Conta TOQUES no OS numa janela:
 *  - criação de job: nota do Harvey = Harvey; site, recorrência e retrabalho = sistema; resto = humano
 *  - eventos de job e quote no audit_logs: sem usuário = sistema; usuário Harvey = Harvey; resto = humano
 *    (um toque por registro, ator, ação e dia, para sync automático não inflar)
 *  - cobrança no cartão salvo que passou = sistema
 * Resposta pública do Harvey no Zendesk ainda não entra (fica no Zendesk).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { conferirPayday } from "@/lib/payday-check";

export type Ator = "harvey" | "system" | "human";
export const META: Record<Ator, number> = { harvey: 50, system: 30, human: 20 };

export function classificarAtor(e: { userId: string | null; userName: string | null }): Ator {
  if (/harvey/i.test(e.userName ?? "")) return "harvey";
  if (!e.userId) return "system";
  return "human";
}

export function classificarCriacaoDoJob(j: { externalSource: string | null; internalNotes: string | null }): Ator {
  const notas = j.internalNotes ?? "";
  if (/harvey/i.test(notas)) return "harvey";
  if (/^(site|website|b2c|stripe|recurring)$/i.test(j.externalSource ?? "") || /remedial-of:|site booking|getfixfy\.com\/book/i.test(notas)) return "system";
  return "human";
}

export function percentuais(c: Record<Ator, number>): Record<Ator, number> {
  const total = c.harvey + c.system + c.human;
  if (!total) return { harvey: 0, system: 0, human: 0 };
  const r = (n: number) => Math.round((n / total) * 1000) / 10;
  return { harvey: r(c.harvey), system: r(c.system), human: r(c.human) };
}

export type Divisao = {
  dias: number;
  toques: Record<Ator, number>;
  pct: Record<Ator, number>;
  meta: Record<Ator, number>;
  detalhe: { criacaoDeJob: Record<Ator, number>; eventos: Record<Ator, number>; cobrancasNoCartao: number };
};

export async function medirDivisao(sb: SupabaseClient, dias = 7): Promise<Divisao> {
  const desde = new Date(Date.now() - dias * 86_400_000).toISOString();
  const zero = (): Record<Ator, number> => ({ harvey: 0, system: 0, human: 0 });

  const criacao = zero();
  const { data: jobs } = await sb.from("jobs").select("external_source, internal_notes").gte("created_at", desde).limit(5000);
  for (const j of (jobs ?? []) as Array<{ external_source: string | null; internal_notes: string | null }>) {
    criacao[classificarCriacaoDoJob({ externalSource: j.external_source, internalNotes: j.internal_notes })]++;
  }

  const eventos = zero();
  const vistos = new Set<string>();
  for (let de = 0; de < 50_000; de += 1000) {
    const { data } = await sb
      .from("audit_logs")
      .select("entity_id, action, user_id, user_name, created_at")
      .in("entity_type", ["job", "quote", "invoice"])
      .gte("created_at", desde)
      .order("created_at", { ascending: true })
      .range(de, de + 999);
    const lote = (data ?? []) as Array<{ entity_id: string; action: string; user_id: string | null; user_name: string | null; created_at: string }>;
    for (const e of lote) {
      const ator = classificarAtor({ userId: e.user_id, userName: e.user_name });
      const k = `${e.entity_id}|${ator}|${e.action}|${e.created_at.slice(0, 10)}`;
      if (vistos.has(k)) continue;
      vistos.add(k);
      eventos[ator]++;
    }
    if (lote.length < 1000) break;
  }

  const { count: cartao } = await sb.from("stripe_charge_attempts").select("id", { count: "exact", head: true }).eq("status", "succeeded").gte("created_at", desde);
  const cobrancas = cartao ?? 0;

  const toques: Record<Ator, number> = {
    harvey: criacao.harvey + eventos.harvey,
    system: criacao.system + eventos.system + cobrancas,
    human: criacao.human + eventos.human,
  };
  return { dias, toques, pct: percentuais(toques), meta: META, detalhe: { criacaoDeJob: criacao, eventos, cobrancasNoCartao: cobrancas } };
}

export type Alertas = {
  total: number;
  cartaoRecusado: string[];
  cobrancaPresa: string[];
  semSelfBill: string[];
  payday: string[];
};

/** O que precisa de gente hoje (Fase 5): cartão recusado, cobrança sem resposta, job fora da quinzena. */
export async function alertasDeAutomacao(sb: SupabaseClient, agora = new Date()): Promise<Alertas> {
  const { data: rec } = await sb
    .from("jobs")
    .select("reference, card_charge_status, card_refused_reason")
    .in("card_charge_status", ["refused", "requires_action"])
    .eq("status", "final_check")
    .is("deleted_at", null);
  const cartaoRecusado = ((rec ?? []) as Array<{ reference: string; card_charge_status: string; card_refused_reason: string | null }>).map(
    (j) => `${j.reference}: ${j.card_charge_status === "refused" ? "card refused" : "bank asked the customer to confirm"}${j.card_refused_reason ? ` (${j.card_refused_reason})` : ""}`,
  );

  const quinzeMin = new Date(agora.getTime() - 15 * 60_000).toISOString();
  const { data: presas } = await sb.from("stripe_charge_attempts").select("job_id, amount_pence, created_at").eq("status", "pending").lt("created_at", quinzeMin).limit(50);
  const cobrancaPresa = ((presas ?? []) as Array<{ job_id: string; amount_pence: number; created_at: string }>).map(
    (p) => `job ${p.job_id}: £${(p.amount_pence / 100).toFixed(2)} pending since ${p.created_at.slice(0, 16).replace("T", " ")} (Stripe never answered)`,
  );

  const trintaDias = new Date(agora.getTime() - 30 * 86_400_000).toISOString();
  const { data: soltos } = await sb
    .from("jobs")
    .select("reference, partner_name, partner_cost")
    .in("status", ["awaiting_payment", "completed"])
    .is("self_bill_id", null)
    .not("partner_id", "is", null)
    .gt("partner_cost", 0)
    .gte("updated_at", trintaDias)
    .is("deleted_at", null)
    .limit(100);
  const semSelfBill = ((soltos ?? []) as Array<{ reference: string; partner_name: string | null; partner_cost: number }>).map(
    (j) => `${j.reference} (${j.partner_name ?? "partner"}, £${Number(j.partner_cost).toFixed(2)}) approved but on no self-bill`,
  );

  const p = await conferirPayday(sb).catch(() => null);
  // Duplicata de quinzena já paga não tem mais o que fazer: só entra a que ainda tem documento aberto.
  const payday = p
    ? [...p.duplicados.filter((x) => /accumulating|draft/.test(x)).map((x) => `duplicate self-bill: ${x}`), ...p.parceiroErrado, ...p.emPagamentoSemAprovar]
    : [];

  return { total: cartaoRecusado.length + cobrancaPresa.length + semSelfBill.length + payday.length, cartaoRecusado, cobrancaPresa, semSelfBill, payday };
}
