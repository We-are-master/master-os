"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Check, Clock } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FixfyHintIcon } from "@/components/ui/fixfy-hint-icon";
import { cn, formatCurrency } from "@/lib/utils";
import type { CashflowBreakdownLine, CashflowWeekBreakdown } from "@/lib/billing-standalone-metrics";
import type { RunwayPeriodDetail } from "@/lib/billing-runway-views";
import type { RunwayViewMode } from "@/lib/billing-runway-views";

/**
 * Detalhe do período do runway (dono, 15/10/2026), no mesmo desenho do Money
 * In / Money Out: à esquerda o que entrou e o que vai entrar, à direita o que
 * saiu e o que vai sair (parceiros, workforce, contas). Parcelado aparece só
 * com a parcela que vence no período, dos dois lados.
 */

const soma = (l: CashflowBreakdownLine[]) => Math.round(l.reduce((s, x) => s + x.amount, 0) * 100) / 100;

function dia(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00`);
  return Number.isNaN(d.getTime())
    ? ymd
    : d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

function Linha({ line, done, tone }: { line: CashflowBreakdownLine; done: boolean; tone: "in" | "out" }) {
  const parcela = /instalment/i.test(line.detail ?? "");
  const detail = (line.detail ?? "").replace(/\s*·\s*instalment/i, "");
  const atrasada = !done && line.dueYmd < new Date().toISOString().slice(0, 10);
  return (
    <li className="flex items-center gap-2 px-3 py-1.5 text-[12.5px]">
      <span
        className={cn(
          "flex h-4 w-4 shrink-0 items-center justify-center rounded-full",
          done ? "bg-[var(--success-light)] text-[var(--ok)]" : "bg-[var(--line-2)] text-text-tertiary",
        )}
      >
        {done ? <Check className="h-2.5 w-2.5" /> : <Clock className="h-2.5 w-2.5" />}
      </span>
      <span className="min-w-0 truncate font-medium text-text-primary" title={line.label}>
        {line.label}
      </span>
      {detail ? (
        <span className="hidden min-w-0 truncate text-[11px] text-text-tertiary sm:inline" title={detail}>
          {detail}
        </span>
      ) : null}
      {parcela ? (
        <span className="shrink-0 rounded-md bg-[var(--info-light)] px-1.5 text-[10.5px] font-medium text-[var(--info,#2563eb)]">
          Instalment
        </span>
      ) : null}
      <span
        className={cn(
          "ml-auto shrink-0 text-[11px] tabular-nums",
          atrasada ? "font-medium text-[var(--bad,#dc2626)]" : "text-text-tertiary",
        )}
      >
        {atrasada ? `Late · ${dia(line.dueYmd)}` : dia(line.dueYmd)}
      </span>
      <span
        className={cn(
          "w-[84px] shrink-0 text-right font-semibold tabular-nums",
          tone === "in" ? "text-[var(--ok)]" : "text-text-primary",
        )}
      >
        {formatCurrency(line.amount)}
      </span>
    </li>
  );
}

function Grupo({
  title,
  lines,
  done,
  tone,
  empty,
}: {
  title: string;
  lines: CashflowBreakdownLine[];
  done: boolean;
  tone: "in" | "out";
  empty?: string;
}) {
  if (lines.length === 0 && !empty) return null;
  return (
    <div>
      <div className="flex items-center justify-between bg-surface-hover/50 px-3 py-1.5 text-[11px] font-semibold text-text-secondary">
        <span>
          {title} <span className="font-normal text-text-tertiary">· {lines.length}</span>
        </span>
        <span className="tabular-nums">{formatCurrency(soma(lines))}</span>
      </div>
      {lines.length === 0 ? (
        <p className="m-0 px-3 py-2 text-[12px] text-text-tertiary">{empty}</p>
      ) : (
        <ul className="m-0 list-none divide-y divide-border-light/70 p-0">
          {lines.map((l) => (
            <Linha key={`${l.kind}-${l.id}`} line={l} done={done} tone={tone} />
          ))}
        </ul>
      )}
    </div>
  );
}

function Coluna({ title, hint, total, children }: { title: string; hint: string; total: number; children: ReactNode }) {
  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
        <h3 className="m-0 flex items-center gap-1.5 text-[13px] font-semibold text-text-primary">
          {title}
          <FixfyHintIcon text={hint} />
        </h3>
        <span className="text-[13px] font-bold tabular-nums text-text-primary">{formatCurrency(total)}</span>
      </div>
      <div className="max-h-[52vh] min-h-0 overflow-y-auto">{children}</div>
    </section>
  );
}

function Kpi({ label, value, tone }: { label: string; value: number; tone?: "ok" | "bad" }) {
  return (
    <div className="min-w-0">
      <p className="m-0 text-[11px] text-text-tertiary">{label}</p>
      <p
        className={cn(
          "m-0 text-[15px] font-bold tabular-nums",
          tone === "ok" ? "text-[var(--ok)]" : tone === "bad" ? "text-[var(--bad,#dc2626)]" : "text-text-primary",
        )}
      >
        {formatCurrency(value)}
      </p>
    </div>
  );
}

type Props = {
  open: boolean;
  onClose: () => void;
  view: RunwayViewMode;
  breakdown: CashflowWeekBreakdown | null;
  /** Entrou / vai entrar / saiu / vai sair do período. */
  detail?: RunwayPeriodDetail | null;
  openingBalance?: number;
  closingBalance?: number;
  onSaveOpeningBalance?: (weekStart: string, amount: number) => void | Promise<void>;
  savingOpeningBalance?: boolean;
};

export function CashflowWeekDetailModal({
  open,
  onClose,
  breakdown,
  detail,
  openingBalance,
  onSaveOpeningBalance,
  savingOpeningBalance,
}: Props) {
  const [openingDraft, setOpeningDraft] = useState("");
  const [editingOpening, setEditingOpening] = useState(false);

  useEffect(() => {
    setOpeningDraft(openingBalance === undefined ? "" : String(openingBalance));
    setEditingOpening(false);
  }, [open, openingBalance, breakdown?.weekStart]);

  const received = detail?.received ?? [];
  const expectedIn = detail?.expectedIn ?? [];
  const paidOut = detail?.paidOut ?? [];
  const dueOut = detail?.dueOut ?? [];
  const totalIn = soma(received) + soma(expectedIn);
  const totalOut = soma(paidOut) + soma(dueOut);
  const net = Math.round((totalIn - totalOut) * 100) / 100;
  const opening = Number(openingBalance ?? 0);
  const closing = Math.round((opening + net) * 100) / 100;

  const porTipo = (lines: CashflowBreakdownLine[], kind: CashflowBreakdownLine["kind"]) => lines.filter((l) => l.kind === kind);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={breakdown?.title ?? "Period"}
      size="lg"
      className="max-w-6xl"
    >
      <div className="flex flex-col gap-4 px-4 py-4 sm:px-6 sm:py-5">
        {/* Resumo do período: caixa de abertura, entra, sai, líquido e fechamento. */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-xl border border-border bg-surface-hover/30 px-4 py-3 sm:grid-cols-5">
          <div className="min-w-0">
            <p className="m-0 flex items-center gap-1 text-[11px] text-text-tertiary">
              Opening balance
              <FixfyHintIcon text="Money in the bank at the start of the period. Click to edit; the next periods carry it forward." />
            </p>
            {editingOpening && breakdown && onSaveOpeningBalance ? (
              <div className="mt-0.5 flex items-center gap-1.5">
                <Input
                  type="number"
                  step="0.01"
                  value={openingDraft}
                  onChange={(e) => setOpeningDraft(e.target.value)}
                  className="h-7 w-28 text-[13px]"
                  autoFocus
                />
                <Button
                  type="button"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  loading={savingOpeningBalance}
                  onClick={() => {
                    const n = Number(openingDraft);
                    if (!Number.isFinite(n)) return;
                    void Promise.resolve(onSaveOpeningBalance(breakdown.weekStart, Math.round(n * 100) / 100)).then(() =>
                      setEditingOpening(false),
                    );
                  }}
                >
                  Save
                </Button>
              </div>
            ) : (
              <button
                type="button"
                disabled={!onSaveOpeningBalance}
                onClick={() => setEditingOpening(true)}
                className="m-0 text-[15px] font-bold tabular-nums text-text-primary underline decoration-dotted decoration-text-tertiary underline-offset-4 disabled:no-underline"
              >
                {formatCurrency(opening)}
              </button>
            )}
          </div>
          <Kpi label="Money in" value={totalIn} tone="ok" />
          <Kpi label="Money out" value={totalOut} />
          <Kpi label="Net" value={net} tone={net < 0 ? "bad" : "ok"} />
          <Kpi label="Closing balance" value={closing} tone={closing < 0 ? "bad" : undefined} />
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Coluna
            title="Money in"
            hint="Received: client payments dated in this period. Expected: open invoices and booked jobs due in it. A client paying in instalments only shows the instalment due in this period."
            total={totalIn}
          >
            <Grupo title="Received" lines={received} done tone="in" empty="Nothing received in this period yet." />
            <Grupo title="Expected" lines={expectedIn} done={false} tone="in" empty="Nothing else due in this period." />
          </Coluna>

          <Coluna
            title="Money out"
            hint="Paid: self-bills and bills paid in this period. To pay: partners, workforce, bills and payroll due in it. A partner paid in instalments only shows the instalment due in this period."
            total={totalOut}
          >
            <Grupo title="Paid" lines={paidOut} done tone="out" />
            <Grupo title="Partners" lines={porTipo(dueOut, "self_bill")} done={false} tone="out" />
            <Grupo title="Workforce" lines={porTipo(dueOut, "payroll")} done={false} tone="out" />
            <Grupo title="Bills" lines={porTipo(dueOut, "expense")} done={false} tone="out" />
            {paidOut.length === 0 && dueOut.length === 0 ? (
              <p className="m-0 px-3 py-6 text-center text-[12px] text-text-tertiary">Nothing going out in this period.</p>
            ) : null}
          </Coluna>
        </div>
      </div>
    </Modal>
  );
}
