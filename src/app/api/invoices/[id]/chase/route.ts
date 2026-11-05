/**
 * Cobrança manual de uma fatura vencida (Overview → Action required, 05/11/2026). Manda o
 * próximo estágio da régua (1st, 2nd, 3rd, final); depois do final, um extra com o mesmo
 * texto do final, sem mexer no estágio. O e-mail é o mesmo da rodada diária.
 *
 * Bloqueia o que a rodada também não cobra: fatura nunca enviada, job em espera, cartão
 * recusado (tem régua própria) e plataforma.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isValidUUID } from "@/lib/auth-api";
import { requireStaffPermission } from "@/lib/staff-permission";
import { createServiceClient } from "@/lib/supabase/service";
import { FINAL_REMINDER_STAGE, londonTodayYmd } from "@/lib/invoice-overdue-reminders";
import { enviarEstagioDeCobranca, faturaJaFoiEnviada, saldoVencidoDaFatura, type FaturaCobravel } from "@/lib/invoice-chase-send";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!isValidUUID(id)) return NextResponse.json({ error: "Invalid invoice id" }, { status: 400 });
  const admin = createServiceClient();
  const { data: eu } = await admin.from("profiles").select("role, full_name").eq("id", auth.user.id).maybeSingle();
  if (!["admin", "manager"].includes(String(eu?.role ?? ""))) {
    const permitido = await requireStaffPermission(auth, "finance");
    if (permitido instanceof NextResponse) return permitido;
  }

  const { data: row } = await admin.from("invoices").select("*").eq("id", id).is("deleted_at", null).maybeSingle();
  const inv = row as FaturaCobravel | null;
  if (!inv) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  const hoje = londonTodayYmd();
  if (!["pending", "overdue", "partially_paid", "awaiting_payment"].includes(String(inv.status)) || !inv.due_date || inv.due_date.slice(0, 10) >= hoje) {
    return NextResponse.json({ error: "This invoice is not overdue." }, { status: 409 });
  }
  const { balance, plano } = await saldoVencidoDaFatura(admin, inv, hoje);
  if (balance <= 0.02) return NextResponse.json({ error: "Nothing overdue on this invoice." }, { status: 409 });

  if (inv.job_reference) {
    const { data: job } = await admin.from("jobs").select("status, card_charge_status").eq("reference", inv.job_reference).maybeSingle();
    const j = job as { status?: string; card_charge_status?: string | null } | null;
    if (j?.status === "on_hold") return NextResponse.json({ error: "The job is on hold. Resolve it before chasing." }, { status: 409 });
    if (j?.card_charge_status === "refused") return NextResponse.json({ error: "Card declined: the card dunning is already chasing this one." }, { status: 409 });
  }
  if (!(await faturaJaFoiEnviada(admin, inv))) return NextResponse.json({ error: "This invoice was never sent to the client. Send it first." }, { status: 409 });

  const { data: semLembrete } = await admin.from("accounts").select("id").eq("overdue_reminders", false);
  const contasFora = new Set(((semLembrete ?? []) as { id: string }[]).map((a) => a.id));

  const atual = Number(inv.overdue_reminder_stage ?? 0);
  const stage = Math.min(atual + 1, FINAL_REMINDER_STAGE);
  const r = await enviarEstagioDeCobranca(admin, inv, stage, balance, plano, {
    contasFora,
    manual: { userId: auth.user.id, userName: String(eu?.full_name ?? "").trim() || auth.user.email || "User" },
  });
  if (!r.ok) {
    const msg = r.motivo === "platform" ? "Platform invoices are paid on their own cycle." : r.motivo === "no billing email" ? "No billing email for this client." : r.motivo;
    return NextResponse.json({ error: msg }, { status: r.motivo === "send failed" || r.motivo.startsWith("RESEND") ? 502 : 409 });
  }
  return NextResponse.json({ ok: true, stage, extra: atual >= FINAL_REMINDER_STAGE, to: r.to });
}
