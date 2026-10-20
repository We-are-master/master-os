import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { fecharFaturaSemanal, type ContaSemanal } from "@/lib/fatura-semanal";

/**
 * Fatura semanal das contas (dono, 20/10/2026: "Li & Fung no modo semanal"). Toda segunda
 * de manhã fecha a semana anterior de cada conta com `weekly_invoice_auto`: uma fatura com
 * todos os jobs concluídos e ainda não faturados, enviada com o Pay now e o relatório de
 * cada job. Os lembretes de vencida seguem pela régua de sempre.
 *
 *   GET /api/cron/fatura-semanal              fecha e envia
 *   GET /api/cron/fatura-semanal?dry-run=1    só lista o que entraria
 *
 * Auth: `Authorization: Bearer CRON_SECRET` (Vercel) ou `x-internal-secret: INTERNAL_SYNC_SECRET` (n8n).
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

function segredoConfere(dado: string | null | undefined, esperado: string | null | undefined): boolean {
  if (!dado || !esperado) return false;
  const a = Buffer.from(dado);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const bearer = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  const ok =
    segredoConfere(bearer, process.env.CRON_SECRET?.trim()) ||
    segredoConfere(req.headers.get("x-internal-secret"), process.env.INTERNAL_SYNC_SECRET?.trim());
  if (!ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ensaio = req.nextUrl.searchParams.get("dry-run") === "1";
  const admin = createServiceClient();
  const { data, error } = await admin
    .from("accounts")
    .select("id, company_name, payment_terms")
    .eq("weekly_invoice_auto", true)
    .is("deleted_at", null);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const resultados = [];
  for (const conta of (data ?? []) as ContaSemanal[]) {
    resultados.push(await fecharFaturaSemanal(admin, conta, { aplicar: !ensaio }).catch((e) => ({ conta: conta.company_name, erro: String(e) })));
  }
  return NextResponse.json({ ok: true, ensaio, resultados });
}
