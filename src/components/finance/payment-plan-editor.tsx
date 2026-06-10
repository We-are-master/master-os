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

  return (
    <div className={cn("space-y-2.5", className)}>
      <div className="flex items-center justify-between gap-2">
        <label className="inline-flex items-center gap-2 text-sm font-medium text-text-primary cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => onEnabledChange(e.target.checked)}
            className="rounded border-border"
          />
          Payment plan
        </label>
        {enabled ? (
          <span className={cn("text-xs tabular-nums", sumOk ? "text-text-tertiary" : "text-red-600 font-medium")}>
            {formatCurrency(sum)} / {formatCurrency(totalAmount)}
          </span>
        ) : null}
      </div>

      {enabled ? (
        <>
          <div className="flex flex-wrap gap-1.5">
            <Button type="button" variant="ghost" size="sm" onClick={addRow} icon={<Plus className="h-3.5 w-3.5" />}>
              Add installment
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={splitEqual}>
              Split equally
            </Button>
            {accountPaymentTerms?.trim() ? (
              <Button type="button" variant="ghost" size="sm" onClick={applyAccountTerms}>
                Standard account terms
              </Button>
            ) : null}
          </div>

          <div className="rounded-lg border border-border-light bg-surface-hover/30 max-h-52 overflow-y-auto divide-y divide-border-light">
            {rows.map((row, idx) => (
              <div key={row.key} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <span className="text-[10px] font-semibold text-text-tertiary w-5 shrink-0 tabular-nums">
                  {idx + 1}
                </span>
                <Input
                  type="number"
                  step="0.01"
                  min={0}
                  className="flex-1 min-w-[5rem] max-w-[8rem]"
                  value={row.amount === 0 ? "" : row.amount}
                  onChange={(e) =>
                    updateRow(row.key, { amount: Math.max(0, Number(e.target.value) || 0) })
                  }
                  placeholder="£"
                  aria-label={`Installment ${idx + 1} amount`}
                />
                <Input
                  type="date"
                  className="flex-1 min-w-[8rem] max-w-[11rem]"
                  value={row.due_date}
                  onChange={(e) => updateRow(row.key, { due_date: e.target.value })}
                  aria-label={`Installment ${idx + 1} due date`}
                />
                <button
                  type="button"
                  disabled={rows.length <= 1}
                  onClick={() => removeRow(row.key)}
                  className="p-1.5 text-text-tertiary hover:text-red-600 disabled:opacity-30"
                  aria-label={`Remove installment ${idx + 1}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>

          {!sumOk ? (
            <p className="text-[11px] text-red-600">Installments must sum to {formatCurrency(totalAmount)}.</p>
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
