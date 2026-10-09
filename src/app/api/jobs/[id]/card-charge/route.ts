/**
 * Final review: cobra o restante no cartão salvo ANTES de o job sair de final check
 * (Fase 0, dono 09/10/2026). Recusado = o job fica em final check com "Card refused",
 * nota interna no ticket e novas tentativas só nas recusas que a bandeira permite.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isValidUUID } from "@/lib/auth-api";
import { createServiceClient } from "@/lib/supabase/service";
import { chargeJobBalanceOnSavedCard } from "@/lib/stripe-card-charge";
import { getZendeskTicketId, isZendeskConfigured, zendeskApi } from "@/lib/zendesk";

export const runtime = "nodejs";

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { id: jobId } = await ctx.params;
  if (!isValidUUID(jobId)) return NextResponse.json({ error: "Invalid job id" }, { status: 400 });

  const admin = createServiceClient();
  const outcome = await chargeJobBalanceOnSavedCard(admin, jobId, { actorId: auth.user.id });

  if (outcome.status === "refused" || outcome.status === "requires_action") {
    const { data: job } = await admin.from("jobs").select("*").eq("id", jobId).maybeSingle();
    const ticketId = job ? getZendeskTicketId(job as never) : null;
    if (ticketId && isZendeskConfigured()) {
      const quando = outcome.status === "refused" && outcome.retryAt
        ? `Next automatic try: ${new Date(outcome.retryAt).toLocaleDateString("en-GB", { timeZone: "Europe/London" })}.`
        : "No automatic retry for this decline: the customer needs to pay by link.";
      await zendeskApi(`tickets/${ticketId}.json`, {
        method: "PUT",
        body: { ticket: { comment: { public: false, body: `💳 Card refused for the £${outcome.amountGbp.toFixed(2)} balance: ${outcome.reason}. The job stays in final check. ${quando}` } } },
      }).catch((e) => console.error("[card-charge] note failed", e));
    }
  }

  return NextResponse.json(outcome);
}
