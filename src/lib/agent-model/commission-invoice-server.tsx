/**
 * Emitir, achar e renderizar a fatura de VAT da comissão (Schedule A).
 *
 * O NÚMERO só nasce no envio do payout statement (`issueCommissionVatInvoice`),
 * pela sequence da tabela `commission_vat_invoices` (migration 313). Depois de
 * emitida a fatura não muda: reenviar o mesmo payout reaproveita número, data e
 * linhas gravadas. A prévia (`renderCommissionVatInvoicePdf` sem fatura) sai
 * como DRAFT e nunca consome número.
 *
 * Sem a migration 313 aplicada, emitir devolve erro com `missingTable` e quem
 * envia segue sem o anexo, avisando: payout não para por causa da fatura.
 */
import { renderToBuffer } from "@react-pdf/renderer";
import React from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SelfBill } from "@/types/database";
import {
  CommissionVatInvoicePDF,
  type CommissionVatInvoicePdfData,
} from "@/lib/pdf/commission-vat-invoice-template";
import { resolveSelfBillFooterLogo, resolveSelfBillPdfLogoUrl } from "@/lib/self-bill-pdf-server";
import { FIXFY_LEGAL_ENTITY } from "./commission";
import {
  commissionInvoiceTotals,
  type CommissionInvoiceLine,
  type CommissionInvoiceTotals,
} from "./commission-invoice";
import { receiptPartyFromPartner } from "./receipt-party";

export type IssuedCommissionInvoice = CommissionInvoiceTotals & {
  id: string;
  reference: string;
  invoiceNumber: number;
  issueDate: string;
  lines: CommissionInvoiceLine[];
};

type Row = {
  id: string;
  invoice_number: number | string;
  reference: string | null;
  issue_date: string;
  total_inc_vat: number | string;
  vat_amount: number | string;
  net_amount: number | string;
  vat_rate: number | string | null;
  lines: unknown;
};

const SELECT = "id, invoice_number, reference, issue_date, total_inc_vat, vat_amount, net_amount, vat_rate, lines";

/** A tabela (ou o cache do PostgREST) ainda não conhece `commission_vat_invoices`. */
export function isMissingCommissionInvoiceTable(err: unknown): boolean {
  const o = (err ?? {}) as { code?: unknown; message?: unknown };
  const code = String(o.code ?? "");
  const msg = String(o.message ?? "");
  if (code === "42P01" || code === "PGRST205") return true;
  return /commission_vat_invoices/.test(msg) && /(does not exist|could not find|schema cache)/i.test(msg);
}

function fromRow(r: Row): IssuedCommissionInvoice {
  const n = Number(r.invoice_number) || 0;
  return {
    id: r.id,
    invoiceNumber: n,
    reference: r.reference?.trim() || `FXC-${String(n).padStart(6, "0")}`,
    issueDate: String(r.issue_date).slice(0, 10),
    totalIncVat: Number(r.total_inc_vat) || 0,
    vatAmount: Number(r.vat_amount) || 0,
    netAmount: Number(r.net_amount) || 0,
    vatRatePct: Number(r.vat_rate ?? 20) || 20,
    lines: Array.isArray(r.lines) ? (r.lines as CommissionInvoiceLine[]) : [],
  };
}

export async function findCommissionVatInvoice(
  supabase: SupabaseClient,
  selfBillId: string,
): Promise<{ invoice: IssuedCommissionInvoice | null } | { error: string; missingTable: boolean }> {
  const { data, error } = await supabase
    .from("commission_vat_invoices")
    .select(SELECT)
    .eq("self_bill_id", selfBillId)
    .maybeSingle();
  if (error) return { error: error.message, missingTable: isMissingCommissionInvoiceTable(error) };
  return { invoice: data ? fromRow(data as Row) : null };
}

/**
 * Emite (ou devolve a já emitida) a fatura deste payout statement.
 * `changed` = a fatura gravada não bate com as linhas de agora (payout mexido
 * depois do primeiro envio): ela continua valendo, e quem chama avisa.
 */
export async function issueCommissionVatInvoice(
  supabase: SupabaseClient,
  input: { selfBillId: string; partnerId: string | null; lines: CommissionInvoiceLine[] },
): Promise<
  { invoice: IssuedCommissionInvoice; created: boolean; changed: boolean } | { error: string; missingTable: boolean }
> {
  const totals = commissionInvoiceTotals(input.lines);
  const sameAsNow = (inv: IssuedCommissionInvoice) => Math.abs(inv.totalIncVat - totals.totalIncVat) < 0.005;

  const existing = await findCommissionVatInvoice(supabase, input.selfBillId);
  if ("error" in existing) return existing;
  if (existing.invoice) {
    return { invoice: existing.invoice, created: false, changed: !sameAsNow(existing.invoice) };
  }

  const { data, error } = await supabase
    .from("commission_vat_invoices")
    .insert({
      self_bill_id: input.selfBillId,
      partner_id: input.partnerId,
      total_inc_vat: totals.totalIncVat,
      vat_amount: totals.vatAmount,
      net_amount: totals.netAmount,
      vat_rate: totals.vatRatePct,
      lines: input.lines,
    })
    .select(SELECT)
    .single();
  if (error) {
    // Dois envios ao mesmo tempo: o outro ganhou a corrida, vale o dele.
    if (String((error as { code?: unknown }).code ?? "") === "23505") {
      const again = await findCommissionVatInvoice(supabase, input.selfBillId);
      if ("error" in again) return again;
      if (again.invoice) return { invoice: again.invoice, created: false, changed: !sameAsNow(again.invoice) };
    }
    return { error: error.message, missingTable: isMissingCommissionInvoiceTable(error) };
  }
  return { invoice: fromRow(data as Row), created: true, changed: false };
}

function fmtPeriodDate(ymd?: string | null): string | null {
  const raw = (ymd ?? "").trim();
  if (!raw) return null;
  const d = new Date(raw.length === 10 ? `${raw}T12:00:00Z` : raw);
  if (Number.isNaN(d.getTime())) return raw.slice(0, 10);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/**
 * Renderiza a fatura. Com `invoice`, a emitida (número, data e linhas
 * gravadas); sem, uma prévia DRAFT com as linhas de agora.
 */
export async function renderCommissionVatInvoicePdf(
  supabase: SupabaseClient,
  input: { sb: SelfBill; invoice?: IssuedCommissionInvoice | null; draftLines?: CommissionInvoiceLine[] },
): Promise<Buffer> {
  const { sb } = input;
  let partnerName = sb.partner_name?.trim() || "Partner";
  let partnerAddress: string | null = null;
  let partnerVat: string | null = null;
  if (sb.partner_id) {
    const { data } = await supabase
      .from("partners")
      .select("company_name, contact_name, partner_address, vat_number, vat_registered")
      .eq("id", sb.partner_id)
      .maybeSingle();
    const party = receiptPartyFromPartner(data as Parameters<typeof receiptPartyFromPartner>[0]);
    partnerName = party.professionalName ?? partnerName;
    // TODO(agent-model): sem endereço comercial no cadastro, a fatura sai só com o nome.
    partnerAddress = party.businessAddress;
    partnerVat = party.vatNumber;
  }

  const lines = input.invoice?.lines ?? input.draftLines ?? [];
  const totals = input.invoice ?? commissionInvoiceTotals(lines);
  const start = fmtPeriodDate(sb.week_start);
  const end = fmtPeriodDate(sb.week_end);

  const data: CommissionVatInvoicePdfData = {
    invoiceReference: input.invoice?.reference ?? "DRAFT",
    draft: !input.invoice,
    issueDate: input.invoice?.issueDate ?? new Date().toISOString().slice(0, 10),
    fixfy: FIXFY_LEGAL_ENTITY,
    partner: { name: partnerName, address: partnerAddress, vatNumber: partnerVat },
    payoutStatementRef: sb.reference,
    periodText: start && end ? `${start} to ${end}` : (sb.week_label ?? null),
    lines,
    totalIncVat: totals.totalIncVat,
    vatAmount: totals.vatAmount,
    netAmount: totals.netAmount,
    vatRatePct: totals.vatRatePct,
    logoUrl: await resolveSelfBillPdfLogoUrl(supabase),
    footerLogoUrl: await resolveSelfBillFooterLogo(),
  };

  const buffer = await renderToBuffer(<CommissionVatInvoicePDF data={data} />);
  return Buffer.from(buffer);
}
