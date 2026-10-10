/**
 * Alertas da automação (Fase 5): cartão recusado, cobrança que a Stripe não respondeu,
 * job aprovado sem self-bill e a conferência do payday. GET lista; POST manda e-mail
 * para a lista de company_settings.daily_brief_emails, só quando tem algo.
 * Chamado pelo n8n de manhã. Auth: x-internal-secret = INTERNAL_SYNC_SECRET.
 */
import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { createServiceClient } from "@/lib/supabase/service";
import { segredoInternoValido } from "@/lib/internal-secret";
import { alertasDeAutomacao, type Alertas } from "@/lib/divisao-automacao";

export const runtime = "nodejs";
export const maxDuration = 60;

function corpo(a: Alertas): string {
  const bloco = (titulo: string, itens: string[]) => (itens.length ? `${titulo}\n${itens.map((i) => `- ${i}`).join("\n")}\n` : "");
  return [
    bloco("Card refused (job waits in final check):", a.cartaoRecusado),
    bloco("Card charges Stripe never answered:", a.cobrancaPresa),
    bloco("Approved jobs on no self-bill (partner would not be paid):", a.semSelfBill),
    bloco("Self-bills to fix before payday:", a.payday),
  ].filter(Boolean).join("\n");
}

export async function GET(req: NextRequest) {
  if (!segredoInternoValido(req.headers.get("x-internal-secret"))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await alertasDeAutomacao(createServiceClient()));
}

export async function POST(req: NextRequest) {
  if (!segredoInternoValido(req.headers.get("x-internal-secret"))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const sb = createServiceClient();
  const a = await alertasDeAutomacao(sb);
  if (!a.total) return NextResponse.json({ ok: true, enviado: false, total: 0 });
  const { data: cfg } = await sb.from("company_settings").select("daily_brief_emails").limit(1).maybeSingle();
  const para = String((cfg as { daily_brief_emails?: string } | null)?.daily_brief_emails ?? "").split(/[,;\s]+/).filter((e) => e.includes("@"));
  const key = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RESEND_FROM_EMAIL?.trim();
  if (!para.length || !key || !from) return NextResponse.json({ ok: true, enviado: false, total: a.total, motivo: "no recipients or Resend not set", alertas: a });
  const { error } = await new Resend(key).emails.send({ from, to: para, subject: `Fixfy OS: ${a.total} thing${a.total === 1 ? "" : "s"} need a person today`, text: corpo(a) });
  return NextResponse.json({ ok: !error, enviado: !error, total: a.total, erro: error?.message });
}
