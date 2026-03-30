import React from "react";
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";

export interface SelfBillPdfLine {
  reference: string;
  title: string;
  partner_cost: number;
  materials_cost: number;
  property_address?: string;
}

export interface SelfBillPdfData {
  reference: string;
  partnerName: string;
  weekLabel?: string;
  weekStart?: string;
  weekEnd?: string;
  period: string;
  jobsCount: number;
  jobValue: number;
  materials: number;
  commission: number;
  netPayout: number;
  status: string;
  lines: SelfBillPdfLine[];
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
});

function fmt(n: number): string {
  return `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function SelfBillPDF({ data }: { data: SelfBillPdfData }) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>Partner self-bill</Text>
        <Text style={styles.subtitle}>
          {data.reference} · {data.partnerName}
          {data.weekLabel ? ` · Week ${data.weekLabel}` : ` · ${data.period}`}
        </Text>
        {data.weekStart && data.weekEnd ? (
          <Text style={{ marginBottom: 12, fontSize: 9 }}>
            Period: {data.weekStart} → {data.weekEnd} (Mon–Sun)
          </Text>
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
            <Text style={styles.cellRef}>{line.reference}</Text>
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
          <Text style={{ marginTop: 8, fontSize: 8, color: "#78716C" }}>Status: {data.status}</Text>
        </View>
      </Page>
    </Document>
  );
}
