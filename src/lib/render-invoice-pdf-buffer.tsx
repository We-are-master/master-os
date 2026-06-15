import { renderToBuffer } from "@react-pdf/renderer";
import { InvoicePDF } from "@/lib/pdf/invoice-template";
import type { InvoicePdfData } from "@/lib/pdf/invoice-template";

export async function renderInvoicePdfBufferFromData(data: InvoicePdfData): Promise<Buffer> {
  try {
    const buffer = await renderToBuffer(<InvoicePDF data={data} />);
    return Buffer.from(buffer);
  } catch (err) {
    if (!data.logoUrl) throw err;
    const buffer = await renderToBuffer(<InvoicePDF data={{ ...data, logoUrl: undefined }} />);
    return Buffer.from(buffer);
  }
}
