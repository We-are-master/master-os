"use client";

import { getSupabase } from "@/services/base";
import type { Bill, SelfBill } from "@/types/database";
import { getWeekBoundsForDate } from "@/lib/self-bill-period";
import {
  SELF_BILL_PAYOUT_VOID_STATUSES,
  isSelfBillPayoutVoided,
} from "@/services/self-bills";

/**
 * A single line that will show up on the Payout page, normalised across the three
 * underlying sources (partner self-bills, internal workforce self-bills, supplier bills).
 *
 * This type exists only in the frontend — it's derived on the fly from existing data.
 */
export type PayoutCategory = "workforce" | "partners" | "expenses";
/**
 * Uses the existing Fixfy vocabulary (Draft / Approved / Paid / Cancelled),
 * so users coming from Bills, Self-bills and Invoices recognise the states.
 */
export type PayoutStatus = "draft" | "approved" | "paid" | "cancelled";
export type PayoutSource = "self_bill_partner" | "self_bill_internal" | "bill";

export interface PayoutItem {
  /** Stable id = `${source}:${rowId}` so selections survive refetches. */
  id: string;
  source: PayoutSource;
  sourceId: string;
  category: PayoutCategory;
  /** Human reference (SB-2026-W15-..., BILL-042, etc.). */
  reference: string;
  /** Payee display name. */
  name: string;
  /** Short line under the name (contractor type, supplier category, etc.). */
  description?: string;
  jobsCount?: number;
  weekLabel: string;
  weekStart: string;
  weekEnd: string;
  dueDate: string | null;
  amount: number;
  status: PayoutStatus;
  /** `****1234` or null when bank details unavailable. */
  bankLast4: string | null;
  /** Target href for the "open in origin page" link (always _blank). */
  linkHref: string;
  /** Avatar name fallback (partner company name, contractor name, supplier description). */
  avatarName: string;
  /** Back-reference to the original row for drawer / inspection. */
  raw: SelfBill | Bill;
}

function toYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function getWeekFromAnchor(anchor: Date): { weekStart: string; weekEnd: string; weekLabel: string } {
  return getWeekBoundsForDate(anchor);
}

/** Jump to previous / next ISO week by shifting the anchor by 7 days. */
export function shiftWeek(anchor: Date, direction: -1 | 1): Date {
  return new Date(anchor.getTime() + direction * 7 * 86400000);
}

/** True if today falls in the same ISO week as `anchor`. */
export function isThisWeek(anchor: Date): boolean {
  const a = getWeekBoundsForDate(anchor);
  const b = getWeekBoundsForDate(new Date());
  return a.weekLabel === b.weekLabel;
}

function lastFourOfAccount(accountNumber: string | null | undefined): string | null {
  if (!accountNumber) return null;
  const digits = accountNumber.replace(/\D/g, "");
  if (digits.length < 4) return null;
  return `****${digits.slice(-4)}`;
}

/** Supplier bills have no bank column — we return null and the UI shows "—". */
function bankForBill(): string | null {
  return null;
}

/**
 * Self-bill → payout status
 * - paid                                    → paid
 * - payout_cancelled / payout_lost /
 *   payout_archived / rejected              → cancelled
 * - ready_to_pay / pending_review /
 *   awaiting_payment / audit_required       → approved (ready to release funds)
 * - everything else (draft, accumulating,
 *   needs_attention)                        → draft (not yet signed off)
 */
function mapSelfBillStatus(sb: SelfBill): PayoutStatus {
  if (sb.status === "paid") return "paid";
  if (isSelfBillPayoutVoided(sb) || sb.status === "rejected") return "cancelled";
  if (
    sb.status === "ready_to_pay" ||
    sb.status === "pending_review" ||
    sb.status === "awaiting_payment" ||
    sb.status === "audit_required"
  ) {
    return "approved";
  }
  return "draft";
}

/**
 * Supplier bill → payout status
 * - paid                     → paid
 * - rejected                 → cancelled
 * - approved                 → approved
 * - submitted / needs_attention → draft (awaiting review)
 */
function mapBillStatus(b: Bill): PayoutStatus {
  if (b.status === "paid") return "paid";
  if (b.status === "rejected") return "cancelled";
  if (b.status === "approved") return "approved";
  return "draft";
}

/**
 * Fetch one week (or multi-week range) of payout items from the three sources,
 * enrich with bank info, and return a unified list plus an overdue-from-before-range list.
 *
 * All reads are done in parallel. No writes, no new endpoints.
 *
 * @param fromDate start of the user-selected window (any day in the first week)
 * @param toDate   end of the user-selected window (any day in the last week).
 *                 When omitted, the week that contains fromDate is used (single-week mode).
 */
export async function fetchPayoutRange(
  fromDate: Date,
  toDate?: Date,
): Promise<{
  items: PayoutItem[];
  overdueItems: PayoutItem[];
  rangeStart: string;
  rangeEnd: string;
  rangeLabel: string;
}> {
  const from = getWeekBoundsForDate(fromDate);
  const to = toDate ? getWeekBoundsForDate(toDate) : from;
  const rangeStart = from.weekStart < to.weekStart ? from.weekStart : to.weekStart;
  const rangeEnd = from.weekEnd > to.weekEnd ? from.weekEnd : to.weekEnd;
  const rangeLabel =
    from.weekLabel === to.weekLabel ? from.weekLabel : `${from.weekLabel} → ${to.weekLabel}`;

  const supabase = getSupabase();

  // Past 8 weeks before range start — lookback for overdue payouts that should have been done earlier.
  const overdueRangeStart = toYmd(new Date(new Date(rangeStart).getTime() - 56 * 86400000));

  const [selfBillsRes, billsRes] = await Promise.all([
    supabase
      .from("self_bills")
      .select("*")
      .gte("week_start", overdueRangeStart)
      .lte("week_start", rangeEnd)
      .order("week_start", { ascending: false })
      .order("created_at", { ascending: false }),
    supabase
      .from("bills")
      .select("*")
      .gte("due_date", overdueRangeStart)
      .lte("due_date", rangeEnd)
      .is("archived_at", null)
      .order("due_date", { ascending: false }),
  ]);

  if (selfBillsRes.error) throw selfBillsRes.error;
  if (billsRes.error) throw billsRes.error;

  const selfBills = (selfBillsRes.data ?? []) as SelfBill[];
  const bills = (billsRes.data ?? []) as Bill[];

  // Collect unique partner_ids and internal_cost_ids to enrich with bank details.
  const partnerIds = [
    ...new Set(
      selfBills
        .filter((sb) => sb.bill_origin !== "internal" && sb.partner_id)
        .map((sb) => sb.partner_id as string),
    ),
  ];
  const internalIds = [
    ...new Set(
      selfBills
        .filter((sb) => sb.bill_origin === "internal" && sb.internal_cost_id)
        .map((sb) => sb.internal_cost_id as string),
    ),
  ];

  const [partnersRes, internalsRes] = await Promise.all([
    partnerIds.length > 0
      ? supabase
          .from("partners")
          .select("id, company_name, contact_name, trade, bank_account_number")
          .in("id", partnerIds)
      : Promise.resolve({ data: [], error: null }),
    internalIds.length > 0
      ? supabase
          .from("payroll_internal_costs")
          .select("id, payee_name, payroll_profile")
          .in("id", internalIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  type PartnerRow = {
    id: string;
    company_name?: string | null;
    contact_name?: string | null;
    trade?: string | null;
    bank_account_number?: string | null;
  };
  type InternalRow = {
    id: string;
    payee_name?: string | null;
    payroll_profile?: Record<string, unknown> | null;
  };

  const partnersById = new Map<string, PartnerRow>();
  for (const p of (partnersRes.data ?? []) as PartnerRow[]) partnersById.set(p.id, p);
  const internalsById = new Map<string, InternalRow>();
  for (const i of (internalsRes.data ?? []) as InternalRow[]) internalsById.set(i.id, i);

  const items: PayoutItem[] = [];

  for (const sb of selfBills) {
    const isInternal = sb.bill_origin === "internal";
    const category: PayoutCategory = isInternal ? "workforce" : "partners";
    const status = mapSelfBillStatus(sb);
    const wkLabel = sb.week_label ?? from.weekLabel;
    const wkStart = sb.week_start ?? rangeStart;
    const wkEnd = sb.week_end ?? rangeEnd;

    let name = sb.partner_name ?? "—";
    let description: string | undefined;
    let bankLast4: string | null = null;
    let linkHref = `/finance/selfbill?focus=${sb.id}`;

    if (isInternal && sb.internal_cost_id) {
      const row = internalsById.get(sb.internal_cost_id);
      if (row) {
        name = row.payee_name?.trim() || name;
        const profile = (row.payroll_profile ?? {}) as { position?: string };
        description = profile.position ?? "Contractor";
        // internal bank details aren't in a dedicated column yet — skip for v1
      }
      linkHref = `/people`;
    } else if (sb.partner_id) {
      const row = partnersById.get(sb.partner_id);
      if (row) {
        name = (row.company_name || row.contact_name || name).trim();
        description = row.trade ?? "Partner";
        bankLast4 = lastFourOfAccount(row.bank_account_number);
      }
      linkHref = `/partners/${sb.partner_id}`;
    }

    items.push({
      id: `self_bill:${sb.id}`,
      source: isInternal ? "self_bill_internal" : "self_bill_partner",
      sourceId: sb.id,
      category,
      reference: sb.reference,
      name,
      description,
      jobsCount: typeof sb.jobs_count === "number" ? sb.jobs_count : undefined,
      weekLabel: wkLabel,
      weekStart: wkStart,
      weekEnd: wkEnd,
      dueDate: sb.due_date ?? null,
      amount: Number(sb.net_payout ?? 0),
      status,
      bankLast4,
      linkHref,
      avatarName: name,
      raw: sb,
    });
  }

  for (const b of bills) {
    const due = b.due_date ?? rangeStart;
    const wkBounds = getWeekBoundsForDate(new Date(due));
    items.push({
      id: `bill:${b.id}`,
      source: "bill",
      sourceId: b.id,
      category: "expenses",
      reference: b.id.slice(0, 8).toUpperCase(),
      name: b.description,
      description: b.category ?? "Expense",
      weekLabel: wkBounds.weekLabel,
      weekStart: wkBounds.weekStart,
      weekEnd: wkBounds.weekEnd,
      dueDate: b.due_date ?? null,
      amount: Number(b.amount ?? 0),
      status: mapBillStatus(b),
      bankLast4: bankForBill(),
      linkHref: `/finance/bills?focus=${b.id}`,
      avatarName: b.description,
      raw: b,
    });
  }

  // Split into "in range" vs "overdue" (earlier weeks still pending).
  const inRange: PayoutItem[] = [];
  const overdue: PayoutItem[] = [];
  for (const it of items) {
    const isInRange = it.weekStart >= rangeStart && it.weekStart <= rangeEnd;
    if (isInRange) {
      inRange.push(it);
    } else if (it.status === "approved" || it.status === "draft") {
      // "Still open" = anything not paid / cancelled that lives before the active range.
      overdue.push(it);
    }
  }

  return {
    items: inRange,
    overdueItems: overdue,
    rangeStart,
    rangeEnd,
    rangeLabel,
  };
}

/** Back-compat alias used by the page before range support. */
export const fetchPayoutWeek = (anchor: Date) => fetchPayoutRange(anchor);

/**
 * CSV export of the currently visible items.
 * Simple, fixed-column schema — meant for bank upload / accounting handoff.
 */
export function buildPayoutCsv(items: PayoutItem[], weekLabel: string): string {
  const rows: string[][] = [
    ["Week", "Category", "Reference", "Name", "Description", "Due date", "Amount", "Status", "Bank"],
  ];
  for (const it of items) {
    rows.push([
      it.weekLabel,
      it.category,
      it.reference,
      it.name,
      it.description ?? "",
      it.dueDate ?? "",
      it.amount.toFixed(2),
      it.status,
      it.bankLast4 ?? "",
    ]);
  }
  return rows
    .map((row) =>
      row
        .map((cell) => {
          const s = String(cell ?? "");
          if (s.includes(",") || s.includes('"') || s.includes("\n")) {
            return `"${s.replace(/"/g, '""')}"`;
          }
          return s;
        })
        .join(","),
    )
    .join("\n")
    .concat("\n")
    .concat(`# ${weekLabel}\n`);
}

/** Tab order — matches Fixfy lifecycle vocabulary. */
export const STATUS_ORDER: PayoutStatus[] = ["draft", "approved", "paid", "cancelled"];
export const CATEGORY_ORDER: PayoutCategory[] = ["workforce", "partners", "expenses"];
export { SELF_BILL_PAYOUT_VOID_STATUSES };
