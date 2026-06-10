import { renderToBuffer } from "@react-pdf/renderer";
import {
  WorkforceContractSignedPDF,
  type WorkforceContractSignedPdfData,
} from "@/lib/pdf/workforce-contract-signed-pdf";

export async function renderWorkforceSignedContractPdf(
  data: WorkforceContractSignedPdfData,
): Promise<Buffer> {
  const buffer = await renderToBuffer(<WorkforceContractSignedPDF data={data} />);
  return Buffer.from(buffer);
}
