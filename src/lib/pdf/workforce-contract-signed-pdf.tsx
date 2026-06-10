import React from "react";
import { Document, Page, Text, View, Image, StyleSheet } from "@react-pdf/renderer";
import { htmlToPlainTextBlocks } from "@/lib/html-to-plain-text";

export interface WorkforceContractSignedPdfData {
  companyName: string;
  contractTitle: string;
  contractVersion: string;
  contractType: string;
  bodyHtml: string;
  signerFullName: string;
  signerEmail: string;
  signedAt: string;
  signerIp: string | null;
  deviceInfo: string | null;
  signatureImageBase64: string;
  contractVersionId: string;
}

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontSize: 10,
    fontFamily: "Helvetica",
    color: "#1a1a1a",
    lineHeight: 1.45,
  },
  header: {
    marginBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e5e5",
    paddingBottom: 12,
  },
  company: {
    fontSize: 9,
    color: "#666",
    marginBottom: 4,
  },
  title: {
    fontSize: 16,
    fontWeight: 700,
    color: "#020040",
    marginBottom: 4,
  },
  meta: {
    fontSize: 9,
    color: "#666",
  },
  bodyLine: {
    marginBottom: 6,
  },
  signSection: {
    marginTop: 24,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: "#e5e5e5",
  },
  signLabel: {
    fontSize: 9,
    color: "#666",
    marginBottom: 8,
  },
  signatureImage: {
    width: 200,
    height: 60,
    objectFit: "contain",
    marginBottom: 10,
  },
  signerName: {
    fontSize: 11,
    fontWeight: 700,
    marginBottom: 2,
  },
  auditBox: {
    marginTop: 20,
    padding: 12,
    backgroundColor: "#f8f8fa",
    borderRadius: 4,
  },
  auditTitle: {
    fontSize: 9,
    fontWeight: 700,
    color: "#020040",
    marginBottom: 6,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  auditRow: {
    fontSize: 8,
    color: "#444",
    marginBottom: 3,
  },
});

function formatSignedAt(iso: string): string {
  try {
    return new Date(iso).toUTCString();
  } catch {
    return iso;
  }
}

export function WorkforceContractSignedPDF({ data }: { data: WorkforceContractSignedPdfData }) {
  const blocks = htmlToPlainTextBlocks(data.bodyHtml);
  const signatureSrc = data.signatureImageBase64.startsWith("data:")
    ? data.signatureImageBase64
    : `data:image/png;base64,${data.signatureImageBase64}`;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.company}>{data.companyName}</Text>
          <Text style={styles.title}>{data.contractTitle}</Text>
          <Text style={styles.meta}>
            Version {data.contractVersion} · {data.contractType.replace(/_/g, " ")}
          </Text>
        </View>

        <View>
          {blocks.map((line, i) => (
            <Text key={`${i}-${line.slice(0, 24)}`} style={styles.bodyLine}>
              {line}
            </Text>
          ))}
        </View>

        <View style={styles.signSection}>
          <Text style={styles.signLabel}>Electronic signature</Text>
          <Image src={signatureSrc} style={styles.signatureImage} />
          <Text style={styles.signerName}>{data.signerFullName}</Text>
          <Text style={styles.meta}>{data.signerEmail}</Text>
          <Text style={styles.meta}>Signed {formatSignedAt(data.signedAt)}</Text>
        </View>

        <View style={styles.auditBox}>
          <Text style={styles.auditTitle}>Signature audit log</Text>
          <Text style={styles.auditRow}>Signer: {data.signerFullName}</Text>
          <Text style={styles.auditRow}>Email: {data.signerEmail}</Text>
          <Text style={styles.auditRow}>Signed at (UTC): {formatSignedAt(data.signedAt)}</Text>
          <Text style={styles.auditRow}>IP address: {data.signerIp ?? "—"}</Text>
          <Text style={styles.auditRow}>Device: {data.deviceInfo ?? "—"}</Text>
          <Text style={styles.auditRow}>Contract version ID: {data.contractVersionId}</Text>
        </View>
      </Page>
    </Document>
  );
}
