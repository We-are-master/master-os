/**
 * Enriched job detail fetcher for the portal.
 *
 * One high-level fetch that returns everything the redesigned portal
 * job detail page needs, in parallel:
 *   - Base job row (scoped by account, mirrors fetchPortalJobDetail)
 *   - Phase timeline from `audit_logs` (phase_advanced entries)
 *   - Customer-side payment history (job_payments, customer_* only — RLS
 *     also restricts this but we filter explicitly as defense-in-depth)
 *   - Linked invoices (by source_account_id OR job.reference)
 *   - Latest job report (before/after images, pdf path)
 *
 * Never returns: partner_cost, materials_cost, margin, internal_notes,
 * self_bill data. The page + this fetcher are the only contract between
 * DB and client for this page, so keep the selects strict.
 */

import { getServerSupabase } from "@/lib/supabase/server-cached";

export interface PortalPhaseEvent {
  /** Status the job transitioned to (e.g. in_progress_phase1) */
  newStatus: string;
  /** Status before transition */
  oldStatus: string | null;
  /** When the transition was recorded */
  at: string;
  /** Optional actor name for the audit entry */
  actorName: string | null;
}

export interface PortalCustomerPayment {
  id: string;
  amount: number;
  paid_at: string | null;
  type: "customer_deposit" | "customer_final";
  method: string | null;
}

export interface PortalLinkedInvoice {
  id: string;
  reference: string;
  status: string;
  invoice_kind: string | null;
  amount_due: number;
  amount_paid: number;
  balance: number;
  due_date: string | null;
  stripe_payment_link_url: string | null;
}

export interface PortalJobReport {
  id: string;
  pdf_url: string | null;
  description: string | null;
  materials: string | null;
  before_images: string[];
  after_images: string[];
  created_at: string;
}

export interface PortalJobDetailRich {
  id: string;
  reference: string;
  title: string;
  status: string;
  scheduled_date: string | null;
  scheduled_start_at: string | null;
  scheduled_end_at: string | null;
  scheduled_finish_date: string | null;
  property_address: string | null;
  partner_name: string | null;
  partner_avatar_url: string | null;
  current_phase: number | null;
  total_phases: number | null;
  scope: string | null;
  client_price: number;
  deposit_required: number;
  customer_deposit_paid: boolean;
  customer_final_payment: number;
  customer_final_paid: boolean;
  latitude: number | null;
  longitude: number | null;
  customer_review_rating: number | null;
  customer_review_comment: string | null;
  customer_review_submitted_at: string | null;
  /** Photo URLs stored on the job (from request or quote). */
  images: string[];
  created_at: string;
  updated_at: string;

  /** partner_timer_started_at — wall clock the partner pressed Start. */
  partner_timer_started_at: string | null;
  partner_timer_ended_at: string | null;
  partner_timer_accum_paused_ms: number | null;
  partner_timer_is_paused: boolean | null;
  partner_timer_pause_began_at: string | null;

  phases: PortalPhaseEvent[];
  payments: PortalCustomerPayment[];
  invoices: PortalLinkedInvoice[];
  report: PortalJobReport | null;
}

function asNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function asStrArr(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.length > 0);
}

export async function fetchPortalJobDetailRich(
  jobId: string,
  accountId: string,
): Promise<PortalJobDetailRich | null> {
  const supabase = await getServerSupabase();

  // 1) Job row — account scoping enforced by migration 142 RLS + explicit check
  const { data: jobRow } = await supabase
    .from("jobs")
    .select(`
      id, reference, title, status, scheduled_date, scheduled_start_at,
      scheduled_end_at, scheduled_finish_date,
      property_address, partner_id, partner_name, current_phase, total_phases,
      scope, client_price, deposit_required, customer_deposit_paid,
      customer_final_payment, customer_final_paid,
      customer_review_rating, customer_review_comment, customer_review_submitted_at,
      latitude, longitude, images, client_id,
      partner_timer_started_at, partner_timer_ended_at, partner_timer_accum_paused_ms,
      partner_timer_is_paused, partner_timer_pause_began_at,
      created_at, updated_at
    `)
    .eq("id", jobId)
    .is("deleted_at", null)
    .maybeSingle();

  if (!jobRow) return null;
  const j = jobRow as Record<string, unknown>;

  const clientId = j.client_id as string | null;
  if (!clientId) return null;

  // Defense-in-depth: verify account ownership even though RLS should have
  // done it already. Prevents leaks if the migration rolls back.
  const { data: client } = await supabase
    .from("clients")
    .select("source_account_id")
    .eq("id", clientId)
    .maybeSingle();
  if (!client || (client as { source_account_id?: string }).source_account_id !== accountId) {
    return null;
  }

  // 2..5) Parallel: phases, payments, invoices, report, partner avatar
  const partnerId = j.partner_id as string | null;
  const jobReference = j.reference as string;

  const [phasesRes, paymentsRes, invoicesRes, reportRes, partnerRes] = await Promise.all([
    supabase
      .from("audit_logs")
      .select("action, new_value, old_value, created_at, user_name")
      .eq("entity_type", "job")
      .eq("entity_id", jobId)
      .eq("action", "phase_advanced")
      .order("created_at", { ascending: true })
      .limit(100),

    supabase
      .from("job_payments")
      .select("id, amount, payment_date, type, payment_method")
      .eq("job_id", jobId)
      .in("type", ["customer_deposit", "customer_final"])
      .is("deleted_at", null)
      .order("payment_date", { ascending: true }),

    supabase
      .from("invoices")
      .select("id, reference, status, invoice_kind, amount_due, amount_paid, balance, due_date, stripe_payment_link_url")
      .or(`source_account_id.eq.${accountId},job_reference.eq.${jobReference}`)
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),

    supabase
      .from("job_reports")
      .select("id, pdf_url, description, materials, before_images, after_images, created_at")
      .eq("job_id", jobId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),

    partnerId
      ? supabase.from("partners").select("avatar_url").eq("id", partnerId).maybeSingle()
      : Promise.resolve({ data: null } as { data: null }),
  ]);

  const phases: PortalPhaseEvent[] = ((phasesRes.data ?? []) as Array<{
    new_value: string; old_value: string | null; created_at: string; user_name: string | null;
  }>).map((r) => ({
    newStatus: r.new_value,
    oldStatus: r.old_value,
    at: r.created_at,
    actorName: r.user_name,
  }));

  const payments: PortalCustomerPayment[] = ((paymentsRes.data ?? []) as Array<{
    id: string; amount: number | string; payment_date: string | null; type: string; payment_method: string | null;
  }>).map((p) => ({
    id: p.id,
    amount: asNum(p.amount),
    paid_at: p.payment_date,
    type: p.type as "customer_deposit" | "customer_final",
    method: p.payment_method,
  }));

  const invoices: PortalLinkedInvoice[] = ((invoicesRes.data ?? []) as Array<Record<string, unknown>>).map((inv) => ({
    id: inv.id as string,
    reference: (inv.reference as string) ?? "",
    status: (inv.status as string) ?? "pending",
    invoice_kind: (inv.invoice_kind as string | null) ?? null,
    amount_due: asNum(inv.amount_due),
    amount_paid: asNum(inv.amount_paid),
    balance: asNum(inv.balance),
    due_date: (inv.due_date as string | null) ?? null,
    stripe_payment_link_url: (inv.stripe_payment_link_url as string | null) ?? null,
  }));

  const report: PortalJobReport | null = reportRes.data
    ? {
        id: (reportRes.data as { id: string }).id,
        pdf_url: ((reportRes.data as { pdf_url?: string | null }).pdf_url) ?? null,
        description: ((reportRes.data as { description?: string | null }).description) ?? null,
        materials: ((reportRes.data as { materials?: string | null }).materials) ?? null,
        before_images: asStrArr((reportRes.data as { before_images?: unknown }).before_images),
        after_images: asStrArr((reportRes.data as { after_images?: unknown }).after_images),
        created_at: (reportRes.data as { created_at: string }).created_at,
      }
    : null;

  const partnerAvatar = partnerRes.data
    ? ((partnerRes.data as { avatar_url?: string | null }).avatar_url ?? null)
    : null;

  return {
    id: j.id as string,
    reference: jobReference ?? "",
    title: (j.title as string) ?? "Job",
    status: (j.status as string) ?? "",
    scheduled_date: (j.scheduled_date as string | null) ?? null,
    scheduled_start_at: (j.scheduled_start_at as string | null) ?? null,
    scheduled_end_at: (j.scheduled_end_at as string | null) ?? null,
    scheduled_finish_date: (j.scheduled_finish_date as string | null) ?? null,
    property_address: (j.property_address as string | null) ?? null,
    partner_name: (j.partner_name as string | null) ?? null,
    partner_avatar_url: partnerAvatar,
    current_phase: (j.current_phase as number | null) ?? null,
    total_phases: (j.total_phases as number | null) ?? null,
    scope: (j.scope as string | null) ?? null,
    client_price: asNum(j.client_price),
    deposit_required: asNum(j.deposit_required),
    customer_deposit_paid: Boolean(j.customer_deposit_paid),
    customer_final_payment: asNum(j.customer_final_payment),
    customer_final_paid: Boolean(j.customer_final_paid),
    latitude: j.latitude != null ? asNum(j.latitude) : null,
    longitude: j.longitude != null ? asNum(j.longitude) : null,
    customer_review_rating: (j.customer_review_rating as number | null) ?? null,
    customer_review_comment: (j.customer_review_comment as string | null) ?? null,
    customer_review_submitted_at: (j.customer_review_submitted_at as string | null) ?? null,
    images: asStrArr(j.images),
    created_at: (j.created_at as string) ?? "",
    updated_at: (j.updated_at as string) ?? "",

    partner_timer_started_at: (j.partner_timer_started_at as string | null) ?? null,
    partner_timer_ended_at: (j.partner_timer_ended_at as string | null) ?? null,
    partner_timer_accum_paused_ms:
      j.partner_timer_accum_paused_ms != null ? asNum(j.partner_timer_accum_paused_ms) : null,
    partner_timer_is_paused: (j.partner_timer_is_paused as boolean | null) ?? null,
    partner_timer_pause_began_at: (j.partner_timer_pause_began_at as string | null) ?? null,

    phases,
    payments,
    invoices,
    report,
  };
}
