/**
 * Lembrete de fatura vencida (dono, 09/10/2026): 1, 3 e 4 dias depois do vencimento em
 * tom amigável e o 4º, no dia 7, como final reminder. Um estágio por fatura por rodada,
 * com a fatura em PDF e o link de pagamento. Plataformas (Housekeep, Fantastic,
 * Checkatrade, Express) ficam fora (`accounts.overdue_reminders = false`).
 * Fatura que nunca foi enviada ao cliente também fica fora: primeiro o envio, depois a cobrança.
 *
 * Chamado pelo n8n uma vez por dia (manhã de Londres). Auth: x-internal-secret =
 * INTERNAL_SYNC_SECRET. ?dry-run=1 só lista o que mandaria.
 */
import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { daysOverdue, londonTodayYmd, MAX_DIAS_PARA_COMECAR, nextReminderStage } from "@/lib/invoice-overdue-reminders";
import { enviarEstagioDeCobranca, faturaJaFoiEnviada, saldoVencidoDaFatura, type FaturaCobravel } from "@/lib/invoice-chase-send";

export const runtime = "nodejs";
export const maxDuration = 60;

const ABERTAS = ["pending", "partially_paid", "overdue", "awaiting_payment"];

function autorizado(dado: string | null): boolean {
  const segredo = process.env.INTERNAL_SYNC_SECRET?.trim();
  if (!segredo || !dado || dado.length !== segredo.length) return false;
  return timingSafeEqual(Buffer.from(dado), Buffer.from(segredo));
}

export async function POST(req: NextRequest) {
  if (!autorizado(req.headers.get("x-internal-secret"))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const ensaio = req.nextUrl.searchParams.get("dry-run") === "1";
  const admin = createServiceClient();
  const today = londonTodayYmd();

  const { data: rows } = await admin
    .from("invoices")
    .select("*")
    .in("status", ABERTAS)
    .is("deleted_at", null)
    .lt("due_date", today)
    .lt("overdue_reminder_stage", 4)
    .order("due_date", { ascending: true })
    .limit(60);

  const { data: semLembrete } = await admin.from("accounts").select("id").eq("overdue_reminders", false);
  const contasFora = new Set(((semLembrete ?? []) as { id: string }[]).map((a) => a.id));

  const out: string[] = [];

  for (const inv of (rows ?? []) as FaturaCobravel[]) {
    if (!inv.due_date) continue;
    const { balance, plano } = await saldoVencidoDaFatura(admin, inv, today);
    if (balance <= 0.02) continue;
    const ultimo = (inv as { overdue_reminder_last_at?: string | null }).overdue_reminder_last_at;
    const desdeUltimo = ultimo ? daysOverdue(londonTodayYmd(new Date(ultimo)), today) : null;
    const atraso = daysOverdue(inv.due_date.slice(0, 10), today);
    const stage = nextReminderStage(inv.overdue_reminder_stage ?? 0, atraso, desdeUltimo);
    if (!stage) {
      if ((inv.overdue_reminder_stage ?? 0) === 0 && atraso > MAX_DIAS_PARA_COMECAR) out.push(`${inv.reference}: ${atraso} days overdue, left for the team (too old to start the sequence)`);
      continue;
    }
    // Job em espera (reclamação, disputa) não recebe cobrança automática.
    if (inv.job_reference) {
      const { data: job } = await admin.from("jobs").select("status, card_charge_status").eq("reference", inv.job_reference).maybeSingle();
      if ((job as { status?: string } | null)?.status === "on_hold") { out.push(`${inv.reference}: skip (job on hold)`); continue; }
      // Cartão recusado já tem a régua própria (dias 1, 3 e 7, cobranca-cartao no Railway):
      // o lembrete de fatura vencida em cima dela mandava dois e-mails de cobrança (22/10/2026).
      if ((job as { card_charge_status?: string | null } | null)?.card_charge_status === "refused") { out.push(`${inv.reference}: skip (card declined: the card dunning handles it)`); continue; }
    }

    // Só cobra o que o cliente já recebeu (dono, 13/10/2026): fatura que nunca foi enviada não gera lembrete.
    // A RCP-2026-904 recebeu "overdue" em 12/10 sem a fatura ter saído uma única vez.
    if (!(await faturaJaFoiEnviada(admin, inv))) { out.push(`${inv.reference}: skip (invoice never sent to the client)`); continue; }

    const r = await enviarEstagioDeCobranca(admin, inv, stage, balance, plano, { ensaio, contasFora });
    if (!r.ok) {
      if (r.motivo.startsWith("RESEND_API_KEY")) return NextResponse.json({ error: r.motivo }, { status: 503 });
      out.push(`${inv.reference}: ${r.motivo === "send failed" ? "send failed" : `skip (${r.motivo})`}`);
      continue;
    }
    if (!r.enviado) { out.push(`${inv.reference}: would send stage ${stage} (${r.subject}) to ${r.to}`); continue; }
    out.push(`${inv.reference}: sent stage ${stage} to ${r.to}`);
  }
  return NextResponse.json({ ok: true, ensaio, today, results: out });
}
