import React from "react";
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type {
  CatalogRateCardCategorySection,
  CatalogRateCardPayload,
  CatalogRateCardServiceRow,
} from "@/lib/catalog-rate-card-core";
import type { CatalogRateCardContent } from "@/lib/catalog-rate-card-content-types";

const coral = "#ED4B00";
const ink = "#020040";
const mute = "#57534E";
const line = "#E7E5E4";
const white = "#FFFFFF";

const styles = StyleSheet.create({
  coverPage: {
    fontFamily: "Helvetica",
    backgroundColor: ink,
    color: white,
    paddingTop: 56,
    paddingBottom: 48,
    paddingHorizontal: 48,
  },
  coverKicker: {
    fontSize: 8,
    letterSpacing: 2,
    textTransform: "uppercase",
    color: coral,
    marginTop: 32,
    fontWeight: "bold",
  },
  coverBrand: { fontSize: 28, fontWeight: "bold", color: white, marginTop: 8 },
  coverBrandAccent: { color: coral },
  coverTitle: { fontSize: 26, fontWeight: "bold", color: white, marginTop: 20, lineHeight: 1.15 },
  coverTitleAccent: { color: coral },
  coverSub: { fontSize: 11, color: "#FFFFFFC8", marginTop: 16, lineHeight: 1.55, maxWidth: 400 },
  page: {
    fontFamily: "Helvetica",
    fontSize: 9,
    paddingTop: 44,
    paddingBottom: 48,
    paddingHorizontal: 44,
    color: ink,
  },
  sectionEyebrow: {
    fontSize: 8,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: coral,
    marginBottom: 4,
    fontWeight: "bold",
  },
  sectionTitle: { fontSize: 18, fontWeight: "bold", marginBottom: 8, color: ink, lineHeight: 1.2 },
  body: { fontSize: 10, lineHeight: 1.55, color: mute, marginBottom: 10 },
  pillar: {
    marginBottom: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: line,
    borderRadius: 8,
  },
  pillarNum: { fontSize: 8, fontWeight: "bold", color: coral },
  pillarTitle: { fontSize: 11, fontWeight: "bold", marginTop: 4, marginBottom: 4 },
  pillarBody: { fontSize: 9, color: mute, lineHeight: 1.45 },
  bandPage: {
    fontFamily: "Helvetica",
    backgroundColor: ink,
    color: white,
    paddingTop: 44,
    paddingBottom: 48,
    paddingHorizontal: 44,
  },
  statVal: { fontSize: 20, fontWeight: "bold", color: coral },
  statLbl: { fontSize: 9, color: "#FFFFFFB8", marginTop: 4, lineHeight: 1.4 },
  catTitle: { fontSize: 14, fontWeight: "bold", marginBottom: 8, color: ink },
  svcCard: {
    marginBottom: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: line,
    borderRadius: 6,
  },
  svcName: { fontSize: 11, fontWeight: "bold", marginBottom: 4 },
  svcDesc: { fontSize: 8, color: mute, marginBottom: 6, lineHeight: 1.4 },
  priceRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: "#F5F5F4",
  },
  priceLabel: { fontSize: 9, flex: 1 },
  priceAmount: { fontSize: 9, fontWeight: "bold", width: "28%", textAlign: "right" },
  blockTitle: {
    fontSize: 7,
    fontWeight: "bold",
    color: mute,
    textTransform: "uppercase",
    marginBottom: 4,
    marginTop: 4,
  },
  hourlyAmt: { fontSize: 14, fontWeight: "bold" },
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
  coverFooter: {
    position: "absolute",
    bottom: 24,
    left: 48,
    right: 48,
    fontSize: 7,
    color: "#FFFFFF88",
  },
});

function ServiceBlock({ svc }: { svc: CatalogRateCardServiceRow }) {
  if (svc.missing) {
    return (
      <View style={styles.svcCard} wrap={false}>
        <Text style={styles.svcName}>{svc.name}</Text>
        {svc.description ? <Text style={styles.svcDesc}>{svc.description}</Text> : null}
        <Text style={styles.svcDesc}>Priced on request</Text>
      </View>
    );
  }
  if (svc.pricingStyle === "hourly" && svc.lines[0]) {
    const row = svc.lines[0];
    return (
      <View style={styles.svcCard} wrap={false}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Text style={styles.svcName}>{svc.name}</Text>
            {svc.description ? <Text style={styles.svcDesc}>{svc.description}</Text> : null}
          </View>
          <View>
            <Text style={styles.hourlyAmt}>{row.price}</Text>
            <Text style={styles.svcDesc}>1-hour minimum</Text>
          </View>
        </View>
      </View>
    );
  }
  return (
    <View style={styles.svcCard} wrap={false}>
      <Text style={styles.svcName}>{svc.name}</Text>
      {svc.description ? <Text style={styles.svcDesc}>{svc.description}</Text> : null}
      {svc.presets.map((p) => (
        <View key={p.id} style={styles.priceRow}>
          <Text style={styles.priceLabel}>{p.label}</Text>
          <Text style={styles.priceAmount}>{p.price}</Text>
        </View>
      ))}
      {svc.presets.length === 0 && svc.lines.length === 1 ? (
        <Text style={styles.hourlyAmt}>{svc.lines[0].price}</Text>
      ) : null}
      {svc.addons.length > 0 ? (
        <>
          <Text style={styles.blockTitle}>Add-ons</Text>
          {svc.addons.map((a) => (
            <View key={a.id} style={styles.priceRow}>
              <Text style={styles.priceLabel}>{a.label}</Text>
              <Text style={styles.priceAmount}>{a.price}</Text>
            </View>
          ))}
        </>
      ) : null}
    </View>
  );
}

function CategorySection({ cat }: { cat: CatalogRateCardCategorySection }) {
  return (
    <View>
      <Text style={styles.sectionEyebrow}>{cat.label}</Text>
      <Text style={styles.catTitle}>{cat.label}</Text>
      {cat.id === "trades" ? (
        <Text style={styles.body}>
          Skilled trades billed by the hour — one-hour minimum, then in 30-minute increments.
        </Text>
      ) : null}
      {cat.services.map((svc) => (
        <ServiceBlock key={svc.id} svc={svc} />
      ))}
    </View>
  );
}

export function CatalogRateCardPDF({
  payload,
  content,
  docTitle,
}: {
  payload: CatalogRateCardPayload;
  content: CatalogRateCardContent;
  docTitle: string;
}) {
  const generated = new Date(payload.generatedAt).toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const { hero, about, commitments, pricingIntro } = content;

  return (
    <Document title={docTitle}>
      <Page size="A4" style={styles.coverPage}>
        <Text style={styles.coverBrand}>
          fix<Text style={styles.coverBrandAccent}>fy</Text>
        </Text>
        <Text style={styles.coverKicker}>{hero.kicker}</Text>
        <Text style={styles.coverTitle}>
          {hero.titleLine1}
          {"\n"}
          {hero.titleLine2}
          {"\n"}
          <Text style={styles.coverTitleAccent}>{hero.titleEmphasis}</Text>
        </Text>
        <Text style={styles.coverSub}>{hero.subtitle}</Text>
        <View style={styles.coverFooter} fixed>
          <Text>{docTitle} · {content.portalLabel}</Text>
        </View>
      </Page>

      <Page size="A4" style={styles.page}>
        <Text style={styles.sectionEyebrow}>{about.kicker}</Text>
        <Text style={styles.sectionTitle}>{about.title}</Text>
        <Text style={styles.body}>{about.lede}</Text>
        {about.pillars.map((pillar) => (
          <View key={pillar.num} style={styles.pillar}>
            <Text style={styles.pillarNum}>{pillar.num}</Text>
            <Text style={styles.pillarTitle}>{pillar.title}</Text>
            <Text style={styles.pillarBody}>{pillar.body}</Text>
          </View>
        ))}
        <View style={styles.footer} fixed>
          <Text>Fixfy</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>

      <Page size="A4" style={styles.bandPage}>
        <Text style={[styles.sectionTitle, { color: white }]}>{commitments.title}</Text>
        {commitments.stats.map((stat) => (
          <View key={stat.value} style={{ marginTop: 16 }}>
            <Text style={styles.statVal}>{stat.value}</Text>
            <Text style={styles.statLbl}>{stat.label}</Text>
          </View>
        ))}
        <View style={styles.coverFooter} fixed>
          <Text>Fixfy — Commitments</Text>
        </View>
      </Page>

      <Page size="A4" style={styles.page} wrap>
        <Text style={styles.sectionEyebrow}>{pricingIntro.kicker}</Text>
        <Text style={styles.sectionTitle}>{pricingIntro.title}</Text>
        <Text style={styles.body}>{pricingIntro.lede}</Text>
        {payload.categories.map((cat) => (
          <CategorySection key={cat.id} cat={cat} />
        ))}
        <Text style={[styles.body, { marginTop: 16 }]}>
          Updated {generated}. {content.portalLabel}
        </Text>
        <View style={styles.footer} fixed>
          <Text>{docTitle} · {generated}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
