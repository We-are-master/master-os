/**
 * Placar diário (dono, 11/10/2026). Só números do banco, sem IA: o brief antigo foi
 * desligado em 05/10 porque contava cancelado e job aprovado como "aberto".
 *
 * O e-mail tem só três blocos, a pedido do dono:
 *  1. faturamento do mês até agora, a meta e quanto falta
 *  2. leads do mês, taxa de conversão e margem bruta
 *  3. o que precisa de atenção urgente (reclamação, cliente sem resposta, job sem parceiro)
 *
 * As definições:
 *  - job ENTREGUE num dia = concluído naquele dia (relatório final > cronômetro >
 *    completed_date > agenda) e já em final check, aguardando pagamento ou completo
 *  - job ABERTO = sem parceiro, agendado, atrasado, em andamento, em espera ou em final check
 *  - "hoje" e "ontem" são dias de Londres
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveJobCompletionYmd } from "@/lib/job-completion-anchor";

export const META_JOBS_POR_DIA = () => Number(process.env.META_JOBS_POR_DIA?.trim() || "10");
/**
 * A meta do mês é escolhida pelo time em Settings > Setup > "Pulse · Revenue goal"
 * (`frontend_setup.pulse_revenue_goal_monthly_gbp`). Nada de número fixo no código
 * (dono, 11/10/2026): sem meta salva, devolve null e as telas pedem para escolher.
 */
export async function metaMensal(sb: SupabaseClient): Promise<number | null> {
  const { data } = await sb.from("company_settings").select("frontend_setup").limit(1).maybeSingle();
  const v = Number(((data as { frontend_setup?: { pulse_revenue_goal_monthly_gbp?: number | null } } | null)?.frontend_setup ?? {}).pulse_revenue_goal_monthly_gbp);
  return Number.isFinite(v) && v > 0 ? v : null;
}

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

export type Urgente = { tipo: "complaint" | "no_reply" | "no_partner" | "late" | "card"; texto: string };

export type Placar = {
  hoje: string;
  /** Mês corrente de Londres, do dia 1 até agora. */
  mes: Janela & { margemPct: number; meta: number | null; falta: number; pctDaMeta: number; diasRestantes: number; porDiaNecessario: number };
  /** Leads que chegaram até nós no mês (site, WhatsApp, Checkatrade, lançados à mão). Lista de prospecção importada não é lead. */
  leads: { total: number; porCanal: Array<{ canal: string; n: number }>; convertidos: number; taxa: number };
  urgentes: Urgente[];
};

const horasDesde = (iso: string, agora: Date) => Math.max(0, Math.round((agora.getTime() - Date.parse(iso)) / 3_600_000));
export function haQuanto(horas: number): string {
  if (horas < 1) return "less than 1h";
  if (horas < 48) return `${horas}h`;
  return `${Math.round(horas / 24)} days`;
}

/** Margem bruta em %, uma casa. Receita zero dá 0. */
export function margemPct(j: Janela): number {
  return j.receita > 0 ? Math.round((j.margem / j.receita) * 1000) / 10 : 0;
}

/** Quanto falta para a meta e quanto por dia até o fim do mês. Sem banco: testável. */
export function contaDaMeta(receita: number, meta: number | null, hojeYmd: string) {
  const [ano, mes, dia] = hojeYmd.split("-").map(Number);
  const ultimoDia = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const diasRestantes = Math.max(1, ultimoDia - dia + 1);
  if (!meta || meta <= 0) return { falta: 0, pctDaMeta: 0, diasRestantes, porDiaNecessario: 0 };
  const falta = Math.max(0, Math.round((meta - receita) * 100) / 100);
  return { falta, pctDaMeta: Math.round((receita / meta) * 1000) / 10, diasRestantes, porDiaNecessario: Math.round(falta / diasRestantes) };
}

type TicketZd = { id: number; subject: string; updated_at: string; tags: string[] };

/** Tickets do Zendesk que pedem gente: reclamação que o Harvey detectou e cliente esperando resposta. */
async function ticketsUrgentes(): Promise<{ reclamacoes: TicketZd[]; semResposta: TicketZd[] }> {
  try {
    const { isZendeskConfigured, zendeskApi } = await import("@/lib/zendesk");
    if (!isZendeskConfigured()) return { reclamacoes: [], semResposta: [] };
    const busca = (q: string) =>
      zendeskApi<{ results?: TicketZd[] }>(`search.json?query=${encodeURIComponent(q)}&sort_by=updated_at&sort_order=asc&per_page=30`)
        .then((r) => r.results ?? [])
        .catch(() => [] as TicketZd[]);
    const [reclamacoes, semResposta] = await Promise.all([
      busca("type:ticket status<solved tags:harvey_class__reclamacao"),
      busca("type:ticket status<solved tags:reply_awaiting"),
    ]);
    return { reclamacoes, semResposta };
  } catch {
    return { reclamacoes: [], semResposta: [] };
  }
}

/**
 * Leads do mês e quantos viraram cliente. Lead = quem chegou até nós: site, WhatsApp e
 * lançados à mão (site_leads) mais os pedidos do Checkatrade (cliente com a marca
 * `checkatrade-lead:`). Quem veio do Checkatrade e respondeu no WhatsApp é a mesma pessoa:
 * conta uma vez, como Checkatrade, pelo telefone. Lista de prospecção importada não é lead.
 */
export async function leadsDoMes(sb: SupabaseClient, inicioMes: string): Promise<Placar["leads"]> {
  const inicioIso = `${inicioMes}T00:00:00Z`;
  const fim9 = (t: string | null | undefined) => (t ?? "").replace(/\D/g, "").slice(-9);
  const [{ data: leadsRaw }, { data: ckRaw }] = await Promise.all([
    sb.from("site_leads").select("channel, phone, won_at").gte("created_at", inicioIso).limit(5000),
    sb.from("clients").select("id, phone").gte("created_at", inicioIso).ilike("notes", "%checkatrade-lead:%").limit(5000),
  ]);
  const ck = (ckRaw ?? []) as Array<{ id: string; phone: string | null }>;
  const telefonesCk = new Set(ck.map((c) => fim9(c.phone)).filter((t) => t.length === 9));
  const doSite = ((leadsRaw ?? []) as Array<{ channel: string | null; phone: string | null; won_at: string | null }>).filter((l) => !telefonesCk.has(fim9(l.phone)));
  const canais = new Map<string, number>();
  for (const l of doSite) canais.set(l.channel || "website", (canais.get(l.channel || "website") ?? 0) + 1);
  if (ck.length) canais.set("checkatrade", ck.length);
  let ckComJob = 0;
  for (let i = 0; i < ck.length; i += 100) {
    const { data } = await sb.from("jobs").select("client_id").in("client_id", ck.slice(i, i + 100).map((c) => c.id)).is("deleted_at", null).not("status", "in", "(cancelled,deleted)");
    ckComJob += new Set(((data ?? []) as Array<{ client_id: string }>).map((j) => j.client_id)).size;
  }
  const totalLeads = doSite.length + ck.length;
  const convertidos = doSite.filter((l) => l.won_at).length + ckComJob;
  return {
    total: totalLeads,
    porCanal: [...canais].sort((a, b) => b[1] - a[1]).map(([canal, n]) => ({ canal, n })),
    convertidos,
    taxa: totalLeads ? Math.round((convertidos / totalLeads) * 1000) / 10 : 0,
  };
}

/** O que precisa de gente agora: reclamação, cliente sem resposta, job sem parceiro, atraso, cartão. */
export async function urgentesAgora(sb: SupabaseClient, agora = new Date()): Promise<Urgente[]> {
  const hoje = ymdDeLondres(agora);
  const urgentes: Urgente[] = [];
  const { data: emEspera } = await sb.from("jobs").select("reference, client_name, on_hold_at").eq("status", "on_hold").eq("on_hold_reason_preset_id", "complaint").is("deleted_at", null).limit(50);
  for (const j of (emEspera ?? []) as Array<{ reference: string; client_name: string | null; on_hold_at: string | null }>)
    urgentes.push({ tipo: "complaint", texto: `${j.reference} · ${j.client_name ?? "customer"} · complaint open${j.on_hold_at ? ` for ${haQuanto(horasDesde(j.on_hold_at, agora))}` : ""}` });
  const zd = await ticketsUrgentes();
  for (const t of zd.reclamacoes)
    urgentes.push({ tipo: "complaint", texto: `#${t.id} ${t.subject.slice(0, 60)} · complaint${t.tags.includes("reply_awaiting") ? `, customer waiting ${haQuanto(horasDesde(t.updated_at, agora))}` : ""}` });
  const jaListados = new Set(zd.reclamacoes.map((t) => t.id));
  for (const t of zd.semResposta.filter((x) => !jaListados.has(x.id)))
    urgentes.push({ tipo: "no_reply", texto: `#${t.id} ${t.subject.slice(0, 60)} · no reply for ${haQuanto(horasDesde(t.updated_at, agora))}` });
  const { data: semParceiro } = await sb
    .from("jobs")
    .select("reference, scheduled_date, client_name")
    .is("deleted_at", null)
    .is("partner_id", null)
    .in("status", ["unassigned", "auto_assigning", "scheduled"])
    .gte("scheduled_date", hoje)
    .lte("scheduled_date", somarDias(hoje, 2))
    .order("scheduled_date", { ascending: true })
    .limit(30);
  for (const j of (semParceiro ?? []) as Array<{ reference: string; scheduled_date: string; client_name: string | null }>)
    urgentes.push({ tipo: "no_partner", texto: `${j.reference} · ${diaLongo(j.scheduled_date.slice(0, 10))} · no partner yet` });
  const { data: atrasados } = await sb.from("jobs").select("reference, scheduled_date, partner_name").eq("status", "late").is("deleted_at", null).limit(30);
  for (const j of (atrasados ?? []) as Array<{ reference: string; scheduled_date: string | null; partner_name: string | null }>)
    urgentes.push({ tipo: "late", texto: `${j.reference} · late${j.partner_name ? ` · ${j.partner_name}` : ""}` });
  const { data: cartao } = await sb.from("jobs").select("reference, card_refused_reason").in("card_charge_status", ["refused", "requires_action"]).in("status", ["final_check", "awaiting_payment"]).is("deleted_at", null).limit(30);
  for (const j of (cartao ?? []) as Array<{ reference: string; card_refused_reason: string | null }>)
    urgentes.push({ tipo: "card", texto: `${j.reference} · card refused${j.card_refused_reason ? ` (${j.card_refused_reason})` : ""}` });
  return urgentes;
}

export async function montarPlacar(sb: SupabaseClient, agora = new Date()): Promise<Placar> {
  const hoje = ymdDeLondres(agora);
  const inicioMes = `${hoje.slice(0, 8)}01`;

  // 1. Faturamento e margem do mês: jobs entregues, pela data de conclusão.
  const { data: jobsRaw } = await sb
    .from("jobs")
    .select("status, client_price, extras_amount, partner_cost, materials_cost, scheduled_date, scheduled_start_at, completed_date, partner_timer_ended_at, final_report, partner_id, created_at")
    .is("deleted_at", null)
    .gte("scheduled_date", somarDias(inicioMes, -21))
    .limit(5000);
  const doMes = entreguesNaJanela((jobsRaw ?? []) as JobDoPlacar[], inicioMes, hoje);
  const meta = await metaMensal(sb);

  const [leads, urgentes] = await Promise.all([leadsDoMes(sb, inicioMes), urgentesAgora(sb, agora)]);

  return {
    hoje,
    mes: { ...doMes, margemPct: margemPct(doMes), meta, ...contaDaMeta(doMes.receita, meta, hoje) },
    leads,
    urgentes,
  };
}

const gbp = (v: number) => `£${v.toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;
function diaLongo(ymd: string): string {
  return new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}
const mesLongo = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" });

export function assuntoDoPlacar(p: Placar): string {
  return `Fixfy · ${diaLongo(p.hoje)} · ${gbp(p.mes.receita)} this month${p.mes.meta ? `, ${gbp(p.mes.falta)} to go` : ""}${p.urgentes.length ? ` · ${p.urgentes.length} urgent` : ""}`;
}

const GRUPOS: Array<{ tipo: Urgente["tipo"]; titulo: string }> = [
  { tipo: "complaint", titulo: "Complaints" },
  { tipo: "no_reply", titulo: "Customers with no reply" },
  { tipo: "no_partner", titulo: "Jobs in the next 2 days with no partner" },
  { tipo: "late", titulo: "Late jobs" },
  { tipo: "card", titulo: "Card refused" },
];

export function placarEmHtml(p: Placar): string {
  const F = "-apple-system,Segoe UI,sans-serif";
  const esc = (t: string) => t.replace(/[<>&]/g, "");
  const cartao = (rotulo: string, valor: string, nota: string) =>
    `<td style="width:33.3%;padding:12px 10px;vertical-align:top;border:1px solid #e3e5f0;border-radius:10px"><div style="font:600 11px/1 ${F};letter-spacing:.07em;text-transform:uppercase;color:#5b6080">${rotulo}</div><div style="margin-top:6px;font:800 22px/1.1 ${F};color:#020040">${valor}</div><div style="margin-top:4px;font:400 12px/1.35 ${F};color:#8a8fa8">${nota}</div></td>`;
  const pct = Math.min(100, p.mes.pctDaMeta);
  const canais = p.leads.porCanal.map((c) => `${c.n} ${c.canal}`).join(" · ") || "none yet";
  const grupos = GRUPOS.map((g) => ({ ...g, itens: p.urgentes.filter((u) => u.tipo === g.tipo) })).filter((g) => g.itens.length);
  return `<div style="max-width:560px;margin:0 auto;padding:24px 20px;background:#ffffff">
  <p style="margin:0;font:600 12px/1 ${F};letter-spacing:.08em;text-transform:uppercase;color:#ED4B00">${mesLongo(p.hoje)} so far · ${diaLongo(p.hoje)}</p>
  <p style="margin:8px 0 0;font:800 34px/1.05 ${F};color:#020040">${gbp(p.mes.receita)}</p>
  <p style="margin:6px 0 12px;font:400 15px/1.4 ${F};color:#0d1030">${p.mes.meta ? `Goal ${gbp(p.mes.meta)} · <b>${gbp(p.mes.falta)} to go</b> · ${p.mes.pctDaMeta}% there` : "No monthly goal set. Choose it in Settings, Setup, Pulse revenue goal."}</p>
  <div style="height:14px;border-radius:99px;background:#eceef5;overflow:hidden"><div style="height:14px;width:${pct}%;background:#ED4B00;border-radius:99px"></div></div>
  <p style="margin:8px 0 0;font:400 13px/1.4 ${F};color:#5b6080">${p.mes.jobs} jobs delivered. ${p.mes.diasRestantes} day${p.mes.diasRestantes === 1 ? "" : "s"} left in the month${p.mes.meta ? `: ${gbp(p.mes.porDiaNecessario)} a day to hit the goal` : ""}.</p>

  <table style="width:100%;margin-top:20px;border-collapse:separate;border-spacing:6px 0"><tr>
    ${cartao("Leads", String(p.leads.total), canais)}
    ${cartao("Conversion", `${p.leads.taxa}%`, `${p.leads.convertidos} became customer${p.leads.convertidos === 1 ? "" : "s"}`)}
    ${cartao("Gross margin", `${p.mes.margemPct}%`, `${gbp(p.mes.margem)} gross profit`)}
  </tr></table>

  <p style="margin:26px 0 8px;font:700 12px/1 ${F};letter-spacing:.08em;text-transform:uppercase;color:${p.urgentes.length ? "#c5332b" : "#17894c"}">${p.urgentes.length ? `Needs urgent attention · ${p.urgentes.length}` : "Nothing needs urgent attention"}</p>
  ${grupos.map((g) => `<p style="margin:12px 0 4px;font:700 14px/1.3 ${F};color:#0d1030">${g.titulo} · ${g.itens.length}</p><ul style="margin:0;padding-left:18px;font:400 14px/1.5 ${F};color:#0d1030">${g.itens.slice(0, 8).map((u) => `<li>${esc(u.texto)}</li>`).join("")}${g.itens.length > 8 ? `<li style="color:#8a8fa8">and ${g.itens.length - 8} more</li>` : ""}</ul>`).join("")}

  <p style="margin:26px 0 0;font:400 12px/1.4 ${F};color:#8a8fa8">Revenue and margin count jobs delivered this month, on the day they were finished. Leads are people who reached us (website, WhatsApp, Checkatrade, added by the team); imported prospect lists are not leads.</p>
</div>`;
}
