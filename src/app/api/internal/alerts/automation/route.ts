/**
 * Placar do dia + alertas da automação. GET lista os alertas (cartão recusado, cobrança
 * que a Stripe não respondeu, job aprovado sem self-bill, conferência do payday).
 * POST manda o placar (src/lib/placar-diario.ts) para company_settings.daily_brief_emails,
 * todo dia, com os alertas no fim; ?dry-run=1 devolve o placar sem mandar.
 * Chamado pelo n8n às 8h de Londres. Auth: x-internal-secret = INTERNAL_SYNC_SECRET.
 */
import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { createServiceClient } from "@/lib/supabase/service";
import { segredoInternoValido } from "@/lib/internal-secret";
import { alertasDeAutomacao } from "@/lib/divisao-automacao";
import { assuntoDoPlacar, montarPlacar, placarEmHtml } from "@/lib/placar-diario";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!segredoInternoValido(req.headers.get("x-internal-secret"))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await alertasDeAutomacao(createServiceClient()));
}

export async function POST(req: NextRequest) {
  if (!segredoInternoValido(req.headers.get("x-internal-secret"))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const sb = createServiceClient();
  // O e-mail das 8h é o placar do dia (11/10/2026): faturamento do mês e meta, leads e
  // conversão, margem bruta e o que precisa de atenção urgente. Sai sempre.
  const p = await montarPlacar(sb);
  const resumo = { receitaDoMes: p.mes.receita, falta: p.mes.falta, leads: p.leads.total, urgentes: p.urgentes.length };
  if (req.nextUrl.searchParams.get("dry-run") === "1") return NextResponse.json({ ok: true, enviado: false, ensaio: true, assunto: assuntoDoPlacar(p), placar: p });
  const { data: cfg } = await sb.from("company_settings").select("daily_brief_emails").limit(1).maybeSingle();
  const para = String((cfg as { daily_brief_emails?: string } | null)?.daily_brief_emails ?? "").split(/[,;\s]+/).filter((e) => e.includes("@"));
  const key = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RESEND_FROM_EMAIL?.trim();
  if (!para.length || !key || !from) return NextResponse.json({ ok: true, enviado: false, motivo: "no recipients or Resend not set", ...resumo });
  const { error } = await new Resend(key).emails.send({ from, to: para, subject: assuntoDoPlacar(p), html: placarEmHtml(p), text: p.urgentes.map((u) => `- ${u.texto}`).join("\n") || "Nothing needs urgent attention." });
  return NextResponse.json({ ok: !error, enviado: !error, erro: error?.message, ...resumo });
}
