import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { enviarRelatorioExterno, motivoNaoElegivel, previewEnvio } from "@/lib/stefane/run-external-report";

/**
 * STEFANE — botão "Approve Report" do card.
 *
 * POST dispara o envio e devolve na hora, sem esperar. O preenchimento leva de
 * 8 a 35 segundos (o upload de foto é quem manda), tempo demais para segurar um
 * clique, então o card acompanha por GET até virar enviado ou falhou.
 *
 * GET responde o estado atual, para o card poder mostrar "enviando" e parar
 * sozinho quando terminar.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// `start_report`/`final_report` entram porque a elegibilidade agora exige foto,
// e a foto vive dentro do envelope do report.
const SELECT =
  "id, reference, status, report_link, final_report_submitted, external_report_started_at, " +
  "external_report_submitted_at, external_report_error, external_report_attempts, " +
  "start_report, final_report";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = createServiceClient();

  // `?preview=1` devolve o que seria preenchido, campo a campo, sem abrir
  // browser e sem tocar na Housekeep. É o que a tela mostra antes de você
  // mandar enviar nos primeiros jobs.
  if (new URL(_req.url).searchParams.get("preview") === "1") {
    return NextResponse.json(await previewEnvio(supabase, id));
  }
  const { data: job } = await supabase.from("jobs").select(SELECT).eq("id", id).maybeSingle();
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  const j = job as unknown as Record<string, unknown>;
  const estado = j.external_report_submitted_at
    ? "enviado"
    : j.external_report_started_at
      ? "enviando"
      : j.external_report_error
        ? "falhou"
        : "nao_enviado";

  return NextResponse.json({
    estado,
    submitted_at: j.external_report_submitted_at ?? null,
    error: j.external_report_error ?? null,
    attempts: j.external_report_attempts ?? 0,
    report_link: j.report_link ?? null,
    // Por que o botão está apagado, quando estiver.
    bloqueio: motivoNaoElegivel(job as never),
  });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = createServiceClient();

  const { data: job } = await supabase.from("jobs").select(SELECT).eq("id", id).maybeSingle();
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  const bloqueio = motivoNaoElegivel(job as never);
  if (bloqueio) return NextResponse.json({ estado: "nao_elegivel", motivo: bloqueio }, { status: 409 });

  // `?simular=1` preenche tudo e não aperta Submit. É como se testa um job real
  // sem reportar trabalho de mentira para a Housekeep.
  const simular = new URL(req.url).searchParams.get("simular") === "1";

  // Dispara e devolve. O erro vai para as colunas e para o email, não para esta
  // resposta, porque quem clicou já saiu da tela quando ele acontecer.
  void enviarRelatorioExterno(supabase, id, { simular }).catch((err) => {
    console.error("[stefane] envio falhou fora do fluxo:", err);
  });

  return NextResponse.json({ estado: "enviando", simular }, { status: 202 });
}
