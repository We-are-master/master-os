import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-api";
import {
  avisarClienteDaRemarcacao,
  type AvisoDeRemarcacao,
} from "@/lib/notify-client-reschedule-server";

/**
 * POST /api/jobs/[id]/notify-client-reschedule
 *
 * Avisa o CLIENTE que a data mudou. O par disto para o parceiro já existe em
 * `notify-partner-zendesk` com `kind: "rescheduled"`, e é chamado dos mesmos
 * pontos da tela: quem remarca avisa os dois lados no mesmo gesto.
 *
 * Desde 07/09/2026 a rota é só a porta: a decisão inteira (destinatário pela
 * conta, layout, trava de mensagem, e-mail, WhatsApp e o carimbo que reabre o
 * lembrete de véspera) vive em `avisarClienteDaRemarcacao`, para que o agente
 * que LÊ o e-mail de remarcação da plataforma consiga avisar sem sessão. O
 * aviso não pode depender de alguém estar com uma tela aberta.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as AvisoDeRemarcacao;

  const r = await avisarClienteDaRemarcacao(id, body);
  if (r.ok) return NextResponse.json(r);
  if ("skipped" in r) return NextResponse.json(r, { status: 200 });
  return NextResponse.json(r, { status: r.error === "job_not_found" ? 404 : 502 });
}
