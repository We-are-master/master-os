import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Image,
} from "@react-pdf/renderer";
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

export interface QuotePDFData {
  reference: string;
  title: string;
  clientName: string;
  clientEmail: string;
  /** VAT-inclusive grand total — matches the Total Price shown in the app drawer and portal. */
  totalValue: number;
  createdAt: string;
  expiresAt?: string;
  ownerName?: string;
  items?: QuoteLineItem[];
  notes?: string;
  /** Shown in email for accept/reject so client sees full quote. */
  depositRequired?: number;
  scope?: string;
  /** Service / trade category — rendered in the Job Details block. */
  serviceType?: string;
  /** Site address — rendered in the Job Details block. */
  propertyAddress?: string;
  /** VAT rate used to back out subtotal/VAT from `totalValue`. Defaults to 20% if not provided. */
  vatPercent?: number;
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
  companyName: "Getfixfy Ltd",
  address: "124 City Road, London EC1V 2NX, United Kingdom",
  phone: "020 4538 4668",
  email: "support@getfixfy.com",
  website: "getfixfy.com",
  vatNumber: "GB123456789",
  primaryColor: "#ED4B00",
  tagline: "Professional Property Services",
};

const NAVY = FIXFY_PDF_NAVY;
const ORANGE = FIXFY_PDF_ORANGE;
const INK = "#1A1A1A";
const SLATE = "#4A4A55";
const LABEL = "#6B6E7B";
const MUTED = "#9A9AA8";
const CARD_BG = "#F7F7FA";
const LAVENDER = "#F2F0FA";
const BORDER = "#E8E8EE";
const HAIRLINE = "#F2F0FA";
const ORANGE_TINT = "#FFF1EA";
const FOOTER_INFO = "#AAAAD0";

function formatCurrency(value: number): string {
  return `£${value.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatPDFDate(date: string): string {
  return new Date(date).toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });
}

function firstNameOf(name: string): string {
  const t = (name ?? "").trim().split(/\s+/)[0];
  return t || "there";
}

const styles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 10,
    color: INK,
    backgroundColor: "#FFFFFF",
    ...fixfyPdfPageMargins,
  },

  header: {
    backgroundColor: NAVY,
    paddingTop: 14,
    paddingBottom: 14,
    paddingHorizontal: FIXFY_PDF_PAD_H,
    alignItems: "flex-start" as const,
    marginTop: -FIXFY_PDF_PAGE_GAP,
  },
  headerLogo: fixfyPdfHeaderLogoStyle,
  headerCompany: { color: "#FFFFFF", fontSize: 15, fontFamily: "Helvetica-Bold", letterSpacing: 0.5 },
  orangeBar: { height: 4, backgroundColor: ORANGE },

  body: { paddingHorizontal: FIXFY_PDF_PAD_H, paddingTop: FIXFY_PDF_PAGE_GAP },

  hero: { marginBottom: 16 },
  eyebrow: {
    fontSize: 8.5,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 2.5,
    color: ORANGE,
    textTransform: "uppercase" as const,
    marginBottom: 6,
  },
  headline: {
    fontSize: 19,
    fontFamily: "Helvetica-Bold",
    color: NAVY,
    marginBottom: 8,
    lineHeight: 1.25,
  },
  intro: {
    fontSize: 10,
    color: SLATE,
    lineHeight: 1.55,
  },

  sectionLabel: {
    fontSize: 8.5,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 1.8,
    color: NAVY,
    textTransform: "uppercase" as const,
    marginBottom: 8,
  },
  sectionGap: { marginBottom: 14 },

  refBar: {
    backgroundColor: LAVENDER,
    borderRadius: 8,
    paddingVertical: 11,
    paddingHorizontal: 16,
    marginBottom: 14,
  },
  refRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  refRowGap: { marginTop: 6 },
  refLabel: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 1.2,
    color: LABEL,
    textTransform: "uppercase" as const,
    flexShrink: 0,
  },
  refValueStrong: { fontSize: 11, fontFamily: "Helvetica-Bold", color: NAVY, textAlign: "right" as const },
  refValue: { fontSize: 10, color: NAVY, textAlign: "right" as const },

  detailBox: { borderWidth: 1, borderColor: BORDER, borderRadius: 8, marginBottom: 14 },
  detailHeader: {
    paddingVertical: 11,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  detailTitle: { fontSize: 13, fontFamily: "Helvetica-Bold", color: NAVY, lineHeight: 1.35 },
  detailRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 9,
    paddingHorizontal: 16,
    gap: 10,
  },
  detailRowDivider: { borderTopWidth: 1, borderTopColor: HAIRLINE },
  detailKey: {
    width: 72,
    flexShrink: 0,
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 0.8,
    color: LABEL,
    textTransform: "uppercase" as const,
    paddingTop: 1,
  },
  detailVal: { flex: 1, fontSize: 10, color: INK, lineHeight: 1.45 },

  scopeCard: {
    backgroundColor: CARD_BG,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 14,
  },
  scopeText: { fontSize: 10, color: INK, lineHeight: 1.5 },

  priceBox: { borderWidth: 1, borderColor: BORDER, borderRadius: 8, marginBottom: 14 },
  priceRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: HAIRLINE,
  },
  priceLeft: { flex: 1, minWidth: 0 },
  priceName: { fontSize: 10, color: INK, lineHeight: 1.4 },
  priceSub: { fontSize: 8, color: MUTED, marginTop: 2, lineHeight: 1.3 },
  priceAmount: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    color: NAVY,
    minWidth: 68,
    textAlign: "right" as const,
    flexShrink: 0,
  },
  subRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 7,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: HAIRLINE,
  },
  subLabel: { fontSize: 9, color: SLATE },
  subValue: { fontSize: 9.5, fontFamily: "Helvetica-Bold", color: NAVY, minWidth: 68, textAlign: "right" as const },
  totalRow: {
    backgroundColor: LAVENDER,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  totalLabel: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 0.8,
    color: NAVY,
    textTransform: "uppercase" as const,
  },
  totalAmount: { fontSize: 17, fontFamily: "Helvetica-Bold", color: NAVY },

  acceptNote: {
    backgroundColor: ORANGE_TINT,
    borderLeftWidth: 3,
    borderLeftColor: ORANGE,
    borderTopRightRadius: 6,
    borderBottomRightRadius: 6,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 14,
  },
  acceptTitle: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 1.5,
    color: ORANGE,
    textTransform: "uppercase" as const,
    marginBottom: 4,
  },
  acceptText: { fontSize: 9.5, color: NAVY, lineHeight: 1.45 },

  termsGrid: { flexDirection: "row", flexWrap: "wrap", marginBottom: 10 },
  termCell: { width: "50%", padding: 3 },
  termCard: {
    backgroundColor: CARD_BG,
    borderRadius: 6,
    paddingVertical: 8,
    paddingHorizontal: 10,
    minHeight: 52,
  },
  termTitle: { fontSize: 8.5, fontFamily: "Helvetica-Bold", color: NAVY, marginBottom: 3 },
  termText: { fontSize: 8, color: SLATE, lineHeight: 1.4 },

  helpCard: {
    backgroundColor: LAVENDER,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 6,
  },
  helpTitle: { fontSize: 9, fontFamily: "Helvetica-Bold", color: NAVY, marginBottom: 3 },
  helpText: { fontSize: 9, color: SLATE, lineHeight: 1.45 },
  helpContact: { fontFamily: "Helvetica-Bold", color: NAVY },

  footer: {
    position: "absolute" as const,
    bottom: 0,
    left: 0,
    right: 0,
    height: FIXFY_PDF_FOOTER_HEIGHT,
    backgroundColor: NAVY,
    paddingVertical: 14,
    paddingHorizontal: FIXFY_PDF_PAD_H,
    alignItems: "center",
    justifyContent: "center",
  },
  footerLogo: { width: 68, height: 18, objectFit: "contain" as const, marginBottom: 6 },
  footerInfo: { fontSize: 7.5, lineHeight: 1.45, color: FOOTER_INFO, textAlign: "center" as const },
});

const TERMS: Array<{ title: string; text: string }> = [
  { title: "Validity", text: "Quote valid for 14 days from issue date." },
  { title: "Scope changes", text: "Any change to scope may affect price & timeline." },
  { title: "Site access", text: "Client to ensure safe access on the agreed date." },
  { title: "Cancellation", text: "Cancellation within 24h of scheduled work may incur a fee." },
];

export function QuotePDF({
  data,
  branding = DEFAULT_BRANDING,
}: {
  data: QuotePDFData;
  branding?: CompanyBranding;
}) {
  const vatPctRaw = Number(data.vatPercent);
  const vatPct = Number.isFinite(vatPctRaw) && vatPctRaw >= 0 ? vatPctRaw : 20;
  const grandTotal = Number(data.totalValue) || 0;
  const subtotal = vatPct > 0 ? grandTotal / (1 + vatPct / 100) : grandTotal;
  const vat = Math.max(0, grandTotal - subtotal);

  const items: QuoteLineItem[] = data.items?.length
    ? data.items
    : [
        {
          description: data.title || "Professional Services",
          quantity: 1,
          unitPrice: grandTotal,
          total: grandTotal,
        },
      ];

  const detailRows: Array<{ key: string; value: string }> = [];
  if (data.serviceType?.trim()) detailRows.push({ key: "Service", value: data.serviceType.trim() });
  if (data.propertyAddress?.trim()) detailRows.push({ key: "Site", value: data.propertyAddress.trim() });

  const footerLine = [branding.companyName, branding.address].filter(Boolean).join(" · ");
  const footerLink = branding.website || branding.email;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          {branding.logoUrl ? (
            <Image src={branding.logoUrl} style={styles.headerLogo} />
          ) : (
            <Text style={styles.headerCompany}>{branding.companyName}</Text>
          )}
        </View>
        <View style={styles.orangeBar} />

        <View style={styles.body}>
          <KeepTogetherBlock minHeight={80} style={styles.hero}>
            <Text style={styles.eyebrow}>Your Quote</Text>
            <Text style={styles.headline}>Hi {firstNameOf(data.clientName)},</Text>
            <Text style={styles.intro}>
              Thanks for the request. Please find your quote below. To accept, simply reply to the
              email this quote was sent with and we&apos;ll schedule the work.
            </Text>
          </KeepTogetherBlock>

          <KeepTogetherBlock minHeight={56} style={[styles.refBar, styles.sectionGap]}>
            <View style={styles.refRow}>
              <Text style={styles.refLabel}>Quote Ref</Text>
              <Text style={styles.refValueStrong}>{data.reference}</Text>
            </View>
            <View style={[styles.refRow, styles.refRowGap]}>
              <Text style={styles.refLabel}>Valid Until</Text>
              <Text style={styles.refValue}>
                {data.expiresAt ? formatPDFDate(data.expiresAt) : "—"}
              </Text>
            </View>
          </KeepTogetherBlock>

          <KeepTogetherBlock minHeight={80} style={styles.sectionGap}>
            <Text style={styles.sectionLabel}>Job Details</Text>
            <View style={styles.detailBox}>
              <View style={styles.detailHeader}>
                <Text style={styles.detailTitle}>{data.title || "Quotation"}</Text>
              </View>
              {detailRows.map((row, i) => (
                <View key={row.key} style={[styles.detailRow, ...(i > 0 ? [styles.detailRowDivider] : [])]}>
                  <Text style={styles.detailKey}>{row.key}</Text>
                  <Text style={styles.detailVal}>{row.value}</Text>
                </View>
              ))}
            </View>
          </KeepTogetherBlock>

          {data.scope?.trim() ? (
            <KeepTogetherBlock minHeight={60} style={styles.sectionGap}>
              <Text style={styles.sectionLabel}>Scope of Work</Text>
              <View style={styles.scopeCard}>
                <Text style={styles.scopeText}>{data.scope.trim()}</Text>
              </View>
            </KeepTogetherBlock>
          ) : null}

          <KeepTogetherBlock minHeight={120} style={styles.sectionGap}>
            <Text style={styles.sectionLabel}>Pricing</Text>
            <View style={styles.priceBox}>
              {items.map((item, i) => (
                <View key={i} style={styles.priceRow} wrap={false}>
                  <View style={styles.priceLeft}>
                    <Text style={styles.priceName}>{item.description}</Text>
                    {item.quantity && item.quantity !== 1 ? (
                      <Text style={styles.priceSub}>
                        {item.quantity} × {formatCurrency(item.unitPrice)}
                      </Text>
                    ) : null}
                  </View>
                  <Text style={styles.priceAmount}>{formatCurrency(item.total)}</Text>
                </View>
              ))}
              <View style={styles.subRow} wrap={false}>
                <Text style={styles.subLabel}>Subtotal (ex VAT)</Text>
                <Text style={styles.subValue}>{formatCurrency(subtotal)}</Text>
              </View>
              <View style={styles.subRow} wrap={false}>
                <Text style={styles.subLabel}>VAT ({vatPct}%)</Text>
                <Text style={styles.subValue}>{formatCurrency(vat)}</Text>
              </View>
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Total</Text>
                <Text style={styles.totalAmount}>{formatCurrency(grandTotal)}</Text>
              </View>
            </View>
          </KeepTogetherBlock>

          <KeepTogetherBlock minHeight={52} style={[styles.acceptNote, styles.sectionGap]}>
            <Text style={styles.acceptTitle}>How to Accept</Text>
            <Text style={styles.acceptText}>
              Reply to the email this quote was sent with confirming you&apos;d like to proceed (ref{" "}
              {data.reference}). We&apos;ll schedule the work and send a confirmation with the date
              and arrival window.
            </Text>
          </KeepTogetherBlock>

          <KeepTogetherBlock minHeight={120}>
            <Text style={styles.sectionLabel}>Terms</Text>
            <View style={styles.termsGrid}>
              {TERMS.map((term) => (
                <View key={term.title} style={styles.termCell}>
                  <View style={styles.termCard}>
                    <Text style={styles.termTitle}>{term.title}</Text>
                    <Text style={styles.termText}>{term.text}</Text>
                  </View>
                </View>
              ))}
            </View>
          </KeepTogetherBlock>

          <KeepTogetherBlock minHeight={44} style={styles.helpCard}>
            <Text style={styles.helpTitle}>Questions about this quote?</Text>
            <Text style={styles.helpText}>
              Reply to the email or contact us at{" "}
              <Text style={styles.helpContact}>{branding.email}</Text>
              {branding.phone ? (
                <Text>
                  {"  ·  "}
                  <Text style={styles.helpContact}>{branding.phone}</Text>
                </Text>
              ) : null}
            </Text>
          </KeepTogetherBlock>
        </View>

        <FixfyPdfFooterGuard />
        <View style={styles.footer} fixed>
          {branding.logoUrl ? <Image src={branding.logoUrl} style={styles.footerLogo} /> : null}
          <Text style={styles.footerInfo}>{footerLine}</Text>
          {footerLink ? <Text style={styles.footerInfo}>{footerLink}</Text> : null}
        </View>
      </Page>
    </Document>
  );
}
