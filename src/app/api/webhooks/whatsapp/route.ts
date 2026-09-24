/**
 * Webhook do WhatsApp (Cloud API): o que volta DEPOIS da mensagem.
 *
 * A conversa em si continua no Zendesk, que é outro app inscrito na mesma
 * WABA e recebe tudo igual. Aqui só entra o que a campanha precisa saber:
 *
 *   Stop        "Stop promotions" (botão do template) ou STOP/UNSUBSCRIBE
 *               digitado. Bloqueia o número na hora, em whatsapp_suppressions.
 *   resposta    carimba `replied_at` no último toque de marketing do número.
 *   status      delivered/read/failed carimbam o toque pelo id da mensagem.
 *               Falha de "número sem WhatsApp" (131026) bloqueia como invalid,
 *               senão a próxima campanha tenta de novo.
 *
 * Configuração: `WHATSAPP_VERIFY_TOKEN` (qualquer segredo, o mesmo informado à
 * Meta) e, quando houver, `WHATSAPP_APP_SECRET` para conferir a assinatura.
 * Sem o segredo do app a rota aceita o evento, porque tudo que ela faz é
 * REDUZIR envio: um evento forjado no máximo tira alguém da lista.
 */

import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { ehPedidoDeSaida } from "@/lib/marketing/whatsapp";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** O aperto de mão da Meta ao cadastrar a URL. */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const esperado = process.env.WHATSAPP_VERIFY_TOKEN?.trim();
  if (p.get("hub.mode") === "subscribe" && esperado && p.get("hub.verify_token") === esperado) {
    return new NextResponse(p.get("hub.challenge") ?? "", { status: 200 });
  }
  return NextResponse.json({ error: "forbidden" }, { status: 403 });
}

function assinaturaOk(corpo: string, cabecalho: string | null): boolean {
  const segredo = process.env.WHATSAPP_APP_SECRET?.trim();
  if (!segredo) return true;
  if (!cabecalho?.startsWith("sha256=")) return false;
  const esperado = Buffer.from("sha256=" + createHmac("sha256", segredo).update(corpo).digest("hex"));
  const recebido = Buffer.from(cabecalho);
  return esperado.length === recebido.length && timingSafeEqual(esperado, recebido);
}

type Mensagem = {
  from?: string;
  type?: string;
  text?: { body?: string };
  button?: { text?: string; payload?: string };
  interactive?: { button_reply?: { title?: string } };
};
type Status = { id?: string; status?: string; recipient_id?: string; errors?: { code?: number }[] };

const CARIMBO: Record<string, string> = { delivered: "delivered_at", read: "opened_at", failed: "bounced_at" };

export async function POST(req: NextRequest) {
  const corpo = await req.text();
  if (!assinaturaOk(corpo, req.headers.get("x-hub-signature-256"))) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  let evento: { entry?: { changes?: { value?: { messages?: Mensagem[]; statuses?: Status[] } }[] }[] };
  try {
    evento = JSON.parse(corpo);
  } catch {
    return NextResponse.json({ ok: true, ignorado: "json" });
  }

  const sb = createServiceClient();
  const agora = new Date().toISOString();

  for (const entry of evento.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const valor = change.value ?? {};

      for (const m of valor.messages ?? []) {
        const phone = String(m.from ?? "").replace(/\D/g, "");
        if (!phone) continue;
        const texto = m.button?.text ?? m.button?.payload ?? m.interactive?.button_reply?.title ?? m.text?.body;

        if (ehPedidoDeSaida(texto)) {
          await sb
            .from("whatsapp_suppressions")
            .upsert({ phone, reason: "stopped", source: "webhook", notes: String(texto).slice(0, 80) }, { onConflict: "phone", ignoreDuplicates: true });
        }

        // Resposta ao último toque de marketing, se houver um nos últimos 14 dias.
        const { data: ultimo } = await sb
          .from("marketing_touches")
          .select("id")
          .eq("channel", "whatsapp")
          .eq("phone", phone)
          .is("replied_at", null)
          .gte("sent_at", new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString())
          .order("sent_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (ultimo) await sb.from("marketing_touches").update({ replied_at: agora }).eq("id", ultimo.id);
      }

      for (const s of valor.statuses ?? []) {
        const coluna = s.status ? CARIMBO[s.status] : undefined;
        if (!s.id || !coluna) continue;
        // Só o primeiro carimbo vale: `read` repetido não reescreve a hora.
        await sb.from("marketing_touches").update({ [coluna]: agora }).eq("provider_id", s.id).is(coluna, null);

        if (s.status === "failed" && s.errors?.some((e) => e.code === 131026) && s.recipient_id) {
          await sb
            .from("whatsapp_suppressions")
            .upsert({ phone: s.recipient_id.replace(/\D/g, ""), reason: "invalid", source: "webhook" }, { onConflict: "phone", ignoreDuplicates: true });
        }
      }
    }
  }

  // A Meta reenvia o que não recebe 200; responder rápido e sempre.
  return NextResponse.json({ ok: true });
}
