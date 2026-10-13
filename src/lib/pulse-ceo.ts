/**
 * Os números do CEO no Pulse (dono, 11/10/2026), todos do MÊS corrente de Londres e com
 * as mesmas definições do placar das 8h:
 *  - faturamento do mês = job com visita no mês que não foi cancelado (abertos inclusos)
 *  - entregue = concluído (final check, aguardando pagamento, completo), no dia da conclusão
 *  - lead = quem chegou até nós (site, WhatsApp, Checkatrade, lançado à mão)
 *  - a receber separa o vencido de verdade das plataformas, que pagam no ciclo delas
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { isDirectConsumerAccount } from "@/lib/direct-consumer-accounts";
import { resolveJobCompletionYmd } from "@/lib/job-completion-anchor";
import { leadsDoMes, metaMensal, somarDias, urgentesAgora, ymdDeLondres, STATUS_ENTREGUE, type Urgente } from "@/lib/placar-diario";

export type UrgenteDoPulse = { tipo: Urgente["tipo"] | "final_check" | "quote_ready"; texto: string };

export type PulseCeo = {
  hoje: string;
  /** Escolhida em Settings > Setup. Null enquanto ninguém escolheu. */
  meta: number | null;
  funil: {
    leads: number;
    porCanal: Array<{ canal: string; n: number }>;
    quotes: number;
    fechados: { n: number; valor: number };
    entregues: { n: number; valor: number };
    pagos: { n: number; valor: number };
    conversao: number;
    /** Leads do mês que viraram cliente. */
    convertidos: number;
  };
  dinheiro: {
    aReceber: { n: number; valor: number };
    vencido: { n: number; valor: number };
    plataformas: { n: number; valor: number };
  };
  urgentes: UrgenteDoPulse[];
  /** Acumulado por dia do mês: fechado (pela visita) e entregue (pela conclusão). */
  acumulado: Array<{ dia: number; fechado: number; entregue: number }>;
  origem: Array<{ nome: "B2B accounts" | "Platforms" | "B2C"; valor: number; jobs: number }>;
};

type JobDoMes = {
  id: string;
  reference: string;
  status: string;
  client_id: string | null;
  client_price: number | null;
  extras_amount: number | null;
  scheduled_date: string | null;
  scheduled_start_at: string | null;
  completed_date: string | null;
  partner_timer_ended_at: string | null;
  final_report: { submitted_at?: string | null } | null;
  created_at: string | null;
};

const valor = (j: Pick<JobDoMes, "client_price" | "extras_amount">) => Number(j.client_price ?? 0) + Number(j.extras_amount ?? 0);
const r2 = (v: number) => Math.round(v * 100) / 100;

/** O dia de Londres da visita: o horário marcado, senão o dia agendado. */
export function diaDaVisita(j: Pick<JobDoMes, "scheduled_start_at" | "scheduled_date">): string | null {
  if (j.scheduled_start_at) {
    const d = new Date(j.scheduled_start_at);
    if (!Number.isNaN(d.getTime())) return ymdDeLondres(d);
  }
  const s = j.scheduled_date?.slice(0, 10) ?? "";
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

/** Soma acumulada por dia do mês (1 até o último dia). Sem banco: testável. */
export function acumularPorDia(itens: Array<{ ymd: string | null; valor: number }>, inicioMes: string, ultimoDia: number): number[] {
  const porDia = new Array<number>(ultimoDia).fill(0);
  const prefixo = inicioMes.slice(0, 8);
  for (const i of itens) {
    if (!i.ymd || !i.ymd.startsWith(prefixo)) continue;
    const d = Number(i.ymd.slice(8, 10));
    if (d >= 1 && d <= ultimoDia) porDia[d - 1] += i.valor;
  }
  let soma = 0;
  return porDia.map((v) => r2((soma += v)));
}

export async function montarPulseCeo(sb: SupabaseClient, agora = new Date()): Promise<PulseCeo> {
  const hoje = ymdDeLondres(agora);
  const inicioMes = `${hoje.slice(0, 8)}01`;
  const [ano, mes] = hoje.split("-").map(Number);
  const ultimoDia = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const fimMes = `${hoje.slice(0, 8)}${String(ultimoDia).padStart(2, "0")}`;
  const inicioIso = `${inicioMes}T00:00:00Z`;

  const { data: jobsRaw } = await sb
    .from("jobs")
    .select("id, reference, status, client_id, client_price, extras_amount, scheduled_date, scheduled_start_at, completed_date, partner_timer_ended_at, final_report, created_at")
    .is("deleted_at", null)
    .gte("scheduled_date", somarDias(inicioMes, -21))
    .lte("scheduled_date", somarDias(fimMes, 7))
    .limit(5000);
  const todos = ((jobsRaw ?? []) as JobDoMes[]).filter((j) => j.status !== "cancelled" && j.status !== "deleted");
  const doMes = todos.filter((j) => {
    const d = diaDaVisita(j);
    return d != null && d >= inicioMes && d <= fimMes;
  });
  const entregues = todos
    .filter((j) => (STATUS_ENTREGUE as readonly string[]).includes(j.status))
    .map((j) => ({ j, ymd: resolveJobCompletionYmd(j) }))
    .filter((x) => x.ymd != null && x.ymd >= inicioMes && x.ymd <= hoje);

  // Funil.
  const [leads, { count: quotes }, { data: fechadosRaw }, { data: pagRaw }, meta, urgentesBase] = await Promise.all([
    leadsDoMes(sb, inicioMes),
    sb.from("quotes").select("id", { count: "exact", head: true }).gte("created_at", inicioIso).is("deleted_at", null),
    sb.from("jobs").select("status, client_price, extras_amount").is("deleted_at", null).gte("created_at", inicioIso).limit(5000),
    // Recebido no mês: faturas que entraram em "paid" com data de pagamento no mês.
    sb.from("invoices").select("amount, amount_paid, paid_date").is("deleted_at", null).gte("paid_date", inicioMes).lte("paid_date", fimMes).limit(5000),
    metaMensal(sb),
    urgentesAgora(sb, agora),
  ]);
  const fechados = ((fechadosRaw ?? []) as Array<{ status: string; client_price: number | null; extras_amount: number | null }>).filter((j) => j.status !== "cancelled" && j.status !== "deleted");
  const pagos = ((pagRaw ?? []) as Array<{ amount: number | null; amount_paid: number | null }>).map((f) => ({ amount: Number(f.amount_paid ?? 0) > 0 ? Number(f.amount_paid) : Number(f.amount ?? 0) }));

  // A receber: vencido de verdade × plataformas.
  const { data: fat } = await sb.from("invoices").select("due_date, amount, amount_paid, source_account_id").is("deleted_at", null).in("status", ["pending", "overdue", "partially_paid"]).limit(5000);
  const faturas = ((fat ?? []) as Array<{ due_date: string | null; amount: number | null; amount_paid: number | null; source_account_id: string | null }>)
    .map((f) => ({ ...f, saldo: Number(f.amount ?? 0) - Number(f.amount_paid ?? 0) }))
    .filter((f) => f.saldo > 0.02);
  const { data: contas } = await sb.from("accounts").select("id, company_name, overdue_reminders").is("deleted_at", null);
  const listaContas = (contas ?? []) as Array<{ id: string; company_name: string | null; overdue_reminders: boolean | null }>;
  const plataformas = new Set(listaContas.filter((a) => a.overdue_reminders === false).map((a) => a.id));
  const contaFixfy = new Set(listaContas.filter((a) => (a.company_name ?? "").trim().toLowerCase() === "fixfy").map((a) => a.id));
  const passadas = faturas.filter((f) => f.due_date && f.due_date.slice(0, 10) < hoje);
  const vencidas = passadas.filter((f) => !f.source_account_id || !plataformas.has(f.source_account_id));
  const dePlataforma = passadas.filter((f) => f.source_account_id && plataformas.has(f.source_account_id));
  const total = (l: Array<{ saldo: number }>) => ({ n: l.length, valor: r2(l.reduce((t, f) => t + f.saldo, 0)) });

  // De onde vem a receita do mês: plataformas, contas B2B, B2C.
  const clientIds = [...new Set(doMes.map((j) => j.client_id).filter(Boolean))] as string[];
  const contaDoCliente = new Map<string, string | null>();
  for (let i = 0; i < clientIds.length; i += 100) {
    const { data } = await sb.from("clients").select("id, source_account_id").in("id", clientIds.slice(i, i + 100));
    for (const c of (data ?? []) as Array<{ id: string; source_account_id: string | null }>) contaDoCliente.set(c.id, c.source_account_id);
  }
  const grupo = (j: JobDoMes): PulseCeo["origem"][number]["nome"] => {
    const conta = j.client_id ? contaDoCliente.get(j.client_id) ?? null : null;
    if (conta && plataformas.has(conta)) return "Platforms";
    if (!conta || contaFixfy.has(conta) || isDirectConsumerAccount(conta)) return "B2C";
    return "B2B accounts";
  };
  const origem = (["B2B accounts", "Platforms", "B2C"] as const).map((nome) => {
    const js = doMes.filter((j) => grupo(j) === nome);
    return { nome, valor: r2(js.reduce((t, j) => t + valor(j), 0)), jobs: js.length };
  });

  // Urgentes do Pulse: os do placar + final check parado há 3 dias + quotes prontas.
  const urgentes: UrgenteDoPulse[] = [...urgentesBase];
  const limite = somarDias(hoje, -3);
  const { data: fc } = await sb.from("jobs").select("reference, completed_date, client_price, extras_amount").eq("status", "final_check").is("deleted_at", null).limit(100);
  for (const j of (fc ?? []) as Array<{ reference: string; completed_date: string | null; client_price: number | null; extras_amount: number | null }>) {
    const d = j.completed_date?.slice(0, 10);
    if (d && d <= limite) urgentes.push({ tipo: "final_check", texto: `${j.reference} · in final check since ${d} · £${Math.round(valor(j)).toLocaleString("en-GB")} waiting` });
  }
  const { data: qr } = await sb.from("quotes").select("reference, client_name, total_value").eq("status", "quote_ready").is("deleted_at", null).order("updated_at", { ascending: false }).limit(20);
  for (const q of (qr ?? []) as Array<{ reference: string; client_name: string | null; total_value: number | null }>)
    urgentes.push({ tipo: "quote_ready", texto: `${q.reference} · ${q.client_name ?? "customer"} · £${Math.round(Number(q.total_value ?? 0)).toLocaleString("en-GB")} ready to send` });

  const fechadoAcc = acumularPorDia(doMes.map((j) => ({ ymd: diaDaVisita(j), valor: valor(j) })), inicioMes, ultimoDia);
  const entregueAcc = acumularPorDia(entregues.map((x) => ({ ymd: x.ymd, valor: valor(x.j) })), inicioMes, ultimoDia);

  return {
    hoje,
    meta,
    funil: {
      leads: leads.total,
      porCanal: leads.porCanal,
      quotes: quotes ?? 0,
      fechados: { n: fechados.length, valor: r2(fechados.reduce((t, j) => t + valor(j), 0)) },
      entregues: { n: entregues.length, valor: r2(entregues.reduce((t, x) => t + valor(x.j), 0)) },
      pagos: { n: pagos.length, valor: r2(pagos.reduce((t, p) => t + Number(p.amount ?? 0), 0)) },
      conversao: leads.taxa,
      convertidos: leads.convertidos,
    },
    dinheiro: { aReceber: total(faturas), vencido: total(vencidas), plataformas: total(dePlataforma) },
    urgentes,
    acumulado: fechadoAcc.map((v, i) => ({ dia: i + 1, fechado: v, entregue: entregueAcc[i] })),
    origem,
  };
}
