/**
 * PDF template for V2 job reports (start_report / final_report).
 *
 * Consumes the normalised report shape from `lib/job-report-v2.ts`.
 * Photo URLs must already be signed (private bucket); the route handler
 * passes signed URLs in instead of raw paths.
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
  reference:        string;
  jobTitle:         string;
  propertyAddress:  string;
  clientName?:      string | null;
  partnerName?:     string | null;
  start?: { report: NormalizedReport; signedPhotos: SignedPhoto[]; approvedAt: string | null } | null;
  final?: { report: NormalizedReport; signedPhotos: SignedPhoto[]; approvedAt: string | null } | null;
}

export interface SignedPhoto {
  url:    string;
  label?: string;
}

const styles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 10,
    paddingTop: 50,
    paddingBottom: 60,
    paddingHorizontal: 50,
    backgroundColor: "#FFFFFF",
    color: "#1C1917",
  },
  headerBar: {
    height: 4,
    backgroundColor: "#F97316",
    marginBottom: 28,
    borderRadius: 2,
    marginHorizontal: -50,
    marginTop: -50,
    width: 595,
  },
  brand: {
    fontSize: 18,
    fontFamily: "Helvetica-Bold",
    color: "#F97316",
    marginBottom: 4,
    paddingTop: 16,
  },
  reportLabel: {
    fontSize: 22,
    fontFamily: "Helvetica-Bold",
    color: "#E7E5E4",
    textTransform: "uppercase",
    marginBottom: 16,
  },
  metaCard: {
    backgroundColor: "#FAFAF9",
    borderRadius: 8,
    padding: 16,
    marginBottom: 18,
  },
  metaRow: {
    flexDirection: "row",
    marginBottom: 4,
  },
  metaKey: {
    fontSize: 8,
    color: "#A8A29E",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    width: 90,
  },
  metaVal: {
    fontSize: 10,
    color: "#1C1917",
    flex: 1,
  },
  sectionTitle: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    color: "#1C1917",
    marginTop: 12,
    marginBottom: 8,
  },
  sectionBadgeRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
  },
  badge: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    marginRight: 6,
    color: "#FFFFFF",
    backgroundColor: "#F97316",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  badgeApproved: {
    backgroundColor: "#0F6E56",
  },
  badgePending: {
    backgroundColor: "#A8A29E",
  },
  field: {
    flexDirection: "row",
    paddingVertical: 4,
    borderBottomWidth: 0.5,
    borderBottomColor: "#F5F5F4",
  },
  fieldKey: {
    fontSize: 9,
    color: "#78716C",
    width: 160,
  },
  fieldVal: {
    fontSize: 10,
    color: "#1C1917",
    flex: 1,
  },
  photoGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 8,
  },
  photoWrap: {
    width: 150,
    marginBottom: 8,
  },
  photo: {
    width: 150,
    height: 100,
    objectFit: "cover",
    borderRadius: 4,
    backgroundColor: "#F5F5F4",
  },
  photoCaption: {
    fontSize: 7,
    color: "#78716C",
    marginTop: 2,
  },
  footer: {
    position: "absolute",
    bottom: 30,
    left: 50,
    right: 50,
    fontSize: 7,
    color: "#A8A29E",
    textAlign: "center",
  },
});

function formatBritishDateTime(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: true,
  }).format(d);
}

function ReportSection({
  kind,
  data,
  signedPhotos,
  approvedAt,
}: {
  kind: ReportKind;
  data: NormalizedReport;
  signedPhotos: SignedPhoto[];
  approvedAt: string | null;
}) {
  const fields: RenderableField[] = renderableFieldsFromReport(data);
  const submitted = data.submittedAt ? formatBritishDateTime(data.submittedAt) : "—";

  return (
    <View>
      <View style={styles.sectionBadgeRow}>
        <Text style={styles.badge}>{kind === "start" ? "Start" : "Final"}</Text>
        <Text style={[styles.badge, { backgroundColor: "#1C1917" }]}>{data.template}</Text>
        <Text style={[styles.badge, approvedAt ? styles.badgeApproved : styles.badgePending]}>
          {approvedAt ? "Approved" : "Pending review"}
        </Text>
      </View>

      <View style={styles.metaCard}>
        <View style={styles.metaRow}>
          <Text style={styles.metaKey}>Submitted</Text>
          <Text style={styles.metaVal}>{submitted}</Text>
        </View>
        {approvedAt ? (
          <View style={styles.metaRow}>
            <Text style={styles.metaKey}>Approved</Text>
            <Text style={styles.metaVal}>{formatBritishDateTime(new Date(approvedAt))}</Text>
          </View>
        ) : null}
      </View>

      {fields.length > 0 ? (
        <View style={{ marginBottom: 10 }}>
          {fields.map((f) => (
            <View key={f.key} style={styles.field}>
              <Text style={styles.fieldKey}>{f.label}</Text>
              <Text style={styles.fieldVal}>{f.display}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {signedPhotos.length > 0 ? (
        <View>
          <Text style={[styles.sectionTitle, { fontSize: 10, marginTop: 6 }]}>Photos</Text>
          <View style={styles.photoGrid}>
            {signedPhotos.map((p, i) => (
              <View key={`${kind}-${i}`} style={styles.photoWrap}>
                <Image src={p.url} style={styles.photo} />
                {p.label ? <Text style={styles.photoCaption}>{p.label}</Text> : null}
              </View>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

/** Re-implements `renderableFields` here to avoid an import cycle (lib uses these styles). */
function renderableFieldsFromReport(report: NormalizedReport): RenderableField[] {
  const out: RenderableField[] = [];
  for (const [k, v] of Object.entries(report.fields)) {
    if (v === null || v === undefined) continue;
    if (k === "photos") continue;
    out.push({
      key: k,
      label: labelForReportField(k),
      display: format(k, v),
      raw: v,
    });
  }
  return out;
}
function format(key: string, v: unknown): string {
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

export function JobReportPDF({ data }: { data: JobReportPDFData }): React.ReactElement {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.headerBar} />
        <Text style={styles.brand}>Fixfy</Text>
        <Text style={styles.reportLabel}>Job Report</Text>

        <View style={styles.metaCard}>
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
            <Text style={styles.metaVal}>{data.propertyAddress}</Text>
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
          <Text style={{ fontSize: 9, color: "#A8A29E", marginBottom: 12 }}>
            No start report submitted.
          </Text>
        )}

        {data.final ? (
          <ReportSection
            kind="final"
            data={data.final.report}
            signedPhotos={data.final.signedPhotos}
            approvedAt={data.final.approvedAt}
          />
        ) : (
          <Text style={{ fontSize: 9, color: "#A8A29E", marginTop: 16 }}>
            No final report submitted.
          </Text>
        )}

        <Text
          style={styles.footer}
          render={({ pageNumber, totalPages }) => `Page ${pageNumber} / ${totalPages} · ${data.reference}`}
          fixed
        />
      </Page>
    </Document>
  );
}
