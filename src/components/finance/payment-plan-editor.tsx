"use client";

import { useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/utils";
import {
  splitEqually,
  todayYmdForPaymentPlan,
  validateInstallmentsSum,
  type PaymentPlanInstallmentDraft,
} from "@/lib/invoice-payment-plan";
import { dueDateIsoFromAccountPaymentTerms } from "@/lib/account-payment-due-date";
import type { AccountPaymentOrgContext } from "@/lib/account-payment-due-date";
import { Plus, Trash2 } from "lucide-react";

export type PaymentPlanEditorRow = PaymentPlanInstallmentDraft & { key: string };

type Props = {
  enabled: boolean;
  onEnabledChange: (v: boolean) => void;
  rows: PaymentPlanEditorRow[];
  onRowsChange: (rows: PaymentPlanEditorRow[]) => void;
  totalAmount: number;
  accountPaymentTerms?: string | null;
  orgCtx?: AccountPaymentOrgContext | null;
  className?: string;
};

function newRowKey(): string {
  return `row-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function emptyPaymentPlanRow(dueDate = ""): PaymentPlanEditorRow {
  return { key: newRowKey(), amount: 0, due_date: dueDate };
}

export function PaymentPlanEditor({
  enabled,
  onEnabledChange,
  rows,
  onRowsChange,
  totalAmount,
  accountPaymentTerms,
  orgCtx,
  className,
}: Props) {
  const sum = useMemo(
    () => Math.round(rows.reduce((s, r) => s + (Number(r.amount) || 0), 0) * 100) / 100,
    [rows],
  );
  const sumOk = validateInstallmentsSum(totalAmount, rows);

  const addRow = useCallback(() => {
    onRowsChange([...rows, emptyPaymentPlanRow()]);
  }, [rows, onRowsChange]);

  const removeRow = useCallback(
    (key: string) => {
      if (rows.length <= 1) return;
      onRowsChange(rows.filter((r) => r.key !== key));
    },
    [rows, onRowsChange],
  );

  const updateRow = useCallback(
    (key: string, patch: Partial<PaymentPlanInstallmentDraft>) => {
      onRowsChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    },
    [rows, onRowsChange],
  );

  const splitEqual = useCallback(() => {
    if (rows.length < 1 || totalAmount <= 0) return;
    const amounts = splitEqually(totalAmount, rows.length);
    onRowsChange(rows.map((r, i) => ({ ...r, amount: amounts[i] ?? 0 })));
  }, [rows, totalAmount, onRowsChange]);

  const applyAccountTerms = useCallback(() => {
    if (rows.length < 1) return;
    const terms = accountPaymentTerms?.trim();
    if (!terms) return;
    const anchor = new Date();
    const updated = rows.map((r, i) => {
      const d = new Date(anchor);
      d.setMonth(d.getMonth() + i);
      const iso = dueDateIsoFromAccountPaymentTerms(d, terms, orgCtx ?? undefined);
      return { ...r, due_date: iso.slice(0, 10) };
    });
    onRowsChange(updated);
  }, [rows, accountPaymentTerms, orgCtx, onRowsChange]);

  const drift = Math.round((totalAmount - sum) * 100) / 100;

  return (
    <div className={cn("space-y-2", className)}>
      <label className="inline-flex items-center gap-1.5 text-xs font-medium text-text-primary cursor-pointer">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onEnabledChange(e.target.checked)}
          className="rounded border-border h-3.5 w-3.5"
        />
        Payment plan
      </label>

      {enabled ? (
        <div className="grid grid-cols-[5.75rem_max-content] gap-x-2 gap-y-0.5 text-[10px] leading-snug">
          <span className="text-text-tertiary">Installments:</span>
          <span
            className={cn("font-semibold tabular-nums", sumOk ? "text-text-primary" : "text-red-600")}
            title="Sum of installment amounts below"
          >
            {formatCurrency(sum)}
          </span>
          <span className="text-text-tertiary">Total</span>
          <span className="font-semibold tabular-nums text-text-primary" title="Fixed bill / invoice total">
            {formatCurrency(totalAmount)}
          </span>
          <span className="text-text-tertiary">Difference:</span>
          <span
            className={cn(
              "font-semibold tabular-nums",
              sumOk ? "text-emerald-700 dark:text-emerald-400" : "text-red-600",
            )}
          >
            {sumOk ? formatCurrency(0) : formatCurrency(drift)}
          </span>
        </div>
      ) : null}

      {enabled ? (
        <>
          <div className="flex flex-wrap gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[11px]"
              onClick={addRow}
              icon={<Plus className="h-3 w-3" />}
            >
              Add
            </Button>
            <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-[11px]" onClick={splitEqual}>
              Split equally
            </Button>
            {accountPaymentTerms?.trim() ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-[11px]"
                onClick={applyAccountTerms}
              >
                Account terms
              </Button>
            ) : null}
          </div>

          <div className="rounded-md border border-border-light bg-surface-hover/30 max-h-44 overflow-y-auto">
            <div className="grid grid-cols-[1.25rem_minmax(0,1fr)_minmax(0,1.15fr)_1.25rem] gap-1 px-2 py-1 border-b border-border-light/80 text-[9px] font-semibold uppercase tracking-wide text-text-tertiary">
              <span>#</span>
              <span>Amount</span>
              <span>Due</span>
              <span />
            </div>
            <div className="divide-y divide-border-light/80">
              {rows.map((row, idx) => (
                <div
                  key={row.key}
                  className="grid grid-cols-[1.25rem_minmax(0,1fr)_minmax(0,1.15fr)_1.25rem] gap-1 items-center px-2 py-1.5"
                >
                  <span className="text-[10px] font-semibold text-text-tertiary tabular-nums">{idx + 1}</span>
                  <Input
                    type="number"
                    step="0.01"
                    min={0}
                    className="h-8 min-w-0 text-xs px-2"
                    value={row.amount === 0 ? "" : row.amount}
                    onChange={(e) =>
                      updateRow(row.key, { amount: Math.max(0, Number(e.target.value) || 0) })
                    }
                    placeholder="£"
                    aria-label={`Installment ${idx + 1} amount`}
                  />
                  <Input
                    type="date"
                    className="h-8 min-w-0 text-xs px-1.5"
                    value={row.due_date}
                    onChange={(e) => updateRow(row.key, { due_date: e.target.value })}
                    aria-label={`Installment ${idx + 1} due date`}
                  />
                  <button
                    type="button"
                    disabled={rows.length <= 1}
                    onClick={() => removeRow(row.key)}
                    className="p-0.5 text-text-tertiary hover:text-red-600 disabled:opacity-30 justify-self-center"
                    aria-label={`Remove installment ${idx + 1}`}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {!sumOk ? (
            <p className="text-[10px] text-red-600 leading-snug">
              Adjust installments — difference must be {formatCurrency(0)}.
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

export function defaultPaymentPlanRows(total: number, count = 4): PaymentPlanEditorRow[] {
  const today = todayYmdForPaymentPlan();
  const amounts = splitEqually(total, count);
  return amounts.map((amount, i) => {
    const d = new Date(`${today}T12:00:00`);
    d.setMonth(d.getMonth() + i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return { key: newRowKey(), amount, due_date: `${y}-${m}-${day}` };
  });
}
