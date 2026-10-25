import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { feedbackLigado, varrerFeedbackPosJob } from "@/lib/feedback/pos-job";

/**
 * Pedido de feedback pós-job por e-mail, uma vez por dia (vercel.json, 10:00
 * UTC = 10h/11h de Londres, dentro da janela de 9h-20h).
 *
 *   GET /api/cron/feedback-pos-job             manda, se FEEDBACK_POS_JOB=on
 *   GET /api/cron/feedback-pos-job?dry-run=1   só lista
 *
 * Sem `FEEDBACK_POS_JOB=on` é sempre ensaio, e o ensaio não grava nada. Mandar
 * também exige `CLIENT_MESSAGING_ENABLED=1`. Regras em `src/lib/feedback/pos-job.ts`.
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *     "https://app.getfixfy.com/api/cron/feedback-pos-job?dry-run=1"
 */

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
  const aplicar = feedbackLigado() && req.nextUrl.searchParams.get("dry-run") !== "1";
  try {
    const r = await varrerFeedbackPosJob(createServiceClient(), { aplicar });
    const conta = (x: string) => r.linhas.filter((l) => l.resultado === x).length;
    console.log(`[feedback-pos-job] ${r.modo}: ${conta("enviado")} enviado(s), ${conta("enviaria")} enviaria(m), ${conta("pulado")} pulado(s), ${conta("falhou")} falha(s)`);
    return NextResponse.json({ ...r, ligado: feedbackLigado() });
  } catch (e) {
    console.error("[feedback-pos-job]", e);
    return NextResponse.json({ error: String((e as Error).message ?? e) }, { status: 500 });
  }
}
