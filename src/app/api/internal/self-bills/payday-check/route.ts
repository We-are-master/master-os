/**
 * Conferência antes do payday (Fase 1, dono 09/10/2026). Só lê; devolve o que está fora
 * do lugar para a equipe acertar antes de pagar:
 *  1. mais de um documento aberto do mesmo parceiro na mesma quinzena
 *  2. job num documento de outro parceiro
 *  3. job ainda em final check num documento já em pagamento ou pago
 *  4. documento aberto de £0 de quinzena que já fechou
 * Auth: x-internal-secret = INTERNAL_SYNC_SECRET.
 */
import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

function autorizado(dado: string | null): boolean {
  const segredo = process.env.INTERNAL_SYNC_SECRET?.trim();
  if (!segredo || !dado || dado.length !== segredo.length) return false;
  return timingSafeEqual(Buffer.from(dado), Buffer.from(segredo));
}

type Sb = { id: string; reference: string; partner_id: string | null; partner_name: string | null; week_start: string | null; week_end: string | null; status: string; net_payout: number | null };
type Jb = { id: string; reference: string; status: string; partner_id: string | null; partner_name: string | null; self_bill_id: string | null };

export async function GET(req: NextRequest) {
  if (!autorizado(req.headers.get("x-internal-secret"))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const admin = createServiceClient();
  const desde = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);
  const hoje = new Date().toISOString().slice(0, 10);

  const { data: sbsRaw } = await admin
    .from("self_bills")
    .select("id, reference, partner_id, partner_name, week_start, week_end, status, net_payout")
    .eq("bill_origin", "partner")
    .gte("week_start", desde);
  const sbs = (sbsRaw ?? []) as Sb[];
  const byId = new Map(sbs.map((s) => [s.id, s]));
  const abertos = sbs.filter((s) => s.status === "draft" || s.status === "accumulating");
  const fechados = new Set(["awaiting_payment", "ready_to_pay", "paid", "approved"]);

  const duplicados: string[] = [];
  const grupos = new Map<string, Sb[]>();
  for (const s of sbs.filter((x) => x.status !== "rejected" && !x.status.startsWith("payout_"))) {
    const k = `${s.partner_id}|${s.week_start}`;
    grupos.set(k, [...(grupos.get(k) ?? []), s]);
  }
  for (const lista of grupos.values()) {
    if (lista.length > 1) duplicados.push(`${lista[0].partner_name} ${lista[0].week_start}: ${lista.map((s) => `${s.reference} (${s.status})`).join(", ")}`);
  }

  const ids = sbs.map((s) => s.id);
  const jobs: Jb[] = [];
  for (let i = 0; i < ids.length; i += 80) {
    const { data } = await admin.from("jobs").select("id, reference, status, partner_id, partner_name, self_bill_id").in("self_bill_id", ids.slice(i, i + 80)).is("deleted_at", null);
    jobs.push(...((data ?? []) as Jb[]));
  }
  const parceiroErrado = jobs
    .filter((j) => j.self_bill_id && byId.get(j.self_bill_id)?.partner_id && j.partner_id && byId.get(j.self_bill_id)!.partner_id !== j.partner_id)
    .map((j) => `${j.reference} (${j.partner_name}) is on ${byId.get(j.self_bill_id!)!.reference} of ${byId.get(j.self_bill_id!)!.partner_name}`);
  const emPagamentoSemAprovar = jobs
    .filter((j) => j.status === "final_check" && j.self_bill_id && fechados.has(byId.get(j.self_bill_id)?.status ?? ""))
    .map((j) => `${j.reference} still in final check on ${byId.get(j.self_bill_id!)!.reference} (${byId.get(j.self_bill_id!)!.status})`);
  const zeradosVelhos = abertos
    .filter((s) => (s.week_end ?? "9999") < hoje && Number(s.net_payout ?? 0) <= 0.01)
    .map((s) => `${s.reference} (${s.partner_name}, ${s.week_start} a ${s.week_end})`);

  const total = duplicados.length + parceiroErrado.length + emPagamentoSemAprovar.length + zeradosVelhos.length;
  return NextResponse.json({ ok: total === 0, total, duplicados, parceiroErrado, emPagamentoSemAprovar, zeradosVelhos });
}
