import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Image,
  Link,
} from "@react-pdf/renderer";

export interface QuotePDFData {
  reference: string;
  title: string;
  clientName: string;
  clientEmail: string;
  totalValue: number;
  createdAt: string;
  expiresAt?: string;
  ownerName?: string;
  items?: QuoteLineItem[];
  notes?: string;
}

export interface QuoteLineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface CompanyBranding {
  companyName: string;
  logoUrl?: string;
  address: string;
  phone: string;
  email: string;
  website?: string;
  vatNumber?: string;
  primaryColor?: string;
  tagline?: string;
}

const DEFAULT_BRANDING: CompanyBranding = {
  companyName: "Master Group",
  address: "123 Business Street, London, UK",
  phone: "+44 20 1234 5678",
  email: "info@mastergroup.com",
  website: "www.mastergroup.com",
  vatNumber: "GB123456789",
  primaryColor: "#F97316",
  tagline: "Professional Property Services",
};

function formatCurrency(value: number): string {
  return `£${value.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatPDFDate(date: string): string {
  return new Date(date).toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });
}

const styles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 10,
    paddingTop: 50,
    paddingBottom: 70,
    paddingHorizontal: 50,
    backgroundColor: "#FFFFFF",
    color: "#1C1917",
  },
  headerBar: {
    height: 4,
    backgroundColor: "#F97316",
    marginBottom: 30,
    borderRadius: 2,
    marginHorizontal: -50,
    marginTop: -50,
    width: 595,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 30,
    paddingTop: 20,
  },
  companySection: {
    flex: 1,
  },
  companyName: {
    fontSize: 22,
    fontFamily: "Helvetica-Bold",
    color: "#F97316",
    marginBottom: 4,
  },
  tagline: {
    fontSize: 9,
    color: "#78716C",
    letterSpacing: 1,
    textTransform: "uppercase" as const,
    marginBottom: 8,
  },
  companyDetail: {
    fontSize: 8.5,
    color: "#57534E",
    marginBottom: 2,
  },
  quoteInfo: {
    alignItems: "flex-end" as const,
    flex: 1,
  },
  quoteLabel: {
    fontSize: 28,
    fontFamily: "Helvetica-Bold",
    color: "#E7E5E4",
    textTransform: "uppercase" as const,
    marginBottom: 10,
  },
  refRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 4,
  },
  refLabel: {
    fontSize: 8,
    color: "#A8A29E",
    textTransform: "uppercase" as const,
    letterSpacing: 0.5,
    width: 60,
    textAlign: "right" as const,
    marginRight: 8,
  },
  refValue: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    color: "#1C1917",
  },
  divider: {
    borderBottomWidth: 1,
    borderBottomColor: "#E7E5E4",
    marginVertical: 20,
  },
  thinDivider: {
    borderBottomWidth: 0.5,
    borderBottomColor: "#F5F5F4",
    marginVertical: 12,
  },
  clientSection: {
    backgroundColor: "#FAFAF9",
    borderRadius: 8,
    padding: 20,
    marginBottom: 24,
  },
  sectionLabel: {
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    color: "#A8A29E",
    textTransform: "uppercase" as const,
    letterSpacing: 1.5,
    marginBottom: 10,
  },
  clientName: {
    fontSize: 14,
    fontFamily: "Helvetica-Bold",
    color: "#1C1917",
    marginBottom: 4,
  },
  clientDetail: {
    fontSize: 9,
    color: "#57534E",
    marginBottom: 2,
  },
  titleSection: {
    marginBottom: 24,
  },
  quoteTitle: {
    fontSize: 16,
    fontFamily: "Helvetica-Bold",
    color: "#1C1917",
    marginBottom: 6,
  },
  quoteSubtitle: {
    fontSize: 9,
    color: "#78716C",
    lineHeight: 1.5,
  },
  table: {
    marginBottom: 24,
  },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#1C1917",
    borderRadius: 4,
    padding: 10,
    marginBottom: 2,
  },
  tableHeaderText: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: "#FFFFFF",
    textTransform: "uppercase" as const,
    letterSpacing: 0.5,
  },
  tableRow: {
    flexDirection: "row",
    padding: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: "#F5F5F4",
  },
  tableRowAlt: {
    flexDirection: "row",
    padding: 10,
    backgroundColor: "#FAFAF9",
    borderBottomWidth: 0.5,
    borderBottomColor: "#F5F5F4",
  },
  colDesc: { flex: 3 },
  colQty: { flex: 0.7, textAlign: "center" as const },
  colUnit: { flex: 1, textAlign: "right" as const },
  colTotal: { flex: 1, textAlign: "right" as const },
  cellText: {
    fontSize: 9,
    color: "#1C1917",
  },
  cellTextBold: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: "#1C1917",
  },
  totalSection: {
    alignItems: "flex-end" as const,
    marginBottom: 30,
  },
  totalBox: {
    width: 220,
    backgroundColor: "#FAFAF9",
    borderRadius: 8,
    padding: 16,
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  totalLabel: {
    fontSize: 9,
    color: "#78716C",
  },
  totalValue: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: "#1C1917",
  },
  grandTotalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: 10,
    borderTopWidth: 1.5,
    borderTopColor: "#F97316",
    marginTop: 6,
  },
  grandTotalLabel: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    color: "#1C1917",
  },
  grandTotalValue: {
    fontSize: 14,
    fontFamily: "Helvetica-Bold",
    color: "#F97316",
  },
  notesSection: {
    backgroundColor: "#FFFBEB",
    borderRadius: 8,
    padding: 16,
    marginBottom: 24,
    borderLeftWidth: 3,
    borderLeftColor: "#F97316",
  },
  notesTitle: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: "#92400E",
    textTransform: "uppercase" as const,
    letterSpacing: 1,
    marginBottom: 6,
  },
  notesText: {
    fontSize: 9,
    color: "#78716C",
    lineHeight: 1.6,
  },
  termsSection: {
    marginBottom: 24,
  },
  termItem: {
    flexDirection: "row",
    marginBottom: 4,
    alignItems: "flex-start",
  },
  termBullet: {
    width: 12,
    fontSize: 8,
    color: "#F97316",
    fontFamily: "Helvetica-Bold",
  },
  termText: {
    flex: 1,
    fontSize: 8,
    color: "#78716C",
    lineHeight: 1.5,
  },
  footer: {
    position: "absolute" as const,
    bottom: 30,
    left: 50,
    right: 50,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: 12,
    borderTopWidth: 0.5,
    borderTopColor: "#E7E5E4",
  },
  footerText: {
    fontSize: 7,
    color: "#A8A29E",
  },
  footerBrand: {
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    color: "#F97316",
  },
});

export function QuotePDF({
  data,
  branding = DEFAULT_BRANDING,
}: {
  data: QuotePDFData;
  branding?: CompanyBranding;
}) {
  const color = branding.primaryColor ?? "#F97316";
  const subtotal = data.items?.reduce((s, i) => s + i.total, 0) ?? data.totalValue;
  const vat = subtotal * 0.2;
  const grandTotal = subtotal + vat;

  const defaultItems: QuoteLineItem[] = data.items ?? [
    { description: data.title || "Professional Services", quantity: 1, unitPrice: data.totalValue, total: data.totalValue },
  ];

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={[styles.headerBar, { backgroundColor: color }]} />

        {/* Header */}
        <View style={styles.header}>
          <View style={styles.companySection}>
            {branding.logoUrl && (
              <Image src={branding.logoUrl} style={{ width: 120, height: 40, marginBottom: 8, objectFit: "contain" as const }} />
            )}
            <Text style={[styles.companyName, { color }]}>{branding.companyName}</Text>
            {branding.tagline && <Text style={styles.tagline}>{branding.tagline}</Text>}
            <Text style={styles.companyDetail}>{branding.address}</Text>
            <Text style={styles.companyDetail}>{branding.phone}</Text>
            <Text style={styles.companyDetail}>{branding.email}</Text>
            {branding.vatNumber && <Text style={styles.companyDetail}>VAT: {branding.vatNumber}</Text>}
          </View>
          <View style={styles.quoteInfo}>
            <Text style={styles.quoteLabel}>QUOTE</Text>
            <View style={styles.refRow}>
              <Text style={styles.refLabel}>Ref</Text>
              <Text style={styles.refValue}>{data.reference}</Text>
            </View>
            <View style={styles.refRow}>
              <Text style={styles.refLabel}>Date</Text>
              <Text style={styles.refValue}>{formatPDFDate(data.createdAt)}</Text>
            </View>
            {data.expiresAt && (
              <View style={styles.refRow}>
                <Text style={styles.refLabel}>Valid Until</Text>
                <Text style={styles.refValue}>{formatPDFDate(data.expiresAt)}</Text>
              </View>
            )}
            {data.ownerName && (
              <View style={styles.refRow}>
                <Text style={styles.refLabel}>Prepared by</Text>
                <Text style={styles.refValue}>{data.ownerName}</Text>
              </View>
            )}
          </View>
        </View>

        {/* Client */}
        <View style={styles.clientSection}>
          <Text style={styles.sectionLabel}>Quote For</Text>
          <Text style={styles.clientName}>{data.clientName}</Text>
          {data.clientEmail && <Text style={styles.clientDetail}>{data.clientEmail}</Text>}
        </View>

        {/* Title */}
        <View style={styles.titleSection}>
          <Text style={styles.sectionLabel}>Service Description</Text>
          <Text style={styles.quoteTitle}>{data.title}</Text>
        </View>

        {/* Line Items */}
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[styles.tableHeaderText, styles.colDesc]}>Description</Text>
            <Text style={[styles.tableHeaderText, styles.colQty]}>Qty</Text>
            <Text style={[styles.tableHeaderText, styles.colUnit]}>Unit Price</Text>
            <Text style={[styles.tableHeaderText, styles.colTotal]}>Total</Text>
          </View>
          {defaultItems.map((item, i) => (
            <View key={i} style={i % 2 === 1 ? styles.tableRowAlt : styles.tableRow}>
              <Text style={[styles.cellText, styles.colDesc]}>{item.description}</Text>
              <Text style={[styles.cellText, styles.colQty]}>{item.quantity}</Text>
              <Text style={[styles.cellText, styles.colUnit]}>{formatCurrency(item.unitPrice)}</Text>
              <Text style={[styles.cellTextBold, styles.colTotal]}>{formatCurrency(item.total)}</Text>
            </View>
          ))}
        </View>

        {/* Totals */}
        <View style={styles.totalSection}>
          <View style={styles.totalBox}>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Subtotal</Text>
              <Text style={styles.totalValue}>{formatCurrency(subtotal)}</Text>
            </View>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>VAT (20%)</Text>
              <Text style={styles.totalValue}>{formatCurrency(vat)}</Text>
            </View>
            <View style={[styles.grandTotalRow, { borderTopColor: color }]}>
              <Text style={styles.grandTotalLabel}>Total</Text>
              <Text style={[styles.grandTotalValue, { color }]}>{formatCurrency(grandTotal)}</Text>
            </View>
          </View>
        </View>

        {/* Notes */}
        {data.notes && (
          <View style={[styles.notesSection, { borderLeftColor: color }]}>
            <Text style={styles.notesTitle}>Notes</Text>
            <Text style={styles.notesText}>{data.notes}</Text>
          </View>
        )}

        {/* Terms */}
        <View style={styles.termsSection}>
          <Text style={styles.sectionLabel}>Terms & Conditions</Text>
          {[
            "This quote is valid for 30 days from the date of issue unless otherwise stated.",
            "Payment is due within 14 days of invoice date.",
            "All prices are in GBP and exclude VAT unless otherwise stated.",
            "Work will commence upon written acceptance of this quotation.",
            "Any variations to the scope of work may result in additional charges.",
          ].map((term, i) => (
            <View key={i} style={styles.termItem}>
              <Text style={[styles.termBullet, { color }]}>•</Text>
              <Text style={styles.termText}>{term}</Text>
            </View>
          ))}
        </View>

        {/* Footer */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>
            {branding.companyName} — {data.reference} — Generated {new Date().toLocaleDateString("en-GB")}
          </Text>
          <Text style={[styles.footerBrand, { color }]}>{branding.website ?? branding.email}</Text>
        </View>
      </Page>
    </Document>
  );
}
