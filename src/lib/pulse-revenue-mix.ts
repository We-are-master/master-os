/**
 * De onde vem a receita, num período só (dono, 05/11/2026: "Where revenue comes from" e
 * "Top accounts" viraram um card). O canal (B2B, plataforma, B2C) e as maiores contas saem
 * dos MESMOS jobs, para a porcentagem de cada conta somar dentro da barra.
 *
 * Job do período: visita no período (horário marcado, senão o dia), sem cancelado.
 * Mesma regra de canal do Pulse: conta de plataforma (overdue_reminders = false) é
 * Platforms; sem conta, conta Fixfy ou conta direta é B2C; o resto é B2B.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { isDirectConsumerAccount } from "@/lib/direct-consumer-accounts";
import { diaDaVisita } from "@/lib/pulse-ceo";
import { ymdDeLondres } from "@/lib/placar-diario";

export type Canal = "B2B accounts" | "Platforms" | "B2C";
export type MixDaReceita = {
  periodo: "month" | "year";
  de: string;
  ate: string;
  total: number;
  canais: Array<{ nome: Canal; valor: number; jobs: number }>;
  contas: Array<{ id: string; nome: string; canal: Canal; valor: number; jobs: number }>;
};

type Job = { client_id: string | null; status: string; client_price: number | null; extras_amount: number | null; scheduled_date: string | null; scheduled_start_at: string | null };
const r2 = (n: number) => Math.round(n * 100) / 100;
const valor = (j: Job) => Number(j.client_price ?? 0) + Number(j.extras_amount ?? 0);

export async function montarMixDaReceita(sb: SupabaseClient, periodo: "month" | "year", agora = new Date()): Promise<MixDaReceita> {
  const hoje = ymdDeLondres(agora);
  const [ano, mes] = hoje.split("-").map(Number);
  const de = periodo === "year" ? `${ano}-01-01` : `${hoje.slice(0, 8)}01`;
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const ate = periodo === "year" ? `${ano}-12-31` : `${hoje.slice(0, 8)}${String(ultimo).padStart(2, "0")}`;

  // Folga de um dia nas pontas: o horário marcado é UTC e o dia que vale é o de Londres.
  const anterior = new Date(`${de}T00:00:00Z`);
  anterior.setUTCDate(anterior.getUTCDate() - 1);
  const seguinte = new Date(`${ate}T00:00:00Z`);
  seguinte.setUTCDate(seguinte.getUTCDate() + 2);
  const cols = "client_id, status, client_price, extras_amount, scheduled_date, scheduled_start_at";
  const jobs: Job[] = [];
  for (let desde = 0; ; desde += 1000) {
    const { data } = await sb
      .from("jobs")
      .select(cols)
      .is("deleted_at", null)
      .or(`and(scheduled_start_at.gte.${anterior.toISOString()},scheduled_start_at.lt.${seguinte.toISOString()}),and(scheduled_start_at.is.null,scheduled_date.gte.${de},scheduled_date.lte.${ate})`)
      .range(desde, desde + 999);
    const lote = (data ?? []) as Job[];
    jobs.push(...lote);
    if (lote.length < 1000 || desde > 20000) break;
  }
  const doPeriodo = jobs.filter((j) => {
    if (j.status === "cancelled" || j.status === "deleted") return false;
    const d = diaDaVisita(j);
    return d != null && d >= de && d <= ate;
  });

  const clientIds = [...new Set(doPeriodo.map((j) => j.client_id).filter(Boolean))] as string[];
  const contaDoCliente = new Map<string, string | null>();
  for (let i = 0; i < clientIds.length; i += 150) {
    const { data } = await sb.from("clients").select("id, source_account_id").in("id", clientIds.slice(i, i + 150));
    for (const c of (data ?? []) as Array<{ id: string; source_account_id: string | null }>) contaDoCliente.set(c.id, c.source_account_id);
  }
  const { data: contasRaw } = await sb.from("accounts").select("id, company_name, overdue_reminders");
  const contas = new Map(((contasRaw ?? []) as Array<{ id: string; company_name: string | null; overdue_reminders: boolean | null }>).map((a) => [a.id, a]));
  const canalDaConta = (conta: string | null): Canal => {
    if (conta && contas.get(conta)?.overdue_reminders === false) return "Platforms";
    if (!conta || (contas.get(conta)?.company_name ?? "").trim().toLowerCase() === "fixfy" || isDirectConsumerAccount(conta)) return "B2C";
    return "B2B accounts";
  };

  const porCanal = new Map<Canal, { valor: number; jobs: number }>();
  const porConta = new Map<string, { valor: number; jobs: number }>();
  for (const j of doPeriodo) {
    const conta = j.client_id ? contaDoCliente.get(j.client_id) ?? null : null;
    const c = canalDaConta(conta);
    const v = valor(j);
    const a = porCanal.get(c) ?? { valor: 0, jobs: 0 };
    porCanal.set(c, { valor: a.valor + v, jobs: a.jobs + 1 });
    if (conta) {
      const b = porConta.get(conta) ?? { valor: 0, jobs: 0 };
      porConta.set(conta, { valor: b.valor + v, jobs: b.jobs + 1 });
    }
  }
  const canais = (["B2B accounts", "Platforms", "B2C"] as const).map((nome) => ({ nome, valor: r2(porCanal.get(nome)?.valor ?? 0), jobs: porCanal.get(nome)?.jobs ?? 0 }));
  const topo = [...porConta.entries()]
    .filter(([, x]) => x.valor > 0)
    .sort((a, b) => b[1].valor - a[1].valor)
    .slice(0, 5)
    .map(([id, x]) => ({ id, nome: contas.get(id)?.company_name?.trim() || "Account", canal: canalDaConta(id), valor: r2(x.valor), jobs: x.jobs }));
  return { periodo, de, ate, total: r2(canais.reduce((t, c) => t + c.valor, 0)), canais, contas: topo };
}
