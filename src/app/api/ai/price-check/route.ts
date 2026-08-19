/**
 * O price-check do orçamentista: pedido em texto livre entra, quote fechada
 * sai — labour aprovado do pricebook + kit de material comprado do mais
 * barato e vendido pela média, com o link de prova de cada preço.
 *
 * A rota é fina de propósito: auth e validação aqui, o resto em
 * lib/orcamentista/price-check — o MESMO núcleo que o quoter do Zendesk usa,
 * para não existirem duas contas.
 *
 * Quem chama: a aba Quote do dashboard (sessão), o quoter do Zendesk e, em
 * breve, Mike (x-api-key, o mesmo padrão do endpoint do Express).
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-api";
import { executarPriceCheck } from "@/lib/orcamentista/price-check";

export const dynamic = "force-dynamic";

async function autorizado(req: NextRequest): Promise<boolean> {
  const key = req.headers.get("x-api-key")?.trim();
  const esperada = process.env.MASTER_OS_JOB_WEBHOOK_API_KEY?.trim();
  if (esperada && key === esperada) return true;
  const auth = await requireAuth();
  return !(auth instanceof NextResponse);
}

export async function POST(req: NextRequest) {
  if (!(await autorizado(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let pedido = "";
  try {
    const body = (await req.json()) as { request?: string };
    pedido = String(body.request ?? "").trim();
  } catch {
    /* cai no 422 abaixo */
  }
  if (pedido.length < 3) {
    return NextResponse.json(
      { error: 'send { request: "what the customer wants" }' },
      { status: 422 },
    );
  }

  try {
    const resultado = await executarPriceCheck(pedido);
    return NextResponse.json({
      request: pedido,
      quote: resultado.quote,
      presentable: resultado.presentable,
      electrical_work_requested: resultado.electricalWorkRequested,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: msg.includes("OpenAI") ? 502 : 500 });
  }
}
