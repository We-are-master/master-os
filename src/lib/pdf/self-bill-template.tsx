import React from "react";
import { Document, Page, Text, View, StyleSheet, Image } from "@react-pdf/renderer";
import { formatGbpIncVat } from "@/lib/money-display-label";
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
  KeepTogetherBlock,
} from "@/lib/pdf/fixfy-pdf-layout";

export interface SelfBillPdfLine {
  reference: string;
  title: string;
  partner_cost: number;
  materials_cost: number;
  property_address?: string;
  /** Job UUID for audit / partner transparency. */
  jobId?: string;
  /** Archived / Lost / Cancelled — shown for audit when job no longer pays out. */
  payoutStateNote?: string | null;
}

export interface SelfBillPdfData {
  reference: string;
  partnerName: string;
  weekLabel?: string;
  weekStart?: string;
  weekEnd?: string;
  /** Partner field: Friday after week_end (YYYY-MM-DD). Omitted for internal workforce bills. */
  paymentDueDate?: string;
  period: string;
  jobsCount: number;
  jobValue: number;
  materials: number;
  commission: number;
  netPayout: number;
  status: string;
  lines: SelfBillPdfLine[];
  /** Snapshot before payout was voided (original combined net). */
  originalNetPayout?: number | null;
  payoutVoidReason?: string | null;
  partnerStatusLabel?: string | null;
  /** Internal finance label when voided (e.g. Void). */
  financeStatusLabel?: string | null;
  /** Explicit flag from server — preferred over inferring from optional text fields. */
  payoutVoided?: boolean;
  billOrigin?: "partner" | "internal";
  /** Data URI or https URL for header logo (white wordmark on navy). */
  logoUrl?: string;
  internalBreakdown?: {
    fixedPay: number;
    commissionAmount: number;
    commissionBasis?: string | null;
    commissionRatePercent?: number | null;
    basisTotal?: number;
    jobs?: { reference: string; revenue: number; grossProfit: number; commission: number }[];
  };
}

/* Brand palette — mirrors the Self-Bill Issued email
 * (src/lib/email-templates/...) and the client statement PDF. */
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
const BODY_TOP = FIXFY_PDF_PAGE_GAP;
/** Logo band + orange accent — reserved on every page via `fixed` header. */
const PAGE_HEADER_HEIGHT = FIXFY_PDF_HEADER_LOGO_HEIGHT + 28;

const styles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 10,
    color: NAVY,
    paddingTop: PAGE_HEADER_HEIGHT + BODY_TOP,
    paddingBottom: FIXFY_PDF_PAGE_BOTTOM_RESERVE,
  },

  pageHeader: { position: "absolute" as const, top: 0, left: 0, right: 0 },
  headerBand: {
    backgroundColor: NAVY,
    paddingVertical: 12,
    paddingHorizontal: PAD,
    alignItems: "flex-start" as const,
  },
  wordmark: { fontFamily: "Helvetica-Bold", fontSize: 20, color: "#FFFFFF", letterSpacing: 0.5 },
  headerLogo: fixfyPdfHeaderLogoStyle,
  accentBar: { backgroundColor: ORANGE, height: 4 },

  body: { paddingHorizontal: PAD },

  eyebrow: { fontFamily: "Helvetica-Bold", fontSize: 9, letterSpacing: 2.5, color: ORANGE, textTransform: "uppercase", marginBottom: 6 },
  headline: { fontFamily: "Helvetica-Bold", fontSize: 18, color: NAVY, marginBottom: 6 },
  intro: { fontSize: 10.5, lineHeight: 1.45, color: MUTED, marginBottom: 12 },

  sectionLabel: { fontFamily: "Helvetica-Bold", fontSize: 9, letterSpacing: 1.6, color: NAVY, textTransform: "uppercase", marginBottom: 8, marginTop: 2 },

  // Payout-sent banner
  paidBanner: { backgroundColor: "#DCFCE7", borderLeftWidth: 4, borderLeftColor: "#22C55E", borderRadius: 4, padding: 11, marginBottom: 12 },
  paidEyebrow: { fontFamily: "Helvetica-Bold", fontSize: 9, letterSpacing: 2, color: "#166534", textTransform: "uppercase", marginBottom: 2 },
  paidText: { fontSize: 11, color: "#166534" },

  // Reference bar
  refBar: { backgroundColor: LILAC, borderRadius: 8, padding: 12, marginBottom: 14 },
  refRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 5 },
  refRowLast: { flexDirection: "row", justifyContent: "space-between" },
  refKey: { fontFamily: "Helvetica-Bold", fontSize: 9, letterSpacing: 1, color: LABEL, textTransform: "uppercase" },
  refVal: { fontFamily: "Helvetica-Bold", fontSize: 11, color: NAVY },

  // Summary card
  card: { borderWidth: 1, borderColor: BORDER, borderRadius: 8, marginBottom: 14 },
  lineRow: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: HAIRLINE },
  lineLabel: { fontSize: 10.5, color: TEXT },
  lineVal: { fontFamily: "Helvetica-Bold", fontSize: 10.5, color: NAVY },
  totalRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: LILAC, paddingHorizontal: 12, paddingVertical: 11 },
  totalLabel: { fontFamily: "Helvetica-Bold", fontSize: 10, letterSpacing: 1, color: NAVY, textTransform: "uppercase" },
  totalVal: { fontFamily: "Helvetica-Bold", fontSize: 17, color: NAVY },

  // Per-job breakdown table
  tableHead: { flexDirection: "row", backgroundColor: NAVY, borderTopLeftRadius: 6, borderTopRightRadius: 6, paddingHorizontal: 10, paddingVertical: 7 },
  th: { fontFamily: "Helvetica-Bold", fontSize: 8, color: "#FFFFFF", letterSpacing: 0.4, textTransform: "uppercase" },
  tableRow: { flexDirection: "row", paddingHorizontal: 10, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: HAIRLINE, borderLeftWidth: 1, borderRightWidth: 1, borderLeftColor: BORDER, borderRightColor: BORDER },
  cellRef: { width: "20%" },
  cellTitle: { width: "30%" },
  cellAddr: { width: "30%" },
  cellNum: { width: "10%", textAlign: "right" },
  cellText: { fontSize: 9, color: TEXT },
  cellNumText: { fontSize: 9, color: NAVY },
  lineNote: { fontSize: 7, color: ORANGE, marginTop: 2 },
  lineId: { fontSize: 6, color: LABEL, marginTop: 1 },

  // Void box
  voidBox: { backgroundColor: "#F5F5F4", borderRadius: 6, borderWidth: 1, borderColor: "#D6D3D1", padding: 10, marginBottom: 12 },
  voidTitle: { fontSize: 10.5, fontFamily: "Helvetica-Bold", marginBottom: 5, color: "#44403C" },
  voidRow: { fontSize: 9, marginBottom: 2, color: "#44403C" },
  voidReason: { fontSize: 8, marginTop: 4, color: MUTED, lineHeight: 1.35 },

  // HMRC notice
  notice: { backgroundColor: "#FFF1EA", borderLeftWidth: 4, borderLeftColor: ORANGE, borderRadius: 4, padding: 11, marginTop: 4, marginBottom: 12 },
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
  footerText: { fontSize: 7, lineHeight: 1.4, color: FOOTER_INFO, textAlign: "center" as const },
});

function fmt(n: number): string {
  return formatGbpIncVat(n);
}

function firstNameOf(name: string): string {
  const t = (name || "").trim().split(/\s+/)[0];
  return t || "there";
}

function SelfBillPageHeader({ logoUrl }: { logoUrl?: string }) {
  return (
    <View style={styles.pageHeader} fixed>
      <View style={styles.headerBand}>
        {logoUrl ? (
          <Image src={logoUrl} style={styles.headerLogo} />
        ) : (
          <Text style={styles.wordmark}>Fixfy</Text>
        )}
      </View>
      <View style={styles.accentBar} />
    </View>
  );
}

export function SelfBillPDF({ data }: { data: SelfBillPdfData }) {
  const isVoided = data.payoutVoided === true;
  const lineSum = data.lines.reduce((s, l) => s + l.partner_cost + l.materials_cost, 0);
  const originalAmt =
    data.originalNetPayout != null && Number.isFinite(Number(data.originalNetPayout)) && Number(data.originalNetPayout) > 0
      ? Number(data.originalNetPayout)
      : lineSum > 0.01
        ? lineSum
        : data.jobValue + data.materials - data.commission;

  const periodText =
    data.weekStart && data.weekEnd ? `${data.weekStart} — ${data.weekEnd}` : data.period;
  const showPayoutBanner = !isVoided && data.netPayout > 0.01;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <SelfBillPageHeader logoUrl={data.logoUrl} />

        <View style={styles.body}>
          <Text style={styles.eyebrow}>Self-billing statement</Text>
          <Text style={styles.headline}>Hi {firstNameOf(data.partnerName)},</Text>
          <Text style={styles.intro}>
            Your self-bill for the period is summarised below, with a job-by-job breakdown for your
            accounting records. This is a self-billed invoice issued by Getfixfy Ltd on your behalf.
          </Text>

          {showPayoutBanner ? (
            <View style={styles.paidBanner} wrap={false}>
              <Text style={styles.paidEyebrow}>Payout</Text>
              <Text style={styles.paidText}>
                {fmt(data.netPayout)} for {data.jobsCount} job{data.jobsCount === 1 ? "" : "s"} this period
                {data.paymentDueDate ? ` · due ${data.paymentDueDate}` : ""}
              </Text>
            </View>
          ) : null}

          {isVoided ? (
            <View style={styles.voidBox} wrap={false}>
              <Text style={styles.voidTitle}>Payout adjustment (no longer due)</Text>
              <Text style={styles.voidRow}>Original amount: {fmt(originalAmt)}</Text>
              <Text style={styles.voidRow}>Payable amount: {fmt(data.netPayout)}</Text>
              <Text style={styles.voidRow}>Status: {data.partnerStatusLabel ?? data.status}</Text>
              {data.financeStatusLabel ? (
                <Text style={styles.voidRow}>Finance record: {data.financeStatusLabel}</Text>
              ) : null}
              {data.payoutVoidReason ? (
                <Text style={styles.voidReason}>Reason: {data.payoutVoidReason}</Text>
              ) : null}
            </View>
          ) : null}

          {/* Reference bar */}
          <View style={styles.refBar} wrap={false}>
            <View style={styles.refRow}>
              <Text style={styles.refKey}>Self-bill Ref</Text>
              <Text style={styles.refVal}>{data.reference}</Text>
            </View>
            <View style={data.paymentDueDate ? styles.refRow : styles.refRowLast}>
              <Text style={styles.refKey}>Period</Text>
              <Text style={styles.refVal}>{periodText}</Text>
            </View>
            {data.paymentDueDate ? (
              <View style={styles.refRowLast}>
                <Text style={styles.refKey}>Payment due</Text>
                <Text style={styles.refVal}>{data.paymentDueDate}</Text>
              </View>
            ) : null}
          </View>

          {/* Summary */}
          <Text style={styles.sectionLabel}>Summary</Text>
          <View style={styles.card} wrap={false}>
            <View style={styles.lineRow}>
              <Text style={styles.lineLabel}>Jobs completed</Text>
              <Text style={styles.lineVal}>{data.jobsCount}</Text>
            </View>
            <View style={styles.lineRow}>
              <Text style={styles.lineLabel}>Labour</Text>
              <Text style={styles.lineVal}>{fmt(data.jobValue)}</Text>
            </View>
            <View style={styles.lineRow}>
              <Text style={styles.lineLabel}>Materials reimbursed</Text>
              <Text style={styles.lineVal}>{fmt(data.materials)}</Text>
            </View>
            {data.commission > 0.01 ? (
              <View style={styles.lineRow}>
                <Text style={styles.lineLabel}>Commission</Text>
                <Text style={styles.lineVal}>-{fmt(data.commission)}</Text>
              </View>
            ) : null}
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Total payout</Text>
              <Text style={styles.totalVal}>{fmt(data.netPayout)}</Text>
            </View>
          </View>

          {/* Per-job breakdown */}
          {data.lines.length > 0 ? (
            <>
              <Text style={styles.sectionLabel}>Job-by-job breakdown</Text>
              <View style={{ marginBottom: 14 }}>
                <View style={styles.tableHead} wrap={false}>
                  <Text style={[styles.th, styles.cellRef]}>Job</Text>
                  <Text style={[styles.th, styles.cellTitle]}>Title</Text>
                  <Text style={[styles.th, styles.cellAddr]}>Property</Text>
                  <Text style={[styles.th, styles.cellNum]}>Labour</Text>
                  <Text style={[styles.th, styles.cellNum]}>Mat.</Text>
                </View>
                {data.lines.map((line) => (
                  <View key={line.reference} style={styles.tableRow} wrap={false}>
                    <View style={styles.cellRef}>
                      <Text style={styles.cellText}>{line.reference}</Text>
                      {line.jobId ? <Text style={styles.lineId}>Job ID: {line.jobId}</Text> : null}
                      {line.payoutStateNote ? <Text style={styles.lineNote}>{line.payoutStateNote}</Text> : null}
                    </View>
                    <Text style={[styles.cellText, styles.cellTitle]}>{line.title}</Text>
                    <Text style={[styles.cellText, styles.cellAddr]}>{line.property_address ?? "—"}</Text>
                    <Text style={[styles.cellNumText, styles.cellNum]}>{fmt(line.partner_cost)}</Text>
                    <Text style={[styles.cellNumText, styles.cellNum]}>{fmt(line.materials_cost)}</Text>
                  </View>
                ))}
              </View>
            </>
          ) : null}

          {/* HMRC self-billing notice */}
          <View style={styles.notice} wrap={false}>
            <Text style={styles.noticeEyebrow}>About self-billing</Text>
            <Text style={styles.noticeText}>
              This document is issued under a self-billing arrangement in line with UK practice
              (including HMRC guidance on self-billing, e.g. VAT Notice 700/62 where VAT applies).
              The partner named above is the supplier for the supplies summarised here and must not
              issue a separate invoice for the same amounts. Where CIS or VAT applies, each party
              remains responsible for their own returns and records. Retain this for your records.
            </Text>
          </View>
        </View>

        <FixfyPdfFooterGuard />
        {/* Footer (navy, pinned) */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerWordmark}>Fixfy</Text>
          <Text style={styles.footerText}>
            Getfixfy Ltd · Co. No. 15406523{"\n"}
            124 City Road, London EC1V 2NX, United Kingdom · getfixfy.com
          </Text>
        </View>
      </Page>
    </Document>
  );
}
