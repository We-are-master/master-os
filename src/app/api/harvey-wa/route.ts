/**
 * Webhook da Sunshine Conversations (integração "harvey" no switchboard do
 * Zendesk): cada mensagem de WhatsApp chega aqui na hora.
 *
 * Responde 200 na mesma hora e trabalha depois (`after`): a Sunshine reenvia
 * o evento se a resposta demora, e o motor tem trava para repetida. Promessa
 * solta depois da resposta morre na Vercel, por isso `after` e não `void`.
 *
 * Autenticação: o segredo do webhook da integração vem no X-API-Key.
 */

import { after, NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { processarEvento } from "@/lib/harvey-wa/motor";
import { passarParaEquipe } from "@/lib/harvey-wa/sunshine";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function autorizado(dado: string | null): boolean {
  const segredo = process.env.SUNSHINE_WEBHOOK_SECRET?.trim();
  if (!segredo || !dado || dado.length !== segredo.length) return false;
  return timingSafeEqual(Buffer.from(dado), Buffer.from(segredo));
}

export async function POST(req: NextRequest) {
  if (!autorizado(req.headers.get("x-api-key"))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const corpo = (await req.json().catch(() => null)) as { events?: Array<Parameters<typeof processarEvento>[0]> } | null;
  const eventos = corpo?.events ?? [];
  after(async () => {
    for (const e of eventos) {
      try {
        const r = await processarEvento(e);
        console.log("[harvey-wa]", e.payload?.conversation?.id, r);
      } catch (err) {
        console.error("[harvey-wa] falhou", e.payload?.conversation?.id, err);
        // Cliente nunca fica sem resposta: deu erro, a equipe assume a conversa.
        const id = e.payload?.conversation?.id;
        if (id && e.payload?.message?.author?.type === "user") {
          await passarParaEquipe(id, `Harvey error: ${err instanceof Error ? err.message.slice(0, 120) : "unknown"}`).catch(() => {});
        }
      }
    }
  });
  return NextResponse.json({ ok: true, eventos: eventos.length });
}
