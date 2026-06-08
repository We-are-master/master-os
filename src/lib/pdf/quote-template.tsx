import React from "react";
import { formatGbpIncVat } from "@/lib/money-display-label";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Image,
} from "@react-pdf/renderer";

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

// ── Brand palette (from quote_client.html) ───────────────────────────────────
const NAVY = "#020040";
const ORANGE = "#ED4B00";
const INK = "#1A1A1A";
const SLATE = "#4A4A55";
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
    fontSize: 10.5,
    lineHeight: 1.45,
    color: INK,
    backgroundColor: "#FFFFFF",
    paddingBottom: 86, // reserve room for the fixed navy footer
  },

  // ── Header (navy, centred logo) ────────────────────────────────────────────
  header: {
    backgroundColor: NAVY,
    paddingTop: 24,
    paddingBottom: 18,
    paddingHorizontal: 24,
    alignItems: "center",
  },
  headerLogo: { width: 110, height: 30, objectFit: "contain" as const },
  headerCompany: { color: "#FFFFFF", fontSize: 16, fontFamily: "Helvetica-Bold", letterSpacing: 0.5 },
  orangeBar: { height: 5, backgroundColor: ORANGE },

  // ── Body ───────────────────────────────────────────────────────────────────
  body: { paddingHorizontal: 40, paddingTop: 30 },

  eyebrow: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 3,
    color: ORANGE,
    textTransform: "uppercase" as const,
    marginBottom: 8,
  },
  headline: { fontSize: 22, fontFamily: "Helvetica-Bold", color: NAVY, marginBottom: 8 },
  intro: { fontSize: 11, color: SLATE, lineHeight: 1.6, marginBottom: 26 },

  // ── Section eyebrow (navy) ─────────────────────────────────────────────────
  sectionLabel: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 2,
    color: NAVY,
    textTransform: "uppercase" as const,
    marginBottom: 10,
  },

  // ── Quote reference bar ────────────────────────────────────────────────────
  refBar: { backgroundColor: LAVENDER, borderRadius: 8, paddingVertical: 14, paddingHorizontal: 18, marginBottom: 24 },
  refRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  refRowGap: { marginTop: 6 },
  refLabel: {
    fontSize: 8.5,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 1.5,
    color: MUTED,
    textTransform: "uppercase" as const,
  },
  refValueStrong: { fontSize: 12, fontFamily: "Helvetica-Bold", color: NAVY },
  refValue: { fontSize: 11, color: NAVY },

  // ── Job details box ────────────────────────────────────────────────────────
  detailBox: { borderWidth: 1, borderColor: BORDER, borderRadius: 8, marginBottom: 24 },
  detailHeader: {
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  detailTitle: { fontSize: 15, fontFamily: "Helvetica-Bold", color: NAVY, lineHeight: 1.3 },
  detailRow: { flexDirection: "row", paddingVertical: 12, paddingHorizontal: 20 },
  detailRowDivider: { borderTopWidth: 1, borderTopColor: HAIRLINE },
  detailKey: {
    width: "35%",
    fontSize: 8.5,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 1,
    color: MUTED,
    textTransform: "uppercase" as const,
  },
  detailVal: { flex: 1, fontSize: 10.5, color: INK, lineHeight: 1.4 },

  // ── Scope card ─────────────────────────────────────────────────────────────
  scopeCard: { backgroundColor: CARD_BG, borderRadius: 8, paddingVertical: 16, paddingHorizontal: 18, marginBottom: 28 },
  scopeText: { fontSize: 10.5, color: INK, lineHeight: 1.6 },

  // ── Pricing box ────────────────────────────────────────────────────────────
  priceBox: { borderWidth: 1, borderColor: BORDER, borderRadius: 8, marginBottom: 28 },
  priceRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingVertical: 13,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: HAIRLINE,
  },
  priceName: { fontSize: 10.5, color: INK },
  priceSub: { fontSize: 8.5, color: MUTED, marginTop: 1 },
  priceAmount: { fontSize: 10.5, fontFamily: "Helvetica-Bold", color: NAVY },
  subRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 9,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: HAIRLINE,
  },
  subLabel: { fontSize: 9.5, color: SLATE },
  subValue: { fontSize: 10, fontFamily: "Helvetica-Bold", color: NAVY },
  totalRow: {
    backgroundColor: LAVENDER,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 16,
    paddingHorizontal: 20,
  },
  totalLabel: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 1,
    color: NAVY,
    textTransform: "uppercase" as const,
  },
  totalAmount: { fontSize: 19, fontFamily: "Helvetica-Bold", color: NAVY },

  // ── Acceptance note ────────────────────────────────────────────────────────
  acceptNote: {
    backgroundColor: ORANGE_TINT,
    borderLeftWidth: 4,
    borderLeftColor: ORANGE,
    borderTopRightRadius: 6,
    borderBottomRightRadius: 6,
    paddingVertical: 14,
    paddingHorizontal: 18,
    marginBottom: 28,
  },
  acceptTitle: {
    fontSize: 8.5,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 2,
    color: ORANGE,
    textTransform: "uppercase" as const,
    marginBottom: 5,
  },
  acceptText: { fontSize: 10.5, color: NAVY, lineHeight: 1.5 },

  // ── Terms grid ─────────────────────────────────────────────────────────────
  termsGrid: { flexDirection: "row", flexWrap: "wrap", marginBottom: 16 },
  termCell: { width: "50%", padding: 6 },
  termCard: { backgroundColor: CARD_BG, borderRadius: 6, paddingVertical: 12, paddingHorizontal: 14, height: "100%" },
  termTitle: { fontSize: 9, fontFamily: "Helvetica-Bold", color: NAVY, marginBottom: 4 },
  termText: { fontSize: 9, color: SLATE, lineHeight: 1.5 },

  // ── Help card ──────────────────────────────────────────────────────────────
  helpCard: { backgroundColor: LAVENDER, borderRadius: 8, paddingVertical: 14, paddingHorizontal: 18, marginBottom: 8 },
  helpTitle: { fontSize: 9.5, fontFamily: "Helvetica-Bold", color: NAVY, marginBottom: 4 },
  helpText: { fontSize: 10, color: SLATE, lineHeight: 1.5 },
  helpContact: { fontFamily: "Helvetica-Bold", color: NAVY },

  // ── Footer (navy, pinned to bottom) ────────────────────────────────────────
  footer: {
    position: "absolute" as const,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: NAVY,
    paddingVertical: 22,
    paddingHorizontal: 40,
    alignItems: "center",
  },
  footerLogo: { width: 76, height: 20, objectFit: "contain" as const, marginBottom: 10 },
  footerInfo: { fontSize: 8, lineHeight: 1.6, color: FOOTER_INFO, textAlign: "center" as const },
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
  // The Total Price shown to the customer is VAT-inclusive. Back out the
  // subtotal/VAT from `totalValue` so the breakdown reconciles with the app
  // drawer and portal. We trust `totalValue` as the canonical VAT-inclusive
  // grand total rather than recomputing from line items (whose unit prices may
  // or may not already include VAT depending on how the quote was created).
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
        {/* ── Header ── */}
        <View style={styles.header}>
          {branding.logoUrl ? (
            <Image src={branding.logoUrl} style={styles.headerLogo} />
          ) : (
            <Text style={styles.headerCompany}>{branding.companyName}</Text>
          )}
        </View>
        <View style={styles.orangeBar} />

        <View style={styles.body}>
          {/* ── Eyebrow + greeting + intro ── */}
          <Text style={styles.eyebrow}>Your Quote</Text>
          <Text style={styles.headline}>Hi {firstNameOf(data.clientName)},</Text>
          <Text style={styles.intro}>
            Thanks for the request. Please find your quote below. To accept, simply reply to the
            email this quote was sent with and we&apos;ll schedule the work.
          </Text>

          {/* ── Quote reference bar ── */}
          <View style={styles.refBar}>
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
          </View>

          {/* ── Job details ── */}
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

          {/* ── Scope ── */}
          {data.scope?.trim() ? (
            <>
              <Text style={styles.sectionLabel}>Scope of Work</Text>
              <View style={styles.scopeCard}>
                <Text style={styles.scopeText}>{data.scope.trim()}</Text>
              </View>
            </>
          ) : null}

          {/* ── Pricing ── */}
          <Text style={styles.sectionLabel}>Pricing</Text>
          <View style={styles.priceBox}>
            {items.map((item, i) => (
              <View key={i} style={styles.priceRow}>
                <View>
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
            <View style={styles.subRow}>
              <Text style={styles.subLabel}>Subtotal (ex VAT)</Text>
              <Text style={styles.subValue}>{formatCurrency(subtotal)}</Text>
            </View>
            <View style={styles.subRow}>
              <Text style={styles.subLabel}>VAT ({vatPct}%)</Text>
              <Text style={styles.subValue}>{formatCurrency(vat)}</Text>
            </View>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Total</Text>
              <Text style={styles.totalAmount}>{formatCurrency(grandTotal)}</Text>
            </View>
          </View>

          {/* ── How to accept ── */}
          <View style={styles.acceptNote}>
            <Text style={styles.acceptTitle}>How to Accept</Text>
            <Text style={styles.acceptText}>
              Reply to the email this quote was sent with confirming you&apos;d like to proceed (ref{" "}
              {data.reference}). We&apos;ll schedule the work and send a confirmation with the date
              and arrival window.
            </Text>
          </View>

          {/* ── Terms ── */}
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

          {/* ── Help ── */}
          <View style={styles.helpCard}>
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
          </View>
        </View>

        {/* ── Footer (navy, pinned) ── */}
        <View style={styles.footer} fixed>
          {branding.logoUrl ? <Image src={branding.logoUrl} style={styles.footerLogo} /> : null}
          <Text style={styles.footerInfo}>{footerLine}</Text>
          {footerLink ? <Text style={styles.footerInfo}>{footerLink}</Text> : null}
        </View>
      </Page>
    </Document>
  );
}
