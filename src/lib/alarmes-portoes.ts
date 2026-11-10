/**
 * Alarmes dos portões do dono (dono, 10/11/2026: "fico com três portões, o resto é
 * agente e automação"). Os portões são: quote, alocar parceiro em job Unassigned e
 * aprovar o relatório final (Final Check). Quote já tem a sua fila; aqui ficam os
 * alarmes dos outros dois e o do parceiro que não começou:
 *
 *   alocar             Unassigned há mais de 2h e sem esperar sinal do cliente
 *                      (sinal pago, ou conta que não cobra sinal: B2B, plataforma, fatura)
 *   aprovar_report     Final Check há mais de 12h (jobs.final_check_at, migration 283)
 *   parceiro_parado    Scheduled ou Late, início (scheduled_start_at) passou há 30 min
 *                      e o parceiro não começou (sem cronômetro, sem start report)
 *
 * Cada alarme vira UM Action Required no ticket do job (fila-de-acao.ts), uma vez por
 * job, portão e marco (a entrada no status ou o horário marcado). Nunca muda status
 * de job, nunca fala com cliente nem com parceiro.
 *
 * Tudo atrás de ALARMES_PORTOES=1. Desligado, a rotina não lê nem escreve nada.
 * `alarmesDosPortoes` é pura e serve também para o resumo da manhã.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { regrasDoProcesso, tipoDaConta, type ExcecoesDaConta } from "@/lib/processo/conta";
import { getZendeskTicketId } from "@/lib/zendesk";

export const alarmesLigados = (env: Record<string, string | undefined> = process.env): boolean => env.ALARMES_PORTOES?.trim() === "1";

export type Portao = "alocar" | "aprovar_report" | "parceiro_parado";

export const HORAS_SEM_PARCEIRO = 2;
export const HORAS_EM_FINAL_CHECK = 12;
export const MINUTOS_SEM_COMECAR = 30;
/** Só job mexido nos últimos 7 dias: a primeira passada não acorda job esquecido há meses. */
export const DIAS_DE_JANELA = 7;
/** Teto de alarmes por passada; o resto fica no log e sai nas próximas. */
export const MAX_POR_PASSADA = 10;

export const STATUS_DOS_ALARMES = ["unassigned", "final_check", "scheduled", "late"] as const;

export type JobDoAlarme = {
  id: string;
  reference: string | null;
  status: string;
  deleted_at?: string | null;
  created_at: string;
  updated_at?: string | null;
  account_id?: string | null;
  quote_id?: string | null;
  partner_id?: string | null;
  scheduled_start_at?: string | null;
  final_check_at?: string | null;
  partner_timer_started_at?: string | null;
  start_report_submitted?: boolean | null;
  customer_deposit?: number | string | null;
  customer_deposit_paid?: boolean | null;
  finance_status?: string | null;
  payment_status?: string | null;
  external_source?: string | null;
  external_ref?: string | null;
};

export type ContaDoAlarme = { id: string; process_type?: string | null; process_rules?: ExcecoesDaConta | null; collection_mode?: string | null };

export type ContextoDosAlarmes = {
  contas: Map<string, ContaDoAlarme>;
  /** Jobs com sinal ou pagamento do cliente no livro (job_payments). */
  pagosNoLivro: Set<string>;
  /** Jobs cuja quote ainda está em awaiting_payment (esperando a entrada). */
  quoteEsperandoSinal: Set<string>;
  /** Última volta para Unassigned no histórico (audit_logs), por job. */
  voltouParaUnassigned: Map<string, string>;
};

export type Alarme = {
  portao: Portao;
  jobId: string;
  referencia: string;
  ticketId: string | null;
  /** A linha do Action Required. Estável: o mesmo texto não ganha nota de novo. */
  acao: string;
  /** Desde quando a condição vale (entrada no status ou início marcado). */
  desde: string;
  /** Trava de "já avisei": job, portão e marco. Marco novo (voltou ao status, remarcou) = alarme novo. */
  chave: string;
};

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN);

const HORA_LONDRES = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/**
 * O job está esperando o sinal do cliente? Ordem: quote em awaiting_payment espera;
 * pagamento visto (flag, finance_status pago ou parcial, livro) não espera; conta que
 * não cobra o cliente (B2B, plataforma) não espera; sinal combinado e não pago espera;
 * sem sinal combinado, só espera quem paga antes no cartão (card_upfront ou sem conta).
 * O livro entra porque `customer_deposit_paid` falha na reserva do site (JOB-9794).
 */
export function esperandoSinal(job: JobDoAlarme, ctx: ContextoDosAlarmes): boolean {
  if (ctx.quoteEsperandoSinal.has(job.id)) return true;
  const situacao = job.finance_status ?? job.payment_status ?? "";
  if (job.customer_deposit_paid === true || situacao === "paid" || situacao === "partial" || ctx.pagosNoLivro.has(job.id)) return false;
  const conta = job.account_id ? ctx.contas.get(job.account_id) ?? null : null;
  const tipo = tipoDaConta(conta ?? { id: job.account_id ?? null });
  const regras = tipo ? regrasDoProcesso(tipo, conta?.process_rules ?? null) : null;
  if (regras && !regras.cobraDoCliente) return false;
  if (num(job.customer_deposit) > 0) return true;
  return !conta || conta.collection_mode === "card_upfront";
}

/** Desde quando está em Unassigned: a última volta registrada, senão a criação do job. */
export function semParceiroDesde(job: JobDoAlarme, ctx: ContextoDosAlarmes): string {
  const volta = ctx.voltouParaUnassigned.get(job.id);
  return volta && ms(volta) > ms(job.created_at) ? volta : job.created_at;
}

/**
 * Os alarmes de agora, sem teto e sem trava (quem roda aplica os dois). Ignora job
 * apagado, cancelado, fora dos três status e sem mexida há mais de `diasDeJanela`.
 */
export function alarmesDosPortoes(jobs: JobDoAlarme[], ctx: ContextoDosAlarmes, agora: Date = new Date(), diasDeJanela = DIAS_DE_JANELA): Alarme[] {
  const t = agora.getTime();
  const limiteDaJanela = t - diasDeJanela * 86_400_000;
  const alarmes: Alarme[] = [];
  for (const job of jobs) {
    if (job.deleted_at || !(STATUS_DOS_ALARMES as readonly string[]).includes(job.status)) continue;
    if (!(ms(job.updated_at ?? job.created_at) >= limiteDaJanela)) continue;
    const ref = job.reference?.trim() || job.id.slice(0, 8);
    const base = { jobId: job.id, referencia: ref, ticketId: getZendeskTicketId(job) };
    const empurrar = (portao: Portao, desde: string, acao: string) => alarmes.push({ ...base, portao, desde, acao, chave: `${portao}:${job.id}:${desde}` });

    if (job.status === "unassigned") {
      const desde = semParceiroDesde(job, ctx);
      if (t - ms(desde) > HORAS_SEM_PARCEIRO * 3_600_000 && !esperandoSinal(job, ctx)) {
        empurrar("alocar", desde, `Allocate a partner: ${ref} has been unassigned for over ${HORAS_SEM_PARCEIRO}h and is not waiting for a deposit`);
      }
    } else if (job.status === "final_check") {
      // Sem carimbo (job de antes da 283), vale a última mexida: nunca mais cedo do que devia.
      const desde = job.final_check_at || job.updated_at || job.created_at;
      if (t - ms(desde) > HORAS_EM_FINAL_CHECK * 3_600_000) {
        empurrar("aprovar_report", desde, `Approve the final report: ${ref} has been in final check for over ${HORAS_EM_FINAL_CHECK}h`);
      }
    } else {
      // Scheduled ou Late (a lista de Jobs passa para Late quando o horário passa).
      // Só data, sem hora: não dá para dizer que atrasou 30 min, fica de fora.
      const inicio = job.scheduled_start_at;
      const comecou = !!job.partner_timer_started_at || job.start_report_submitted === true;
      if (!inicio || !job.partner_id || comecou || !Number.isFinite(ms(inicio))) continue;
      if (t - ms(inicio) > MINUTOS_SEM_COMECAR * 60_000) {
        empurrar("parceiro_parado", inicio, `Partner has not started: ${ref} was due at ${HORA_LONDRES.format(new Date(inicio))} (London). Call the partner`);
      }
    }
  }
  return alarmes;
}

// ─── Leitura (só select) ────────────────────────────────────────────────────

const CAMPOS_DO_JOB =
  "id, reference, status, deleted_at, created_at, updated_at, account_id, quote_id, partner_id, scheduled_start_at, final_check_at, partner_timer_started_at, start_report_submitted, customer_deposit, customer_deposit_paid, finance_status, payment_status, external_source, external_ref";

/** Lê o que `alarmesDosPortoes` precisa. Só leitura; erro de leitura sobe (a passada falha e a próxima tenta). */
export async function lerEntradaDosAlarmes(sb: SupabaseClient, agora: Date = new Date()): Promise<{ jobs: JobDoAlarme[]; ctx: ContextoDosAlarmes }> {
  const desde = new Date(agora.getTime() - DIAS_DE_JANELA * 86_400_000).toISOString();
  const { data, error } = await sb
    .from("jobs")
    .select(CAMPOS_DO_JOB)
    .is("deleted_at", null)
    .in("status", [...STATUS_DOS_ALARMES])
    .gte("updated_at", desde)
    .limit(2000);
  if (error) throw new Error(`jobs: ${error.message}`);
  const jobs = (data ?? []) as JobDoAlarme[];
  const semParceiro = jobs.filter((j) => j.status === "unassigned");
  const ids = semParceiro.map((j) => j.id);
  const ctx: ContextoDosAlarmes = { contas: new Map(), pagosNoLivro: new Set(), quoteEsperandoSinal: new Set(), voltouParaUnassigned: new Map() };
  if (!ids.length) return { jobs, ctx };

  const contaIds = [...new Set(semParceiro.map((j) => j.account_id).filter((x): x is string => !!x))];
  if (contaIds.length) {
    const { data: contas, error: e } = await sb.from("accounts").select("id, process_type, process_rules, collection_mode").in("id", contaIds);
    if (e) throw new Error(`accounts: ${e.message}`);
    for (const c of (contas ?? []) as ContaDoAlarme[]) ctx.contas.set(c.id, c);
  }

  // Sem a coluna deleted_at no livro, lê sem o filtro (como sinalPagoDoJob).
  const livro = (comDeleted: boolean) => {
    const q = sb.from("job_payments").select("job_id, amount").in("job_id", ids).in("type", ["customer_deposit", "customer_final"]);
    return comDeleted ? q.is("deleted_at", null) : q;
  };
  let pag = await livro(true);
  if (pag.error) pag = await livro(false);
  if (pag.error) throw new Error(`job_payments: ${pag.error.message}`);
  for (const p of (pag.data ?? []) as Array<{ job_id: string; amount: number | string | null }>) if (num(p.amount) > 0) ctx.pagosNoLivro.add(p.job_id);

  const quoteDoJob = new Map(semParceiro.filter((j) => j.quote_id).map((j) => [j.quote_id as string, j.id]));
  if (quoteDoJob.size) {
    const { data: qs, error: e } = await sb.from("quotes").select("id, status").in("id", [...quoteDoJob.keys()]);
    if (e) throw new Error(`quotes: ${e.message}`);
    for (const q of (qs ?? []) as Array<{ id: string; status: string | null }>) if (q.status === "awaiting_payment") ctx.quoteEsperandoSinal.add(quoteDoJob.get(q.id)!);
  }

  const { data: hist, error: eh } = await sb
    .from("audit_logs")
    .select("entity_id, created_at")
    .eq("entity_type", "job")
    .eq("field_name", "status")
    .eq("new_value", "unassigned")
    .in("entity_id", ids)
    .order("created_at", { ascending: false });
  if (eh) throw new Error(`audit_logs: ${eh.message}`);
  for (const h of (hist ?? []) as Array<{ entity_id: string; created_at: string }>) if (!ctx.voltouParaUnassigned.has(h.entity_id)) ctx.voltouParaUnassigned.set(h.entity_id, h.created_at);
  return { jobs, ctx };
}

// ─── A passada ──────────────────────────────────────────────────────────────

export type ResumoDaPassada =
  | { feito: "desligado" }
  | { feito: "ensaio" | "aplicado"; alarmes: Alarme[]; marcados: number; jaAvisados: number; semTicket: number; adiados: number; falhas: number };

/** Trava guardada some depois disso: o arquivo não cresce para sempre. */
const DIAS_DA_TRAVA = 30;

/**
 * Uma passada. Com ALARMES_PORTOES desligado, volta antes de ler qualquer coisa.
 * `travas` (chave → quando avisou) é alterado no lugar; quem chama grava.
 * Ticket fechado também trava (não adianta tentar de novo); falha de escrita não trava.
 */
export async function passadaDosAlarmes(
  deps: {
    env?: Record<string, string | undefined>;
    ler: () => Promise<{ jobs: JobDoAlarme[]; ctx: ContextoDosAlarmes }>;
    marcar: (ticketId: string, acao: string) => Promise<{ ok: boolean; linha: string }>;
    travas: Record<string, string>;
    log?: (linha: string) => void;
  },
  opts: { aplicar: boolean; agora?: Date; max?: number },
): Promise<ResumoDaPassada> {
  if (!alarmesLigados(deps.env)) return { feito: "desligado" };
  const agora = opts.agora ?? new Date();
  const log = deps.log ?? console.log;
  const max = opts.max ?? MAX_POR_PASSADA;
  for (const [k, quando] of Object.entries(deps.travas)) if (agora.getTime() - ms(quando) > DIAS_DA_TRAVA * 86_400_000) delete deps.travas[k];

  const { jobs, ctx } = await deps.ler();
  const alarmes = alarmesDosPortoes(jobs, ctx, agora);
  let marcados = 0, jaAvisados = 0, semTicket = 0, adiados = 0, falhas = 0;
  for (const a of alarmes) {
    if (deps.travas[a.chave]) {
      jaAvisados++;
      continue;
    }
    if (!a.ticketId) {
      semTicket++;
      log(`${a.referencia} [${a.portao}] sem ticket do Zendesk: ${a.acao}`);
      continue;
    }
    if (marcados + falhas >= max) {
      adiados++;
      log(`${a.referencia} [${a.portao}] adiado (teto de ${max} por passada): ${a.acao}`);
      continue;
    }
    if (!opts.aplicar) {
      marcados++;
      log(`${a.referencia} [${a.portao}] #${a.ticketId} marcaria: ${a.acao}`);
      continue;
    }
    const r = await deps.marcar(a.ticketId, a.acao);
    log(`${a.referencia} [${a.portao}] ${r.linha}`);
    if (r.ok) marcados++;
    else if (/falhou/.test(r.linha)) {
      falhas++;
      continue;
    }
    deps.travas[a.chave] = agora.toISOString();
  }
  return { feito: opts.aplicar ? "aplicado" : "ensaio", alarmes, marcados, jaAvisados, semTicket, adiados, falhas };
}
