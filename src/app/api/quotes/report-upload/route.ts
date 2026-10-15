import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyPartnerReportToken } from "@/lib/quote-response-token";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { registrarReportLink } from "@/lib/report-link-events";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BUCKET = "job-reports";

/**
 * POST /api/quotes/report-upload   (público, autenticado pelo token do report)
 *
 * Uma foto por vez (dono, 15/10/2026: "link quebrando"). Antes o formulário mandava as
 * ~60 fotos de uma limpeza num pacote só no fim, e o pacote estourava o limite da
 * função. Agora cada foto, ao ser escolhida, pede aqui um endereço assinado e sobe
 * DIRETO para o armazenamento; o envio final leva só o texto e os endereços.
 *
 * Body JSON: { token, slot, pdf? }  →  { path, uploadToken, publicUrl }
 */
export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  // Uma por foto: um relatório de limpeza chega a 60. O teto é por conexão.
  const rl = checkRateLimit(`report-upload:${ip}`, 240, 10 * 60 * 1000);
  if (!rl.ok) return NextResponse.json({ error: "Too many uploads. Wait a minute and try again." }, { status: 429 });

  const body = (await req.json().catch(() => null)) as { token?: string; slot?: string; pdf?: boolean } | null;
  const token = String(body?.token ?? "").trim();
  const slot = String(body?.slot ?? "").trim().replace(/[^a-z0-9:_-]/gi, "").slice(0, 60) || "photo";
  const verified = token ? verifyPartnerReportToken(token) : null;
  if (!verified) return NextResponse.json({ error: "This report link is not valid any more. Open the latest link from your email." }, { status: 400 });

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SERVICE_ROLE_KEY!);
  const { data: job } = await sb
    .from("jobs")
    .select("id, partner_id, status, start_report_submitted, final_report_submitted")
    .eq("id", verified.jobId)
    .is("deleted_at", null)
    .maybeSingle();
  const motivo = !job
    ? "job_removido"
    : job.partner_id !== verified.partnerId
      ? "outro_parceiro"
      : job.status === "cancelled"
        ? "cancelado"
        : job.start_report_submitted && job.final_report_submitted
          ? "ja_enviado"
          : null;
  if (motivo) {
    await registrarReportLink(sb, { jobId: verified.jobId, partnerId: verified.partnerId, event: "upload_refused", ok: false, detail: motivo });
    return NextResponse.json({ error: "This job can no longer receive a report from this link.", motivo }, { status: 409 });
  }

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const rand = Math.random().toString(36).slice(2, 8);
  const path = `${verified.jobId}/${slot.replace(":", "-")}-${rand}-${ts}.${body?.pdf ? "pdf" : "jpg"}`;
  const { data, error } = await sb.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data) {
    await registrarReportLink(sb, { jobId: verified.jobId, partnerId: verified.partnerId, event: "upload_refused", ok: false, detail: error?.message ?? "sign failed" });
    return NextResponse.json({ error: "We could not prepare the upload. Try again in a moment." }, { status: 500 });
  }
  const publicUrl = sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  return NextResponse.json({ path, uploadToken: data.token, publicUrl });
}
