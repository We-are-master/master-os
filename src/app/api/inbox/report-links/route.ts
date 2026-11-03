/**
 * Links do formulário de report dos jobs que o parceiro ainda não entregou, para
 * o pedido pelo WhatsApp na /inbox. Link curto (o /r/ assina no clique), nunca o
 * token cru. Só jobs que são mesmo deste parceiro.
 */

import { NextRequest, NextResponse } from "next/server";
import { staffDaInbox } from "@/lib/inbox/staff";
import { buildPartnerJobReportUrl } from "@/lib/partner-job-report-url";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const s = await staffDaInbox();
  if (s instanceof NextResponse) return s;
  const { parceiroId, jobIds } = (await req.json().catch(() => ({}))) as { parceiroId?: unknown; jobIds?: unknown };
  const ids = Array.isArray(jobIds) ? jobIds.filter((x): x is string => typeof x === "string").slice(0, 30) : [];
  if (typeof parceiroId !== "string" || !parceiroId || !ids.length) return NextResponse.json({ error: "Missing partner or jobs" }, { status: 400 });

  const { data, error } = await s.sb
    .from("jobs")
    .select("id, reference, title, status, scheduled_date, partner_id")
    .in("id", ids)
    .eq("partner_id", parceiroId)
    .eq("report_submitted", false)
    .is("deleted_at", null)
    .order("scheduled_date", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const jobs = await Promise.all(
    (data ?? []).map(async (j) => ({
      id: j.id as string,
      ref: (j.reference as string | null) ?? "Job",
      titulo: (j.title as string | null) ?? null,
      data: (j.scheduled_date as string | null) ?? null,
      status: (j.status as string | null) ?? "",
      url: await buildPartnerJobReportUrl(j.id as string, parceiroId),
    })),
  );
  return NextResponse.json({ jobs });
}
