import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { Invoice } from "@/types/database";

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 10, fontFamily: "Helvetica" },
  h1: { fontSize: 16, marginBottom: 12, fontFamily: "Helvetica-Bold" },
  row: { flexDirection: "row", justifyContent: "space-between", marginTop: 6 },
  label: { fontSize: 9, color: "#555" },
});

export function InvoicePreviewPDF({ invoice }: { invoice: Invoice }) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.h1}>Invoice {invoice.reference}</Text>
        <View style={styles.row}>
          <Text style={styles.label}>Client</Text>
          <Text>{invoice.client_name}</Text>
        </View>
        {invoice.job_reference ? (
          <View style={styles.row}>
            <Text style={styles.label}>Job reference</Text>
            <Text>{invoice.job_reference}</Text>
          </View>
        ) : null}
        <View style={styles.row}>
          <Text style={styles.label}>Amount</Text>
          <Text>£{Number(invoice.amount).toFixed(2)}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Status</Text>
          <Text>{invoice.status}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Due</Text>
          <Text>{invoice.due_date}</Text>
        </View>
      </Page>
    </Document>
  );
}
