import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import React from "react";
import { requireAuth, isValidUUID } from "@/lib/auth-api";
import { createClient } from "@/lib/supabase/server";
import { InvoicePreviewPDF } from "@/lib/pdf/invoice-preview-pdf";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { id } = await ctx.params;
  if (!id || !isValidUUID(id)) {
    return NextResponse.json({ error: "Invalid job id" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: job, error: jobErr } = await supabase.from("jobs").select("id, reference, invoice_id").eq("id", id).single();
  if (jobErr || !job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const invoiceId = job.invoice_id?.trim();
  if (!invoiceId) {
    return NextResponse.json({ placeholder: true, message: "Invoice not yet generated." }, { status: 404 });
  }

  const { data: invoice, error: invErr } = await supabase.from("invoices").select("*").eq("id", invoiceId).single();
  if (invErr || !invoice) {
    return NextResponse.json({ placeholder: true, message: "Invoice not yet generated." }, { status: 404 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfBuffer = await (renderToBuffer as any)(React.createElement(InvoicePreviewPDF, { invoice }));

  return new NextResponse(pdfBuffer, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="invoice-${invoice.reference}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
