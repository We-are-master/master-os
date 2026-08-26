/**
 * Métricas do circuito automático (Fase 4 do auto-flow) para o Pulse.
 *
 * A régua do painel é dupla de propósito: velocidade (o auto assign aloca
 * rápido?) E margem (aloca sem destruir a contribuição?). Medir só taxa de
 * aceite premia alocar barato demais — Contribution Margin % anda junto para
 * denunciar isso na hora.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DashboardDateBounds } from "@/lib/dashboard-date-range";

export type PulseAutoFlowMetrics = {
  /** Jobs com parceiro no período que entraram por aceite de auto assign. */
  autoAssignedPct: number | null;
  autoAssignedCount: number;
  assignedCount: number;
  /** Minutos entre o convite e o aceite (mediana). */
  medianTimeToAcceptMin: number | null;
  /** AGORA: jobs em auto_assigning há mais de 24h sem aceite (não é por período). */
  unaccepted24h: number;
  /** Convites aceitos / convites enviados no período. */
  acceptanceRatePct: number | null;
  invitesSent: number;
  /** Jobs cancelados DEPOIS de terem parceiro / jobs com parceiro. */
  cancellationAfterAssignmentPct: number | null;
  /** Jobs com confirmação enviada ao cliente / jobs criados. */
  customerConfirmationPct: number | null;
  avgJobValueGbp: number | null;
  avgPartnerPayoutGbp: number | null;
  /** (receita − parceiro − materiais) / receita, agregado no período. */
  contributionMarginPct: number | null;
  jobsCreated: number;
};

type JobRow = {
  id: string;
  status: string;
  partner_id: string | null;
  client_price: number | null;
  partner_cost: number | null;
  materials_cost: number | null;
  cancelled_at: string | null;
  partner_cancelled_at: string | null;
  client_confirmation_sent_at: string | null;
  created_at: string;
};

type InviteRow = {
  job_id: string;
  status: string;
  invited_at: string | null;
  decided_at: string | null;
};

function mediana(valores: number[]): number | null {
  if (valores.length === 0) return null;
  const ordenados = [...valores].sort((a, b) => a - b);
  const meio = Math.floor(ordenados.length / 2);
  return ordenados.length % 2 === 1
    ? ordenados[meio]!
    : (ordenados[meio - 1]! + ordenados[meio]!) / 2;
}

const pct = (parte: number, todo: number): number | null =>
  todo > 0 ? Math.round((parte / todo) * 1000) / 10 : null;

export async function fetchPulseAutoFlow(
  supabase: SupabaseClient,
  bounds: DashboardDateBounds | null,
): Promise<PulseAutoFlowMetrics> {
  let jobsQuery = supabase
    .from("jobs")
    .select(
      "id, status, partner_id, client_price, partner_cost, materials_cost, cancelled_at, partner_cancelled_at, client_confirmation_sent_at, created_at",
    )
    .is("deleted_at", null)
    .neq("status", "deleted");
  if (bounds) {
    jobsQuery = jobsQuery.gte("created_at", bounds.fromIso).lte("created_at", bounds.toIso);
  }

  let invitesQuery = supabase
    .from("job_partner_invites")
    .select("job_id, status, invited_at, decided_at");
  if (bounds) {
    invitesQuery = invitesQuery.gte("invited_at", bounds.fromIso).lte("invited_at", bounds.toIso);
  }

  const corte24h = new Date(Date.now() - 24 * 3600_000).toISOString();
  const [{ data: jobsData }, { data: invitesData }, { count: stuckCount }] = await Promise.all([
    jobsQuery,
    invitesQuery,
    supabase
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("status", "auto_assigning")
      .is("partner_id", null)
      .is("deleted_at", null)
      .lt("created_at", corte24h),
  ]);

  const jobs = (jobsData ?? []) as JobRow[];
  const invites = (invitesData ?? []) as InviteRow[];

  const assigned = jobs.filter((j) => j.partner_id);
  const autoJobIds = new Set(invites.filter((i) => i.status === "accepted").map((i) => i.job_id));
  const autoAssigned = assigned.filter((j) => autoJobIds.has(j.id));

  const temposMin = invites
    .filter((i) => i.status === "accepted" && i.invited_at && i.decided_at)
    .map((i) => (Date.parse(i.decided_at!) - Date.parse(i.invited_at!)) / 60_000)
    .filter((m) => Number.isFinite(m) && m >= 0);

  const cancelledAfterAssignment = jobs.filter(
    (j) => j.status === "cancelled" && (j.partner_id || j.partner_cancelled_at),
  );

  const confirmed = jobs.filter((j) => j.client_confirmation_sent_at);

  // Economia: só jobs vivos com preço (cancelado é zerado por regra da casa e
  // entraria como ruído, não como margem).
  const comPreco = jobs.filter((j) => j.status !== "cancelled" && Number(j.client_price) > 0);
  const receita = comPreco.reduce((s, j) => s + Number(j.client_price ?? 0), 0);
  const payout = comPreco.reduce((s, j) => s + Number(j.partner_cost ?? 0), 0);
  const materiais = comPreco.reduce((s, j) => s + Number(j.materials_cost ?? 0), 0);
  const comPayout = comPreco.filter((j) => Number(j.partner_cost) > 0);

  const m = mediana(temposMin);
  return {
    autoAssignedPct: pct(autoAssigned.length, assigned.length),
    autoAssignedCount: autoAssigned.length,
    assignedCount: assigned.length,
    medianTimeToAcceptMin: m == null ? null : Math.round(m),
    unaccepted24h: stuckCount ?? 0,
    acceptanceRatePct: pct(invites.filter((i) => i.status === "accepted").length, invites.length),
    invitesSent: invites.length,
    cancellationAfterAssignmentPct: pct(cancelledAfterAssignment.length, assigned.length),
    customerConfirmationPct: pct(confirmed.length, jobs.length),
    avgJobValueGbp: comPreco.length > 0 ? receita / comPreco.length : null,
    avgPartnerPayoutGbp:
      comPayout.length > 0
        ? comPayout.reduce((s, j) => s + Number(j.partner_cost ?? 0), 0) / comPayout.length
        : null,
    contributionMarginPct: receita > 0 ? Math.round(((receita - payout - materiais) / receita) * 1000) / 10 : null,
    jobsCreated: jobs.length,
  };
}
