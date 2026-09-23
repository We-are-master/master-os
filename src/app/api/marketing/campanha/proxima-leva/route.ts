/**
 * O n8n pede aqui a próxima leva de WhatsApp. Os itens já saem RESERVADOS e
 * com o corpo pronto para a Graph API; o n8n manda e devolve em /resultado.
 */
import { NextRequest, NextResponse } from "next/server";
import { chaveDoN8nOk } from "@/lib/marketing/chave-do-n8n";
import { proximaLevaWhatsApp } from "@/lib/marketing/campanha";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (!chaveDoN8nOk(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (process.env.MARKETING_CAMPANHA?.trim().toLowerCase() !== "on") return NextResponse.json({ itens: [], motivo: "MARKETING_CAMPANHA != on" });
  try {
    const n = Number(req.nextUrl.searchParams.get("n") ?? "50");
    return NextResponse.json(await proximaLevaWhatsApp({ n }));
  } catch (err) {
    console.error("[campanha] próxima leva falhou:", err);
    return NextResponse.json({ itens: [], motivo: err instanceof Error ? err.message : "falhou" }, { status: 500 });
  }
}
