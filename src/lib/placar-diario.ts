/**
 * Placar diário (dono, 11/10/2026: "brief de volta com os números certos, para ver o
 * placar todo dia rumo à meta"). Só números do banco, sem IA: o brief antigo foi
 * desligado em 05/10 porque contava cancelado e job aprovado como "aberto".
 *
 * As definições:
 *  - job ENTREGUE num dia = concluído naquele dia (relatório final > cronômetro >
 *    completed_date > agenda) e já em final check, aguardando pagamento ou completo
 *  - job ABERTO = sem parceiro, agendado, atrasado, em andamento, em espera ou em final check
 *  - "hoje" e "ontem" são dias de Londres
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveJobCompletionYmd } from "@/lib/job-completion-anchor";
import { alertasDeAutomacao, medirDivisao, type Alertas, type Divisao } from "@/lib/divisao-automacao";

export const META_JOBS_POR_DIA = () => Number(process.env.META_JOBS_POR_DIA?.trim() || "10");
/** R$ 500 mil por mês a ~R$ 7 por libra. */
export const META_MENSAL_GBP = () => Number(process.env.META_MENSAL_GBP?.trim() || "71000");

export const STATUS_ENTREGUE = ["final_check", "awaiting_payment", "completed"] as const;
export const STATUS_ABERTO = ["unassigned", "auto_assigning", "scheduled", "late", "in_progress", "on_hold", "final_check"] as const;

export function ymdDeLondres(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
export function somarDias(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export type JobDoPlacar = {
  status: string;
  client_price: number | null;
  extras_amount: number | null;
  partner_cost: number | null;
  materials_cost?: number | null;
  scheduled_date: string | null;
  scheduled_start_at?: string | null;
  completed_date?: string | null;
  partner_timer_ended_at?: string | null;
  final_report?: { submitted_at?: string | null } | null;
  partner_id?: string | null;
  created_at?: string | null;
};

export type Janela = { jobs: number; receita: number; margem: number };

/** Jobs entregues entre dois dias (inclusive), pela data de conclusão. Sem banco: testável. */
export function entreguesNaJanela(jobs: JobDoPlacar[], deYmd: string, ateYmd: string): Janela {
  let n = 0, receita = 0, custo = 0;
  for (const j of jobs) {
    if (!(STATUS_ENTREGUE as readonly string[]).includes(j.status)) continue;
    const dia = resolveJobCompletionYmd(j);
    if (!dia || dia < deYmd || dia > ateYmd) continue;
    n++;
    receita += Number(j.client_price ?? 0) + Number(j.extras_amount ?? 0);
    custo += Number(j.partner_cost ?? 0) + Number(j.materials_cost ?? 0);
  }
  const r2 = (v: number) => Math.round(v * 100) / 100;
  return { jobs: n, receita: r2(receita), margem: r2(receita - custo) };
}

export type Placar = {
  hoje: string;
  ontem: Janela;
  seteDias: Janela & { porDia: number };
  trintaDias: Janela & { pctDaMeta: number };
  metaJobsPorDia: number;
  metaMensal: number;
  hojeAgendados: number;
  hojeSemParceiro: number;
  abertos: number;
  semParceiro: number;
  emFinalCheck: number;
  aReceber: { faturas: number; valor: number };
  /** Vencidas de contas e clientes: é o que se cobra. */
  vencidas: { faturas: number; valor: number };
  /** Passaram da data, mas são de plataforma (Housekeep, Fantastic, Checkatrade): pagam no ciclo delas. */
  plataformas: { faturas: number; valor: number };
  novosOntem: { jobs: number; leads: number; quotes: number };
  divisao: Divisao;
  alertas: Alertas;
};

export async function montarPlacar(sb: SupabaseClient, agora = new Date()): Promise<Placar> {
  const hoje = ymdDeLondres(agora);
  const ontem = somarDias(hoje, -1);
  const desde = somarDias(hoje, -45);

  const { data: jobsRaw } = await sb
    .from("jobs")
    .select("status, client_price, extras_amount, partner_cost, materials_cost, scheduled_date, scheduled_start_at, completed_date, partner_timer_ended_at, final_report, partner_id, created_at")
    .is("deleted_at", null)
    .gte("scheduled_date", desde)
    .limit(5000);
  const jobs = (jobsRaw ?? []) as JobDoPlacar[];

  const d7 = entreguesNaJanela(jobs, somarDias(hoje, -7), ontem);
  const d30 = entreguesNaJanela(jobs, somarDias(hoje, -30), ontem);

  const { data: abertosRaw } = await sb.from("jobs").select("status, partner_id, scheduled_date").is("deleted_at", null).in("status", [...STATUS_ABERTO]).limit(5000);
  const abertos = (abertosRaw ?? []) as Array<{ status: string; partner_id: string | null; scheduled_date: string | null }>;
  const deHoje = abertos.filter((j) => (j.scheduled_date ?? "").slice(0, 10) === hoje);

  const { data: fat } = await sb.from("invoices").select("status, due_date, amount, amount_paid, source_account_id").is("deleted_at", null).in("status", ["pending", "overdue", "partially_paid"]).limit(5000);
  const faturas = ((fat ?? []) as Array<{ status: string; due_date: string | null; amount: number | null; amount_paid: number | null; source_account_id: string | null }>).map((f) => ({ ...f, saldo: Number(f.amount ?? 0) - Number(f.amount_paid ?? 0) })).filter((f) => f.saldo > 0.02);
  // Plataforma = conta com o lembrete de vencida desligado (mig 320): paga pelo extrato dela.
  const { data: plat } = await sb.from("accounts").select("id").eq("overdue_reminders", false);
  const ehPlataforma = new Set(((plat ?? []) as { id: string }[]).map((a) => a.id));
  const passadas = faturas.filter((f) => f.due_date && f.due_date.slice(0, 10) < hoje);
  const vencidas = passadas.filter((f) => !f.source_account_id || !ehPlataforma.has(f.source_account_id));
  const dePlataforma = passadas.filter((f) => f.source_account_id && ehPlataforma.has(f.source_account_id));
  const soma = (l: Array<{ saldo: number }>) => Math.round(l.reduce((t, f) => t + f.saldo, 0) * 100) / 100;

  const inicioOntem = `${ontem}T00:00:00Z`, inicioHoje = `${hoje}T00:00:00Z`;
  const conta = async (t: string) => (await sb.from(t).select("id", { count: "exact", head: true }).gte("created_at", inicioOntem).lt("created_at", inicioHoje)).count ?? 0;
  const [jobsNovos, leadsNovos, quotesNovas, divisao, alertas] = await Promise.all([conta("jobs"), conta("site_leads"), conta("quotes"), medirDivisao(sb, 7), alertasDeAutomacao(sb, agora)]);

  return {
    hoje,
    ontem: entreguesNaJanela(jobs, ontem, ontem),
    seteDias: { ...d7, porDia: Math.round((d7.jobs / 7) * 10) / 10 },
    trintaDias: { ...d30, pctDaMeta: Math.round((d30.receita / META_MENSAL_GBP()) * 1000) / 10 },
    metaJobsPorDia: META_JOBS_POR_DIA(),
    metaMensal: META_MENSAL_GBP(),
    hojeAgendados: deHoje.length,
    hojeSemParceiro: deHoje.filter((j) => !j.partner_id).length,
    abertos: abertos.length,
    semParceiro: abertos.filter((j) => !j.partner_id && j.status !== "on_hold").length,
    emFinalCheck: abertos.filter((j) => j.status === "final_check").length,
    aReceber: { faturas: faturas.length, valor: soma(faturas) },
    vencidas: { faturas: vencidas.length, valor: soma(vencidas) },
    plataformas: { faturas: dePlataforma.length, valor: soma(dePlataforma) },
    novosOntem: { jobs: jobsNovos, leads: leadsNovos, quotes: quotesNovas },
    divisao,
    alertas,
  };
}

const gbp = (v: number) => `£${v.toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;
const diaLongo = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

export function assuntoDoPlacar(p: Placar): string {
  return `Fixfy · ${diaLongo(p.hoje)} · ${p.seteDias.porDia} jobs a day (goal ${p.metaJobsPorDia}) · ${p.trintaDias.pctDaMeta}% of the monthly goal${p.alertas.total ? ` · ${p.alertas.total} to fix` : ""}`;
}

export function placarEmHtml(p: Placar): string {
  const linha = (rotulo: string, valor: string, nota = "") =>
    `<tr><td style="padding:7px 0;color:#5b6080;font:14px/1.4 -apple-system,Segoe UI,sans-serif">${rotulo}</td><td style="padding:7px 0;text-align:right;font:600 15px/1.4 -apple-system,Segoe UI,sans-serif;color:#0d1030">${valor}${nota ? `<div style="font:400 12px/1.3 -apple-system,Segoe UI,sans-serif;color:#8a8fa8">${nota}</div>` : ""}</td></tr>`;
  const bloco = (titulo: string, linhas: string) =>
    `<h3 style="margin:22px 0 4px;font:700 12px/1 -apple-system,Segoe UI,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#ED4B00">${titulo}</h3><table style="width:100%;border-collapse:collapse">${linhas}</table>`;
  const pct = Math.min(100, p.trintaDias.pctDaMeta);
  const alertas = [
    ...p.alertas.cartaoRecusado, ...p.alertas.cobrancaPresa, ...p.alertas.semSelfBill, ...p.alertas.payday,
  ];
  return `<div style="max-width:560px;margin:0 auto;padding:24px 20px;background:#ffffff">
  <p style="margin:0;font:800 22px/1.2 -apple-system,Segoe UI,sans-serif;color:#020040">Fixfy scoreboard · ${diaLongo(p.hoje)}</p>
  <p style="margin:6px 0 14px;font:14px/1.4 -apple-system,Segoe UI,sans-serif;color:#5b6080">${gbp(p.trintaDias.receita)} delivered in the last 30 days, ${p.trintaDias.pctDaMeta}% of the ${gbp(p.metaMensal)} monthly goal.</p>
  <div style="height:12px;border-radius:99px;background:#eceef5;overflow:hidden"><div style="height:12px;width:${pct}%;background:#ED4B00;border-radius:99px"></div></div>
  ${bloco("Pace", linha("Jobs a day, last 7 days", `${p.seteDias.porDia}`, `goal ${p.metaJobsPorDia} a day`) + linha("Yesterday", `${p.ontem.jobs} jobs · ${gbp(p.ontem.receita)}`, `margin ${gbp(p.ontem.margem)}`) + linha("Last 7 days", `${p.seteDias.jobs} jobs · ${gbp(p.seteDias.receita)}`, `margin ${gbp(p.seteDias.margem)}`) + linha("Last 30 days", `${p.trintaDias.jobs} jobs · ${gbp(p.trintaDias.receita)}`, `margin ${gbp(p.trintaDias.margem)}`))}
  ${bloco("Today", linha("Jobs scheduled today", `${p.hojeAgendados}`, p.hojeSemParceiro ? `${p.hojeSemParceiro} with no partner yet` : "all have a partner") + linha("Open jobs", `${p.abertos}`, `${p.semParceiro} with no partner · ${p.emFinalCheck} in final check`))}
  ${bloco("Came in yesterday", linha("New jobs", `${p.novosOntem.jobs}`) + linha("New leads", `${p.novosOntem.leads}`) + linha("New quotes", `${p.novosOntem.quotes}`))}
  ${bloco("Money", linha("To receive", `${gbp(p.aReceber.valor)}`, `${p.aReceber.faturas} invoices`) + linha("Overdue (accounts and customers)", `${gbp(p.vencidas.valor)}`, `${p.vencidas.faturas} invoices to chase`) + linha("Platforms past their date", `${gbp(p.plataformas.valor)}`, `${p.plataformas.faturas} invoices, paid on their own cycle`))}
  ${bloco("Who did the work, last 7 days", linha("Harvey", `${p.divisao.pct.harvey}%`, "goal 50%") + linha("System", `${p.divisao.pct.system}%`, "goal 30%") + linha("Team", `${p.divisao.pct.human}%`, "goal 20%"))}
  <h3 style="margin:22px 0 6px;font:700 12px/1 -apple-system,Segoe UI,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:${alertas.length ? "#c5332b" : "#17894c"}">${alertas.length ? `Needs a person today · ${alertas.length}` : "Nothing waiting on a person"}</h3>
  ${alertas.length ? `<ul style="margin:0;padding-left:18px;font:14px/1.5 -apple-system,Segoe UI,sans-serif;color:#0d1030">${alertas.map((a) => `<li>${a.replace(/[<>&]/g, "")}</li>`).join("")}</ul>` : ""}
  <p style="margin:24px 0 0;font:12px/1.4 -apple-system,Segoe UI,sans-serif;color:#8a8fa8">Numbers straight from the OS. A job counts on the day it was finished. Open the OS: app.getfixfy.com/automation</p>
</div>`;
}
