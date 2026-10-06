import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isValidUUID } from "@/lib/auth-api";
import { createServiceClient } from "@/lib/supabase/service";
import { renderSelfBillPdfBuffer } from "@/lib/self-bill-pdf-server";
import { buildCommissionInvoiceLines } from "@/lib/agent-model/commission-invoice";
import {
  findCommissionVatInvoice,
  renderCommissionVatInvoicePdf,
} from "@/lib/agent-model/commission-invoice-server";

/**
 * GET /api/self-bills/:id/commission-invoice: a fatura de VAT da comissão
 * (Schedule A) deste payout statement, para conferir antes ou depois do envio.
 *
 * Só LÊ: já emitida, mostra a emitida; ainda não, mostra uma prévia DRAFT com
 * as linhas de agora. O número só nasce no envio (`/api/self-bills/send-email`).
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { id } = await ctx.params;
  if (!isValidUUID(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const supabase = createServiceClient();
  const result = await renderSelfBillPdfBuffer(supabase, id);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const found = await findCommissionVatInvoice(supabase, id);
  const issued = "invoice" in found ? found.invoice : null;
  const draftLines = result.agent?.hasPlatformBookings ? buildCommissionInvoiceLines(result.agent) : [];
  if (!issued && draftLines.length === 0) {
    return NextResponse.json(
      { error: "No commission VAT invoice for this payout: no Platform Bookings (or FIXFY_AGENT_MODEL is off)." },
      { status: 404 },
    );
  }

  const buffer = await renderCommissionVatInvoicePdf(supabase, { sb: result.sb, invoice: issued, draftLines });
  const name = (issued?.reference ?? `${result.sb.reference}-commission-draft`).replace(/[^\w.-]+/g, "_");
  const inline = req.nextUrl.searchParams.get("inline") === "1";
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${name}.pdf"`,
    },
  });
}
