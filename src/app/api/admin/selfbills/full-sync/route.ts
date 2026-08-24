import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-api";
import { createServiceClient } from "@/lib/supabase/service";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { computePartnerSelfBillDueIso } from "@/lib/partner-payout-schedule";
import { loadOrgPartnerPayoutSettings } from "@/lib/org-partner-payout-settings-server";
import { getWeekBoundsForDate } from "@/lib/self-bill-period";
import {
  ensureWeeklySelfBillForJob,
  canLinkJobToSelfBill,
  refreshSelfBillPayoutState,
  resolveJobSelfBillWeekAnchor,
  SELF_BILL_PAYOUT_APPROVED_JOB_STATUSES,
  listVisitPayoutLinesBySelfBillId,
  type SelfBillPayoutLine,
} from "@/services/self-bills";

const JOB_SELECT_FIELDS =
  "id, reference, partner_id, partner_name, created_at, scheduled_date, scheduled_start_at, completed_date, status, partner_cost, materials_cost, partner_agreed_value, property_address, deleted_at, partner_cancelled_at, self_bill_id, invoice_id, job_type, bill_origin";

const COMPLETED_DATE_BACKFILL_STATUSES = ["awaiting_payment", "completed", "final_check"] as const;

function inferCompletedDateYmd(job: {
  scheduled_start_at?: string | null;
  scheduled_date?: string | null;
}): string | null {
  const fromStart = job.scheduled_start_at?.trim().slice(0, 10) ?? "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(fromStart)) return fromStart;
  const fromSched = job.scheduled_date?.trim().slice(0, 10) ?? "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(fromSched)) return fromSched;
  return null;
}

export const dynamic = "force-dynamic";

const ADMIN_ROLES = new Set(["admin", "manager"]);
const CHUNK = 200;
/** Concurrency cap for per-item write loops below — each item is a
 *  multi-round-trip write (ensureWeeklySelfBillForJob does several queries
 *  itself), so this is deliberately smaller than CHUNK (which just batches
 *  simple .in() reads). */
const WRITE_CONCURRENCY = 10;

/** Run `fn` over `items` with at most WRITE_CONCURRENCY in flight at once. */
async function runChunked<T>(items: T[], fn: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += WRITE_CONCURRENCY) {
    await Promise.all(items.slice(i, i + WRITE_CONCURRENCY).map(fn));
  }
}

/** Self-bill statuses we can promote to ready_to_pay */
const PROMOTABLE_STATUSES = new Set([
  "draft",
  "accumulating",
  "pending_review",
  "awaiting_payment",
  "audit_required",
]);

/** Self-bill statuses we must never touch */
const SKIP_STATUSES = new Set(["paid", "payout_cancelled", "payout_archived", "payout_lost"]);

/**
 * POST /api/admin/selfbills/full-sync
 *
 * 1. Backfill: every job with a partner but no self_bill_id gets linked to its weekly self-bill
 * 2. Rebucket: jobs linked to the wrong work-week self-bill → correct weekly bucket (completed_date anchor)
 * 3. Status sync: self-bills whose linked jobs are all approved → promoted to ready_to_pay
 * 4. Totals: recompute jobs_count / job_value / materials / net_payout for every non-paid self-bill
 * 5. Due dates: recalculate from partner.payment_terms for every non-paid self-bill
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const serverSupabase = await createServerSupabase();
  const { data: profile } = await serverSupabase
    .from("profiles")
    .select("role")
    .eq("id", auth.user.id)
    .maybeSingle();
  const role = (profile as { role?: string } | null)?.role ?? "";
  if (!ADMIN_ROLES.has(role)) {
    return NextResponse.json({ error: "Admin or manager required" }, { status: 403 });
  }

  const admin = createServiceClient();
  const orgPayout = await loadOrgPartnerPayoutSettings(admin);
  const stats = {
    completedDatesBackfilled: 0,
    orphansFound: 0,
    backfilled: 0,
    rebucketed: 0,
    promoted: 0,
    totalsUpdated: 0,
    dueDatesUpdated: 0,
    errors: 0,
  };

  // ── 0. Backfill missing completed_date on executed jobs ───────────────────
  const { data: missingCompleted } = await admin
    .from("jobs")
    .select("id, scheduled_start_at, scheduled_date")
    .in("status", [...COMPLETED_DATE_BACKFILL_STATUSES])
    .is("completed_date", null)
    .is("deleted_at", null);

  // Each job's completed_date backfill is independent — was one sequential
  // UPDATE per job. Chunked concurrency (not unbounded Promise.all) so a
  // large backlog doesn't open hundreds of simultaneous connections.
  await runChunked(missingCompleted ?? [], async (raw) => {
    const job = raw as { id: string; scheduled_start_at?: string | null; scheduled_date?: string | null };
    const ymd = inferCompletedDateYmd(job);
    if (!ymd) return;
    try {
      const { error } = await admin.from("jobs").update({ completed_date: ymd }).eq("id", job.id);
      if (error) throw error;
      stats.completedDatesBackfilled++;
    } catch (e) {
      console.error("[full-sync] completed_date backfill", job.id, e);
      stats.errors++;
    }
  });

  // ── 1. Backfill: jobs with partner but no self_bill_id ────────────────────
  const { data: orphanJobs } = await admin
    .from("jobs")
    .select(JOB_SELECT_FIELDS)
    .not("partner_id", "is", null)
    .is("self_bill_id", null)
    .is("deleted_at", null)
    .neq("status", "cancelled")
    .not("completed_date", "is", null);

  stats.orphansFound = (orphanJobs ?? []).length;

  // ensureWeeklySelfBillForJob already handles the concurrent-insert race
  // (unique-constraint conflict → re-fetch the winning row — see
  // src/services/self-bills.ts), so it's safe to run many jobs at once even
  // when several land on the same new partner+week self-bill.
  await runChunked(orphanJobs ?? [], async (job) => {
    if (!canLinkJobToSelfBill(job as Parameters<typeof canLinkJobToSelfBill>[0])) return;
    try {
      const sbId = await ensureWeeklySelfBillForJob(job as unknown as Parameters<typeof ensureWeeklySelfBillForJob>[0]);
      if (sbId) {
        await admin.from("jobs").update({ self_bill_id: sbId }).eq("id", job.id);
        stats.backfilled++;
      }
    } catch (e) {
      console.error("[full-sync] backfill error", job.id, e);
      stats.errors++;
    }
  });

  // ── 2. Rebucket: jobs on wrong work-week self-bill ────────────────────────
  const { data: linkedJobs } = await admin
    .from("jobs")
    .select(JOB_SELECT_FIELDS)
    .not("partner_id", "is", null)
    .not("self_bill_id", "is", null)
    .is("deleted_at", null)
    .neq("status", "cancelled");

  const linkedSbIds = [
    ...new Set(
      (linkedJobs ?? [])
        .map((j) => (j as { self_bill_id?: string | null }).self_bill_id)
        .filter((x): x is string => Boolean(x?.trim())),
    ),
  ];
  const sbMetaById = new Map<string, { week_start: string | null; status: string }>();
  for (let i = 0; i < linkedSbIds.length; i += CHUNK) {
    const { data: sbRows } = await admin
      .from("self_bills")
      .select("id, week_start, status")
      .in("id", linkedSbIds.slice(i, i + CHUNK));
    for (const row of sbRows ?? []) {
      const r = row as { id: string; week_start?: string | null; status: string };
      sbMetaById.set(r.id, { week_start: r.week_start ?? null, status: r.status });
    }
  }

  const refreshSbIds = new Set<string>();
  await runChunked(linkedJobs ?? [], async (raw) => {
    const job = raw as unknown as Parameters<typeof ensureWeeklySelfBillForJob>[0];
    const sbId = job.self_bill_id?.trim();
    if (!sbId) return;
    const meta = sbMetaById.get(sbId);
    if (!meta || SKIP_STATUSES.has(meta.status)) return;
    if (!canLinkJobToSelfBill(job)) return;
    const anchor = resolveJobSelfBillWeekAnchor(job);
    if (!anchor) return;
    const { weekStart: correctWeekStart } = getWeekBoundsForDate(anchor);
    const currentWeekStart = meta.week_start?.trim().slice(0, 10) ?? "";
    if (!correctWeekStart || currentWeekStart === correctWeekStart) return;
    try {
      const newSbId = await ensureWeeklySelfBillForJob(job, { weekAnchorDate: anchor });
      if (newSbId && newSbId !== sbId) {
        refreshSbIds.add(sbId);
        refreshSbIds.add(newSbId);
        stats.rebucketed++;
      }
    } catch (e) {
      console.error("[full-sync] rebucket error", job.id, e);
      stats.errors++;
    }
  });

  await runChunked([...refreshSbIds], async (sbId) => {
    try {
      await refreshSelfBillPayoutState(sbId);
    } catch (e) {
      console.error("[full-sync] refresh after rebucket", sbId, e);
      stats.errors++;
    }
  });

  // ── 3. Load all non-paid self-bills with their jobs ───────────────────────
  const { data: allSelfBills } = await admin
    .from("self_bills")
    .select("id, partner_id, week_end, due_date, status, bill_origin")
    .is("deleted_at", null)
    .not("status", "in", '("paid","rejected","payout_cancelled","payout_archived","payout_lost")');

  const selfBills = (allSelfBills ?? []) as {
    id: string;
    partner_id: string | null;
    week_end: string | null;
    due_date: string | null;
    status: string;
    bill_origin: string | null;
  }[];

  if (selfBills.length === 0) {
    return NextResponse.json({ ok: true, ...stats });
  }

  // ── 4. Load all linked jobs for these self-bills ──────────────────────────
  const selfBillIds = selfBills.map((s) => s.id);
  type SyncJobRow = {
    status: string;
    partner_cost: number;
    materials_cost: number;
    partner_cancelled_at?: string | null;
    deleted_at?: string | null;
  };
  const jobsBySb = new Map<string, SyncJobRow[]>();

  for (let i = 0; i < selfBillIds.length; i += CHUNK) {
    const { data: jobs } = await admin
      .from("jobs")
      .select("self_bill_id, status, partner_cost, materials_cost, deleted_at, partner_cancelled_at")
      .in("self_bill_id", selfBillIds.slice(i, i + CHUNK))
      .is("deleted_at", null);

    for (const j of jobs ?? []) {
      const sbId = (j as { self_bill_id: string }).self_bill_id;
      const list = jobsBySb.get(sbId) ?? [];
      list.push(j as SyncJobRow);
      jobsBySb.set(sbId, list);
    }
  }

  /**
   * Visitas ligadas aos mesmos documentos (mig 161/276).
   *
   * Duas leituras de propósito, e elas respondem perguntas diferentes:
   *
   *   - `linhasDeVisita` é DINHEIRO, e vem de `listVisitPayoutLinesBySelfBillId`
   *     porque é a fonte única que o recompute e o PDF usam. Somar aqui de novo
   *     por conta própria foi o que fez o Sync reinflar `net_payout` com visita
   *     de job deletado: a linha some da tela e volta pelo botão de sincronizar,
   *     direto para o Wise;
   *   - `visitsBySb` é ESTADO ("ainda existe visita por fazer?"), e para isso
   *     precisa enxergar também a visita que não vale dinheiro.
   *
   * Ambiente sem a coluna devolve erro e os dois ficam vazios: o sync segue
   * valendo só com os jobs.
   */
  const linhasDeVisita = await listVisitPayoutLinesBySelfBillId(selfBillIds, admin).catch((e) => {
    console.error("full-sync: listVisitPayoutLinesBySelfBillId", e);
    return {} as Record<string, SelfBillPayoutLine[]>;
  });
  type SyncVisitRow = { self_bill_id: string; status: string; partner_cost: number; materials_cost: number };
  const visitsBySb = new Map<string, SyncVisitRow[]>();
  for (let i = 0; i < selfBillIds.length; i += CHUNK) {
    const { data: visits, error: visitErr } = await admin
      .from("job_visits")
      .select("self_bill_id, status, partner_cost, materials_cost")
      .in("self_bill_id", selfBillIds.slice(i, i + CHUNK))
      .is("deleted_at", null);
    if (visitErr) break;
    for (const v of visits ?? []) {
      const sbId = (v as { self_bill_id: string }).self_bill_id;
      const list = visitsBySb.get(sbId) ?? [];
      list.push(v as SyncVisitRow);
      visitsBySb.set(sbId, list);
    }
  }

  // ── 5. Termos do parceiro ─────────────────────────────────────────────────
  /**
   * Parceiro não tem termo próprio: todos seguem o padrão da organização.
   *
   * Isto lia `partners.payment_terms`, coluna que **não existe neste banco** (a
   * migração 145 nunca foi aplicada), então toda chamada desta rota morria com
   * 42703 antes de fazer qualquer coisa. E o dono decidiu em 20/08/2026 que a
   * cadência é uma só para todos, o que dispensa o override por parceiro.
   *
   * O mapa fica vazio de propósito: quem consome trata "sem termo" como "usa o
   * padrão do Setup", que é exatamente o comportamento desejado.
   */
  const partnerTermsMap = new Map<string, string | null>();

  // ── 6. Update each self-bill ───────────────────────────────────────────────
  const BATCH = 50;
  const updates: { id: string; patch: Record<string, unknown> }[] = [];

  for (const sb of selfBills) {
    if (SKIP_STATUSES.has(sb.status) || sb.bill_origin === "internal") continue;

    const jobs = jobsBySb.get(sb.id) ?? [];
    const payable = jobs.filter((j) => SELF_BILL_PAYOUT_APPROVED_JOB_STATUSES.has(j.status));

    /**
     * Visitas ligadas a este documento (mig 161/276).
     *
     * Sem isto um clique em Sync na tela de Billing zerava o dinheiro de
     * visita: este recompute varria só `jobs`, e reescrevia `net_payout` por
     * cima do valor certo. Mesma regra do recompute canônico — visita paga
     * quando está `completed`.
     */
    const visits = visitsBySb.get(sb.id) ?? [];
    // Mesma regra do recompute: valor entra assim que a visita existe viva; o
    // "done" governa a promoção a ready_to_pay, não o valor.
    const payableVisits = visits.filter((v) => v.status !== "cancelled");
    // O dinheiro sai da fonte única, que já descarta visita de job morto.
    const pagaveisDeVisita = linhasDeVisita[sb.id] ?? [];

    const jobValue =
      payable.reduce((s, j) => s + (Number(j.partner_cost) || 0), 0) +
      pagaveisDeVisita.reduce((s, v) => s + (Number(v.labour) || 0), 0);
    const materials =
      payable.reduce((s, j) => s + (Number(j.materials_cost) || 0), 0) +
      pagaveisDeVisita.reduce((s, v) => s + (Number(v.materials) || 0), 0);
    const netPayout = jobValue + materials;

    const patch: Record<string, unknown> = {
      jobs_count: payable.length,
      job_value: jobValue,
      materials,
      commission: 0,
      net_payout: netPayout,
    };

    // Documento com visita viva não é órfão, mesmo que todo job dele tenha sido
    // cancelado: o parceiro da visita continua tendo o que receber.
    const allLinkedTerminal = visits.length === 0 && jobs.length > 0 && jobs.every(
      (j) => j.status === "cancelled" || j.status === "deleted" || Boolean(j.deleted_at),
    );
    if (payable.length === 0 && allLinkedTerminal) {
      const hasPartnerCancel = jobs.some((j) => j.partner_cancelled_at);
      patch.status = hasPartnerCancel ? "payout_lost" : "payout_cancelled";
      patch.partner_status_label = hasPartnerCancel ? "Lost" : "Cancelled";
      patch.payout_void_reason = hasPartnerCancel ? "Jobs cancelled by partner" : "Jobs cancelled";
      stats.promoted++;
    }

    /**
     * Promove a ready_to_pay quando TUDO que está no documento acabou.
     *
     * "Tudo" agora inclui as visitas (mig 161/276): documento só de visita
     * jamais seria promovido enquanto a regra olhasse apenas jobs, e um
     * documento misto não pode ser liberado com visita ainda por fazer.
     */
    const temTrabalho = payable.length > 0 || pagaveisDeVisita.length > 0;
    const jobsProntos = payable.every((j) => SELF_BILL_PAYOUT_APPROVED_JOB_STATUSES.has(j.status));
    const visitasPendentes = visits.some((v) => v.status !== "completed" && v.status !== "cancelled");
    if (PROMOTABLE_STATUSES.has(sb.status) && temTrabalho && jobsProntos && !visitasPendentes) {
      patch.status = "ready_to_pay";
      stats.promoted++;
    }

    // Recalculate due date from partner terms or Setup org standard schedule
    if (sb.week_end) {
      const terms = sb.partner_id ? partnerTermsMap.get(sb.partner_id) ?? null : null;
      const newDueDate = computePartnerSelfBillDueIso(
        sb.week_end,
        terms,
        orgPayout.orgStandardTerms,
        orgPayout.orgReferenceYmd,
      );
      const oldDueDate = sb.due_date ? String(sb.due_date).slice(0, 10) : null;
      if (newDueDate !== oldDueDate) {
        patch.due_date = newDueDate;
        stats.dueDatesUpdated++;
      }
    }

    updates.push({ id: sb.id, patch });
    stats.totalsUpdated++;
  }

  for (let i = 0; i < updates.length; i += BATCH) {
    await Promise.all(
      updates.slice(i, i + BATCH).map(({ id, patch }) =>
        admin.from("self_bills").update(patch).eq("id", id),
      ),
    );
  }

  return NextResponse.json({ ok: true, ...stats });
}
