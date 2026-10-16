import React from "react";
import { Document, Page, Text, View, StyleSheet, Image } from "@react-pdf/renderer";
import { formatGbpIncVat } from "@/lib/money-display-label";
import { displayBillingReference } from "@/lib/billing-reference";
import { invoicePayLinkUrl } from "@/lib/pay-link-url";
import { FIXFY_LEGAL_ENTITY } from "@/lib/agent-model/commission";
import { FIXFY_CLIENT_BANK_DETAIL_ROWS } from "@/lib/fixfy-client-bank-details";
import type { AgentReceiptView } from "@/lib/agent-model/receipt-view";
import type { FeeVatBreakdown, InvoiceBillTo } from "@/lib/invoice-fee-vat";
import {
  FIXFY_PDF_FOOTER_HEIGHT,
  FIXFY_PDF_NAVY,
  FIXFY_PDF_ORANGE,
  FIXFY_PDF_PAD_H,
  FIXFY_PDF_PAGE_GAP,
  fixfyPdfHeaderLogoStyle,
  fixfyPdfPageMargins,
  FixfyPdfFooterGuard,
  KeepTogetherBlock,
} from "@/lib/pdf/fixfy-pdf-layout";

export interface InvoicePdfData {
  reference: string;
  documentTitle: string;
  clientName: string;
  jobTitle: string;
  jobReference: string;
  propertyAddress?: string;
  issueDate: string;
  dueDate: string;
  paymentDate?: string;
  amount: number;
  balanceDue: number;
  paid: boolean;
  partial: boolean;
  paidAmount: number;
  quoteReference?: string;
  serviceType?: string;
  completionDate?: string;
  tradeAmount: number;
  feeAmount: number;
  /** Data URI or https URL for header logo. */
  logoUrl?: string;
  /** Logo para fundo branco (a fatura de uma página, estilo contábil). */
  logoDarkUrl?: string;
  /** When set (partial request), amount due now — may be less than full balance. */
  amountDueNow?: number;
  /** % of base requested (for PDF note). */
  requestPercent?: number;
  /**
   * Schedule A (modelo de agente): recibo em nome do profissional, emitido pela
   * Fixfy como agente dele. Ausente = Schedule B, documento de sempre.
   */
  agent?: AgentReceiptView;
  /** Quem lê o documento, quando o "Bill to" é a empresa e não a pessoa. */
  contactName?: string;
  /** Razão social, endereço e número da empresa cobrada (conta com `invoice_fee_vat`). */
  billTo?: InvoiceBillTo;
  /** A taxa da Fixfy aberta em líquido + VAT. O total não muda. */
  feeVat?: FeeVatBreakdown;
}

const NAVY = FIXFY_PDF_NAVY;
const ORANGE = FIXFY_PDF_ORANGE;
const LILAC = "#F2F0FA";
const TEXT = "#1A1A1A";
const MUTED = "#4A4A55";
const LABEL = "#6B6E7B";
const BORDER = "#E8E8EE";
const HAIRLINE = "#F2F0FA";
const FOOTER_INFO = "#AAAAD0";
const PAD = FIXFY_PDF_PAD_H;

const styles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 10,
    color: NAVY,
    ...fixfyPdfPageMargins,
  },

  headerBand: {
    backgroundColor: NAVY,
    paddingVertical: 14,
    paddingHorizontal: PAD,
    alignItems: "flex-start" as const,
    marginTop: -FIXFY_PDF_PAGE_GAP,
  },
  wordmark: { fontFamily: "Helvetica-Bold", fontSize: 18, color: "#FFFFFF", letterSpacing: 0.5 },
  headerLogo: fixfyPdfHeaderLogoStyle,
  accentBar: { backgroundColor: ORANGE, height: 4 },

  body: { paddingHorizontal: PAD, paddingTop: 18 },

  hero: { marginBottom: 14 },
  eyebrow: {
    fontFamily: "Helvetica-Bold",
    fontSize: 8.5,
    letterSpacing: 2.2,
    color: ORANGE,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  docTitle: { marginBottom: 8 },
  docRef: { fontFamily: "Helvetica-Bold", fontSize: 13, color: ORANGE, marginBottom: 4 },
  docClient: { fontFamily: "Helvetica-Bold", fontSize: 15, color: NAVY, lineHeight: 1.3 },
  headline: {
    fontFamily: "Helvetica-Bold",
    fontSize: 13,
    color: NAVY,
    marginBottom: 6,
    lineHeight: 1.25,
  },
  intro: { fontSize: 10, lineHeight: 1.5, color: MUTED },

  sectionLabel: {
    fontFamily: "Helvetica-Bold",
    fontSize: 8.5,
    letterSpacing: 1.5,
    color: NAVY,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  sectionGap: { marginBottom: 14 },

  refBar: { backgroundColor: LILAC, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 14, marginBottom: 14 },
  refRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    marginBottom: 5,
  },
  refRowLast: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  refKey: {
    fontFamily: "Helvetica-Bold",
    fontSize: 8,
    letterSpacing: 1,
    color: LABEL,
    textTransform: "uppercase",
    flexShrink: 0,
  },
  refVal: { fontFamily: "Helvetica-Bold", fontSize: 10.5, color: NAVY, textAlign: "right" as const },
  refValDue: { fontFamily: "Helvetica-Bold", fontSize: 10.5, color: ORANGE, textAlign: "right" as const },

  card: { borderWidth: 1, borderColor: BORDER, borderRadius: 8, marginBottom: 14 },
  cardHead: { paddingVertical: 10, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: BORDER },
  cardHeadText: { fontFamily: "Helvetica-Bold", fontSize: 12, color: NAVY, lineHeight: 1.35 },
  infoRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  infoDivider: { borderTopWidth: 1, borderTopColor: HAIRLINE },
  infoKey: {
    width: 72,
    flexShrink: 0,
    fontFamily: "Helvetica-Bold",
    fontSize: 8,
    letterSpacing: 0.8,
    color: LABEL,
    textTransform: "uppercase",
    paddingTop: 1,
  },
  infoVal: { flex: 1, fontSize: 10, color: TEXT, lineHeight: 1.45 },
  infoValMuted: { color: MUTED },

  lineRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: HAIRLINE,
  },
  lineLabel: { flex: 1, fontSize: 10, color: TEXT, lineHeight: 1.4 },
  lineVal: {
    fontFamily: "Helvetica-Bold",
    fontSize: 10,
    color: NAVY,
    minWidth: 68,
    textAlign: "right" as const,
    flexShrink: 0,
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: LILAC,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  totalLabel: {
    fontFamily: "Helvetica-Bold",
    fontSize: 9,
    letterSpacing: 0.8,
    color: NAVY,
    textTransform: "uppercase",
  },
  totalVal: { fontFamily: "Helvetica-Bold", fontSize: 16, color: NAVY },

  paidNote: { backgroundColor: "#E8F5EF", borderRadius: 8, paddingVertical: 10, paddingHorizontal: 12, marginBottom: 14 },
  paidNoteText: { fontSize: 10, color: "#0F6B45", fontFamily: "Helvetica-Bold", lineHeight: 1.4 },
  vatNote: {
    backgroundColor: "#FFF1EA",
    borderLeftWidth: 3,
    borderLeftColor: ORANGE,
    borderRadius: 4,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  vatEyebrow: {
    fontFamily: "Helvetica-Bold",
    fontSize: 8,
    letterSpacing: 1.5,
    color: ORANGE,
    textTransform: "uppercase",
    marginBottom: 3,
  },
  vatText: { fontSize: 9, lineHeight: 1.45, color: NAVY },

  bankNote: { fontSize: 9, lineHeight: 1.45, color: MUTED, marginTop: 8 },

  footer: {
    position: "absolute" as const,
    bottom: 0,
    left: 0,
    right: 0,
    height: FIXFY_PDF_FOOTER_HEIGHT,
    backgroundColor: NAVY,
    paddingVertical: 12,
    paddingHorizontal: PAD,
    alignItems: "center",
    justifyContent: "center",
  },
  footerWordmark: { fontFamily: "Helvetica-Bold", fontSize: 12, color: "#FFFFFF", marginBottom: 5 },
  footerLogo: { width: 68, height: 18, objectFit: "contain" as const, marginBottom: 6 },
  footerText: { fontSize: 7, lineHeight: 1.4, color: FOOTER_INFO, textAlign: "center" as const },
});

function money(n: number): string {
  return formatGbpIncVat(n);
}

function firstNameOf(name: string): string {
  const t = (name || "").trim().split(/\s+/)[0];
  return t || "there";
}

export function InvoicePDF({ data }: { data: InvoicePdfData }) {
  if (data.agent) return <AgentReceiptPDF data={data} agent={data.agent} />;
  return <InvoiceSheetPDF data={data} />;
}

/**
 * Layout antigo (faixa azul, cartões, duas a três páginas). Fica aqui só como
 * referência enquanto o layout de uma página se prova; ninguém mais o chama.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function LegacyInvoicePDF({ data }: { data: InvoicePdfData }) {
  const isPaid = data.paid;
  const eyebrow = isPaid ? "PAYMENT RECEIPT" : data.feeVat ? "INVOICE" : "STATEMENT OF CHARGES";
  const intro = isPaid
    ? "Thank you — your payment has been received. This statement is for your records."
    : data.feeVat
      ? "Your job is complete. Below is your invoice, with VAT shown on the Fixfy management fee."
      : "Your job is complete. Below is your statement of charges. This statement PDF is for your records.";
  const fullDue = data.balanceDue > 0 ? data.balanceDue : data.amount;
  const requestedDue =
    !isPaid && data.amountDueNow != null && data.amountDueNow > 0 ? data.amountDueNow : fullDue;
  const isPartialRequest =
    !isPaid &&
    data.amountDueNow != null &&
    data.amountDueNow > 0.02 &&
    Math.abs(data.amountDueNow - fullDue) > 0.02;
  const totalLabel = isPaid
    ? "Amount paid"
    : isPartialRequest
      ? "Amount due now"
      : data.partial
        ? "Balance due"
        : "Amount due";
  const totalAmount = isPaid ? data.amount : requestedDue;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.headerBand}>
          {data.logoUrl ? (
            <Image src={data.logoUrl} style={styles.headerLogo} />
          ) : (
            <Text style={styles.wordmark}>Fixfy</Text>
          )}
        </View>
        <View style={styles.accentBar} />

        <View style={styles.body}>
          <KeepTogetherBlock minHeight={90} style={styles.hero}>
            <Text style={styles.eyebrow}>{eyebrow}</Text>
            <View style={styles.docTitle}>
              <Text style={styles.docRef}>{displayBillingReference(data.reference)}</Text>
              <Text style={styles.docClient}>{data.clientName.trim() || "Client"}</Text>
            </View>
            <Text style={styles.headline}>
              {isPaid ? `Hi ${firstNameOf(data.contactName ?? data.clientName)},` : `Your invoice ${displayBillingReference(data.reference)} is ready`}
            </Text>
            <Text style={styles.intro}>{isPaid ? intro : `Hi ${firstNameOf(data.contactName ?? data.clientName)}, ${intro.charAt(0).toLowerCase()}${intro.slice(1)}`}</Text>
          </KeepTogetherBlock>

          {isPaid ? (
            <KeepTogetherBlock minHeight={44} style={styles.paidNote}>
              <Text style={styles.paidNoteText}>
                Payment received — {money(data.amount)}
                {data.paymentDate ? ` on ${data.paymentDate}` : ""}
              </Text>
            </KeepTogetherBlock>
          ) : null}

          <KeepTogetherBlock minHeight={72} style={[styles.refBar, styles.sectionGap]}>
            {data.billTo ? (
              <>
                <View style={styles.refRow}>
                  <Text style={styles.refKey}>Bill to</Text>
                  <Text style={styles.refVal}>{data.billTo.legalName}</Text>
                </View>
                {data.billTo.addressLines.length ? (
                  <View style={styles.refRow}>
                    <Text style={styles.refKey}>Address</Text>
                    <Text style={styles.refVal}>{data.billTo.addressLines.join(", ")}</Text>
                  </View>
                ) : null}
                {data.billTo.companyNumber ? (
                  <View style={styles.refRow}>
                    <Text style={styles.refKey}>Company no.</Text>
                    <Text style={styles.refVal}>{data.billTo.companyNumber}</Text>
                  </View>
                ) : null}
              </>
            ) : null}
            <View style={styles.refRow}>
              <Text style={styles.refKey}>Issue date</Text>
              <Text style={styles.refVal}>{data.issueDate}</Text>
            </View>
            {isPaid ? (
              data.paymentDate ? (
                <View style={data.quoteReference ? styles.refRow : styles.refRowLast}>
                  <Text style={styles.refKey}>Payment date</Text>
                  <Text style={styles.refVal}>{data.paymentDate}</Text>
                </View>
              ) : null
            ) : (
              <View style={data.quoteReference ? styles.refRow : styles.refRowLast}>
                <Text style={styles.refKey}>Due date</Text>
                <Text style={styles.refValDue}>{data.dueDate}</Text>
              </View>
            )}
            {data.quoteReference ? (
              <View style={styles.refRowLast}>
                <Text style={styles.refKey}>Linked to</Text>
                <Text style={styles.refVal}>{data.quoteReference}</Text>
              </View>
            ) : null}
          </KeepTogetherBlock>

          <KeepTogetherBlock minHeight={120} style={styles.sectionGap}>
            <Text style={styles.sectionLabel}>{isPaid ? "Job" : "Job completed"}</Text>
            <View style={styles.card}>
              <View style={styles.cardHead}>
                <Text style={styles.cardHeadText}>{data.jobTitle}</Text>
              </View>
              {data.serviceType ? (
                <View style={styles.infoRow}>
                  <Text style={styles.infoKey}>Service</Text>
                  <Text style={styles.infoVal}>{data.serviceType}</Text>
                </View>
              ) : null}
              {data.propertyAddress ? (
                <View style={[styles.infoRow, styles.infoDivider]}>
                  <Text style={styles.infoKey}>Site</Text>
                  <Text style={styles.infoVal}>{data.propertyAddress}</Text>
                </View>
              ) : null}
              {data.completionDate ? (
                <View style={[styles.infoRow, styles.infoDivider]}>
                  <Text style={styles.infoKey}>Completed on</Text>
                  <Text style={styles.infoVal}>{data.completionDate}</Text>
                </View>
              ) : null}
              <View style={[styles.infoRow, styles.infoDivider]}>
                <Text style={styles.infoKey}>Job ref</Text>
                <Text style={[styles.infoVal, styles.infoValMuted]}>{data.jobReference || "—"}</Text>
              </View>
            </View>
          </KeepTogetherBlock>

          <KeepTogetherBlock minHeight={100} style={styles.sectionGap}>
            <Text style={styles.sectionLabel}>Charges breakdown</Text>
            <View style={styles.card}>
              <View style={styles.lineRow}>
                <Text style={styles.lineLabel}>{data.feeVat ? "Trade services (passed through, no VAT)" : "Trade services"}</Text>
                <Text style={styles.lineVal}>{data.feeVat ? plainMoney(data.tradeAmount) : money(data.tradeAmount)}</Text>
              </View>
              {data.feeVat ? (
                <>
                  <View style={styles.lineRow}>
                    <Text style={styles.lineLabel}>Fixfy management fee (net)</Text>
                    <Text style={styles.lineVal}>{plainMoney(data.feeVat.net)}</Text>
                  </View>
                  <View style={styles.lineRow}>
                    <Text style={styles.lineLabel}>VAT at {data.feeVat.ratePct}% on the Fixfy management fee</Text>
                    <Text style={styles.lineVal}>{plainMoney(data.feeVat.vat)}</Text>
                  </View>
                </>
              ) : (
                <View style={styles.lineRow}>
                  <Text style={styles.lineLabel}>Fixfy management fee</Text>
                  <Text style={styles.lineVal}>{money(data.feeAmount)}</Text>
                </View>
              )}
              {data.partial && !isPaid ? (
                <View style={styles.lineRow}>
                  <Text style={styles.lineLabel}>Already paid</Text>
                  <Text style={styles.lineVal}>{money(data.paidAmount)}</Text>
                </View>
              ) : null}
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>{totalLabel}</Text>
                <Text style={styles.totalVal}>{money(totalAmount)}</Text>
              </View>
            </View>
          </KeepTogetherBlock>

          {!isPaid ? (
            <KeepTogetherBlock minHeight={140} style={styles.sectionGap}>
              <Text style={styles.sectionLabel}>Pay by bank transfer</Text>
              <View style={styles.refBar}>
                {FIXFY_CLIENT_BANK_DETAIL_ROWS.map((row) => (
                  <View key={row.label} style={styles.refRow}>
                    <Text style={styles.refKey}>{row.label}</Text>
                    <Text style={styles.refVal}>{row.value}</Text>
                  </View>
                ))}
                <View style={styles.refRowLast}>
                  <Text style={styles.refKey}>Payment reference</Text>
                  <Text style={styles.refValDue}>{displayBillingReference(data.reference)}</Text>
                </View>
                <Text style={styles.bankNote}>
                  Use this reference so we can match your payment automatically.
                </Text>
              </View>
            </KeepTogetherBlock>
          ) : null}

          {data.feeVat ? (
            <KeepTogetherBlock minHeight={52} style={styles.vatNote}>
              <Text style={styles.vatEyebrow}>VAT</Text>
              <Text style={styles.vatText}>
                Getfixfy Ltd · VAT No. {data.feeVat.vatNumber}. VAT is charged on the Fixfy management fee only. Trade
                services are passed through at cost, with no VAT added by Fixfy.
              </Text>
            </KeepTogetherBlock>
          ) : (
            <KeepTogetherBlock minHeight={52} style={styles.vatNote}>
              <Text style={styles.vatEyebrow}>Need a VAT invoice?</Text>
              <Text style={styles.vatText}>
                Reply to your statement email or contact support@getfixfy.com and we&#39;ll send one across.
              </Text>
            </KeepTogetherBlock>
          )}
        </View>

        <FixfyPdfFooterGuard />
        <View style={styles.footer} fixed>
          {data.logoUrl ? (
            <Image src={data.logoUrl} style={styles.footerLogo} />
          ) : (
            <Text style={styles.footerWordmark}>Fixfy</Text>
          )}
          <Text style={styles.footerText}>
            Getfixfy Ltd · Co. No. 15406523{"\n"}
            124 City Road, London EC1V 2NX, United Kingdom · getfixfy.com
          </Text>
        </View>
      </Page>
    </Document>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Fatura de uma página (dono, 13/10/2026: "queria algo look like Xero, tá muito
 * feio em duas, três páginas, não tá profissional").
 *
 * Folha branca, logo no canto, três colunas no topo (para quem, os números, de
 * quem), uma tabela de linhas e os totais à direita. Cabe em uma página A4.
 * O recibo do modelo de agente (Schedule A) continua no layout dele.
 * ──────────────────────────────────────────────────────────────────────────── */

const sheet = StyleSheet.create({
  page: { fontFamily: "Helvetica", fontSize: 9, color: TEXT, paddingTop: 44, paddingBottom: 64, paddingHorizontal: 48 },
  top: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 26 },
  title: { fontSize: 24, fontFamily: "Helvetica-Bold", color: NAVY, letterSpacing: 0.4 },
  logo: { height: 28, objectFit: "contain" },
  wordmark: { fontSize: 20, fontFamily: "Helvetica-Bold", color: NAVY },
  cols: { flexDirection: "row", marginBottom: 26 },
  colTo: { width: "40%", paddingRight: 14 },
  colMeta: { width: "27%", paddingRight: 14 },
  colFrom: { width: "33%" },
  name: { fontSize: 10.5, fontFamily: "Helvetica-Bold", color: NAVY, marginBottom: 3 },
  line: { fontSize: 9, color: MUTED, lineHeight: 1.45 },
  metaLabel: { fontSize: 8, fontFamily: "Helvetica-Bold", color: NAVY, marginTop: 6 },
  metaLabelFirst: { fontSize: 8, fontFamily: "Helvetica-Bold", color: NAVY },
  metaValue: { fontSize: 9, color: MUTED, marginTop: 1 },
  th: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: NAVY, paddingBottom: 5 },
  thText: { fontSize: 8, fontFamily: "Helvetica-Bold", color: NAVY },
  tr: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: BORDER, paddingVertical: 7 },
  cDesc: { flex: 1, paddingRight: 10 },
  cQty: { width: 52, textAlign: "right" },
  cUnit: { width: 72, textAlign: "right" },
  cVat: { width: 58, textAlign: "right" },
  cAmt: { width: 78, textAlign: "right" },
  desc: { fontSize: 9, color: TEXT },
  descSub: { fontSize: 8, color: LABEL, marginTop: 2, lineHeight: 1.4 },
  totals: { marginTop: 8, marginLeft: "52%" },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 },
  totalLabel: { fontSize: 9, color: MUTED },
  totalValue: { fontSize: 9, color: TEXT },
  grandRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, borderTopWidth: 1, borderTopColor: NAVY, marginTop: 2 },
  grandLabel: { fontSize: 10, fontFamily: "Helvetica-Bold", color: NAVY },
  grandValue: { fontSize: 10, fontFamily: "Helvetica-Bold", color: NAVY },
  dueRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 7, borderTopWidth: 1, borderTopColor: NAVY, borderBottomWidth: 1, borderBottomColor: NAVY, marginTop: 2 },
  dueLabel: { fontSize: 11, fontFamily: "Helvetica-Bold", color: NAVY },
  dueValue: { fontSize: 11, fontFamily: "Helvetica-Bold", color: ORANGE },
  payWrap: { marginTop: 30 },
  payTitle: { fontSize: 10.5, fontFamily: "Helvetica-Bold", color: NAVY, marginBottom: 6 },
  payBox: { flexDirection: "row", borderTopWidth: 0.5, borderTopColor: BORDER, paddingTop: 8 },
  payCol: { width: "50%", paddingRight: 14 },
  payKey: { fontSize: 8, fontFamily: "Helvetica-Bold", color: NAVY, marginTop: 5 },
  payKeyFirst: { fontSize: 8, fontFamily: "Helvetica-Bold", color: NAVY },
  payVal: { fontSize: 9, color: MUTED, marginTop: 1 },
  note: { fontSize: 8, color: LABEL, lineHeight: 1.45, marginTop: 14 },
  paidStamp: { marginTop: 14, alignSelf: "flex-start", borderWidth: 1, borderColor: "#1D9E75", borderRadius: 3, paddingVertical: 4, paddingHorizontal: 9 },
  paidStampText: { fontSize: 9, fontFamily: "Helvetica-Bold", color: "#1D9E75", letterSpacing: 0.6 },
  footer: { position: "absolute", left: 48, right: 48, bottom: 26, borderTopWidth: 0.5, borderTopColor: BORDER, paddingTop: 7 },
  footerText: { fontSize: 7, color: LABEL, textAlign: "center", lineHeight: 1.45 },
});

/** Endereço em linhas de dois pedaços ("5th Floor, 1 Exchange Quay"), para não virar uma coluna comprida. */
function paresDeLinhas(linhas: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < linhas.length; i += 2) out.push(linhas.slice(i, i + 2).join(", "));
  return out;
}

type SheetLine = { titulo: string; sub?: string; qtd?: string; unit?: string; vat?: string; valor: number };

function InvoiceSheetPDF({ data }: { data: InvoicePdfData }) {
  const paid = data.paid;
  const comVat = Boolean(data.feeVat) && !paid;
  const title = paid ? "RECEIPT" : "INVOICE";
  const reference = displayBillingReference(data.reference);
  const f = FIXFY_LEGAL_ENTITY;

  const fullDue = data.balanceDue > 0 ? data.balanceDue : data.amount;
  const dueNow = !paid && data.amountDueNow != null && data.amountDueNow > 0 ? data.amountDueNow : fullDue;
  const partialRequest = !paid && data.amountDueNow != null && data.amountDueNow > 0.02 && Math.abs(data.amountDueNow - fullDue) > 0.02;

  const servico = [data.jobTitle, data.propertyAddress].filter(Boolean).join(" · ");
  const quando = data.completionDate ? `Completed on ${data.completionDate}` : "";
  const sub = [servico, quando].filter(Boolean).join("\n");

  const linhas: SheetLine[] = data.feeVat
    ? [
        { titulo: "Trade services (passed through at cost)", sub, qtd: "1.00", unit: plainMoney(data.tradeAmount).slice(1), vat: "No VAT", valor: data.tradeAmount },
        { titulo: "Fixfy management fee", sub: "Coordination, vetting and quality assurance", qtd: "1.00", unit: plainMoney(data.feeVat.net).slice(1), vat: `${data.feeVat.ratePct}%`, valor: data.feeVat.net },
      ]
    : [
        { titulo: "Trade services", sub, valor: data.tradeAmount },
        ...(data.feeAmount > 0.004 ? [{ titulo: "Fixfy management fee", sub: "Coordination, vetting and quality assurance", valor: data.feeAmount }] : []),
      ];
  const subtotal = data.feeVat ? Math.round((data.tradeAmount + data.feeVat.net) * 100) / 100 : data.amount;

  const billName = data.billTo?.legalName ?? (data.clientName.trim() || "Client");
  const attention = data.billTo && data.contactName && data.contactName.trim() !== billName ? data.contactName.trim() : null;

  return (
    <Document>
      <Page size="A4" style={sheet.page}>
        <View style={sheet.top}>
          <Text style={sheet.title}>{title}</Text>
          {data.logoDarkUrl ? <Image src={data.logoDarkUrl} style={sheet.logo} /> : <Text style={sheet.wordmark}>Fixfy</Text>}
        </View>

        <View style={sheet.cols}>
          <View style={sheet.colTo}>
            <Text style={sheet.name}>{billName}</Text>
            {attention ? <Text style={sheet.line}>Attention: {attention}</Text> : null}
            {paresDeLinhas(data.billTo?.addressLines ?? []).map((l, i) => (
              <Text key={i} style={sheet.line}>{l}</Text>
            ))}
            {data.billTo?.companyNumber ? <Text style={sheet.line}>Company No. {data.billTo.companyNumber}</Text> : null}
          </View>
          <View style={sheet.colMeta}>
            <Text style={sheet.metaLabelFirst}>{paid ? "Receipt Date" : "Invoice Date"}</Text>
            <Text style={sheet.metaValue}>{paid && data.paymentDate ? data.paymentDate : data.issueDate}</Text>
            <Text style={sheet.metaLabel}>{paid ? "Receipt Number" : "Invoice Number"}</Text>
            <Text style={sheet.metaValue}>{reference}</Text>
            {data.jobReference ? (
              <>
                <Text style={sheet.metaLabel}>Reference</Text>
                <Text style={sheet.metaValue}>{[data.jobReference, data.quoteReference].filter(Boolean).join(" · ")}</Text>
              </>
            ) : null}
            {data.feeVat ? (
              <>
                <Text style={sheet.metaLabel}>VAT Number</Text>
                <Text style={sheet.metaValue}>{data.feeVat.vatNumber}</Text>
              </>
            ) : null}
          </View>
          <View style={sheet.colFrom}>
            <Text style={sheet.name}>Getfixfy Ltd</Text>
            {f.addressLines.map((l) => (
              <Text key={l} style={sheet.line}>{l}</Text>
            ))}
            <Text style={sheet.line}>support@getfixfy.com</Text>
          </View>
        </View>

        <View style={sheet.th}>
          <Text style={[sheet.thText, sheet.cDesc]}>Description</Text>
          {data.feeVat ? (
            <>
              <Text style={[sheet.thText, sheet.cQty]}>Quantity</Text>
              <Text style={[sheet.thText, sheet.cUnit]}>Unit Price</Text>
              <Text style={[sheet.thText, sheet.cVat]}>VAT</Text>
            </>
          ) : null}
          <Text style={[sheet.thText, sheet.cAmt]}>Amount GBP</Text>
        </View>
        {linhas.map((l) => (
          <View key={l.titulo} style={sheet.tr} wrap={false}>
            <View style={sheet.cDesc}>
              <Text style={sheet.desc}>{l.titulo}</Text>
              {l.sub ? <Text style={sheet.descSub}>{l.sub}</Text> : null}
            </View>
            {data.feeVat ? (
              <>
                <Text style={[sheet.desc, sheet.cQty]}>{l.qtd}</Text>
                <Text style={[sheet.desc, sheet.cUnit]}>{l.unit}</Text>
                <Text style={[sheet.desc, sheet.cVat]}>{l.vat}</Text>
              </>
            ) : null}
            <Text style={[sheet.desc, sheet.cAmt]}>{plainMoney(l.valor).slice(1)}</Text>
          </View>
        ))}

        <View style={sheet.totals} wrap={false}>
          {data.feeVat ? (
            <>
              <View style={sheet.totalRow}>
                <Text style={sheet.totalLabel}>Subtotal</Text>
                <Text style={sheet.totalValue}>{plainMoney(subtotal).slice(1)}</Text>
              </View>
              <View style={sheet.totalRow}>
                <Text style={sheet.totalLabel}>Total VAT {data.feeVat.ratePct}%</Text>
                <Text style={sheet.totalValue}>{plainMoney(data.feeVat.vat).slice(1)}</Text>
              </View>
            </>
          ) : null}
          <View style={sheet.grandRow}>
            <Text style={sheet.grandLabel}>{data.feeVat ? "TOTAL GBP" : "TOTAL GBP (inc VAT)"}</Text>
            <Text style={sheet.grandValue}>{plainMoney(data.amount).slice(1)}</Text>
          </View>
          {!paid && data.paidAmount > 0.02 ? (
            <View style={sheet.totalRow}>
              <Text style={sheet.totalLabel}>Less amount paid</Text>
              <Text style={sheet.totalValue}>{plainMoney(data.paidAmount).slice(1)}</Text>
            </View>
          ) : null}
          {paid ? (
            <View style={sheet.dueRow}>
              <Text style={sheet.dueLabel}>AMOUNT PAID GBP</Text>
              <Text style={[sheet.dueValue, { color: "#1D9E75" }]}>{plainMoney(data.amount).slice(1)}</Text>
            </View>
          ) : (
            <View style={sheet.dueRow}>
              <Text style={sheet.dueLabel}>{partialRequest ? "AMOUNT DUE NOW GBP" : "AMOUNT DUE GBP"}</Text>
              <Text style={sheet.dueValue}>{plainMoney(dueNow).slice(1)}</Text>
            </View>
          )}
        </View>

        {paid ? (
          <View style={sheet.paidStamp}>
            <Text style={sheet.paidStampText}>PAID{data.paymentDate ? ` · ${data.paymentDate}` : ""}</Text>
          </View>
        ) : (
          <View style={sheet.payWrap} wrap={false}>
            <Text style={sheet.payTitle}>Due Date: {data.dueDate}</Text>
            <View style={sheet.payBox}>
              <View style={sheet.payCol}>
                {FIXFY_CLIENT_BANK_DETAIL_ROWS.filter((r) => r.label !== "IBAN").map((r, i) => (
                  <View key={r.label}>
                    <Text style={i === 0 ? sheet.payKeyFirst : sheet.payKey}>{r.label}</Text>
                    <Text style={sheet.payVal}>{r.value}</Text>
                  </View>
                ))}
              </View>
              <View style={sheet.payCol}>
                <Text style={sheet.payKeyFirst}>Payment reference</Text>
                <Text style={sheet.payVal}>{reference}</Text>
                <Text style={sheet.payKey}>IBAN</Text>
                <Text style={sheet.payVal}>{FIXFY_CLIENT_BANK_DETAIL_ROWS.find((r) => r.label === "IBAN")?.value ?? ""}</Text>
                <Text style={sheet.payKey}>Pay online by card</Text>
                <Text style={sheet.payVal}>{invoicePayLinkUrl(data.reference).replace(/^https?:\/\//, "")}</Text>
              </View>
            </View>
          </View>
        )}

        <Text style={sheet.note}>
          {comVat || data.feeVat
            ? "VAT is charged on the Fixfy management fee only. Trade services are passed through at cost, with no VAT added by Fixfy."
            : "Prices include VAT where it applies. Need a VAT invoice? Reply to the email this came with, or write to support@getfixfy.com."}
          {partialRequest && data.requestPercent ? ` This request is for ${Math.round(data.requestPercent)}% of the invoice.` : ""}
        </Text>

        <View style={sheet.footer} fixed>
          <Text style={sheet.footerText}>
            {f.legalName} · Registered in England and Wales, Company No. {f.companyNumber} · VAT No. {f.vatNumber}{"\n"}
            Registered office: {f.addressLines.join(", ")} · getfixfy.com
          </Text>
        </View>
      </Page>
    </Document>
  );
}

/** £1,234.50 sem "inc VAT": no recibo de agente o VAT é do profissional, e só existe se ele for registrado. */
function plainMoney(n: number): string {
  return `£${(Number(n) || 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Recibo de Schedule A (04-booking-copy, seção d).
 *
 * O documento é do profissional: "Receipt from {professional}", emitido pela
 * Fixfy como agente. Sem "Fixfy platform fee", sem VAT da Fixfy, sem o quadro
 * "Need a VAT invoice?" (a Fixfy não vende o serviço, então não fatura VAT
 * dele). O VAT só aparece quando o profissional é registrado.
 */
function AgentReceiptPDF({ data, agent }: { data: InvoicePdfData; agent: AgentReceiptView }) {
  const isPaid = data.paid;
  const name = agent.professionalName;
  const eyebrow = isPaid ? "Receipt" : "Statement of charges";
  const heading = name ? `${isPaid ? "Receipt" : "Statement"} from ${name}` : isPaid ? "Receipt" : "Statement";
  const intro = isPaid
    ? `Your payment has been received. This receipt is issued in the name of ${agent.professionalLabel}, who carries out your job.`
    : `Your job is complete. Below is the statement for the work carried out by ${agent.professionalLabel}.`;
  const fullDue = data.balanceDue > 0 ? data.balanceDue : data.amount;
  const requestedDue =
    !isPaid && data.amountDueNow != null && data.amountDueNow > 0 ? data.amountDueNow : fullDue;
  const isPartialRequest =
    !isPaid && data.amountDueNow != null && data.amountDueNow > 0.02 && Math.abs(data.amountDueNow - fullDue) > 0.02;
  const totalLabel = isPaid
    ? "Amount you paid"
    : isPartialRequest
      ? "Amount due now"
      : data.partial
        ? "Balance due"
        : "Amount due";
  const totalAmount = isPaid ? data.amount : requestedDue;
  const showPriceSubtotal = agent.lines.length > 1 || agent.vatLine != null || agent.promotion > 0.02;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.headerBand}>
          {data.logoUrl ? <Image src={data.logoUrl} style={styles.headerLogo} /> : <Text style={styles.wordmark}>Fixfy</Text>}
        </View>
        <View style={styles.accentBar} />

        <View style={styles.body}>
          <KeepTogetherBlock minHeight={90} style={styles.hero}>
            <Text style={styles.eyebrow}>{eyebrow}</Text>
            <View style={styles.docTitle}>
              <Text style={styles.docRef}>{heading}</Text>
              <Text style={[styles.intro, { marginBottom: 6 }]}>{agent.issuerLine}</Text>
            </View>
            <Text style={styles.headline}>Hi {firstNameOf(data.clientName)},</Text>
            <Text style={styles.intro}>{intro}</Text>
          </KeepTogetherBlock>

          {isPaid ? (
            <KeepTogetherBlock minHeight={44} style={styles.paidNote}>
              <Text style={styles.paidNoteText}>
                Payment received: {plainMoney(data.amount)}
                {data.paymentDate ? ` on ${data.paymentDate}` : ""}
              </Text>
            </KeepTogetherBlock>
          ) : null}

          <KeepTogetherBlock minHeight={72} style={[styles.refBar, styles.sectionGap]}>
            <View style={styles.refRow}>
              <Text style={styles.refKey}>{isPaid ? "Receipt number" : "Statement number"}</Text>
              <Text style={styles.refVal}>{displayBillingReference(data.reference)}</Text>
            </View>
            <View style={styles.refRow}>
              <Text style={styles.refKey}>Date</Text>
              <Text style={styles.refVal}>{data.issueDate}</Text>
            </View>
            {isPaid ? (
              data.paymentDate ? (
                <View style={styles.refRow}>
                  <Text style={styles.refKey}>Payment date</Text>
                  <Text style={styles.refVal}>{data.paymentDate}</Text>
                </View>
              ) : null
            ) : (
              <View style={styles.refRow}>
                <Text style={styles.refKey}>Due date</Text>
                <Text style={styles.refValDue}>{data.dueDate}</Text>
              </View>
            )}
            <View style={styles.refRowLast}>
              <Text style={styles.refKey}>Booking reference</Text>
              <Text style={styles.refVal}>{data.jobReference || displayBillingReference(data.reference)}</Text>
            </View>
          </KeepTogetherBlock>

          <View style={styles.sectionGap} wrap={false}>
            <Text style={styles.sectionLabel}>Service provided by</Text>
            <View style={styles.card}>
              <View style={styles.cardHead}>
                <Text style={styles.cardHeadText}>{name ?? "An independent, vetted professional"}</Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.infoKey}>Status</Text>
                <Text style={styles.infoVal}>
                  {name ? "Independent trader. Your contract for this job is with them." : "Named in your booking confirmation."}
                </Text>
              </View>
              {agent.businessAddress ? (
                <View style={[styles.infoRow, styles.infoDivider]}>
                  <Text style={styles.infoKey}>Address</Text>
                  <Text style={styles.infoVal}>{agent.businessAddress}</Text>
                </View>
              ) : null}
              {agent.vatNumber ? (
                <View style={[styles.infoRow, styles.infoDivider]}>
                  <Text style={styles.infoKey}>VAT number</Text>
                  <Text style={styles.infoVal}>{agent.vatNumber}</Text>
                </View>
              ) : null}
            </View>
          </View>

          <View style={styles.sectionGap} wrap={false}>
            <Text style={styles.sectionLabel}>Job</Text>
            <View style={styles.card}>
              <View style={styles.cardHead}>
                <Text style={styles.cardHeadText}>{data.jobTitle}</Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.infoKey}>Customer</Text>
                <Text style={styles.infoVal}>{data.clientName.trim() || "Customer"}</Text>
              </View>
              {data.propertyAddress ? (
                <View style={[styles.infoRow, styles.infoDivider]}>
                  <Text style={styles.infoKey}>Address</Text>
                  <Text style={styles.infoVal}>{data.propertyAddress}</Text>
                </View>
              ) : null}
              {data.completionDate ? (
                <View style={[styles.infoRow, styles.infoDivider]}>
                  <Text style={styles.infoKey}>Service date</Text>
                  <Text style={styles.infoVal}>{data.completionDate}</Text>
                </View>
              ) : null}
            </View>
          </View>

          <KeepTogetherBlock minHeight={100} style={styles.sectionGap}>
            <Text style={styles.sectionLabel}>Services</Text>
            <View style={styles.card}>
              {agent.lines.map((l, i) => (
                <View key={`${l.label}-${i}`} style={styles.lineRow}>
                  <Text style={styles.lineLabel}>{l.label}</Text>
                  <Text style={styles.lineVal}>{plainMoney(l.amount)}</Text>
                </View>
              ))}
              {showPriceSubtotal ? (
                <View style={styles.lineRow}>
                  <Text style={[styles.lineLabel, { fontFamily: "Helvetica-Bold" }]}>
                    {name ? `${name}'s price` : "Price"}
                  </Text>
                  <Text style={styles.lineVal}>{plainMoney(agent.professionalPrice)}</Text>
                </View>
              ) : null}
              {agent.vatLine ? (
                <View style={styles.lineRow}>
                  <Text style={[styles.lineLabel, styles.infoValMuted]}>{agent.vatLine}</Text>
                  <Text style={styles.lineVal}>{agent.vatAmount != null ? plainMoney(agent.vatAmount) : ""}</Text>
                </View>
              ) : null}
              {agent.promotion > 0.02 ? (
                <View style={styles.lineRow}>
                  <Text style={styles.lineLabel}>Fixfy promotion, paid by Fixfy on your behalf</Text>
                  <Text style={styles.lineVal}>-{plainMoney(agent.promotion)}</Text>
                </View>
              ) : null}
              {agent.partOfPrice ? (
                <View style={styles.lineRow}>
                  <Text style={styles.lineLabel}>{isPaid ? "This receipt covers" : "This statement covers"}</Text>
                  <Text style={styles.lineVal}>{plainMoney(agent.documentAmount)}</Text>
                </View>
              ) : null}
              {data.partial && !isPaid ? (
                <View style={styles.lineRow}>
                  <Text style={styles.lineLabel}>Already paid</Text>
                  <Text style={styles.lineVal}>{plainMoney(data.paidAmount)}</Text>
                </View>
              ) : null}
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>{totalLabel}</Text>
                <Text style={styles.totalVal}>{plainMoney(totalAmount)}</Text>
              </View>
            </View>
          </KeepTogetherBlock>

          {!isPaid ? (
            <KeepTogetherBlock minHeight={140} style={styles.sectionGap}>
              <Text style={styles.sectionLabel}>Pay by bank transfer</Text>
              <View style={styles.refBar}>
                {FIXFY_CLIENT_BANK_DETAIL_ROWS.map((row) => (
                  <View key={row.label} style={styles.refRow}>
                    <Text style={styles.refKey}>{row.label}</Text>
                    <Text style={styles.refVal}>{row.value}</Text>
                  </View>
                ))}
                <View style={styles.refRowLast}>
                  <Text style={styles.refKey}>Payment reference</Text>
                  <Text style={styles.refValDue}>{displayBillingReference(data.reference)}</Text>
                </View>
                <Text style={styles.bankNote}>
                  Paid to GETFIXFY LTD (Fixfy) as payment collection agent for {agent.professionalLabel}. Use this reference so we can match your payment.
                </Text>
              </View>
            </KeepTogetherBlock>
          ) : null}

          <KeepTogetherBlock minHeight={70} style={styles.vatNote}>
            <Text style={styles.vatEyebrow}>Who you are booking with</Text>
            <Text style={styles.vatText}>{agent.paymentNote}</Text>
            <Text style={[styles.vatText, { marginTop: 4 }]}>{agent.bookingNote}</Text>
          </KeepTogetherBlock>
        </View>

        <FixfyPdfFooterGuard />
        <View style={styles.footer} fixed>
          {data.logoUrl ? <Image src={data.logoUrl} style={styles.footerLogo} /> : <Text style={styles.footerWordmark}>Fixfy</Text>}
          <Text style={styles.footerText}>
            {agent.issuerLine}
            {"\n"}
            Questions: reply to your booking emails or write to hello@getfixfy.com · getfixfy.com
          </Text>
        </View>
      </Page>
    </Document>
  );
}
