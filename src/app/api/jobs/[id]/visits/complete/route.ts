import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-api";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { computeVisitDoneAmounts, visitDoneProblems, type VisitDoneInput } from "@/lib/visit-done-billing";
import { aplicarMaterialDaVisita } from "@/lib/report-material-extra";
import { isMissingRateColumn, withoutRateColumns } from "@/lib/job-visit-rate-columns";
import { detachVisitFromSelfBill, ensureWeeklySelfBillForVisit } from "@/services/self-bills";
import type { Job, JobVisit } from "@/types/database";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED_ROLES = new Set(["admin", "manager", "operator"]);
const BUCKET = "job-reports";

/**
 * POST multipart — o Done de uma visita extra pelo escritório (dono, 22/10/2026).
 *
 * Campos: `visitId`, `payload` (JSON de `VisitDoneInput`) e `receipt` (arquivos do
 * recibo do material). Grava os valores finais da visita, fecha (completed +
 * completed_at), aplica o material (parceiro da visita e extras do job), e põe a
 * visita no self-bill do parceiro dela, no período do dia em que foi feita. Só a
 * partir daqui a visita paga o parceiro. O total do job o gatilho da mig 274
 * recalcula. Depois a tela chama o /advance, como no Done de sempre.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const serverSupabase = await createServerSupabase();
  const { data: profile } = await serverSupabase.from("profiles").select("role, full_name").eq("id", auth.user.id).maybeSingle();
  const perfil = profile as { role?: string; full_name?: string } | null;
  if (!ALLOWED_ROLES.has(perfil?.role ?? "")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id: jobId } = await ctx.params;
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Invalid form" }, { status: 400 });
  const visitId = String(form.get("visitId") ?? "").trim();
  let input: VisitDoneInput;
  try {
    input = JSON.parse(String(form.get("payload") ?? "{}")) as VisitDoneInput;
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  if (input.rateType !== "hourly" && input.rateType !== "fixed") {
    return NextResponse.json({ error: "Choose Hourly or Fixed" }, { status: 400 });
  }
  const recibos = form.getAll("receipt").filter((f): f is File => f instanceof File && f.size > 0);

  const supabase = createServiceClient();
  const { data: visitRow } = await supabase
    .from("job_visits")
    .select("*")
    .eq("id", visitId)
    .eq("job_id", jobId)
    .is("deleted_at", null)
    .maybeSingle();
  const visit = visitRow as JobVisit | null;
  if (!visit) return NextResponse.json({ error: "Visit not found" }, { status: 404 });
  if (visit.status === "cancelled") return NextResponse.json({ error: "This visit was cancelled" }, { status: 409 });
  if (visit.status === "completed") return NextResponse.json({ error: "This visit is already done" }, { status: 409 });

  const recibosJa = Array.isArray(visit.materials_receipts) ? visit.materials_receipts : [];
  const problemas = visitDoneProblems({ ...input, receiptCount: recibosJa.length + recibos.length });
  if (problemas.length) return NextResponse.json({ error: problemas.join(". "), problems: problemas }, { status: 422 });
  const valores = computeVisitDoneAmounts(input);

  // Recibo do material: mesmo bucket e mesmo nome do relatório da visita.
  const novos: string[] = [];
  for (const [i, f] of recibos.entries()) {
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const pdf = f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf");
    const path = `${jobId}/visit-${visit.visit_index}-receipt-${i}-${ts}.${pdf ? "pdf" : "jpg"}`;
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, new Uint8Array(await f.arrayBuffer()), { contentType: pdf ? "application/pdf" : f.type || "image/jpeg", upsert: false });
    if (error) return NextResponse.json({ error: `Receipt upload failed: ${error.message}` }, { status: 500 });
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
    if (data?.publicUrl) novos.push(data.publicUrl);
  }

  const agora = new Date().toISOString();
  const patch: Record<string, unknown> = {
    client_price: valores.clientPrice,
    partner_cost: valores.partnerCost,
    status: "completed",
    completed_at: agora,
    updated_by: auth.user.id,
    job_type: valores.rateType,
    hourly_client_rate: input.rateType === "hourly" ? Number(input.hourlyClientRate ?? 0) || 0 : null,
    hourly_partner_rate: input.rateType === "hourly" ? Number(input.hourlyPartnerRate ?? 0) || 0 : null,
    billed_hours: valores.billedHours,
    arrived_at: input.rateType === "hourly" ? input.arrivedAt ?? null : null,
    departed_at: input.rateType === "hourly" ? input.departedAt ?? null : null,
    materials_receipts: [...recibosJa, ...novos],
  };
  const gravar = (p: Record<string, unknown>) =>
    supabase.from("job_visits").update(p).eq("id", visit.id).eq("status", visit.status).select().single();
  let { data: fechada, error } = await gravar(patch);
  let semColunasNovas = false;
  if (error && isMissingRateColumn(error)) {
    // Banco sem a mig 349: o dinheiro grava; horários e recibo vão numa nota da visita.
    semColunasNovas = true;
    const nota = [
      visit.notes?.trim(),
      input.rateType === "hourly" && valores.billedHours != null
        ? `Done: ${valores.billedHours}h (${input.arrivedAt} to ${input.departedAt})`
        : null,
      novos.length ? `Materials receipt: ${novos.join(" ")}` : null,
    ].filter(Boolean).join("\n");
    ({ data: fechada, error } = await gravar({ ...withoutRateColumns(patch), notes: nota || null }));
  }
  if (error || !fechada) return NextResponse.json({ error: error?.message ?? "Could not close the visit" }, { status: 400 });

  // Material: parceiro da visita (materials_cost) e cliente (extras do job), por diferença.
  const anterior = ((visit.final_report as { data?: Record<string, unknown> } | null)?.data ?? null) as Record<string, unknown> | null;
  const material = await aplicarMaterialDaVisita(supabase, visit, {
    finalData: { materials_extra_cost: valores.materialsCost, materials_extra_charge: valores.materialsCharge },
    previousFinalData: anterior,
  });

  // Self-bill do parceiro desta visita, no período do dia em que foi feita.
  let selfBillId: string | null = null;
  let payoutError: string | null = null;
  try {
    const { data: atualizada } = await supabase.from("job_visits").select("*").eq("id", visit.id).maybeSingle();
    const v = (atualizada ?? fechada) as JobVisit;
    const solta = await detachVisitFromSelfBill(v.id, supabase);
    if (!solta.detached) {
      payoutError = "this visit is on a self-bill that was already paid; settle the difference as a manual adjustment";
    } else if (v.partner_id) {
      const { data: jobRow } = await supabase.from("jobs").select("*").eq("id", jobId).maybeSingle();
      if (jobRow) selfBillId = await ensureWeeklySelfBillForVisit(jobRow as Job, v, { client: supabase });
      if (!selfBillId) payoutError = "self-bill not created for this visit";
    } else {
      payoutError = "visit has no partner, so no self-bill";
    }
  } catch (e) {
    const err = e as { message?: string } | null;
    payoutError = err?.message ?? String(e);
    console.error("[visit-complete] self-bill", e);
  }

  try {
    await supabase.from("audit_logs").insert({
      entity_type: "job",
      entity_id: jobId,
      action: "completed",
      field_name: `visit_${visit.visit_index}`,
      user_id: auth.user.id,
      user_name: perfil?.full_name ?? null,
      metadata: {
        visit_id: visit.id,
        rate_type: valores.rateType,
        billed_hours: valores.billedHours,
        client_price: valores.clientPrice,
        partner_cost: valores.partnerCost,
        materials_cost: valores.materialsCost,
        materials_charge: valores.materialsCharge,
      },
    });
  } catch {
    console.error("[visit-complete] audit failed");
  }

  return NextResponse.json({
    ok: true,
    visit: fechada,
    amounts: valores,
    material,
    selfBillId,
    payoutError,
    ...(semColunasNovas ? { note: "Migration 349 not applied: hours and receipt saved in the visit notes" } : {}),
  });
}
