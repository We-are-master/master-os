import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isValidUUID } from "@/lib/auth-api";
import { createServiceClient } from "@/lib/supabase/service";
import { refreshSelfBillPayoutState } from "@/services/self-bills";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * PATCH /api/jobs/[id]/cancellation-compensation
 *
 * Corrige quanto o parceiro recebe por um job que o escritório cancelou.
 *
 * Este valor só era escrito uma vez, no modal "Cancel job", no instante do
 * cancelamento. Depois disso não havia tela nenhuma que o mudasse: um valor
 * errado só saía do sistema por SQL. Em 21/08/2026 o JOB-9436 estava com £200
 * onde o combinado era £100, e o pagamento do G&M sairia £100 a mais no mesmo
 * dia.
 *
 * NÃO usa `updateJob`. Num job cancelado, `updateJob` dispara
 * `cancelOpenSelfBillsForJobCancellation`, que ANULA o self-bill aberto — é por
 * isso que o próprio fluxo de cancelamento a chama com `skipCancelDocVoid`.
 * Trocar um número não pode derrubar o pagamento da quinzena inteira, então
 * aqui a escrita é direta e estreita: só os dois campos do dinheiro.
 *
 * `refreshSelfBillPayoutState` depois, porque é ela que soma a compensação em
 * `net_payout` — sem ela o job diz £100 e o documento continua dizendo £200.
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { id } = await ctx.params;
  if (!isValidUUID(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const body = (await req.json().catch(() => null)) as { amountGbp?: unknown } | null;
  const bruto = Number(body?.amountGbp);
  if (!Number.isFinite(bruto) || bruto < 0) {
    return NextResponse.json({ error: "amountGbp must be a number of 0 or more" }, { status: 400 });
  }
  const valor = Math.round(bruto * 100) / 100;

  const supabase = createServiceClient();
  const { data: row, error: readErr } = await supabase
    .from("jobs")
    .select("id, reference, status, self_bill_id, cancellation_fee_party, partner_cancelled_at")
    .eq("id", id)
    .maybeSingle();
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  const job = row as {
    reference: string;
    status: string;
    self_bill_id: string | null;
    cancellation_fee_party: string | null;
    partner_cancelled_at: string | null;
  };

  if (job.status !== "cancelled") {
    return NextResponse.json({ error: "Job is not cancelled" }, { status: 409 });
  }
  /**
   * Compensação é do cancelamento do ESCRITÓRIO. Quando foi o parceiro que
   * cancelou, o dinheiro corre no sentido contrário (clawback), e escrever
   * compensação aqui criaria um job que paga e cobra ao mesmo tempo.
   */
  if (job.partner_cancelled_at) {
    return NextResponse.json(
      { error: "Partner cancelled this job — compensation does not apply" },
      { status: 409 },
    );
  }

  const patch: Record<string, unknown> = {
    partner_cancellation_compensation_gbp: valor > 0 ? valor : null,
  };
  // `cancellation_fee_gbp` é o espelho de exibição, e só espelha quando o
  // parceiro é o único lado do cancelamento. Com o cliente também cobrado, ele
  // guarda a taxa do cliente e não pode ser sobrescrito.
  if (job.cancellation_fee_party === "partner") {
    patch.cancellation_fee_gbp = valor > 0 ? valor : null;
  }

  const { error: upErr } = await supabase.from("jobs").update(patch).eq("id", id);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  let selfBillNetPayout: number | null = null;
  if (job.self_bill_id) {
    try {
      await refreshSelfBillPayoutState(job.self_bill_id, supabase);
      const { data: sb } = await supabase
        .from("self_bills")
        .select("net_payout")
        .eq("id", job.self_bill_id)
        .maybeSingle();
      selfBillNetPayout = Number((sb as { net_payout?: number } | null)?.net_payout ?? 0) || 0;
    } catch (e) {
      // O valor do job já está gravado. Falhar aqui deixaria o documento
      // desatualizado, não o dado errado — então avisa e não desfaz.
      console.error("cancellation-compensation: self-bill refresh failed", { jobId: id }, e);
      return NextResponse.json(
        { amountGbp: valor, selfBillNetPayout: null, warning: "Saved, but the self-bill total did not refresh" },
        { status: 200 },
      );
    }
  }

  return NextResponse.json({ amountGbp: valor, selfBillNetPayout });
}
