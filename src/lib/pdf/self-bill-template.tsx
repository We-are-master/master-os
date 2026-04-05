import React from "react";
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";

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
}

const styles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 9,
    paddingTop: 40,
    paddingBottom: 50,
    paddingHorizontal: 40,
    color: "#1C1917",
  },
  title: { fontSize: 16, marginBottom: 4, fontWeight: "bold" },
  subtitle: { fontSize: 10, color: "#57534E", marginBottom: 16 },
  row: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#E7E5E4", paddingVertical: 6 },
  th: { fontWeight: "bold", fontSize: 8, color: "#57534E" },
  cellRef: { width: "18%" },
  cellTitle: { width: "32%" },
  cellAddr: { width: "30%" },
  cellNum: { width: "10%", textAlign: "right" },
  totals: { marginTop: 16, padding: 12, backgroundColor: "#FAFAF9", borderRadius: 4 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  ukNote: {
    marginTop: 20,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#E7E5E4",
    fontSize: 7,
    color: "#57534E",
    lineHeight: 1.45,
  },
  voidBox: {
    marginBottom: 14,
    padding: 10,
    backgroundColor: "#F5F5F4",
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "#D6D3D1",
  },
  voidTitle: { fontSize: 10, fontWeight: "bold", marginBottom: 6, color: "#44403C" },
  voidRow: { fontSize: 9, marginBottom: 3, color: "#44403C" },
  voidReason: { fontSize: 8, marginTop: 6, color: "#57534E", lineHeight: 1.4 },
  lineNote: { fontSize: 7, color: "#78716C", marginTop: 2 },
  lineId: { fontSize: 6, color: "#A8A29E", marginTop: 1 },
});

function fmt(n: number): string {
  return `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>Self-billing statement (UK)</Text>
        <Text style={styles.subtitle}>
          {data.reference} · {data.partnerName}
          {data.weekLabel ? ` · Week ${data.weekLabel}` : ` · ${data.period}`}
        </Text>
        {data.weekStart && data.weekEnd ? (
          <Text style={{ marginBottom: 12, fontSize: 9 }}>
            Period: {data.weekStart} → {data.weekEnd} (Mon–Sun)
            {data.paymentDueDate ? ` · Payment due: ${data.paymentDueDate} (Friday after week ends)` : ""}
          </Text>
        ) : null}

        {isVoided ? (
          <View style={styles.voidBox}>
            <Text style={styles.voidTitle}>Payout adjustment (no longer due)</Text>
            <Text style={styles.voidRow}>Original amount: {fmt(originalAmt)}</Text>
            <Text style={styles.voidRow}>Payable amount: {fmt(data.netPayout)}</Text>
            <Text style={styles.voidRow}>
              Status: {data.partnerStatusLabel ?? data.status}
            </Text>
            {data.financeStatusLabel ? (
              <Text style={styles.voidRow}>Finance record: {data.financeStatusLabel}</Text>
            ) : null}
            {data.payoutVoidReason ? (
              <Text style={styles.voidReason}>Reason: {data.payoutVoidReason}</Text>
            ) : null}
          </View>
        ) : null}

        <View style={[styles.row, { borderBottomWidth: 2 }]}>
          <Text style={[styles.th, styles.cellRef]}>Job</Text>
          <Text style={[styles.th, styles.cellTitle]}>Title</Text>
          <Text style={[styles.th, styles.cellAddr]}>Property</Text>
          <Text style={[styles.th, styles.cellNum]}>Labour</Text>
          <Text style={[styles.th, styles.cellNum]}>Mat.</Text>
        </View>
        {data.lines.map((line) => (
          <View key={line.reference} style={styles.row} wrap={false}>
            <View style={styles.cellRef}>
              <Text>{line.reference}</Text>
              {line.jobId ? <Text style={styles.lineId}>Job ID: {line.jobId}</Text> : null}
              {line.payoutStateNote ? <Text style={styles.lineNote}>{line.payoutStateNote}</Text> : null}
            </View>
            <Text style={styles.cellTitle}>{line.title}</Text>
            <Text style={styles.cellAddr}>{line.property_address ?? "—"}</Text>
            <Text style={styles.cellNum}>{fmt(line.partner_cost)}</Text>
            <Text style={styles.cellNum}>{fmt(line.materials_cost)}</Text>
          </View>
        ))}

        <View style={styles.totals}>
          <Text style={{ fontWeight: "bold", marginBottom: 8 }}>Summary</Text>
          <View style={styles.totalRow}>
            <Text>Jobs</Text>
            <Text>{data.jobsCount}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text>Partner labour</Text>
            <Text>{fmt(data.jobValue)}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text>Materials</Text>
            <Text>{fmt(data.materials)}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text>Commission</Text>
            <Text>-{fmt(data.commission)}</Text>
          </View>
          <View style={[styles.totalRow, { marginTop: 8, fontWeight: "bold", fontSize: 11 }]}>
            <Text>Net payout</Text>
            <Text>{fmt(data.netPayout)}</Text>
          </View>
          {isVoided && originalAmt > 0.01 ? (
            <Text style={{ marginTop: 6, fontSize: 8, color: "#78716C" }}>
              Original amount (for records): {fmt(originalAmt)}
            </Text>
          ) : null}
          <Text style={{ marginTop: 8, fontSize: 8, color: "#78716C" }}>
            Record status: {data.partnerStatusLabel ?? data.status}
            {data.payoutVoidReason ? ` · ${data.payoutVoidReason}` : ""}
          </Text>
        </View>

        <Text style={styles.ukNote}>
          This document is issued under a self-billing arrangement in line with UK practice (including HMRC guidance on self-billing, e.g. VAT Notice 700/62 where VAT applies). The partner named above is the supplier for the supplies summarised here; they must not issue a separate invoice or self-billed document for the same amounts. Where Construction Industry Scheme (CIS) or VAT applies, each party remains responsible for their own returns and records. Retain this statement for your business and tax records.
        </Text>
      </Page>
    </Document>
  );
}
