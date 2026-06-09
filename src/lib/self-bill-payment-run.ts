import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createTicket } from "@/lib/zendesk";
import { formatCurrency } from "@/lib/utils";

/**
 * Self-bill payment-run resolver.
 *
 * One Zendesk master ticket per payment cycle:
 *   • `standard` — upserted by `(period_start, period_end)`. Clicking "Send
 *     all" twice for the same week reuses the same ticket.
 *   • `off_cycle` — always creates a new ticket. Used for one-off / out-of-
 *     band sends that shouldn't pollute the standard weekly thread.
 *
 * The send endpoint calls `resolvePaymentRunForGroup` once per
 * (period_start, period_end) group. If the run is new, we open the Zendesk
 * ticket here and persist the id+url. The endpoint then threads each
 * partner's send as a side conversation under that ticket.
 */

export type PaymentRunCycleKind = "standard" | "off_cycle";

export type PaymentRunGroup = {
  period_start: string; // YYYY-MM-DD
  period_end: string;   // YYYY-MM-DD
  selfBillIds: string[];
  totalAmount: number;
};

export type ResolvedPaymentRun = {
  id: string;
  cycle_kind: PaymentRunCycleKind;
  period_start: string;
  period_end: string;
  zendesk_ticket_id: string | null;
  zendesk_ticket_url: string | null;
  /** Set on this turn when we just created the run row (vs reused an existing one). */
  created: boolean;
};

function fmtPeriod(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);
  const sStr = isNaN(s.getTime()) ? start : s.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const eStr = isNaN(e.getTime()) ? end : e.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  return `${sStr} – ${eStr}`;
}

function ticketUrlFromId(id: number | string | null): string | null {
  if (!id) return null;
  const sub = process.env.ZENDESK_SUBDOMAIN?.trim();
  if (!sub) return null;
  return `https://${sub}.zendesk.com/agent/tickets/${id}`;
}

export async function resolvePaymentRunForGroup(
  admin: SupabaseClient,
  group: PaymentRunGroup,
  options: {
    cycleKind: PaymentRunCycleKind;
    createdBy: string | null;
    /** Email used as Zendesk requester when we open a new master ticket. */
    requesterEmail: string;
    /** Display name for the requester (falls back to email). */
    requesterName?: string | null;
  },
): Promise<ResolvedPaymentRun> {
  if (options.cycleKind === "standard") {
    const { data: existing } = await admin
      .from("self_bill_payment_runs")
      .select("id, cycle_kind, period_start, period_end, zendesk_ticket_id, zendesk_ticket_url")
      .eq("cycle_kind", "standard")
      .eq("period_start", group.period_start)
      .eq("period_end", group.period_end)
      .maybeSingle();

    if (existing) {
      const row = existing as {
        id: string;
        cycle_kind: PaymentRunCycleKind;
        period_start: string;
        period_end: string;
        zendesk_ticket_id: string | null;
        zendesk_ticket_url: string | null;
      };
      // Merge new ids into self_bill_ids and refresh total.
      const merged = await mergeSelfBillIds(admin, row.id, group.selfBillIds, group.totalAmount);
      let zendeskTicketId = row.zendesk_ticket_id;
      let zendeskTicketUrl = row.zendesk_ticket_url;
      if (!zendeskTicketId) {
        const ticket = await openZendeskTicketForRun({
          cycleKind: "standard",
          period_start: row.period_start,
          period_end: row.period_end,
          totalAmount: merged.total,
          requesterEmail: options.requesterEmail,
          requesterName: options.requesterName ?? null,
        });
        if (ticket.ok) {
          zendeskTicketId = String(ticket.id);
          zendeskTicketUrl = ticketUrlFromId(ticket.id);
          await admin
            .from("self_bill_payment_runs")
            .update({ zendesk_ticket_id: zendeskTicketId, zendesk_ticket_url: zendeskTicketUrl })
            .eq("id", row.id);
        }
      }
      return {
        id: row.id,
        cycle_kind: row.cycle_kind,
        period_start: row.period_start,
        period_end: row.period_end,
        zendesk_ticket_id: zendeskTicketId,
        zendesk_ticket_url: zendeskTicketUrl,
        created: false,
      };
    }
  }

  // Create a new run (standard-first-time OR off-cycle).
  const ticket = await openZendeskTicketForRun({
    cycleKind: options.cycleKind,
    period_start: group.period_start,
    period_end: group.period_end,
    totalAmount: group.totalAmount,
    requesterEmail: options.requesterEmail,
    requesterName: options.requesterName ?? null,
  });
  const zendeskTicketId = ticket.ok && ticket.id != null ? String(ticket.id) : null;
  const zendeskTicketUrl = ticketUrlFromId(zendeskTicketId);

  const { data: inserted, error: insertErr } = await admin
    .from("self_bill_payment_runs")
    .insert({
      cycle_kind: options.cycleKind,
      period_start: group.period_start,
      period_end: group.period_end,
      total_amount: group.totalAmount,
      self_bill_ids: group.selfBillIds,
      zendesk_ticket_id: zendeskTicketId,
      zendesk_ticket_url: zendeskTicketUrl,
      created_by: options.createdBy,
    })
    .select("id, cycle_kind, period_start, period_end, zendesk_ticket_id, zendesk_ticket_url")
    .single();

  if (insertErr || !inserted) {
    // Race on the standard unique index — another concurrent request created the
    // row first. Re-resolve so we return the surviving row.
    if (options.cycleKind === "standard") {
      return resolvePaymentRunForGroup(admin, group, options);
    }
    throw insertErr ?? new Error("Failed to create self_bill_payment_runs row");
  }

  const row = inserted as {
    id: string;
    cycle_kind: PaymentRunCycleKind;
    period_start: string;
    period_end: string;
    zendesk_ticket_id: string | null;
    zendesk_ticket_url: string | null;
  };
  return { ...row, created: true };
}

async function mergeSelfBillIds(
  admin: SupabaseClient,
  runId: string,
  newIds: string[],
  groupTotal: number,
): Promise<{ ids: string[]; total: number }> {
  const { data: current } = await admin
    .from("self_bill_payment_runs")
    .select("self_bill_ids, total_amount")
    .eq("id", runId)
    .maybeSingle();
  const existingIds = ((current as { self_bill_ids?: string[] } | null)?.self_bill_ids ?? []) as string[];
  const existingTotal = Number((current as { total_amount?: number } | null)?.total_amount ?? 0);
  const merged = Array.from(new Set([...existingIds, ...newIds]));
  // Keep total in sync with the union when the caller passes an updated group total.
  // For "resend" cases we leave total untouched to avoid double-counting.
  const total = merged.length > existingIds.length ? existingTotal + groupTotal : existingTotal;
  await admin
    .from("self_bill_payment_runs")
    .update({ self_bill_ids: merged, total_amount: total })
    .eq("id", runId);
  return { ids: merged, total };
}

async function openZendeskTicketForRun(args: {
  cycleKind: PaymentRunCycleKind;
  period_start: string;
  period_end: string;
  totalAmount: number;
  requesterEmail: string;
  requesterName: string | null;
}): Promise<{ ok: true; id: number } | { ok: false; error?: string }> {
  const periodLabel = fmtPeriod(args.period_start, args.period_end);
  const subject =
    args.cycleKind === "standard"
      ? `Payment week ${periodLabel}`
      : `Off-cycle payment — ${periodLabel}`;

  const total = formatCurrency(args.totalAmount);
  const htmlBody = `
<div style="font-family:system-ui,sans-serif;color:#0A0A1F;">
  <p style="margin:0 0 12px;"><strong>${subject}</strong></p>
  <p style="margin:0 0 12px;">Total: <strong>${total}</strong></p>
  <p style="margin:0 0 12px;">Period: ${periodLabel}</p>
  <p style="margin:0;color:#6B6B85;font-size:13px;">
    Partner self-bill sends will appear as side conversations under this ticket.
  </p>
</div>`.trim();

  const tags = ["payment-run", args.cycleKind];

  const result = await createTicket({
    subject,
    htmlBody,
    publicComment: false,
    requesterEmail: args.requesterEmail,
    requesterName: args.requesterName,
    tags,
  });

  if (!result.ok || result.id == null) {
    console.warn("[self-bill-payment-run] Zendesk ticket creation failed:", result.error);
    return { ok: false, error: result.error };
  }
  return { ok: true, id: result.id };
}

/**
 * Group self-bill rows by (week_start, week_end). The endpoint feeds each
 * group to `resolvePaymentRunForGroup` once.
 */
export function groupSelfBillsByPeriod<T extends {
  id: string;
  week_start?: string | null;
  week_end?: string | null;
  net_payout?: number | null;
}>(rows: T[]): PaymentRunGroup[] {
  const map = new Map<string, PaymentRunGroup>();
  for (const sb of rows) {
    const start = sb.week_start?.trim();
    const end = sb.week_end?.trim();
    if (!start || !end) continue;
    const key = `${start}|${end}`;
    const existing = map.get(key);
    const amount = Number(sb.net_payout ?? 0);
    if (existing) {
      existing.selfBillIds.push(sb.id);
      existing.totalAmount += amount;
    } else {
      map.set(key, {
        period_start: start,
        period_end: end,
        selfBillIds: [sb.id],
        totalAmount: amount,
      });
    }
  }
  return Array.from(map.values());
}
