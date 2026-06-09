import { renderToBuffer } from "@react-pdf/renderer";
import { InvoicePDF } from "@/lib/pdf/invoice-template";
import type { InvoicePdfData } from "@/lib/pdf/invoice-template";

export async function renderInvoicePdfBufferFromData(data: InvoicePdfData): Promise<Buffer> {
  const buffer = await renderToBuffer(<InvoicePDF data={data} />);
  return Buffer.from(buffer);
}
