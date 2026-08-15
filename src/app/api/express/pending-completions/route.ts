/**
 * A fila de jobs Express esperando a conclusão no Checkatrade, e a confirmação
 * de que ela aconteceu.
 *
 * O braço que conclui vive no RPA e não aqui, e não é escolha de estilo: a
 * sessão auth0 do Checkatrade mora no Chromium do RPA, e um segundo navegador
 * disputando a mesma sessão derruba os dois. Então o OS diz o que fazer e
 * guarda o resultado; quem clica é o RPA.
 *
 * `report_link` apontando para o Checkatrade É o marcador de Express: job de
 * lead nunca tem link, porque lead não tem página de job no members app.
 * Conferido na base, 0 de 0.
 *
 * GET  → o que falta concluir, com as fotos já assinadas
 * POST → registra que concluiu, ou o motivo de não ter dado
 */
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { urlsDeFoto } from "@/lib/stefane/run-external-report";
import { pickReportTemplate } from "@/lib/public-report-templates";

export const dynamic = "force-dynamic";

const BUCKET = "job-reports";
/** Uma hora: o RPA baixa em segundos, mas a fila pode esperar a vez. */
const VALIDADE_ASSINATURA = 3600;

function autorizado(req: NextRequest): boolean {
  const key = req.headers.get("x-api-key")?.trim();
  const esperada = process.env.MASTER_OS_JOB_WEBHOOK_API_KEY?.trim();
  return !!esperada && key === esperada;
}

/** Troca as URLs guardadas por URLs assinadas, que abrem de fato. */
async function assinar(
  supabase: ReturnType<typeof createServiceClient>,
  urls: string[],
): Promise<string[]> {
  if (urls.length === 0) return [];
  const marcador = `/${BUCKET}/`;
  const caminhos = urls
    .map((u) => {
      const i = u.indexOf(marcador);
      return i === -1 ? null : decodeURIComponent(u.slice(i + marcador.length).split("?")[0]);
    })
    .filter((p): p is string => !!p);
  if (caminhos.length === 0) return [];
  const { data } = await supabase.storage.from(BUCKET).createSignedUrls(caminhos, VALIDADE_ASSINATURA);
  return (data ?? []).map((d) => d.signedUrl).filter((u): u is string => !!u);
}

export async function GET(req: NextRequest) {
  if (!autorizado(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("jobs")
    .select(
      "id, reference, title, report_link, status, start_report, final_report, " +
        "final_report_submitted, external_report_submitted_at, external_report_attempts",
    )
    .ilike("report_link", "%checkatrade%")
    .is("external_report_submitted_at", null)
    .eq("final_report_submitted", true)
    .in("status", ["final_check", "completed", "awaiting_payment"])
    .order("scheduled_date", { ascending: true })
    .limit(20);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  type LinhaDaFila = {
    id: string;
    reference: string;
    title: string | null;
    report_link: string | null;
    start_report: unknown;
    final_report: unknown;
    external_report_attempts: number | null;
  };

  const fila = [];
  for (const j of (data ?? []) as unknown as LinhaDaFila[]) {
    // Só o que o RPA consegue abrir. Link truncado ou marcador manual não é
    // página de job, e mandar o robô lá só gastaria tentativa.
    const m = /membersapp\.checkatrade\.com\/business-jobs\/([a-z0-9]+)/i.exec(String(j.report_link ?? ""));
    if (!m) continue;
    if ((j.external_report_attempts ?? 0) >= 3) continue;

    const fotos = await assinar(supabase, [
      ...urlsDeFoto(j.start_report),
      ...urlsDeFoto(j.final_report),
    ]);
    // Sem nada para anexar não há o que concluir: o Checkatrade pede foto ou
    // documento, e concluir vazio é pior do que não concluir.
    if (fotos.length === 0) continue;

    fila.push({
      jobId: j.id,
      reference: j.reference,
      externalId: m[1],
      url: `https://membersapp.checkatrade.com/business-jobs/${m[1]}?source=express`,
      // Certificado anexa documento, o resto anexa foto: são botões diferentes
      // na tela deles.
      ehCertificado: pickReportTemplate({ title: j.title }) === "certificate",
      fotos,
    });
  }

  return NextResponse.json({ fila, total: fila.length });
}

export async function POST(req: NextRequest) {
  if (!autorizado(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const supabase = createServiceClient();

  const body = (await req.json().catch(() => null)) as
    | { jobId?: string; ok?: boolean; motivo?: string }
    | null;
  if (!body?.jobId) return NextResponse.json({ error: "jobId is required" }, { status: 400 });

  if (body.ok) {
    const { error } = await supabase
      .from("jobs")
      .update({ external_report_submitted_at: new Date().toISOString(), external_report_error: null })
      .eq("id", body.jobId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // Falhou: guarda o motivo e conta a tentativa, com o mesmo teto de três da
  // Housekeep, para o robô não bater a cabeça a noite inteira.
  const { data: atual } = await supabase
    .from("jobs")
    .select("external_report_attempts")
    .eq("id", body.jobId)
    .maybeSingle();

  const { error } = await supabase
    .from("jobs")
    .update({
      external_report_error: (body.motivo ?? "unknown error").slice(0, 400),
      external_report_attempts: (atual?.external_report_attempts ?? 0) + 1,
    })
    .eq("id", body.jobId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: false, registrado: true });
}
