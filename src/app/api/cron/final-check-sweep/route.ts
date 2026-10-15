import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { FINAL_CHECK_AUTO_ON, runFinalCheckAutomatico } from "@/lib/final-check-automatico";
import { entraNaVarredura } from "@/lib/final-check-decisao";

/**
 * Rede de segurança do final check automático (Fase 3, dono 15/10/2026). O gatilho de
 * verdade é a submissão do relatório; esta varredura pega o job que ficou em Final Checks
 * com relatório dos últimos 7 dias (falha no meio, relatório de antes do deploy). Job que
 * já ficou para a equipe pelo mesmo motivo não ganha nota de novo.
 *
 *   GET /api/cron/final-check-sweep              roda, se FINAL_CHECK_AUTO=1
 *   GET /api/cron/final-check-sweep?dry-run=1    só diz o que faria (funciona desligado)
 *
 * Auth: `Authorization: Bearer CRON_SECRET` (Vercel) ou `x-internal-secret: INTERNAL_SYNC_SECRET` (n8n).
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/** Por rodada: cada job pode levar alguns segundos (PDF, Zendesk, e-mail). */
const MAX_POR_RODADA = 15;

function segredoConfere(dado: string | null | undefined, esperado: string | null | undefined): boolean {
  if (!dado || !esperado) return false;
  const a = Buffer.from(dado);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const bearer = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  const ok =
    segredoConfere(bearer, process.env.CRON_SECRET?.trim()) ||
    segredoConfere(req.headers.get("x-internal-secret"), process.env.INTERNAL_SYNC_SECRET?.trim());
  if (!ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ensaio = req.nextUrl.searchParams.get("dry-run") === "1";
  if (!ensaio && !FINAL_CHECK_AUTO_ON()) return NextResponse.json({ ok: true, ligado: false, resultados: [] });

  const admin = createServiceClient();
  const { data, error } = await admin
    .from("jobs")
    .select("id, reference, final_report")
    .eq("status", "final_check")
    .eq("final_report_submitted", true)
    .is("review_sent_at", null)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const agora = new Date();
  const candidatos = ((data ?? []) as { id: string; reference: string | null; final_report: { submitted_at?: string } | null }[])
    .filter((j) => entraNaVarredura(j.final_report?.submitted_at ?? null, agora))
    .slice(0, MAX_POR_RODADA);

  const resultados: { job: string | null; resultado: unknown }[] = [];
  for (const j of candidatos) {
    const r = await runFinalCheckAutomatico(admin, j.id, { origem: "sweep", ensaio });
    resultados.push({ job: j.reference, resultado: r });
  }
  console.log(`[final-check-sweep] ${ensaio ? "ensaio" : "rodada"}: ${resultados.length} job(s)`);
  return NextResponse.json({ ok: true, ligado: FINAL_CHECK_AUTO_ON(), ensaio, resultados });
}

export const POST = GET;
