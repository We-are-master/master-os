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
import { alertasDeAutomacao, type Alertas } from "@/lib/divisao-automacao";
import { assuntoDoPlacar, montarPlacar, placarEmHtml } from "@/lib/placar-diario";

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
  // O e-mail das 8h virou o placar do dia (11/10/2026): sai sempre, com os alertas no fim.
  const p = await montarPlacar(sb);
  const resumo = { jobsPorDia: p.seteDias.porDia, pctDaMeta: p.trintaDias.pctDaMeta, alertas: p.alertas.total };
  if (req.nextUrl.searchParams.get("dry-run") === "1") return NextResponse.json({ ok: true, enviado: false, ensaio: true, assunto: assuntoDoPlacar(p), placar: p });
  const { data: cfg } = await sb.from("company_settings").select("daily_brief_emails").limit(1).maybeSingle();
  const para = String((cfg as { daily_brief_emails?: string } | null)?.daily_brief_emails ?? "").split(/[,;\s]+/).filter((e) => e.includes("@"));
  const key = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RESEND_FROM_EMAIL?.trim();
  if (!para.length || !key || !from) return NextResponse.json({ ok: true, enviado: false, motivo: "no recipients or Resend not set", ...resumo });
  const { error } = await new Resend(key).emails.send({ from, to: para, subject: assuntoDoPlacar(p), html: placarEmHtml(p), text: corpo(p.alertas) || "Nothing waiting on a person." });
  return NextResponse.json({ ok: !error, enviado: !error, erro: error?.message, ...resumo });
}
