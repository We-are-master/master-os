import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isValidUUID } from "@/lib/auth-api";
import { createServiceClient } from "@/lib/supabase/service";
import { renderSelfBillPdfBuffer } from "@/lib/self-bill-pdf-server";

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

  const { buffer, sb } = result;
  const safeName = String(sb.reference ?? "self-bill").replace(/[^\w.-]+/g, "_");
  /**
   * `?inline=1` mostra o PDF na aba em vez de baixar.
   *
   * O botão de conferir antes de enviar não deveria deixar um arquivo na pasta
   * de downloads a cada olhada. O download continua sendo o padrão, para não
   * mudar o que já existe e é usado.
   */
  const inline = req.nextUrl.searchParams.get("inline") === "1";
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${safeName}.pdf"`,
    },
  });
}
