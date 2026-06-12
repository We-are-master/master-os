import React from "react";
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import { formatGbpIncVat } from "@/lib/money-display-label";
import { displayBillingReference } from "@/lib/billing-reference";

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

const NAVY = "#020040";
const ORANGE = "#ED4B00";
const LILAC = "#F2F0FA";
const TEXT = "#1A1A1A";
const MUTED = "#4A4A55";
const LABEL = "#6B6E7B";
const BORDER = "#E8E8EE";
const HAIRLINE = "#F2F0FA";
const FOOTER_INFO = "#AAAAD0";
const PAD = 36;
const FOOTER_HEIGHT = 68;

const styles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 10,
    color: NAVY,
    paddingBottom: FOOTER_HEIGHT + 8,
  },

  headerBand: {
    backgroundColor: NAVY,
    paddingVertical: 12,
    alignItems: "center",
  },
  wordmark: { fontFamily: "Helvetica-Bold", fontSize: 18, color: "#FFFFFF", letterSpacing: 0.5 },
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

  footer: {
    position: "absolute" as const,
    bottom: 0,
    left: 0,
    right: 0,
    height: FOOTER_HEIGHT,
    backgroundColor: NAVY,
    paddingVertical: 12,
    paddingHorizontal: PAD,
    alignItems: "center",
    justifyContent: "center",
  },
  footerWordmark: { fontFamily: "Helvetica-Bold", fontSize: 12, color: "#FFFFFF", marginBottom: 5 },
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
  const isPaid = data.paid;
  const eyebrow = isPaid ? "PAYMENT RECEIPT" : "STATEMENT OF CHARGES";
  const intro = isPaid
    ? "Thank you — your payment has been received. This statement is for your records."
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
          <Text style={styles.wordmark}>Fixfy</Text>
        </View>
        <View style={styles.accentBar} />

        <View style={styles.body}>
          <View style={styles.hero} wrap={false}>
            <Text style={styles.eyebrow}>{eyebrow}</Text>
            <View style={styles.docTitle}>
              <Text style={styles.docRef}>{displayBillingReference(data.reference)}</Text>
              <Text style={styles.docClient}>{data.clientName.trim() || "Client"}</Text>
            </View>
            <Text style={styles.headline}>Hi {firstNameOf(data.clientName)},</Text>
            <Text style={styles.intro}>{intro}</Text>
          </View>

          {isPaid ? (
            <View style={styles.paidNote} wrap={false}>
              <Text style={styles.paidNoteText}>
                Payment received — {money(data.amount)}
                {data.paymentDate ? ` on ${data.paymentDate}` : ""}
              </Text>
            </View>
          ) : null}

          <View style={[styles.refBar, styles.sectionGap]} wrap={false}>
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

          <View style={styles.sectionGap} wrap={false}>
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
          </View>

          <View style={styles.sectionGap}>
            <Text style={styles.sectionLabel}>Charges breakdown</Text>
            <View style={styles.card}>
              <View style={styles.lineRow} wrap={false}>
                <Text style={styles.lineLabel}>Trade services</Text>
                <Text style={styles.lineVal}>{money(data.tradeAmount)}</Text>
              </View>
              <View style={styles.lineRow} wrap={false}>
                <Text style={styles.lineLabel}>Fixfy platform fee</Text>
                <Text style={styles.lineVal}>{money(data.feeAmount)}</Text>
              </View>
              {data.partial && !isPaid ? (
                <View style={styles.lineRow} wrap={false}>
                  <Text style={styles.lineLabel}>Already paid</Text>
                  <Text style={styles.lineVal}>{money(data.paidAmount)}</Text>
                </View>
              ) : null}
              <View style={styles.totalRow} wrap={false}>
                <Text style={styles.totalLabel}>{totalLabel}</Text>
                <Text style={styles.totalVal}>{money(totalAmount)}</Text>
              </View>
            </View>
          </View>

          <View style={styles.vatNote} wrap={false}>
            <Text style={styles.vatEyebrow}>Need a VAT invoice?</Text>
            <Text style={styles.vatText}>
              Reply to your statement email or contact support@getfixfy.com and we&#39;ll send one across.
            </Text>
          </View>
        </View>

        <View style={styles.footer} fixed>
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
