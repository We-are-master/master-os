/**
 * PDF template for V2 job reports (start_report / final_report).
 * Visual system aligned with fixfy-job-report.html (navy header, meta panel, pills, photo grid).
 */

import React from "react";
import { Document, Page, Text, View, StyleSheet, Image } from "@react-pdf/renderer";
import {
  labelForReportField,
  type NormalizedReport,
  type ReportKind,
  type RenderableField,
} from "@/lib/job-report-v2";

export interface JobReportPDFData {
  reference: string;
  jobTitle: string;
  propertyAddress: string;
  clientName?: string | null;
  partnerName?: string | null;
  /** Data URI or https URL for white wordmark on navy header. */
  logoUrl?: string;
  start?: { report: NormalizedReport; signedPhotos: SignedPhoto[]; approvedAt: string | null } | null;
  final?: { report: NormalizedReport; signedPhotos: SignedPhoto[]; approvedAt: string | null } | null;
}

export interface SignedPhoto {
  url: string;
  label?: string;
}

const C = {
  navy: "#020040",
  orange: "#ED4B00",
  ink: "#1a1a2e",
  muted: "#8a8a9a",
  line: "#e8e8ee",
  panel: "#fafafc",
  green: "#0f7a4d",
  white: "#ffffff",
  headMuted: "#b9b9d8",
  footMuted: "#c7c7e0",
};

/** Breathing room above/below flowing content on every page (~two fingers). */
const PAGE_CONTENT_GAP = 28;
const PAD_H = 48;
/** Fixed footer band height (padding + one or two text lines). */
const FOOTER_HEIGHT = 72;
const PAGE_BOTTOM_RESERVE = FOOTER_HEIGHT + PAGE_CONTENT_GAP;
/** fixfy-wordmark-white-trim.png — left-aligned wordmark for navy header. */
const HEADER_LOGO_HEIGHT = 40;
const HEADER_LOGO_WIDTH = 132;
const PHOTO_ROW_HEIGHT = 102;
const PHOTO_SECTION_HEADING_HEIGHT = 38;

const styles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 10,
    backgroundColor: C.white,
    color: C.ink,
    paddingTop: PAGE_CONTENT_GAP,
    paddingBottom: PAGE_BOTTOM_RESERVE,
  },
  header: {
    backgroundColor: C.navy,
    paddingTop: 34,
    paddingBottom: 28,
    paddingHorizontal: PAD_H,
    marginTop: -PAGE_CONTENT_GAP,
    marginBottom: 0,
  },
  headerAccent: {
    height: 4,
    backgroundColor: C.orange,
    marginHorizontal: -PAD_H,
    marginTop: 24,
  },
  headerTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    width: "100%",
  },
  brandBlock: {
    flexShrink: 0,
    alignItems: "flex-start",
  },
  headerLogo: {
    width: HEADER_LOGO_WIDTH,
    height: HEADER_LOGO_HEIGHT,
    objectFit: "contain" as const,
    objectPosition: "left center" as const,
  },
  brand: {
    fontSize: 22,
    fontFamily: "Helvetica-Bold",
    color: C.white,
    letterSpacing: -0.5,
  },
  brandAccent: {
    color: C.orange,
  },
  brandTag: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 1.6,
    textTransform: "uppercase",
    color: "#9a9ac2",
    marginTop: 8,
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 0,
    marginTop: 4,
    backgroundColor: "rgba(15,122,77,0.35)",
    borderWidth: 1,
    borderColor: "#1ebe78",
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  statusBadgeText: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    color: "#5fe0a3",
  },
  docTitle: {
    fontSize: 32,
    fontFamily: "Helvetica-Bold",
    color: C.white,
    letterSpacing: -1,
    marginTop: 22,
  },
  headRef: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    marginTop: 12,
    gap: 8,
  },
  headRefNum: {
    fontSize: 13,
    fontFamily: "Helvetica-Bold",
    color: C.orange,
  },
  headRefText: {
    fontSize: 12,
    color: C.headMuted,
  },
  body: {
    paddingHorizontal: PAD_H,
    paddingTop: PAGE_CONTENT_GAP,
  },
  metaPanel: {
    backgroundColor: C.panel,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 10,
    paddingVertical: 20,
    paddingHorizontal: 24,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 10,
  },
  metaKey: {
    width: 110,
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 0.7,
    textTransform: "uppercase",
    color: C.muted,
  },
  metaVal: {
    flex: 1,
    fontSize: 13,
    color: C.ink,
    lineHeight: 1.5,
  },
  pills: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: 22,
    marginBottom: 0,
  },
  pill: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 0.5,
    textTransform: "uppercase",
    color: C.white,
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderRadius: 999,
    marginRight: 6,
    marginBottom: 14,
  },
  pillStage: { backgroundColor: C.orange },
  pillType: { backgroundColor: C.navy },
  pillApproved: { backgroundColor: C.green },
  pillPending: { backgroundColor: C.muted },
  timesPanel: {
    backgroundColor: C.panel,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 10,
    paddingVertical: 16,
    paddingHorizontal: 24,
    marginTop: 14,
    marginBottom: 4,
  },
  sectionIntro: {
    marginTop: 0,
  },
  timesRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 8,
  },
  timesKey: {
    width: 110,
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 0.7,
    textTransform: "uppercase",
    color: C.muted,
  },
  timesVal: {
    flex: 1,
    fontSize: 12,
    color: C.ink,
    lineHeight: 1.5,
  },
  kvRow: {
    paddingVertical: 16,
    paddingHorizontal: 2,
    borderBottomWidth: 1,
    borderBottomColor: C.line,
  },
  kvKey: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    color: C.muted,
  },
  kvVal: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    color: C.ink,
    marginTop: 22,
    lineHeight: 1.65,
  },
  sectionHeading: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 26,
    marginBottom: 12,
    gap: 8,
  },
  sectionAccent: {
    width: 3,
    height: 14,
    backgroundColor: C.orange,
    borderRadius: 2,
  },
  sectionTitle: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 0.9,
    textTransform: "uppercase",
    color: C.navy,
  },
  photoGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  photoWrap: {
    width: "31%",
    marginRight: "2%",
    marginBottom: 10,
    marginTop: 4,
    position: "relative",
  },
  photo: {
    width: "100%",
    height: 88,
    objectFit: "cover",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: "#efeae1",
  },
  photoLabel: {
    position: "absolute",
    bottom: 6,
    left: 6,
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 0.4,
    color: C.white,
    backgroundColor: "rgba(2,0,64,0.65)",
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 4,
  },
  sectionGap: {
    marginTop: 24,
  },
  emptyNote: {
    fontSize: 10,
    color: C.muted,
    marginTop: 8,
    fontStyle: "italic",
  },
  footer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: FOOTER_HEIGHT,
    backgroundColor: C.navy,
    paddingVertical: 18,
    paddingHorizontal: PAD_H,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
  },
  footerGuard: {
    position: "absolute",
    bottom: FOOTER_HEIGHT,
    left: 0,
    right: 0,
    height: PAGE_CONTENT_GAP,
    backgroundColor: C.white,
  },
  footText: {
    fontSize: 10,
    color: C.footMuted,
  },
  footStrong: {
    fontFamily: "Helvetica-Bold",
    color: C.white,
  },
});

function formatBritishDateTime(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(d);
}

const PDF_HIDDEN_FIELD_KEYS = new Set(["photos", "recommend_additional_services"]);

function renderableFieldsFromReport(report: NormalizedReport): RenderableField[] {
  const out: RenderableField[] = [];
  for (const [k, v] of Object.entries(report.fields)) {
    if (v === null || v === undefined) continue;
    if (PDF_HIDDEN_FIELD_KEYS.has(k)) continue;
    out.push({
      key: k,
      label: labelForReportField(k),
      display: formatFieldValue(k, v),
      raw: v,
    });
  }
  return out;
}

function formatFieldValue(key: string, v: unknown): string {
  if (key === "duration_ms" && typeof v === "number") {
    const min = Math.round(v / 60_000);
    const h = Math.floor(min / 60);
    const m = min % 60;
    if (h > 0 && m > 0) return `${h}h ${m}m`;
    if (h > 0) return `${h}h`;
    return `${m}m`;
  }
  if (key === "chargeable_hours" && typeof v === "number") return `${v.toFixed(2)} h`;
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return String(v);
  return JSON.stringify(v);
}

function headerStatus(data: JobReportPDFData): { label: string; approved: boolean } {
  const finalOk = Boolean(data.final?.approvedAt);
  const startOk = Boolean(data.start?.approvedAt);
  if (finalOk || (startOk && !data.final)) return { label: "Approved", approved: true };
  if (startOk || data.final || data.start) return { label: "Pending review", approved: false };
  return { label: "Draft", approved: false };
}

/** Keep a block on one page; if it cannot start with enough room, move it down entirely. */
function KeepTogetherBlock({
  children,
  minHeight,
  style,
}: {
  children: React.ReactNode;
  minHeight: number;
  style?: Record<string, unknown> | Record<string, unknown>[];
}) {
  return (
    <View style={style} wrap={false} minPresenceAhead={PAGE_BOTTOM_RESERVE + minHeight}>
      {children}
    </View>
  );
}

function estimateKvRowHeight(display: string): number {
  const lines = Math.max(1, Math.ceil(display.length / 72));
  return 34 + lines * 20;
}

function PhotoSection({
  stageLabel,
  kind,
  signedPhotos,
}: {
  stageLabel: string;
  kind: ReportKind;
  signedPhotos: SignedPhoto[];
}) {
  const photosPerRow = 3;
  const firstRow = signedPhotos.slice(0, photosPerRow);
  const rest = signedPhotos.slice(photosPerRow);
  const rowCount = Math.ceil(signedPhotos.length / photosPerRow);
  const fullBlockHeight = PHOTO_SECTION_HEADING_HEIGHT + rowCount * PHOTO_ROW_HEIGHT;
  const minStartHeight = PHOTO_SECTION_HEADING_HEIGHT + PHOTO_ROW_HEIGHT;
  const maxKeepAllOnOnePage = 480;

  const heading = (
    <View style={styles.sectionHeading}>
      <View style={styles.sectionAccent} />
      <Text style={styles.sectionTitle}>Photos — {stageLabel}</Text>
    </View>
  );

  const renderPhoto = (p: SignedPhoto, i: number) => (
    <View key={`${kind}-${i}`} style={styles.photoWrap}>
      <Image src={p.url} style={styles.photo} />
      {p.label ? <Text style={styles.photoLabel}>{p.label}</Text> : null}
    </View>
  );

  if (fullBlockHeight <= maxKeepAllOnOnePage) {
    return (
      <KeepTogetherBlock minHeight={fullBlockHeight}>
        {heading}
        <View style={styles.photoGrid}>{signedPhotos.map(renderPhoto)}</View>
      </KeepTogetherBlock>
    );
  }

  return (
    <>
      <KeepTogetherBlock minHeight={minStartHeight}>
        {heading}
        <View style={styles.photoGrid}>{firstRow.map(renderPhoto)}</View>
      </KeepTogetherBlock>
      {rest.length > 0 ? (
        <View style={styles.photoGrid}>{rest.map((p, i) => renderPhoto(p, i + photosPerRow))}</View>
      ) : null}
    </>
  );
}

function ReportSection({
  kind,
  data,
  signedPhotos,
  approvedAt,
  withTopGap,
}: {
  kind: ReportKind;
  data: NormalizedReport;
  signedPhotos: SignedPhoto[];
  approvedAt: string | null;
  withTopGap?: boolean;
}) {
  const fields = renderableFieldsFromReport(data);
  const submitted = data.submittedAt ? formatBritishDateTime(data.submittedAt) : "—";
  const stageLabel = kind === "start" ? "Start" : "Final";

  return (
    <View style={withTopGap ? styles.sectionGap : undefined}>
      <View style={styles.sectionIntro}>
        <View style={styles.pills}>
          <Text style={[styles.pill, styles.pillStage]}>{stageLabel}</Text>
          <Text style={[styles.pill, styles.pillType]}>{data.template}</Text>
          <Text style={[styles.pill, approvedAt ? styles.pillApproved : styles.pillPending]}>
            {approvedAt ? "Approved" : "Pending review"}
          </Text>
        </View>

        <View style={styles.timesPanel}>
          <View style={styles.timesRow}>
            <Text style={styles.timesKey}>Submitted</Text>
            <Text style={styles.timesVal}>{submitted}</Text>
          </View>
          {approvedAt ? (
            <View style={styles.timesRow}>
              <Text style={styles.timesKey}>Approved</Text>
              <Text style={styles.timesVal}>{formatBritishDateTime(new Date(approvedAt))}</Text>
            </View>
          ) : null}
        </View>
      </View>

      {fields.map((f) => (
        <KeepTogetherBlock key={f.key} minHeight={estimateKvRowHeight(f.display)} style={styles.kvRow}>
          <Text style={styles.kvKey}>{f.label}</Text>
          <Text style={styles.kvVal}>{f.display}</Text>
        </KeepTogetherBlock>
      ))}

      {signedPhotos.length > 0 ? (
        <PhotoSection stageLabel={stageLabel} kind={kind} signedPhotos={signedPhotos} />
      ) : null}
    </View>
  );
}

export function JobReportPDF({ data }: { data: JobReportPDFData }): React.ReactElement {
  const status = headerStatus(data);
  const addressShort = data.propertyAddress?.trim() || "—";

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View style={styles.headerTop}>
            <View style={styles.brandBlock}>
              {data.logoUrl ? (
                <Image src={data.logoUrl} style={styles.headerLogo} />
              ) : (
                <Text style={styles.brand}>
                  Fix<Text style={styles.brandAccent}>fy</Text>
                </Text>
              )}
              <Text style={styles.brandTag}>Property Maintenance</Text>
            </View>
            <View style={styles.statusBadge}>
              <Text style={styles.statusBadgeText}>{status.label}</Text>
            </View>
          </View>
          <Text style={styles.docTitle}>Job Report</Text>
          <View style={styles.headRef}>
            <Text style={styles.headRefNum}>{data.reference}</Text>
            <Text style={styles.headRefText}>·</Text>
            <Text style={styles.headRefText}>{data.jobTitle}</Text>
            <Text style={styles.headRefText}>·</Text>
            <Text style={styles.headRefText}>{addressShort}</Text>
          </View>
          <View style={styles.headerAccent} />
        </View>

        <View style={styles.body}>
          <View style={styles.metaPanel}>
            <View style={styles.metaRow}>
              <Text style={styles.metaKey}>Reference</Text>
              <Text style={styles.metaVal}>{data.reference}</Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.metaKey}>Job</Text>
              <Text style={styles.metaVal}>{data.jobTitle}</Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.metaKey}>Address</Text>
              <Text style={styles.metaVal}>{data.propertyAddress || "—"}</Text>
            </View>
            {data.clientName ? (
              <View style={styles.metaRow}>
                <Text style={styles.metaKey}>Client</Text>
                <Text style={styles.metaVal}>{data.clientName}</Text>
              </View>
            ) : null}
            {data.partnerName ? (
              <View style={styles.metaRow}>
                <Text style={styles.metaKey}>Partner</Text>
                <Text style={styles.metaVal}>{data.partnerName}</Text>
              </View>
            ) : null}
          </View>

          {data.start ? (
            <ReportSection
              kind="start"
              data={data.start.report}
              signedPhotos={data.start.signedPhotos}
              approvedAt={data.start.approvedAt}
            />
          ) : (
            <Text style={styles.emptyNote}>No start report submitted.</Text>
          )}

          {data.final ? (
            <ReportSection
              kind="final"
              data={data.final.report}
              signedPhotos={data.final.signedPhotos}
              approvedAt={data.final.approvedAt}
              withTopGap
            />
          ) : (
            <Text style={[styles.emptyNote, { marginTop: 20 }]}>No final report submitted.</Text>
          )}
        </View>

        <View style={styles.footerGuard} fixed />
        <View style={styles.footer} fixed>
          <Text style={styles.footText}>
            <Text style={styles.footStrong}>Getfixfy Ltd</Text> · Co. No. 15406523
          </Text>
          <Text style={styles.footText}>124 City Road, London EC1V 2NX · support@getfixfy.com</Text>
        </View>
      </Page>
    </Document>
  );
}
