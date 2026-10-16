import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-api";
import { createServiceClient } from "@/lib/supabase/service";
import { aposEntradaDaCotacaoPaga } from "@/lib/quote-deposit-paid-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/quotes/deposit-paid  { jobReference, origem? }
 *
 * Entrada da cotação marcada como paga na tela (16/10/2026). A rotina pós-entrada
 * (recibo, parceiro do lance, Job confirmed) manda e-mail e só roda no servidor.
 * Só age se a fatura de entrada do job está mesmo paga, e a rotina só age com a
 * cotação em awaiting_payment: chamar de novo não repete nada.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  let body: { jobReference?: string; origem?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const jobReference = String(body.jobReference ?? "").trim();
  if (!/^JOB-\d+$/i.test(jobReference)) {
    return NextResponse.json({ error: "jobReference is required" }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data: inv } = await supabase
    .from("invoices")
    .select("id, status")
    .eq("job_reference", jobReference)
    .eq("invoice_kind", "deposit")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if ((inv as { status?: string } | null)?.status !== "paid") {
    return NextResponse.json({ ok: false, skipped: "deposit invoice is not paid" });
  }

  const origem = String(body.origem ?? "manual_mark_paid").slice(0, 40);
  const agiu = await aposEntradaDaCotacaoPaga(supabase, jobReference, origem);
  return NextResponse.json({ ok: true, agiu });
}
