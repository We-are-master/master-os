/**
 * Resumo do dia para o JARVIS, o assistente local do dono (voz, no Mac dele).
 *
 * Só LÊ. Nada aqui grava, e a rota que usa isto tem chave própria
 * (`JARVIS_READ_API_KEY`), separada das chaves de escrita de jobs e quotes.
 *
 * As contas são escritas aqui, de propósito, e não pegas do
 * `master-brain-metrics`: foi dele que saíram os números errados que
 * desligaram o brief diário em 05/10. O que já é regra de tela vem da tela:
 * o "a receber" usa `isInvoiceCollectible` + `invoiceListBalanceDue`, os
 * mesmos do Billing, para o JARVIS nunca dizer um número que o OS não mostra.
 *
 * "Hoje" é o dia de Londres. O servidor roda em UTC e o helper da tela usa o
 * relógio do navegador, então o dia é fixado aqui.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getZonedWallClock } from "@/lib/wall-clock-tz";
import {
  invoiceListBalanceDue,
  isInvoiceCollectible,
  type InvoiceListJobSnapshot,
} from "@/lib/billing-invoice-list-data";
import { invoiceDueYmd } from "@/lib/billing-standalone-period";
import { isLegacyMisclassifiedCustomerPayment } from "@/lib/job-payment-ledger";
import type { Invoice } from "@/types/database";

const TZ = "Europe/London";
const CHUNK = 100;

export function hojeLondres(agora = new Date()): string {
  return getZonedWallClock(agora, TZ).ymd;
}

export function somarDias(ymd: string, dias: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + dias)).toISOString().slice(0, 10);
}

/** Meia-noite de Londres daquele dia, em UTC (Londres é UTC+0 ou UTC+1). */
export function inicioDoDiaLondres(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const meiaNoiteUtc = Date.UTC(y, m - 1, d);
  const relogio = getZonedWallClock(new Date(meiaNoiteUtc), TZ);
  const desvioHoras = relogio.ymd === ymd ? relogio.hour : 0;
  return new Date(meiaNoiteUtc - desvioHoras * 3_600_000).toISOString();
}

/** Segunda-feira da semana de `ymd`. */
export function inicioDaSemana(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const diaDaSemana = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = domingo
  return somarDias(ymd, -((diaDaSemana + 6) % 7));
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const dataEntre = (ymd: string, de: string, ate: string) => !!ymd && ymd >= de && ymd <= ate;

type Conversa = {
  estado: string;
  tipo: string | null;
  criado_em: string;
  atualizado_em: string;
  passou_em: string | null;
  checkout_at: string | null;
  checkout_total: number | null;
  checkout_sinal: number | null;
  sinal_recebido_em: string | null;
  job_ids: string[] | null;
};

type FaturaPaga = {
  job_reference: string | null;
  amount: number | null;
  amount_paid: number | null;
  paid_date: string | null;
  status: string;
};

/** `dia` (YYYY-MM-DD) consulta um dia passado; sem ele, é hoje em Londres. */
export async function montarResumoJarvis(supabase: SupabaseClient, agora = new Date(), dia?: string) {
  const hoje = dia ?? hojeLondres(agora);
  const amanha = somarDias(hoje, 1);
  const segunda = inicioDaSemana(hoje);
  const iniHoje = inicioDoDiaLondres(hoje);
  const iniSemana = inicioDoDiaLondres(segunda);
  /** Fim do dia consultado: com `?dia=` no passado, nada depois dele entra na conta. */
  const fim = inicioDoDiaLondres(amanha);
  const desde = (iso: string | null | undefined, inicio: string) => !!iso && iso >= inicio && iso < fim;

  const [conversasRes, pagamentosRes, jobsRes, emCampoRes, quotesRes, leadsRes] = await Promise.all([
    supabase
      .from("harvey_wa_conversas")
      .select(
        "estado, tipo, criado_em, atualizado_em, passou_em, checkout_at, checkout_total, checkout_sinal, sinal_recebido_em, job_ids",
      )
      .or(
        `criado_em.gte.${iniSemana},checkout_at.gte.${iniSemana},sinal_recebido_em.gte.${iniSemana},` +
          `passou_em.gte.${iniSemana},atualizado_em.gte.${iniSemana}`,
      ),
    /**
     * "Recebido" vem da FATURA paga (paid_date), não do ledger `job_payments`:
     * marcar a fatura como paga no Billing não cria linha no ledger. Conferido
     * em 07/10/2026: 02/10 teve 10 faturas pagas (£1.557,60) e 0 linhas no ledger.
     */
    supabase
      .from("invoices")
      .select("job_reference, amount, amount_paid, paid_date, status")
      .is("deleted_at", null)
      .in("status", ["paid", "partially_paid"])
      .gte("paid_date", segunda),
    supabase
      .from("jobs")
      .select("reference, title, status, partner_name, client_name, scheduled_date, scheduled_start_at")
      .in("scheduled_date", [hoje, amanha])
      .is("deleted_at", null)
      .not("status", "in", '("cancelled","deleted")')
      .order("scheduled_start_at", { ascending: true }),
    supabase
      .from("jobs")
      .select("reference, title, status, partner_name")
      .in("status", ["in_progress", "late", "need_attention"])
      .is("deleted_at", null),
    supabase
      .from("quotes")
      .select("status, total_value, sell_price, external_source, created_at, customer_accepted")
      .is("deleted_at", null)
      .not("status", "in", '("rejected","converted_to_job")'),
    supabase.from("site_leads").select("status, channel, created_at").gte("created_at", iniSemana).lt("created_at", fim),
  ]);
  for (const r of [conversasRes, pagamentosRes, jobsRes, emCampoRes, quotesRes, leadsRes]) {
    if (r.error) throw r.error;
  }

  // ---- Harvey (WhatsApp)
  const conversas = (conversasRes.data ?? []) as Conversa[];
  const harvey = (inicio: string) => {
    const links = conversas.filter((c) => desde(c.checkout_at, inicio));
    return {
      conversas_novas: conversas.filter((c) => desde(c.criado_em, inicio)).length,
      links_de_reserva: links.length,
      valor_dos_links: r2(links.reduce((s, c) => s + Number(c.checkout_total ?? 0), 0)),
      sinais_pedidos: r2(links.reduce((s, c) => s + Number(c.checkout_sinal ?? 0), 0)),
      sinais_por_transferencia_recebidos: conversas.filter((c) => desde(c.sinal_recebido_em, inicio)).length,
      passadas_pra_equipe: conversas.filter((c) => desde(c.passou_em, inicio)).length,
    };
  };
  const idsDoHarvey = [...new Set(conversas.flatMap((c) => c.job_ids ?? []))];
  const refsDoHarvey = new Set<string>();
  for (let i = 0; i < idsDoHarvey.length; i += CHUNK) {
    const { data, error } = await supabase.from("jobs").select("reference").in("id", idsDoHarvey.slice(i, i + CHUNK));
    if (error) throw error;
    for (const j of data ?? []) if (j.reference) refsDoHarvey.add(j.reference.trim());
  }

  // ---- Dinheiro que entrou de cliente: faturas pagas na data
  const pagas = (pagamentosRes.data ?? []) as FaturaPaga[];
  const entrou = (inicio: string, filtro: (f: FaturaPaga) => boolean = () => true) =>
    r2(
      pagas
        .filter((f) => dataEntre((f.paid_date ?? "").slice(0, 10), inicio, hoje) && filtro(f))
        .reduce((s, f) => s + Number(f.status === "paid" ? f.amount_paid || f.amount || 0 : f.amount_paid || 0), 0),
    );
  const doHarvey = (f: FaturaPaga) => !!f.job_reference && refsDoHarvey.has(f.job_reference.trim());

  // ---- A receber: mesma regra da aba Ready to receive
  const aReceber = await calcularAReceber(supabase, hoje);

  // ---- Quotes abertas por etapa
  const porEtapa: Record<string, { quantidade: number; valor: number }> = {};
  for (const q of quotesRes.data ?? []) {
    const e = (porEtapa[q.status] ??= { quantidade: 0, valor: 0 });
    e.quantidade += 1;
    e.valor = r2(e.valor + Number(q.sell_price || q.total_value || 0));
  }

  // ---- Leads da semana
  const leads = leadsRes.data ?? [];
  const porCanal: Record<string, number> = {};
  for (const l of leads.filter((l) => desde(l.created_at, iniHoje))) porCanal[l.channel ?? "site"] = (porCanal[l.channel ?? "site"] ?? 0) + 1;

  const jobs = jobsRes.data ?? [];
  const linhaJob = (j: (typeof jobs)[number]) => ({
    ref: j.reference,
    titulo: j.title,
    status: j.status,
    parceiro: j.partner_name ?? null,
    cliente: j.client_name,
    inicio: j.scheduled_start_at ?? null,
  });

  return {
    gerado_em: agora.toISOString(),
    dia_londres: hoje,
    semana_desde: segunda,
    harvey: {
      hoje: harvey(iniHoje),
      semana: harvey(iniSemana),
      agora: {
        conversando_com_harvey: conversas.filter((c) => c.estado === "harvey" && desde(c.atualizado_em, iniHoje)).length,
        com_a_equipe: conversas.filter((c) => c.estado === "equipe").length,
      },
      recebido_dos_jobs_do_harvey: {
        hoje: entrou(hoje, doHarvey),
        semana: entrou(segunda, doHarvey),
      },
    },
    dinheiro: {
      recebido_de_clientes: {
        hoje: entrou(hoje),
        semana: entrou(segunda),
        faturas_pagas_hoje: pagas.filter((f) => dataEntre((f.paid_date ?? "").slice(0, 10), hoje, hoje)).length,
        faturas_pagas_semana: pagas.filter((f) => dataEntre((f.paid_date ?? "").slice(0, 10), segunda, hoje)).length,
      },
      a_receber: aReceber,
    },
    operacao: {
      jobs_hoje: jobs.filter((j) => j.scheduled_date === hoje).map(linhaJob),
      jobs_amanha: jobs.filter((j) => j.scheduled_date === amanha).map(linhaJob),
      em_campo_ou_atencao: (emCampoRes.data ?? []).map((j) => ({
        ref: j.reference,
        titulo: j.title,
        status: j.status,
        parceiro: j.partner_name ?? null,
      })),
    },
    funil: {
      quotes_abertas_por_etapa: porEtapa,
      leads: {
        hoje: leads.filter((l) => desde(l.created_at, iniHoje)).length,
        semana: leads.length,
        hoje_por_canal: porCanal,
        novos_sem_contato_na_semana: leads.filter((l) => l.status === "new").length,
      },
    },
  };
}

/** Mesmo cálculo da aba Ready to receive do Billing, com o cliente de servidor. */
async function calcularAReceber(supabase: SupabaseClient, hoje: string) {
  const invoices: Invoice[] = [];
  for (let from = 0; from < 100_000; from += 1000) {
    const { data, error } = await supabase
      .from("invoices")
      .select("*")
      .is("deleted_at", null)
      .not("status", "in", '("cancelled","paid")')
      .range(from, from + 999);
    if (error) throw error;
    invoices.push(...((data ?? []) as Invoice[]));
    if (!data || data.length < 1000) break;
  }

  const refs = [...new Set(invoices.map((i) => i.job_reference?.trim()).filter((x): x is string => !!x))];
  const jobsByRef: Record<string, InvoiceListJobSnapshot> = {};
  for (let i = 0; i < refs.length; i += CHUNK) {
    const { data, error } = await supabase
      .from("jobs")
      .select(
        "id, reference, status, scheduled_date, scheduled_start_at, completed_date, scheduled_finish_date, scheduled_end_at, property_address, title, billed_hours, client_name",
      )
      .in("reference", refs.slice(i, i + CHUNK));
    if (error) throw error;
    for (const row of data ?? []) {
      const ref = (row.reference ?? "").trim();
      if (ref && row.status && row.id) jobsByRef[ref] = row as InvoiceListJobSnapshot;
    }
  }

  const jobIds = Object.values(jobsByRef).map((j) => j.id);
  const pagoPorJob: Record<string, number> = Object.fromEntries(jobIds.map((id) => [id, 0]));
  for (let i = 0; i < jobIds.length; i += CHUNK) {
    const { data, error } = await supabase
      .from("job_payments")
      .select("job_id, amount, type, note")
      .in("job_id", jobIds.slice(i, i + CHUNK))
      .in("type", ["customer_deposit", "customer_final"])
      .is("deleted_at", null);
    if (error) throw error;
    for (const p of data ?? []) {
      if (isLegacyMisclassifiedCustomerPayment(p)) continue;
      pagoPorJob[p.job_id] = (pagoPorJob[p.job_id] ?? 0) + Number(p.amount ?? 0);
    }
  }

  const linhas = invoices
    .filter((inv) => isInvoiceCollectible(inv, jobsByRef, hoje))
    .map((inv) => ({
      cliente: inv.client_name ?? null,
      ref: inv.reference ?? null,
      job: inv.job_reference ?? null,
      devido: r2(invoiceListBalanceDue(inv, jobsByRef, pagoPorJob)),
      vence: invoiceDueYmd(inv) || null,
    }))
    .filter((l) => l.devido > 0.02);
  const vencidas = linhas.filter((l) => l.vence && l.vence < hoje);

  return {
    total: r2(linhas.reduce((s, l) => s + l.devido, 0)),
    faturas: linhas.length,
    vencido: r2(vencidas.reduce((s, l) => s + l.devido, 0)),
    faturas_vencidas: vencidas.length,
    maiores: [...linhas].sort((a, b) => b.devido - a.devido).slice(0, 8),
  };
}
