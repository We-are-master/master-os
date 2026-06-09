import React from "react";
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import { formatGbpIncVat } from "@/lib/money-display-label";

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
  /** When set (partial request), amount due now — may be less than full balance. */
  amountDueNow?: number;
  /** % of base requested (for PDF note). */
  requestPercent?: number;
}

const styles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 9,
    paddingTop: 40,
    paddingBottom: 50,
    paddingHorizontal: 40,
    color: "#020040",
  },
  eyebrow: { fontSize: 8, letterSpacing: 1.2, color: "#ED4B00", marginBottom: 4 },
  title: { fontSize: 18, marginBottom: 16, fontWeight: "bold" },
  banner: {
    marginBottom: 16,
    padding: 10,
    borderRadius: 4,
    backgroundColor: "#F2F0FA",
  },
  bannerPaid: { backgroundColor: "#E8F5EF" },
  bannerText: { fontSize: 10, fontWeight: "bold" },
  metaRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  metaLabel: { fontSize: 8, color: "#57534E", textTransform: "uppercase" },
  metaValue: { fontSize: 10 },
  section: { marginTop: 14, marginBottom: 8 },
  sectionTitle: { fontSize: 10, fontWeight: "bold", marginBottom: 6 },
  lineRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: "#E7E5E4" },
  totalBox: { marginTop: 12, padding: 12, backgroundColor: "#FAFAF9", borderRadius: 4 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  totalLabel: { fontSize: 11, fontWeight: "bold" },
  foot: { marginTop: 20, fontSize: 7, color: "#57534E", lineHeight: 1.45 },
});

function money(n: number): string {
  return formatGbpIncVat(n);
}

export function InvoicePDF({ data }: { data: InvoicePdfData }) {
  const fullDue = data.balanceDue > 0 ? data.balanceDue : data.amount;
  const requestedDue =
    !data.paid && data.amountDueNow != null && data.amountDueNow > 0
      ? data.amountDueNow
      : fullDue;
  const isPartialRequest =
    !data.paid &&
    data.amountDueNow != null &&
    data.amountDueNow > 0.02 &&
    Math.abs(data.amountDueNow - fullDue) > 0.02;
  const totalLabel = data.paid
    ? "Total paid"
    : isPartialRequest
      ? "Amount due now"
      : data.partial
        ? "Balance due"
        : "Total due";
  const totalAmount = data.paid ? data.amount : requestedDue;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.eyebrow}>{data.paid ? "PAYMENT RECEIPT" : "INVOICE"}</Text>
        <Text style={styles.title}>{data.documentTitle}</Text>

        <View style={data.paid ? [styles.banner, styles.bannerPaid] : styles.banner}>
          <Text style={styles.bannerText}>
            {data.paid
              ? `Payment received — ${money(data.amount)}`
              : data.partial
                ? `Partial payment — ${money(data.paidAmount)} paid, ${money(data.balanceDue)} remaining`
                : isPartialRequest
                  ? `Payment request — ${money(totalAmount)} now (${data.requestPercent ?? 0}% of ${money(fullDue)}) by ${data.dueDate}`
                  : `Amount due — ${money(totalAmount)} by ${data.dueDate}`}
          </Text>
        </View>

        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>Reference</Text>
          <Text style={styles.metaValue}>{data.reference}</Text>
        </View>
        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>Client</Text>
          <Text style={styles.metaValue}>{data.clientName}</Text>
        </View>
        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>Issue date</Text>
          <Text style={styles.metaValue}>{data.issueDate}</Text>
        </View>
        {!data.paid ? (
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Due date</Text>
            <Text style={styles.metaValue}>{data.dueDate}</Text>
          </View>
        ) : data.paymentDate ? (
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Payment date</Text>
            <Text style={styles.metaValue}>{data.paymentDate}</Text>
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Work</Text>
          <View style={styles.lineRow}>
            <Text>Job</Text>
            <Text>{data.jobTitle}</Text>
          </View>
          {data.jobReference ? (
            <View style={styles.lineRow}>
              <Text>Job ref</Text>
              <Text>{data.jobReference}</Text>
            </View>
          ) : null}
          {data.quoteReference ? (
            <View style={styles.lineRow}>
              <Text>Quote</Text>
              <Text>{data.quoteReference}</Text>
            </View>
          ) : null}
          {data.serviceType ? (
            <View style={styles.lineRow}>
              <Text>Type of work</Text>
              <Text>{data.serviceType}</Text>
            </View>
          ) : null}
          {data.propertyAddress ? (
            <View style={styles.lineRow}>
              <Text>Property</Text>
              <Text>{data.propertyAddress}</Text>
            </View>
          ) : null}
          {data.completionDate ? (
            <View style={styles.lineRow}>
              <Text>Completed</Text>
              <Text>{data.completionDate}</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Breakdown</Text>
          <View style={styles.lineRow}>
            <Text>Trade services</Text>
            <Text>{money(data.tradeAmount)}</Text>
          </View>
          <View style={styles.lineRow}>
            <Text>Fixfy platform fee</Text>
            <Text>{money(data.feeAmount)}</Text>
          </View>
        </View>

        <View style={styles.totalBox}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>{totalLabel}</Text>
            <Text style={styles.totalLabel}>{money(totalAmount)}</Text>
          </View>
          {data.partial ? (
            <View style={styles.totalRow}>
              <Text>Already paid</Text>
              <Text>{money(data.paidAmount)}</Text>
            </View>
          ) : null}
        </View>

        <Text style={styles.foot}>
          Fixfy operates as a disclosed platform connecting clients with independent trade providers.
          {data.paid
            ? " This receipt confirms your payment for the work listed above."
            : " This invoice covers the work completed below."}
        </Text>
      </Page>
    </Document>
  );
}
