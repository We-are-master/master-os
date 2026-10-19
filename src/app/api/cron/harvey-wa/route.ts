/**
 * Varredura do Harvey no WhatsApp, a cada 10 min pelo n8n:
 *  - chase de quem parou de responder (src/lib/harvey-wa/chase.ts)
 *  - transferência aguardando o sinal: confirma, lembra e libera (transferencia.ts).
 *  - lead que nunca respondeu o primeiro contato (followup-leads.ts).
 *  - quote enviada sem resposta: 3 lembretes em 7 dias e fecha no 7º; desistência fecha na hora (followup-quotes.ts).
 *    Mora aqui e não no poll do Railway porque lá não há a chave da Sunshine.
 *  - cotação automática por parceiro: 📝 Needs Quote → convite aos 3-5 melhores, lembrete 6h,
 *    aviso ao cliente 24h, lance vira quote (cotacao-automatica.ts). Chave HARVEY_AUTO_QUOTE=1.
 *
 * Esta rota EXECUTA: manda mensagem no WhatsApp de cliente. Para olhar sem mexer:
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *        "https://app.getfixfy.com/api/cron/harvey-wa?dry-run=1"
 */

import { harveyLigado, modoDe } from "@/lib/harvey/autonomia";
import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { varrerChases } from "@/lib/harvey-wa/chase";
import { varrerTransferencias } from "@/lib/harvey-wa/transferencia";
import { varrerFollowupDeLeads } from "@/lib/harvey-wa/followup-leads";
import { varrerCobrancaDeQuotes } from "@/lib/harvey-wa/followup-quotes";
import { varrerCotacaoAutomatica } from "@/lib/harvey-wa/varredura-cotacao-automatica";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

function secretsMatch(provided: string | null | undefined, expected: string | null | undefined): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
  if (!secretsMatch(bearer, process.env.CRON_SECRET?.trim())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const ensaio = req.nextUrl.searchParams.get("dry-run") === "1";
  if (process.env.HARVEY_WA_LIGADO !== "1" && !ensaio) return NextResponse.json({ ok: true, desligado: "HARVEY_WA_LIGADO != 1" });
  if (!(await harveyLigado()) && !ensaio) return NextResponse.json({ ok: true, desligado: "Pause everything on /agents/harvey" });
  try {
    const sb = createServiceClient();
    const chase = await varrerChases(sb, { aplicar: !ensaio });
    const transferencias = await varrerTransferencias(sb, new Date(), { aplicar: !ensaio });
    // Lead que nunca respondeu o primeiro contato: 3 WhatsApps e 3 e-mails em 3 dias, depois fecha (followup-leads.ts).
    const leads = await varrerFollowupDeLeads(sb, { aplicar: !ensaio });
    // Quote enviada (🟠 Approval) sem resposta: lembrete com 24h e 72h. Chave HARVEY_QUOTE_CHASE=1.
    const quotes = process.env.HARVEY_QUOTE_CHASE?.trim() === "1" || ensaio ? await varrerCobrancaDeQuotes(sb, { aplicar: !ensaio && process.env.HARVEY_QUOTE_CHASE?.trim() === "1" }) : null;
    // Needs Quote → parceiros → preço → cliente. Chave HARVEY_AUTO_QUOTE=1; no ensaio só lista.
    const autoQuote = process.env.HARVEY_AUTO_QUOTE?.trim() === "1" && (await modoDe("cotacao")) === "on";
    const cotacao = autoQuote || ensaio ? await varrerCotacaoAutomatica(sb, { aplicar: !ensaio && autoQuote }) : null;
    return NextResponse.json({ ok: true, chase, transferencias, leads, quotes, cotacao });
  } catch (err) {
    console.error("[harvey-wa chase] falhou:", err);
    return NextResponse.json({ ok: false, reason: err instanceof Error ? err.message : "falhou" }, { status: 500 });
  }
}
