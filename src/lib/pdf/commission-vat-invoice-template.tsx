/**
 * Fatura de VAT da comissão: a Fixfy vende ao parceiro o serviço de agência.
 *
 * Invoicing and Payment Collection Agreement 2026-10-06, seção 6.2: uma por
 * payout, com nome, endereço e VAT number da Fixfy; nome e endereço do
 * parceiro; número único e sequencial, data e tax point; a referência e a data
 * de cada reserva com a comissão; cada Late-Withdrawal Fee; e o total sem VAT,
 * a alíquota, o VAT e o total com VAT. Sai mesmo quando a comissão é
 * descontada do dinheiro do parceiro em vez de paga à parte (seção 6.3).
 */
import React from "react";
import { Document, Page, Text, View, StyleSheet, Image } from "@react-pdf/renderer";
import {
  FIXFY_PDF_FOOTER_HEIGHT,
  FIXFY_PDF_HEADER_LOGO_HEIGHT,
  FIXFY_PDF_NAVY,
  FIXFY_PDF_ORANGE,
  FIXFY_PDF_PAD_H,
  FIXFY_PDF_PAGE_BOTTOM_RESERVE,
  FIXFY_PDF_PAGE_GAP,
  fixfyPdfHeaderLogoStyle,
  FixfyPdfFooterGuard,
} from "@/lib/pdf/fixfy-pdf-layout";

import type { CommissionInvoiceLine } from "@/lib/agent-model/commission-invoice";
import { formatCommissionPercent } from "@/lib/agent-model/commission";

export interface CommissionVatInvoicePdfData {
  /** FXC-000123, ou "DRAFT" antes de emitida. */
  invoiceReference: string;
  draft?: boolean;
  /** YYYY-MM-DD. Também é o tax point. */
  issueDate: string;
  fixfy: {
    legalName: string;
    tradingName: string;
    addressLines: readonly string[];
    companyNumber: string;
    vatNumber: string;
  };
  partner: {
    name: string;
    address: string | null;
    vatNumber?: string | null;
  };
  payoutStatementRef: string;
  periodText?: string | null;
  lines: CommissionInvoiceLine[];
  totalIncVat: number;
  vatAmount: number;
  netAmount: number;
  vatRatePct: number;
  logoUrl?: string;
  footerLogoUrl?: string;
}

const NAVY = FIXFY_PDF_NAVY;
const ORANGE = FIXFY_PDF_ORANGE;
const LILAC = "#F2F0FA";
const TEXT = "#1A1A1A";
const MUTED = "#4A4A55";
const LABEL = "#9A9AA8";
const BORDER = "#E8E8EE";
const HAIRLINE = "#F2F0FA";
const FOOTER_INFO = "#AAAAD0";
const PAD = FIXFY_PDF_PAD_H;
const PAGE_HEADER_HEIGHT = FIXFY_PDF_HEADER_LOGO_HEIGHT + 28;

const styles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 10,
    color: NAVY,
    paddingTop: PAGE_HEADER_HEIGHT + FIXFY_PDF_PAGE_GAP,
    paddingBottom: FIXFY_PDF_PAGE_BOTTOM_RESERVE,
  },
  pageHeader: { position: "absolute" as const, top: 0, left: 0, right: 0 },
  headerBand: { backgroundColor: NAVY, paddingVertical: 12, paddingHorizontal: PAD, alignItems: "flex-start" as const },
  wordmark: { fontFamily: "Helvetica-Bold", fontSize: 20, color: "#FFFFFF" },
  headerLogo: fixfyPdfHeaderLogoStyle,
  accentBar: { backgroundColor: ORANGE, height: 4 },
  body: { paddingHorizontal: PAD },

  eyebrow: { fontFamily: "Helvetica-Bold", fontSize: 9, letterSpacing: 2.5, color: ORANGE, textTransform: "uppercase", marginBottom: 6 },
  headline: { fontFamily: "Helvetica-Bold", fontSize: 18, color: NAVY, marginBottom: 4 },
  draft: { fontFamily: "Helvetica-Bold", fontSize: 10, color: "#B45309", marginBottom: 8 },

  parties: { flexDirection: "row", gap: 12, marginTop: 8, marginBottom: 14 },
  party: { flex: 1, borderWidth: 1, borderColor: BORDER, borderRadius: 8, padding: 12 },
  partyKey: { fontFamily: "Helvetica-Bold", fontSize: 8, letterSpacing: 1, color: LABEL, textTransform: "uppercase", marginBottom: 4 },
  partyName: { fontFamily: "Helvetica-Bold", fontSize: 11, color: NAVY, marginBottom: 2 },
  partyText: { fontSize: 9, color: MUTED, lineHeight: 1.4 },

  refBar: { backgroundColor: LILAC, borderRadius: 8, padding: 12, marginBottom: 14 },
  refRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 5 },
  refRowLast: { flexDirection: "row", justifyContent: "space-between" },
  refKey: { fontFamily: "Helvetica-Bold", fontSize: 9, letterSpacing: 1, color: LABEL, textTransform: "uppercase" },
  refVal: { fontFamily: "Helvetica-Bold", fontSize: 10.5, color: NAVY },

  sectionLabel: { fontFamily: "Helvetica-Bold", fontSize: 9, letterSpacing: 1.6, color: NAVY, textTransform: "uppercase", marginBottom: 8 },
  tableHead: { flexDirection: "row", backgroundColor: NAVY, borderTopLeftRadius: 6, borderTopRightRadius: 6, paddingHorizontal: 10, paddingVertical: 7 },
  th: { fontFamily: "Helvetica-Bold", fontSize: 8, color: "#FFFFFF", letterSpacing: 0.4, textTransform: "uppercase" },
  tableRow: {
    flexDirection: "row",
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: HAIRLINE,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderLeftColor: BORDER,
    borderRightColor: BORDER,
  },
  cRef: { width: "18%" },
  cDate: { width: "16%" },
  cDesc: { width: "46%", paddingRight: 8 },
  cNum: { width: "20%", textAlign: "right" },
  cellText: { fontSize: 8.5, color: TEXT, lineHeight: 1.35 },
  cellNum: { fontSize: 8.5, color: NAVY },
  cellSub: { fontSize: 7.5, color: MUTED, marginTop: 1.5, lineHeight: 1.35 },

  totals: { borderWidth: 1, borderColor: BORDER, borderTopWidth: 0, borderBottomLeftRadius: 6, borderBottomRightRadius: 6 },
  totRow: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 10, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: HAIRLINE },
  totLabel: { fontSize: 9, color: MUTED },
  totVal: { fontFamily: "Helvetica-Bold", fontSize: 9.5, color: NAVY },
  grandRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: LILAC, paddingHorizontal: 10, paddingVertical: 10 },
  grandLabel: { fontFamily: "Helvetica-Bold", fontSize: 9.5, letterSpacing: 0.8, color: NAVY, textTransform: "uppercase" },
  grandVal: { fontFamily: "Helvetica-Bold", fontSize: 15, color: NAVY },

  notice: { backgroundColor: "#FFF1EA", borderLeftWidth: 4, borderLeftColor: ORANGE, borderRadius: 4, padding: 11, marginTop: 14 },
  noticeEyebrow: { fontFamily: "Helvetica-Bold", fontSize: 8, letterSpacing: 2, color: ORANGE, textTransform: "uppercase", marginBottom: 3 },
  noticeText: { fontSize: 8.5, lineHeight: 1.4, color: NAVY },

  footer: {
    position: "absolute" as const,
    bottom: 0,
    left: 0,
    right: 0,
    height: FIXFY_PDF_FOOTER_HEIGHT,
    backgroundColor: NAVY,
    paddingVertical: 14,
    paddingHorizontal: PAD,
    alignItems: "center",
  },
  footerWordmark: { fontFamily: "Helvetica-Bold", fontSize: 13, color: "#FFFFFF", marginBottom: 6 },
  footerLogo: { height: 16, objectFit: "contain" as const, marginBottom: 6 },
  footerText: { fontSize: 7, lineHeight: 1.4, color: FOOTER_INFO, textAlign: "center" as const },
});

function money(n: number): string {
  return `£${(Number(n) || 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(ymd?: string | null): string {
  const raw = (ymd ?? "").trim();
  if (!raw) return "";
  const d = new Date(raw.length === 10 ? `${raw}T12:00:00Z` : raw);
  if (Number.isNaN(d.getTime())) return raw.slice(0, 10);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export function CommissionVatInvoicePDF({ data }: { data: CommissionVatInvoicePdfData }) {
  const f = data.fixfy;
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.pageHeader} fixed>
          <View style={styles.headerBand}>
            {data.logoUrl ? <Image src={data.logoUrl} style={styles.headerLogo} /> : <Text style={styles.wordmark}>Fixfy</Text>}
          </View>
          <View style={styles.accentBar} />
        </View>

        <View style={styles.body}>
          <Text style={styles.eyebrow}>VAT invoice</Text>
          <Text style={styles.headline}>Commission VAT invoice {data.invoiceReference}</Text>
          {data.draft ? (
            <Text style={styles.draft}>Draft preview. The number is given when the payout statement is sent.</Text>
          ) : null}

          <View style={styles.parties} wrap={false}>
            <View style={styles.party}>
              <Text style={styles.partyKey}>From (supplier)</Text>
              <Text style={styles.partyName}>
                {f.legalName}, trading as {f.tradingName}
              </Text>
              {f.addressLines.map((l) => (
                <Text key={l} style={styles.partyText}>
                  {l}
                </Text>
              ))}
              <Text style={styles.partyText}>Company No. {f.companyNumber}</Text>
              <Text style={styles.partyText}>VAT No. {f.vatNumber}</Text>
            </View>
            <View style={styles.party}>
              <Text style={styles.partyKey}>To (customer)</Text>
              <Text style={styles.partyName}>{data.partner.name}</Text>
              {data.partner.address ? <Text style={styles.partyText}>{data.partner.address}</Text> : null}
              {data.partner.vatNumber ? <Text style={styles.partyText}>VAT No. {data.partner.vatNumber}</Text> : null}
            </View>
          </View>

          <View style={styles.refBar} wrap={false}>
            <View style={styles.refRow}>
              <Text style={styles.refKey}>Invoice number</Text>
              <Text style={styles.refVal}>{data.invoiceReference}</Text>
            </View>
            <View style={styles.refRow}>
              <Text style={styles.refKey}>Date of issue and tax point</Text>
              <Text style={styles.refVal}>{fmtDate(data.issueDate)}</Text>
            </View>
            <View style={data.periodText ? styles.refRow : styles.refRowLast}>
              <Text style={styles.refKey}>Payout statement</Text>
              <Text style={styles.refVal}>{data.payoutStatementRef}</Text>
            </View>
            {data.periodText ? (
              <View style={styles.refRowLast}>
                <Text style={styles.refKey}>Period</Text>
                <Text style={styles.refVal}>{data.periodText}</Text>
              </View>
            ) : null}
          </View>

          <Text style={styles.sectionLabel}>Agency services</Text>
          <View style={styles.tableHead} wrap={false} fixed>
            <Text style={[styles.th, styles.cRef]}>Booking</Text>
            <Text style={[styles.th, styles.cDate]}>Date</Text>
            <Text style={[styles.th, styles.cDesc]}>Description</Text>
            <Text style={[styles.th, styles.cNum]}>Amount inc VAT</Text>
          </View>
          {data.lines.map((l, i) => (
            <View key={`${l.reference}-${i}`} style={styles.tableRow} wrap={false}>
              <Text style={[styles.cellText, styles.cRef]}>{l.reference}</Text>
              <Text style={[styles.cellText, styles.cDate]}>{fmtDate(l.date)}</Text>
              <View style={styles.cDesc}>
                <Text style={styles.cellText}>{l.description}</Text>
                {l.kind === "commission" && l.percentOfPrice != null ? (
                  <Text style={styles.cellSub}>
                    {formatCommissionPercent(l.percentOfPrice)} of your price
                    {l.customerPrice != null ? ` of ${money(l.customerPrice)}` : ""}
                  </Text>
                ) : null}
              </View>
              <Text style={[styles.cellNum, styles.cNum]}>{money(l.amount)}</Text>
            </View>
          ))}
          <View style={styles.totals} wrap={false}>
            <View style={styles.totRow}>
              <Text style={styles.totLabel}>Total excluding VAT</Text>
              <Text style={styles.totVal}>{money(data.netAmount)}</Text>
            </View>
            <View style={styles.totRow}>
              <Text style={styles.totLabel}>VAT at {data.vatRatePct}%</Text>
              <Text style={styles.totVal}>{money(data.vatAmount)}</Text>
            </View>
            <View style={styles.grandRow}>
              <Text style={styles.grandLabel}>Total including VAT</Text>
              <Text style={styles.grandVal}>{money(data.totalIncVat)}</Text>
            </View>
          </View>

          <View style={styles.notice} wrap={false}>
            <Text style={styles.noticeEyebrow}>Nothing to pay</Text>
            <Text style={styles.noticeText}>
              This invoice is for Fixfy&apos;s agency services on your Platform Bookings and any Late-Withdrawal Fee.
              The amount has already been deducted from the money Fixfy collected for you, as shown on payout
              statement {data.payoutStatementRef}, so nothing is payable separately. Fixfy issues this invoice for
              every payout under the Invoicing and Payment Collection Agreement. If you are VAT registered, you may
              be able to reclaim the VAT under the normal rules.
            </Text>
          </View>
        </View>

        <FixfyPdfFooterGuard />
        <View style={styles.footer} fixed>
          {data.footerLogoUrl ? (
            <Image src={data.footerLogoUrl} style={styles.footerLogo} />
          ) : (
            <Text style={styles.footerWordmark}>Fixfy</Text>
          )}
          <Text style={styles.footerText}>
            {f.legalName}, trading as {f.tradingName} · Company No. {f.companyNumber} · VAT No. {f.vatNumber}
            {"\n"}
            {f.addressLines.join(", ")} · getfixfy.com
          </Text>
        </View>
      </Page>
    </Document>
  );
}
