import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { buscarFormulario, slotsDeFoto, formaDoFormularioAPI } from "@/lib/stefane/housekeep-api";
import type { ExigenciaDeFoto } from "@/lib/report-health";

/**
 * O que a plataforma do cliente exige deste job, lido dela.
 *
 * A nota do relatório media contra o NOSSO piso, que é cinco fotos em todo
 * bloco. O da Housekeep é cinco de sala, três de corredor, cinco de cozinha,
 * cinco de banheiro, cinco de quarto e um a dois de equipamento, e muda de job
 * para job conforme o serviço contratado (limpeza a vapor só aparece quando foi
 * comprada). Medir contra o número errado é como o JOB-9450 tirou 100/100 e
 * voltou recusado.
 *
 * Responde `{ exigencias: [] }` quando não dá para saber, e isso é de
 * propósito: sem exigência conhecida a nota volta ao piso nosso, que avisa sem
 * bloquear. O que não pode acontecer é a tela travar um relatório porque a
 * rede da Housekeep estava fora.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = createServiceClient();

  const { data: job } = await supabase
    .from("jobs")
    .select("id, report_link")
    .eq("id", id)
    .maybeSingle();

  if (!job?.report_link) return NextResponse.json({ exigencias: [], motivo: "job has no platform link" });

  const busca = await buscarFormulario(String(job.report_link));
  if (!busca.ok) return NextResponse.json({ exigencias: [], motivo: busca.motivo, sumiu: busca.sumiu });

  const exigencias: ExigenciaDeFoto[] = slotsDeFoto(busca.form)
    .filter((s) => s.min > 0)
    .map((s) => ({ metade: s.metade, chave: s.chave, rotulo: s.rotulo, min: s.min }));

  return NextResponse.json({
    exigencias,
    forma: formaDoFormularioAPI(busca.form),
    submetidoEm: busca.form.submetidoEm,
  });
}
