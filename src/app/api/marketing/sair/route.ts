/**
 * O "unsubscribe" das campanhas. O link leva o id da linha da fila, que é
 * aleatório e não diz de quem é: funciona igual com e-mail mandado do Mac ou
 * da Vercel (o token assinado dependia de um segredo que não é o mesmo nos
 * dois) e não põe e-mail na URL. GET é o clique; POST é o "one-click" que o
 * Gmail e o Outlook mandam pelo cabeçalho List-Unsubscribe.
 */
import { NextRequest, NextResponse } from "next/server";
import { tirarDaLista } from "@/lib/marketing/campanha";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function pagina(texto: string, status = 200) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fixfy</title></head><body style="margin:0;font:16px/1.5 -apple-system,system-ui,sans-serif;background:#f6f5f2;color:#14161a"><div style="max-width:480px;margin:80px auto;padding:0 16px"><p style="font-weight:700;font-size:20px">Fixfy</p><p>${texto}</p></div></body></html>`;
  return new NextResponse(html, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

async function sair(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") ?? "";
  if (!UUID.test(q)) return null;
  return tirarDaLista({ queueId: q }, "unsubscribe_link");
}

export async function GET(req: NextRequest) {
  const r = await sair(req);
  if (!r?.ok) return pagina("This link has expired. Reply to any of our emails with STOP and we will take you off the list.", 400);
  return pagina("Done. You will not get any more offers from us, by email or WhatsApp. Booking confirmations for jobs you book still arrive as normal.");
}

export async function POST(req: NextRequest) {
  const r = await sair(req);
  return NextResponse.json({ ok: Boolean(r?.ok) }, { status: r?.ok ? 200 : 400 });
}
