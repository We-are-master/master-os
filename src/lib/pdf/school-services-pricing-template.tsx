import React from "react";
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type {
  SchoolCatalogCategorySection,
  SchoolCatalogPriceItem,
  SchoolCatalogServiceRow,
  SchoolServiceCatalogPayload,
} from "@/lib/fixfy-school-service-catalog";

const coral = "#ED4B00";
const ink = "#020040";
const mute = "#57534E";
const line = "#E7E5E4";

const styles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 9,
    paddingTop: 44,
    paddingBottom: 48,
    paddingHorizontal: 44,
    color: ink,
  },
  coverTitle: { fontSize: 22, fontWeight: "bold", color: ink, marginBottom: 6 },
  coverSub: { fontSize: 11, color: mute, marginBottom: 20, lineHeight: 1.5 },
  coverBadge: {
    alignSelf: "flex-start",
    backgroundColor: "#FFF5EE",
    color: coral,
    fontSize: 8,
    fontWeight: "bold",
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
    marginBottom: 16,
  },
  sectionTitle: { fontSize: 14, fontWeight: "bold", marginBottom: 8, color: ink },
  sectionEyebrow: {
    fontSize: 8,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: coral,
    marginBottom: 4,
    fontWeight: "bold",
  },
  body: { fontSize: 10, lineHeight: 1.55, color: mute, marginBottom: 10 },
  callout: {
    borderLeftWidth: 3,
    borderLeftColor: coral,
    backgroundColor: "#FFF8F4",
    padding: 10,
    marginBottom: 10,
  },
  calloutK: { fontSize: 8, fontWeight: "bold", color: coral, marginBottom: 4, textTransform: "uppercase" },
  calloutT: { fontSize: 9, lineHeight: 1.45, color: ink },
  legendRow: { flexDirection: "row", gap: 8, marginBottom: 6, alignItems: "flex-start" },
  legendDot: { width: 10, height: 10, borderRadius: 2, marginTop: 2 },
  catTitle: {
    fontSize: 10,
    fontWeight: "bold",
    letterSpacing: 1,
    textTransform: "uppercase",
    color: mute,
    marginTop: 14,
    marginBottom: 8,
    paddingBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: line,
  },
  svcCard: {
    marginBottom: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: line,
    borderRadius: 6,
  },
  svcHead: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4, gap: 8 },
  svcName: { fontSize: 11, fontWeight: "bold", flex: 1 },
  svcModel: { fontSize: 7, color: mute, textTransform: "uppercase", letterSpacing: 0.5 },
  svcDesc: { fontSize: 8, color: mute, marginBottom: 6, lineHeight: 1.4 },
  blockTitle: { fontSize: 7, fontWeight: "bold", color: mute, textTransform: "uppercase", marginBottom: 4, marginTop: 4 },
  priceRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: "#F5F5F4",
  },
  priceLabel: { fontSize: 9, flex: 1 },
  priceAmount: { fontSize: 9, fontWeight: "bold", width: "22%", textAlign: "right" },
  priceMeta: { fontSize: 7, color: mute, marginTop: 2 },
  marginRow: { flexDirection: "row", gap: 12, marginTop: 3 },
  marginGood: { color: "#157a55", fontSize: 7, fontWeight: "bold" },
  marginThin: { color: "#b45309", fontSize: 7, fontWeight: "bold" },
  marginBad: { color: "#be123c", fontSize: 7, fontWeight: "bold" },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 44,
    right: 44,
    fontSize: 7,
    color: mute,
    flexDirection: "row",
    justifyContent: "space-between",
  },
});

function marginStyle(tier?: SchoolCatalogPriceItem["marginTier"]) {
  if (tier === "thin") return styles.marginThin;
  if (tier === "bad") return styles.marginBad;
  return styles.marginGood;
}

function PriceLine({ item }: { item: SchoolCatalogPriceItem }) {
  return (
    <View style={styles.priceRow} wrap={false}>
      <View style={{ flex: 1 }}>
        <Text style={styles.priceLabel}>{item.label}</Text>
        {item.detail ? <Text style={styles.priceMeta}>{item.detail}</Text> : null}
        {item.pay || item.marginPct != null ? (
          <View style={styles.marginRow}>
            {item.pay ? <Text style={styles.priceMeta}>Pay {item.pay}</Text> : null}
            {item.charge ? <Text style={styles.priceMeta}>Charge {item.charge}</Text> : null}
            {item.marginPct != null ? (
              <Text style={marginStyle(item.marginTier)}>{item.marginPct}% margin</Text>
            ) : null}
          </View>
        ) : null}
      </View>
      <Text style={styles.priceAmount}>{item.price}</Text>
    </View>
  );
}

function ServiceBlock({ svc }: { svc: SchoolCatalogServiceRow }) {
  return (
    <View style={styles.svcCard} wrap={false}>
      <View style={styles.svcHead}>
        <Text style={styles.svcName}>{svc.name}</Text>
        <Text style={styles.svcModel}>{svc.model}</Text>
      </View>
      {svc.description ? <Text style={styles.svcDesc}>{svc.description}</Text> : null}
      {svc.missing ? (
        <Text style={styles.priceMeta}>Price on request</Text>
      ) : (
        <>
          {svc.simple ? (
            <>
              <Text style={styles.blockTitle}>Standard rate</Text>
              <PriceLine item={svc.simple} />
            </>
          ) : null}
          {svc.baseBands.length > 0 ? (
            <>
              <Text style={styles.blockTitle}>Base packages</Text>
              {svc.baseBands.map((b, i) => (
                <PriceLine key={`b-${i}`} item={b} />
              ))}
            </>
          ) : null}
          {svc.addons.length > 0 ? (
            <>
              <Text style={styles.blockTitle}>Add-ons</Text>
              {svc.addons.map((a, i) => (
                <PriceLine key={`a-${i}`} item={a} />
              ))}
            </>
          ) : null}
        </>
      )}
    </View>
  );
}

function CategorySection({ cat }: { cat: SchoolCatalogCategorySection }) {
  return (
    <View>
      <Text style={styles.catTitle}>{cat.label}</Text>
      {cat.services.map((svc) => (
        <ServiceBlock key={svc.id} svc={svc} />
      ))}
    </View>
  );
}

export function SchoolServicesPricingPDF({ payload }: { payload: SchoolServiceCatalogPayload }) {
  const generated = new Date(payload.generatedAt).toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  return (
    <Document title="Fixfy School — Services & Pricing Board">
      <Page size="A4" style={styles.page}>
        <Text style={styles.coverBadge}>Fixfy School · Foundation</Text>
        <Text style={styles.coverTitle}>Services &amp; Pricing Board</Text>
        <Text style={styles.coverSub}>
          Live rate card synced from Fixfy OS Services. Standard client charge, partner pay ceiling, and margin on
          every SKU. Generated {generated} · {payload.totalActive} active services.
        </Text>
        <Text style={styles.sectionEyebrow}>Single source of truth</Text>
        <Text style={styles.sectionTitle}>Same data as the Services tab</Text>
        <Text style={styles.body}>
          When ops updates a price in Services → Manage or copies rates from Services → Overview, this document
          reflects the same numbers. Categories: Trades · Certificates · Cleaning · Other.
        </Text>
        <View style={styles.callout}>
          <Text style={styles.calloutK}>How to read every price row</Text>
          <Text style={styles.calloutT}>
            You charge the client (standard sell). You pay the partner (catalog ceiling — partner must not exceed
            this on standard jobs). You keep the margin (charge minus pay).
          </Text>
        </View>
        <View style={styles.legendRow}>
          <View style={[styles.legendDot, { backgroundColor: ink }]} />
          <Text style={styles.body}>You pay — partner pay ceiling</Text>
        </View>
        <View style={styles.legendRow}>
          <View style={[styles.legendDot, { backgroundColor: "#16a06e" }]} />
          <Text style={styles.body}>You keep — margin (charge minus pay)</Text>
        </View>
        <View style={styles.legendRow}>
          <View style={[styles.legendDot, { backgroundColor: coral }]} />
          <Text style={styles.body}>You charge — standard client price</Text>
        </View>
        <View style={styles.callout}>
          <Text style={styles.calloutK}>Acceptable margin per job</Text>
          <Text style={styles.calloutT}>
            40%+ healthy · 30–39% thin — double-check scope before quoting · {"<"}30% bad — escalate to manager.
            Never pay above the catalog ceiling without approval.
          </Text>
        </View>
        <View style={styles.callout}>
          <Text style={styles.calloutK}>Floor &amp; ceiling rules</Text>
          <Text style={styles.calloutT}>
            Floor: account sell cannot go below catalog standard. Ceiling: partner pay cannot go above catalog
            partner cost. Custom rates need a reason and manager sign-off.
          </Text>
        </View>
        <View style={styles.footer} fixed>
          <Text>Fixfy School — Services &amp; Pricing</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>

      <Page size="A4" style={styles.page} wrap>
        <Text style={styles.sectionEyebrow}>Live from OS</Text>
        <Text style={styles.sectionTitle}>Standard prices by category</Text>
        <Text style={styles.body}>Active services only — pay, charge and margin % on every line.</Text>
        {payload.categories.map((cat) => (
          <CategorySection key={cat.id} cat={cat} />
        ))}
        <View style={styles.footer} fixed>
          <Text>Fixfy School — Services &amp; Pricing · {generated}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
