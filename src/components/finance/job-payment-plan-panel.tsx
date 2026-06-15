"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  PaymentPlanEditor,
  defaultPaymentPlanRows,
  emptyPaymentPlanRow,
  type PaymentPlanEditorRow,
} from "@/components/finance/payment-plan-editor";
import {
  createPaymentPlan,
  updatePaymentPlan,
  updateOpenPaymentPlanInstallments,
  cancelPaymentPlan,
  listInstallmentsForInvoice,
  syncPaymentPlanFromAmountPaid,
} from "@/services/invoice-payment-plan";
import {
  createSelfBillPaymentPlan,
  updateSelfBillPaymentPlan,
  updateOpenSelfBillPaymentPlanInstallments,
  cancelSelfBillPaymentPlan,
  listInstallmentsForSelfBill,
  repairSelfBillPaymentPlanActiveFlag,
  syncSelfBillPaymentPlanFromPartnerPaid,
} from "@/services/self-bill-payment-plan";
import { validateInstallmentsSum, paymentPlanProgressLabel, validateOpenInstallmentsSum, paidInstallmentsTotal } from "@/lib/invoice-payment-plan";
import { selfBillPaymentPlanProgressLabel } from "@/lib/self-bill-payment-plan";
import { cn, formatCurrency } from "@/lib/utils";
import { getSupabase } from "@/services/base";
import type { Invoice, InvoicePaymentInstallment, SelfBillPaymentInstallment } from "@/types/database";

type Props =
  | {
      kind: "client";
      entityId: string;
      totalAmount: number;
      amountPaid: number;
      canEdit: boolean;
      onUpdated?: () => void | Promise<void>;
    }
  | {
      kind: "partner";
      entityId: string;
      totalAmount: number;
      amountPaid: number;
      canEdit: boolean;
      onUpdated?: () => void | Promise<void>;
    };

export function JobPaymentPlanPanel(props: Props) {
  const [installments, setInstallments] = useState<
    InvoicePaymentInstallment[] | SelfBillPaymentInstallment[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const [rows, setRows] = useState<PaymentPlanEditorRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [matching, setMatching] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (props.kind === "client") {
        setInstallments(await listInstallmentsForInvoice(props.entityId));
      } else {
        const rows = await listInstallmentsForSelfBill(props.entityId);
        if (rows.length > 0) {
          try {
            await repairSelfBillPaymentPlanActiveFlag(props.entityId);
          } catch (e) {
            console.warn("JobPaymentPlanPanel repair payment_plan_active", e);
          }
        }
        setInstallments(rows);
      }
    } catch (e) {
      console.error("JobPaymentPlanPanel load", e);
      setInstallments([]);
    } finally {
      setLoading(false);
    }
  }, [props.kind, props.entityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const hasPaid = installments.some((i) => i.status === "paid");
  const hasOpen = installments.some((i) => i.status === "pending");
  const progress =
    props.kind === "client"
      ? paymentPlanProgressLabel(installments as InvoicePaymentInstallment[])
      : selfBillPaymentPlanProgressLabel(installments as SelfBillPaymentInstallment[]);

  const openEditor = () => {
    const total = Math.max(0, props.totalAmount);
    const drafts =
      installments.length > 0
        ? installments.map((i) => ({
            amount: Number(i.amount) || 0,
            due_date: String(i.due_date).slice(0, 10),
            locked: i.status === "paid",
          }))
        : defaultPaymentPlanRows(total, 4).map((r) => ({ ...r, locked: false }));
    setRows(
      drafts.map((d) => ({
        ...emptyPaymentPlanRow(d.due_date),
        amount: d.amount,
        due_date: d.due_date,
        locked: d.locked,
      })),
    );
    setEditorOpen(true);
  };

  const handleSave = async () => {
    const openRows = rows.filter((r) => !r.locked);
    const openDrafts = openRows.map(({ amount, due_date }) => ({ amount, due_date }));
    if (hasPaid) {
      if (openDrafts.length < 1) {
        toast.error("At least one open installment is required.");
        return;
      }
      if (!validateOpenInstallmentsSum(props.totalAmount, paidInstallmentsTotal(installments), openDrafts)) {
        toast.error(`Open installments must sum to ${formatCurrency(props.totalAmount - paidInstallmentsTotal(installments))}.`);
        return;
      }
    } else if (!validateInstallmentsSum(props.totalAmount, rows)) {
      toast.error(`Installments must sum to ${formatCurrency(props.totalAmount)}.`);
      return;
    }
    setSaving(true);
    try {
      if (props.kind === "client") {
        const updated =
          installments.length > 0
            ? hasPaid
              ? await updateOpenPaymentPlanInstallments(props.entityId, props.totalAmount, openDrafts)
              : await updatePaymentPlan(props.entityId, props.totalAmount, openDrafts)
            : await createPaymentPlan(props.entityId, props.totalAmount, openDrafts);
        setInstallments(updated);
      } else {
        const updated =
          installments.length > 0
            ? hasPaid
              ? await updateOpenSelfBillPaymentPlanInstallments(props.entityId, props.totalAmount, openDrafts)
              : await updateSelfBillPaymentPlan(props.entityId, props.totalAmount, openDrafts)
            : await createSelfBillPaymentPlan(props.entityId, props.totalAmount, openDrafts);
        let next = updated;
        if (props.amountPaid > 0) {
          await syncSelfBillPaymentPlanFromPartnerPaid(props.entityId, props.amountPaid);
          next = await listInstallmentsForSelfBill(props.entityId);
        }
        setInstallments(next);
      }
      setEditorOpen(false);
      toast.success("Payment plan saved");
      await props.onUpdated?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save plan");
    } finally {
      setSaving(false);
    }
  };

  const handleMatchPayments = async () => {
    setMatching(true);
    try {
      if (props.kind === "client") {
        const supabase = getSupabase();
        const { data: invRow, error } = await supabase
          .from("invoices")
          .select("*")
          .eq("id", props.entityId)
          .maybeSingle();
        if (error) throw error;
        if (!invRow) throw new Error("Invoice not found");
        const inv = { ...(invRow as Invoice), amount_paid: props.amountPaid };
        await syncPaymentPlanFromAmountPaid(supabase, inv);
        setInstallments(await listInstallmentsForInvoice(props.entityId));
      } else {
        await syncSelfBillPaymentPlanFromPartnerPaid(props.entityId, props.amountPaid);
        setInstallments(await listInstallmentsForSelfBill(props.entityId));
      }
      toast.success("Installments matched to recorded payments");
      await props.onUpdated?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to match payments");
    } finally {
      setMatching(false);
    }
  };

  const handleCancelPlan = async () => {
    try {
      if (props.kind === "client") {
        await cancelPaymentPlan(props.entityId);
      } else {
        await cancelSelfBillPaymentPlan(props.entityId);
      }
      setInstallments([]);
      setEditorOpen(false);
      toast.success("Payment plan removed");
      await props.onUpdated?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to remove plan");
    }
  };

  if (loading) {
    return <p className="text-xs text-text-tertiary">Loading payment plan…</p>;
  }

  const billTotalLabel = props.kind === "client" ? "Invoice total" : "Bill total";

  return (
    <div className="rounded-lg border border-border bg-surface-hover/30 p-2.5 space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-text-secondary">
          {props.kind === "client" ? "Client plan" : "Partner plan"}
        </p>
        {progress ? <span className="text-[10px] text-text-tertiary">{progress}</span> : null}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px]">
        <span className="text-text-tertiary">
          {billTotalLabel}{" "}
          <span className="font-semibold tabular-nums text-text-primary">{formatCurrency(props.totalAmount)}</span>
        </span>
        <span className="text-text-tertiary">
          Paid{" "}
          <span className="font-semibold tabular-nums text-text-secondary">{formatCurrency(props.amountPaid)}</span>
        </span>
      </div>

      {editorOpen ? (
        <div className="space-y-1.5 pt-0.5">
          <PaymentPlanEditor
            enabled
            onEnabledChange={() => {}}
            rows={rows}
            onRowsChange={setRows}
            totalAmount={props.totalAmount}
          />
          <div className="flex flex-wrap gap-1.5">
            <Button type="button" size="sm" className="h-7 text-xs" loading={saving} onClick={() => void handleSave()}>
              Save plan
            </Button>
            <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setEditorOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : installments.length > 0 ? (
        <ul className="rounded-md border border-border-light/80 divide-y divide-border-light/80 text-[11px]">
          {installments.map((inst) => (
            <li key={inst.id} className="flex items-center justify-between gap-2 px-2 py-1">
              <span className={cn("tabular-nums min-w-0 truncate", inst.status === "paid" ? "text-emerald-700" : "text-text-secondary")}>
                <span className="text-text-tertiary">#{inst.sequence}</span> {formatCurrency(inst.amount)}{" "}
                <span className="text-text-tertiary">{String(inst.due_date).slice(0, 10)}</span>
              </span>
              <span
                className={cn(
                  "shrink-0 text-[10px] font-medium capitalize",
                  inst.status === "paid" ? "text-emerald-700" : "text-amber-700 dark:text-amber-400",
                )}
              >
                {inst.status}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[11px] text-text-tertiary">No payment plan yet.</p>
      )}

      {props.canEdit ? (
        <div className="flex flex-wrap gap-1 pt-0.5">
          {!editorOpen && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={openEditor}
              disabled={!hasOpen && installments.length > 0}
            >
              {installments.length > 0 ? "Edit plan" : "Create plan"}
            </Button>
          )}
          {props.amountPaid > 0.02 ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              loading={matching}
              onClick={() => void handleMatchPayments()}
            >
              Match payments
            </Button>
          ) : null}
          {installments.length > 0 && !hasPaid && !editorOpen ? (
            <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => void handleCancelPlan()}>
              Remove plan
            </Button>
          ) : null}
        </div>
      ) : null}
      {hasPaid && hasOpen ? (
        <p className="text-[10px] text-text-tertiary">Paid installments are locked — edit open rows only.</p>
      ) : null}
    </div>
  );
}
