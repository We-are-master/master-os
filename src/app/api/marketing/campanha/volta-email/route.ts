/**
 * Uma volta de e-mail da campanha. O n8n chama de 15 em 15 minutos.
 * Manda até MARKETING_EMAIL_POR_VOLTA (padrão 60) pelo batch do Resend e
 * agenda o WhatsApp de follow-up de quem tem os dois canais.
 */
import { NextRequest, NextResponse } from "next/server";
import { chaveDoN8nOk } from "@/lib/marketing/chave-do-n8n";
import { voltaDeEmail, soltarReservasPresas } from "@/lib/marketing/campanha";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  if (!chaveDoN8nOk(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (process.env.MARKETING_CAMPANHA?.trim().toLowerCase() !== "on") return NextResponse.json({ ok: true, desligado: "MARKETING_CAMPANHA != on" });
  try {
    const soltas = await soltarReservasPresas();
    const r = await voltaDeEmail();
    return NextResponse.json({ ok: true, soltas, ...r });
  } catch (err) {
    console.error("[campanha] volta de e-mail falhou:", err);
    return NextResponse.json({ ok: false, reason: err instanceof Error ? err.message : "falhou" }, { status: 500 });
  }
}
