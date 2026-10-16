/**
 * Webhook do Resend: o que acontece DEPOIS que o e-mail sai.
 *
 * O envio só diz que o Resend aceitou. Entrega, abertura, rejeição e
 * reclamação chegam aqui, minutos ou horas depois, e são elas que dizem se a
 * campanha funcionou e se o domínio está saudável.
 *
 * Duas delas não são estatística, são ação imediata:
 *
 *   complained  alguém clicou em "marcar como spam". Bloqueia na hora. Manter
 *               essa pessoa na lista é o caminho mais curto para o domínio
 *               inteiro cair, e o domínio também manda cobrança e job.
 *   bounced     endereço morto. Bloqueia, senão a taxa de rejeição sobe e o
 *               provedor passa a tratar todo o nosso envio como suspeito.
 *
 * Configurar em Resend → Webhooks, apontando para /api/webhooks/resend, com
 * RESEND_WEBHOOK_SECRET no ambiente.
 */

import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { bloquear } from "@/lib/marketing/suppressions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Evento do Resend → coluna de data em `marketing_touches`. */
const CARIMBO: Record<string, string> = {
  "email.delivered": "delivered_at",
  "email.opened": "opened_at",
  "email.clicked": "clicked_at",
  "email.bounced": "bounced_at",
  "email.complained": "complained_at",
};

/**
 * Assinatura no formato Svix, que é o que o Resend usa.
 *
 * Cabeçalhos: `svix-id`, `svix-timestamp`, `svix-signature`. A assinatura é
 * HMAC-SHA256 sobre `id.timestamp.corpo`, com a chave em base64 depois do
 * prefixo `whsec_`. O cabeçalho pode trazer várias assinaturas separadas por
 * espaço, cada uma como `v1,<base64>`: basta uma bater.
 */
function assinaturaConfere(req: NextRequest, corpoCru: string): boolean {
  const segredo = process.env.RESEND_WEBHOOK_SECRET?.trim();
  if (!segredo) return false;

  const id = req.headers.get("svix-id");
  const ts = req.headers.get("svix-timestamp");
  const assinaturas = req.headers.get("svix-signature");
  if (!id || !ts || !assinaturas) return false;

  // Janela de cinco minutos: sem isso, quem capturar um POST válido pode
  // repetir ele para sempre.
  const idade = Math.abs(Date.now() / 1000 - Number(ts));
  if (!Number.isFinite(idade) || idade > 300) return false;

  const chave = Buffer.from(segredo.replace(/^whsec_/, ""), "base64");
  const esperado = createHmac("sha256", chave).update(`${id}.${ts}.${corpoCru}`).digest("base64");
  const esperadoBuf = Buffer.from(esperado);

  for (const parte of assinaturas.split(" ")) {
    const valor = parte.split(",")[1];
    if (!valor) continue;
    const dado = Buffer.from(valor);
    if (dado.length === esperadoBuf.length && timingSafeEqual(dado, esperadoBuf)) return true;
  }
  return false;
}

export async function POST(req: NextRequest) {
  const corpoCru = await req.text();

  if (!assinaturaConfere(req, corpoCru)) {
    // 401 de propósito: o Resend re-tenta, e se o segredo estiver errado a
    // gente quer ver a falha no painel dele em vez de perder evento calado.
    return NextResponse.json({ error: "assinatura inválida" }, { status: 401 });
  }

  let evento: { type?: string; data?: { email_id?: string; to?: string[] | string; subject?: string } };
  try { evento = JSON.parse(corpoCru); } catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }

  const tipo = String(evento.type ?? "");
  const coluna = CARIMBO[tipo];
  if (!coluna) return NextResponse.json({ ok: true, ignorado: tipo });

  const providerId = evento.data?.email_id ?? null;
  const destino = Array.isArray(evento.data?.to) ? evento.data?.to[0] : evento.data?.to;
  const email = String(destino ?? "").trim().toLowerCase();

  const admin = createServiceClient();
  const agora = new Date().toISOString();

  /**
   * Casa pelo id do Resend, e só cai no e-mail se não houver id.
   *
   * O id identifica UMA mensagem. O e-mail identifica a pessoa, que pode ter
   * recebido dez campanhas: carimbar por e-mail marcaria todas como abertas
   * quando ela abriu uma.
   */
  let alvo = admin.from("marketing_touches").update({ [coluna]: agora });
  if (providerId) alvo = alvo.eq("provider_id", providerId);
  else if (email) alvo = alvo.ilike("email", email).is(coluna, null);
  else return NextResponse.json({ ok: true, ignorado: "evento sem id e sem destinatário" });

  const { error } = await alvo;
  if (error) console.error(`[resend-webhook] falhou carimbar ${coluna}:`, error.message);

  // As duas que exigem ação, não só registro.
  if (email && (tipo === "email.complained" || tipo === "email.bounced")) {
    try {
      await bloquear(email, tipo === "email.complained" ? "complained" : "bounced", "resend_webhook", tipo);
    } catch (err) {
      console.error(`[resend-webhook] falhou bloquear ${email}:`, err);
    }
  }

  return NextResponse.json({ ok: true, tipo, carimbado: coluna });
}
