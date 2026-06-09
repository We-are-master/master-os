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

/* Brand palette — mirrors the Statement of Charges email
 * (src/lib/email-templates/invoice-client.html). */
const NAVY = "#020040";
const ORANGE = "#ED4B00";
const LILAC = "#F2F0FA";
const TEXT = "#1A1A1A";
const MUTED = "#4A4A55";
const LABEL = "#9A9AA8";
const BORDER = "#E8E8EE";
const HAIRLINE = "#F2F0FA";
const PAD = 40;

const styles = StyleSheet.create({
  page: { fontFamily: "Helvetica", fontSize: 10, color: NAVY, paddingBottom: 0 },

  // Header
  headerBand: { backgroundColor: NAVY, paddingVertical: 22, alignItems: "center" },
  wordmark: { fontFamily: "Helvetica-Bold", fontSize: 22, color: "#FFFFFF", letterSpacing: 0.5 },
  accentBar: { backgroundColor: ORANGE, height: 5 },

  body: { paddingHorizontal: PAD, paddingTop: 28 },

  eyebrow: { fontFamily: "Helvetica-Bold", fontSize: 9, letterSpacing: 2.5, color: ORANGE, textTransform: "uppercase", marginBottom: 8 },
  headline: { fontFamily: "Helvetica-Bold", fontSize: 22, color: NAVY, marginBottom: 8 },
  intro: { fontSize: 11, lineHeight: 1.5, color: MUTED, marginBottom: 22 },

  sectionLabel: { fontFamily: "Helvetica-Bold", fontSize: 9, letterSpacing: 1.6, color: NAVY, textTransform: "uppercase", marginBottom: 10 },

  // Reference bar
  refBar: { backgroundColor: LILAC, borderRadius: 8, padding: 16, marginBottom: 24 },
  refRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 7 },
  refRowLast: { flexDirection: "row", justifyContent: "space-between" },
  refKey: { fontFamily: "Helvetica-Bold", fontSize: 9, letterSpacing: 1, color: LABEL, textTransform: "uppercase" },
  refVal: { fontFamily: "Helvetica-Bold", fontSize: 11, color: NAVY },
  refValDue: { fontFamily: "Helvetica-Bold", fontSize: 11, color: ORANGE },

  // Cards
  card: { borderWidth: 1, borderColor: BORDER, borderRadius: 8, marginBottom: 24 },
  cardHead: { padding: 16, borderBottomWidth: 1, borderBottomColor: BORDER },
  cardHeadText: { fontFamily: "Helvetica-Bold", fontSize: 14, color: NAVY },
  infoRow: { flexDirection: "row", paddingHorizontal: 16, paddingVertical: 11 },
  infoDivider: { borderTopWidth: 1, borderTopColor: HAIRLINE },
  infoKey: { width: "35%", fontFamily: "Helvetica-Bold", fontSize: 9, letterSpacing: 0.8, color: LABEL, textTransform: "uppercase" },
  infoVal: { flex: 1, fontSize: 11, color: TEXT, lineHeight: 1.4 },
  infoValMuted: { color: MUTED },

  // Breakdown
  lineRow: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: HAIRLINE },
  lineLabel: { fontSize: 11, color: TEXT },
  lineVal: { fontFamily: "Helvetica-Bold", fontSize: 11, color: NAVY },
  totalRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: LILAC, paddingHorizontal: 16, paddingVertical: 14 },
  totalLabel: { fontFamily: "Helvetica-Bold", fontSize: 11, letterSpacing: 1, color: NAVY, textTransform: "uppercase" },
  totalVal: { fontFamily: "Helvetica-Bold", fontSize: 20, color: NAVY },

  // Notes
  paidNote: { backgroundColor: "#E8F5EF", borderRadius: 8, padding: 14, marginBottom: 22 },
  paidNoteText: { fontSize: 11, color: "#0F6B45", fontFamily: "Helvetica-Bold" },
  vatNote: { backgroundColor: "#FFF1EA", borderLeftWidth: 4, borderLeftColor: ORANGE, borderRadius: 4, padding: 14, marginBottom: 24 },
  vatEyebrow: { fontFamily: "Helvetica-Bold", fontSize: 8, letterSpacing: 2, color: ORANGE, textTransform: "uppercase", marginBottom: 4 },
  vatText: { fontSize: 10, lineHeight: 1.5, color: NAVY },

  // Footer
  footer: { backgroundColor: NAVY, paddingVertical: 22, paddingHorizontal: PAD, alignItems: "center", marginTop: 8 },
  footerWordmark: { fontFamily: "Helvetica-Bold", fontSize: 14, color: "#FFFFFF", marginBottom: 8 },
  footerText: { fontSize: 8, lineHeight: 1.6, color: "#AAAAD0", textAlign: "center" },
});

function money(n: number): string {
  return formatGbpIncVat(n);
}

function firstNameOf(name: string): string {
  const t = (name || "").trim().split(/\s+/)[0];
  return t || "there";
}

export function InvoicePDF({ data }: { data: InvoicePdfData }) {
  const isPaid = data.paid;
  const eyebrow = isPaid ? "PAYMENT RECEIPT" : "STATEMENT OF CHARGES";
  const intro = isPaid
    ? "Thank you — your payment has been received. This statement is for your records."
    : "Your job is complete. Below is your statement of charges. This statement PDF is for your records.";
  const totalLabel = isPaid ? "Amount paid" : data.partial ? "Balance due" : "Amount due";
  const totalAmount = isPaid ? data.amount : data.balanceDue > 0 ? data.balanceDue : data.amount;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.headerBand}>
          <Text style={styles.wordmark}>Fixfy</Text>
        </View>
        <View style={styles.accentBar} />

        <View style={styles.body}>
          <Text style={styles.eyebrow}>{eyebrow}</Text>
          <Text style={styles.headline}>Hi {firstNameOf(data.clientName)},</Text>
          <Text style={styles.intro}>{intro}</Text>

          {isPaid ? (
            <View style={styles.paidNote}>
              <Text style={styles.paidNoteText}>
                Payment received — {money(data.amount)}
                {data.paymentDate ? ` on ${data.paymentDate}` : ""}
              </Text>
            </View>
          ) : null}

          {/* Reference bar */}
          <View style={styles.refBar}>
            <View style={styles.refRow}>
              <Text style={styles.refKey}>{isPaid ? "Receipt Ref" : "Statement Ref"}</Text>
              <Text style={styles.refVal}>{data.reference}</Text>
            </View>
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
          </View>

          {/* Job completed */}
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

          {/* Charges breakdown */}
          <Text style={styles.sectionLabel}>Charges breakdown</Text>
          <View style={styles.card}>
            <View style={styles.lineRow}>
              <Text style={styles.lineLabel}>Trade services</Text>
              <Text style={styles.lineVal}>{money(data.tradeAmount)}</Text>
            </View>
            <View style={styles.lineRow}>
              <Text style={styles.lineLabel}>Fixfy platform fee</Text>
              <Text style={styles.lineVal}>{money(data.feeAmount)}</Text>
            </View>
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

          {/* VAT note */}
          <View style={styles.vatNote}>
            <Text style={styles.vatEyebrow}>Need a VAT invoice?</Text>
            <Text style={styles.vatText}>
              Reply to your statement email or contact support@getfixfy.com and we&#39;ll send one across.
            </Text>
          </View>
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerWordmark}>Fixfy</Text>
          <Text style={styles.footerText}>
            Getfixfy Ltd · Co. No. 15406523{"\n"}
            124 City Road, London EC1V 2NX, United Kingdom · getfixfy.com{"\n"}
            Fixfy operates as a disclosed platform connecting clients with independent trade providers.
          </Text>
        </View>
      </Page>
    </Document>
  );
}
