import { renderToBuffer } from "@react-pdf/renderer";
import React from "react";
import { SelfBillPDF } from "@/lib/pdf/self-bill-template";
import { SELF_BILL_FINANCE_VOID_LABEL } from "@/lib/self-bill-display";
import { partnerFieldSelfBillPaymentDueDate } from "@/lib/self-bill-period";
import { isSupabaseMissingColumnError } from "@/lib/supabase-schema-compat";
import { loadSelfBillPayoutLines } from "@/services/self-bills";
import { selfBillJobCancellationFeeLine } from "@/lib/job-cancel-economics";
import {
  isJobApprovedForSelfBillPayout,
  isSelfBillPayoutVoided,
  selfBillJobPayoutStateLabel,
} from "@/services/self-bills";
import { parseFrontendSetup, resolveInvoiceStatementLogoUrl } from "@/lib/frontend-setup";
import { appBaseUrl } from "@/lib/app-base-url";
import {
  DEFAULT_INVOICE_PDF_LOGO_URL,
  readPublicLogoDataUri,
  resolveLogoDataUri,
} from "@/lib/pdf/resolve-logo-data-uri";
import type { Job, SelfBill } from "@/types/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { agentModelEnabled, resolveWorkSchedules, type WorkSchedule } from "@/lib/agent-model/schedule";
import { platformBookingCommission } from "@/lib/agent-model/commission";
import type { SelfBillAgentSummary } from "@/lib/agent-model/commission-invoice";
import type { SelfBillPdfLine } from "@/lib/pdf/self-bill-template";

/** A wordmark branca em `public/`, usada quando a busca remota não responde. */
const SELF_BILL_LOCAL_LOGO = "logos/fixfy-wordmark-white-trim.png";

export async function resolveSelfBillPdfLogoUrl(supabase: SupabaseClient): Promise<string | undefined> {
  const { data: company } = await supabase
    .from("company_settings")
    .select("logo_url, frontend_setup")
    .limit(1)
    .maybeSingle();
  const companyRow = company as { logo_url?: string | null; frontend_setup?: unknown } | null;
  const setup = parseFrontendSetup(companyRow?.frontend_setup);
  const logoSource =
    resolveInvoiceStatementLogoUrl(setup, companyRow?.logo_url) || DEFAULT_INVOICE_PDF_LOGO_URL;
  /**
   * Falha de rede não pode custar o logo do documento.
   *
   * `resolveLogoDataUri` busca a imagem remota com 4s de timeout e devolve
   * `undefined` quando não consegue. Sem o `??`, o self-bill saía com a marca
   * escrita em texto no lugar do logo, e foi o que aconteceu num render aqui.
   * A fatura já cai no arquivo de `public/` nesse caso; o self-bill não caía.
   */
  return (
    (await resolveLogoDataUri(logoSource)) ?? readPublicLogoDataUri(SELF_BILL_LOCAL_LOGO) ?? undefined
  );
}

/**
 * A wordmark BRANCA para o rodapé navy.
 *
 * A do cabeçalho não serve: ela é a marca sobre fundo claro, e sobre o navy do
 * rodapé sairia invisível ou com halo. `fixfy-wordmark-white-trim.png` é a
 * versão oficial para fundo escuro.
 */
export async function resolveSelfBillFooterLogo(): Promise<string | undefined> {
  return (
    (await resolveLogoDataUri(`${appBaseUrl()}/logos/${SELF_BILL_LOCAL_LOGO.split("/").pop()}`)) ??
    readPublicLogoDataUri(SELF_BILL_LOCAL_LOGO) ??
    undefined
  );
}

export async function renderSelfBillPdfBuffer(
  supabase: SupabaseClient,
  selfBillId: string,
  options?: { commissionInvoiceRef?: string | null },
): Promise<
  { buffer: Buffer; sb: SelfBill; agent: SelfBillAgentSummary | null } | { error: string; status: number }
> {
  const { data: sbRow, error } = await supabase.from("self_bills").select("*").eq("id", selfBillId).single();
  if (error || !sbRow) {
    return { error: "Self-bill not found", status: 404 };
  }
  const sb = sbRow as SelfBill;

  const jobsFull = await supabase
    .from("jobs")
    .select(
      "id, reference, title, partner_cost, materials_cost, property_address, scheduled_date, status, deleted_at, partner_cancelled_at, cancellation_fee_partner_gbp, partner_cancellation_fee, partner_cancellation_compensation_gbp, client_id, client_price, extras_amount, created_at",
    )
    .eq("self_bill_id", selfBillId)
    .order("reference", { ascending: true });
  let jobs: Record<string, unknown>[] | null = (jobsFull.data ?? null) as Record<string, unknown>[] | null;
  let jobsErr = jobsFull.error;
  if (jobsErr && isSupabaseMissingColumnError(jobsErr)) {
    const jobsLegacy = await supabase
      .from("jobs")
      .select("id, reference, title, partner_cost, materials_cost, property_address, status, deleted_at")
      .eq("self_bill_id", selfBillId)
      .order("reference", { ascending: true });
    jobs = (jobsLegacy.data ?? null) as Record<string, unknown>[] | null;
    jobsErr = jobsLegacy.error;
  }
  if (jobsErr) {
    return { error: "Could not load jobs for self-bill", status: 500 };
  }

  /**
   * Modelo de agente: Schedule A ou B por job. Folha interna nunca entra, e
   * com o modelo desligado tudo é B e o documento sai como sempre.
   */
  const agentOn = agentModelEnabled() && sb.bill_origin !== "internal";
  const scheduleByJob: Map<string, WorkSchedule> = agentOn
    ? await resolveWorkSchedules(
        supabase,
        (jobs ?? []).map((j) => ({
          id: String(j.id ?? ""),
          client_id: (j.client_id as string | null | undefined) ?? null,
          created_at: (j.created_at as string | null | undefined) ?? null,
        })),
      )
    : new Map();
  const lateWithdrawalFees: SelfBillAgentSummary["lateWithdrawalFees"] = [];

  const lines: SelfBillPdfLine[] = (jobs ?? []).flatMap((j: Record<string, unknown>): SelfBillPdfLine[] => {
    const row = j as Pick<
      Job,
      | "id"
      | "reference"
      | "title"
      | "partner_cost"
      | "materials_cost"
      | "property_address"
      | "status"
      | "deleted_at"
      | "partner_cancelled_at"
      | "cancellation_fee_partner_gbp"
      | "partner_cancellation_fee"
      | "partner_cancellation_compensation_gbp"
    >;
    const note = selfBillJobPayoutStateLabel(row);
    const feeLine = selfBillJobCancellationFeeLine(row);
    const schedule: WorkSchedule = scheduleByJob.get(String(j.id ?? "")) ?? "B";
    if (agentOn && feeLine?.kind === "clawback") {
      lateWithdrawalFees.push({
        reference: String(j.reference ?? ""),
        doneOn: j.scheduled_date ? String(j.scheduled_date).slice(0, 10) : undefined,
        amount: Math.abs(feeLine.signedAmount),
      });
    }
    /**
     * `sozinha` = o job não aparece por si só, então esta linha é tudo o que o
     * parceiro vai ver dele, e precisa carregar o endereço e a data. Quando
     * vem embaixo da linha do job, os dois ficam vazios para não repetir.
     */
    const montarLinhaDeTaxa = (sozinha: boolean) =>
      feeLine
        ? {
            reference: String(j.reference ?? ""),
            title: feeLine.label,
            partner_cost: feeLine.signedAmount,
            materials_cost: 0,
            property_address:
              sozinha && j.property_address ? String(j.property_address) : undefined,
            doneOn:
              sozinha && j.scheduled_date ? String(j.scheduled_date).slice(0, 10) : undefined,
            payoutStateNote: feeLine.kind === "clawback" ? "Clawback" : "Compensation",
            schedule,
          }
        : null;

    /**
     * A tabela lista EXATAMENTE o que forma o total do rodapé.
     *
     * `isJobApprovedForSelfBillPayout` é o mesmo filtro que
     * `recomputeSelfBillTotals` usa para somar `net_payout`. Usar outro critério
     * aqui é o que produzia documentos onde a coluna não fecha com o "Total
     * payout": medido em 20/08/2026, 6 dos 10 self-bills abertos. Os piores:
     *
     *   G&M Services     linhas £1.055  ·  rodapé £430
     *   TM Handyman      linhas £1.075  ·  rodapé £372
     *
     * Entravam duas coisas que o total (com razão) não paga: job cancelado sem
     * dinheiro nenhum, e job ainda não entregue (`final_check`, `in_progress`),
     * que passa para a quinzena seguinte. Num documento fiscal, uma coluna que
     * não soma o próprio rodapé é a primeira coisa que o parceiro contesta.
     *
     * Cancelamento COM dinheiro continua aparecendo: entra pela linha da taxa,
     * que já traz o motivo no rótulo ("(Cancelled - Compensation)").
     */
    if (!isJobApprovedForSelfBillPayout(row)) {
      const sozinha = montarLinhaDeTaxa(true);
      return sozinha ? [sozinha] : [];
    }

    /**
     * Material entra no valor da linha em vez de ficar numa coluna própria.
     *
     * `net_payout` é `job_value + materials`, então material fora da coluna é
     * dinheiro que o rodapé cobra e a tabela não mostra: o JOB-9368 tem £65 de
     * mão de obra e £40 de material, e o parceiro via £65 numa fatura de £105.
     */
    const base = {
      reference: String(j.reference ?? ""),
      title: String(j.title ?? ""),
      partner_cost: (Number(j.partner_cost) || 0) + (Number(j.materials_cost) || 0),
      materials_cost: 0,
      property_address: j.property_address ? String(j.property_address) : undefined,
      // A data em que o trabalho foi feito, no lugar do UUID: o parceiro
      // reconhece o job pelo dia, nunca por um identificador de 36 caracteres.
      doneOn: j.scheduled_date ? String(j.scheduled_date).slice(0, 10) : undefined,
      payoutStateNote: note ?? undefined,
      schedule,
    };

    /**
     * Schedule A: o job aparece pelo valor cheio (preço do cliente), com a
     * comissão da Fixfy e o líquido do parceiro. O líquido é EXATAMENTE o que a
     * linha já pagava: a comissão é conta para o documento, nunca muda payout.
     */
    if (schedule === "A") {
      const c = platformBookingCommission({
        clientPrice: Number(j.client_price) || 0,
        extrasAmount: Number(j.extras_amount) || 0,
        partnerCost: Number(j.partner_cost) || 0,
        materialsCost: Number(j.materials_cost) || 0,
      });
      Object.assign(base, {
        customerPrice: c.customerPrice,
        commission: c.commission,
        commissionFlag: c.flagged,
        commissionShortfall: c.shortfall,
      });
    }

    const embaixo = montarLinhaDeTaxa(false);
    return embaixo ? [base, embaixo] : [base];
  });

  /**
   * Linhas de VISITA (mig 161).
   *
   * Uma visita de outro parceiro tem documento próprio; as que estão neste
   * documento vêm de `loadSelfBillPayoutLines`, a MESMA função que soma o
   * `net_payout`. O PDF não consulta por conta própria: foi consulta paralela
   * que produziu linhas de £1.055 num rodapé de £430.
   */
  const visitPayoutLines = (await loadSelfBillPayoutLines(selfBillId, supabase)).filter((l) => l.kind === "visit");
  if (visitPayoutLines.length > 0) {
    const parentIds = [...new Set(visitPayoutLines.map((l) => l.jobId))];
    const { data: parents } = await supabase
      .from("jobs")
      .select("id, reference, property_address, client_id, created_at")
      .in("id", parentIds);
    type ParentRow = {
      id: string;
      reference: string | null;
      property_address: string | null;
      client_id?: string | null;
      created_at?: string | null;
    };
    const parentById = new Map(((parents ?? []) as ParentRow[]).map((p) => [p.id, p]));
    const parentSchedule: Map<string, WorkSchedule> = agentOn
      ? await resolveWorkSchedules(
          supabase,
          ((parents ?? []) as ParentRow[]).map((p) => ({
            id: p.id,
            client_id: p.client_id ?? null,
            created_at: p.created_at ?? null,
          })),
        )
      : new Map();
    const { data: visitRows } = await supabase
      .from("job_visits")
      .select("id, scheduled_date, completed_at, scope, client_price")
      .in("id", visitPayoutLines.map((l) => l.id));
    const visitById = new Map(
      ((visitRows ?? []) as {
        id: string;
        scheduled_date: string | null;
        completed_at: string | null;
        scope: string | null;
        client_price?: number | null;
      }[]).map((v) => [v.id, v]),
    );
    for (const l of visitPayoutLines) {
      const parent = parentById.get(l.jobId);
      const v = visitById.get(l.id);
      const visitSchedule: WorkSchedule = parentSchedule.get(l.jobId) ?? "B";
      const visitLine: SelfBillPdfLine = {
        reference: `${parent?.reference ?? ""} · Visit ${l.visitIndex ?? ""}`.trim(),
        title: v?.scope?.trim() || "Extra visit",
        partner_cost: l.labour + l.materials,
        materials_cost: 0,
        property_address: parent?.property_address ?? undefined,
        doneOn: (v?.completed_at ?? v?.scheduled_date ?? "")?.slice(0, 10) || undefined,
        payoutStateNote: undefined,
        schedule: visitSchedule,
      };
      if (visitSchedule === "A") {
        const c = platformBookingCommission({
          clientPrice: Number(v?.client_price) || 0,
          partnerCost: l.labour,
          materialsCost: l.materials,
        });
        visitLine.customerPrice = c.customerPrice;
        visitLine.commission = c.commission;
        visitLine.commissionFlag = c.flagged;
        visitLine.commissionShortfall = c.shortfall;
      }
      lines.push(visitLine);
    }
  }

  const voided = isSelfBillPayoutVoided({ status: sb.status });
  const billOrigin = sb.bill_origin;
  const weekEndStr = sb.week_end ?? "";
  const paymentDueDate =
    billOrigin !== "internal" && weekEndStr.trim()
      ? partnerFieldSelfBillPaymentDueDate(weekEndStr.trim())
      : undefined;

  const breakdown = sb.payout_breakdown;
  const internalBreakdown =
    billOrigin === "internal" && breakdown
      ? {
          fixedPay: Number(breakdown.fixed_pay) || 0,
          commissionAmount: Number(breakdown.commission_amount) || 0,
          commissionBasis: breakdown.commission_basis ?? null,
          commissionRatePercent: breakdown.commission_rate_percent ?? null,
          basisTotal: breakdown.basis_total,
          jobs: (breakdown.jobs ?? []).map((j) => ({
            reference: j.reference,
            revenue: j.revenue,
            grossProfit: j.gross_profit,
            commission: j.commission,
          })),
        }
      : undefined;

  const pdfLines =
    internalBreakdown?.jobs?.length
      ? internalBreakdown.jobs.map((j) => ({
          reference: j.reference,
          title: "Owner job commission",
          partner_cost: j.commission,
          materials_cost: 0,
          property_address: undefined,
        }))
      : lines;

  const agent: SelfBillAgentSummary | null = agentOn
    ? {
        platformLines: lines
          .filter((l) => l.schedule === "A" && l.customerPrice != null)
          .map((l) => ({
            reference: l.reference,
            doneOn: l.doneOn,
            title: l.title,
            customerPrice: l.customerPrice ?? 0,
            commission: l.commission ?? 0,
            partnerNet: l.partner_cost,
            flagged: l.commissionFlag === true,
            shortfall: l.commissionShortfall ?? 0,
          })),
        lateWithdrawalFees,
        hasPlatformBookings: lines.some((l) => l.schedule === "A"),
        hasClientWork: lines.some((l) => l.schedule !== "A"),
      }
    : null;

  const logoUrl = await resolveSelfBillPdfLogoUrl(supabase);
  const footerLogoUrl = await resolveSelfBillFooterLogo();

  const buffer = await renderToBuffer(
    <SelfBillPDF
      data={{
        reference: sb.reference,
        partnerName: sb.partner_name,
        weekLabel: sb.week_label ?? undefined,
        weekStart: sb.week_start ?? undefined,
        weekEnd: weekEndStr || undefined,
        paymentDueDate,
        period: sb.period,
        jobsCount: Number(sb.jobs_count) || 0,
        jobValue: Number(sb.job_value) || 0,
        materials: Number(sb.materials) || 0,
        commission: Number(sb.commission) || 0,
        netPayout: Number(sb.net_payout) || 0,
        status: String(sb.status),
        lines: pdfLines,
        originalNetPayout: sb.original_net_payout ?? null,
        payoutVoidReason: sb.payout_void_reason ?? null,
        partnerStatusLabel: sb.partner_status_label ?? null,
        financeStatusLabel: voided ? SELF_BILL_FINANCE_VOID_LABEL : null,
        payoutVoided: voided,
        billOrigin: billOrigin ?? undefined,
        internalBreakdown,
        logoUrl,
        footerLogoUrl,
        commissionInvoiceRef: options?.commissionInvoiceRef ?? null,
      }}
    />,
  );

  return { buffer: Buffer.from(buffer), sb, agent };
}
