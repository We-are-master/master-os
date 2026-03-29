import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { Job } from "@/types/database";

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 10, fontFamily: "Helvetica" },
  h1: { fontSize: 16, marginBottom: 12, fontFamily: "Helvetica-Bold" },
  label: { fontSize: 9, color: "#555", marginTop: 8 },
  body: { fontSize: 10, marginTop: 4 },
  section: { marginBottom: 10 },
});

export type JobReportPdfProps = {
  job: Pick<Job, "reference" | "title" | "client_name" | "property_address">;
  startReport: Record<string, unknown> | null | undefined;
  finalReport: Record<string, unknown> | null | undefined;
};

function str(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return JSON.stringify(v);
}

export function JobReportPDF({ job, startReport, finalReport }: JobReportPdfProps) {
  const sr = startReport ?? {};
  const fr = finalReport ?? {};
  const startNotes = str(sr.notes ?? sr.summary);
  const finalSummary = str(fr.work_summary ?? fr.summary);
  const materials = str(fr.materials_used);
  const issues = str(fr.issues_notes ?? fr.notes);

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.h1}>Job report — {job.reference}</Text>
        <View style={styles.section}>
          <Text style={styles.label}>Job</Text>
          <Text style={styles.body}>{job.title}</Text>
          <Text style={styles.body}>{job.client_name}</Text>
          <Text style={styles.body}>{job.property_address}</Text>
        </View>
        <View style={styles.section}>
          <Text style={styles.label}>Start of job</Text>
          <Text style={styles.body}>{startNotes || "—"}</Text>
        </View>
        <View style={styles.section}>
          <Text style={styles.label}>Work summary</Text>
          <Text style={styles.body}>{finalSummary || "—"}</Text>
        </View>
        <View style={styles.section}>
          <Text style={styles.label}>Materials used</Text>
          <Text style={styles.body}>{materials || "—"}</Text>
        </View>
        <View style={styles.section}>
          <Text style={styles.label}>Issues / notes</Text>
          <Text style={styles.body}>{issues || "—"}</Text>
        </View>
      </Page>
    </Document>
  );
}
