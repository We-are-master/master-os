"use client";

import { useEffect, useState, type ComponentType } from "react";
import { BellRing, CreditCard, FileText, MessageCircle, Receipt, Star } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { FixfyHintIcon } from "@/components/ui/fixfy-hint-icon";
import { updateAccount } from "@/services/accounts";
import type { Account } from "@/types/database";

/**
 * Interruptores do que a conta recebe automaticamente. Cada um é uma coluna
 * de `accounts` que o código de envio JÁ lê (nada novo aqui, só a tela):
 *   email_include_report_on_final / email_include_invoice_on_final → e-mail de conclusão
 *   client_confirmation_whatsapp → confirmação, remarcação e véspera no WhatsApp
 *   client_feedback_whatsapp → pedido de feedback no dia seguinte
 *   overdue_reminders → lembretes de fatura vencida
 *   collection_mode → cartão adiantado ou fatura
 * Salva na hora, uma coluna por clique.
 */
type Flags = {
  email_include_report_on_final: boolean;
  email_include_invoice_on_final: boolean;
  client_confirmation_whatsapp: boolean;
  client_feedback_whatsapp: boolean;
  overdue_reminders: boolean;
  card_upfront: boolean;
};

function readFlags(a: Account): Flags {
  const r = a as unknown as Record<string, unknown>;
  return {
    email_include_report_on_final: r.email_include_report_on_final !== false,
    email_include_invoice_on_final: r.email_include_invoice_on_final !== false,
    // NULL = nunca decidido; o envio trata como desligado.
    client_confirmation_whatsapp: r.client_confirmation_whatsapp === true,
    client_feedback_whatsapp: r.client_feedback_whatsapp === true,
    overdue_reminders: r.overdue_reminders !== false,
    card_upfront: r.collection_mode === "card_upfront",
  };
}

type Row = {
  key: keyof Flags;
  icon: ComponentType<{ className?: string }>;
  label: string;
  hint: string;
};

const ROWS: { group: string; rows: Row[] }[] = [
  {
    group: "When the job is done",
    rows: [
      {
        key: "email_include_report_on_final",
        icon: FileText,
        label: "Send the job report",
        hint: "The completion email carries the report PDFs (photos, notes, sign-off). Goes out at final check, to the client or to the account's finance email depending on Billing.",
      },
      {
        key: "email_include_invoice_on_final",
        icon: Receipt,
        label: "Send the invoice",
        hint: "The completion email carries our invoice and the pay link. Turn off when the account pays through its own self-bill. With report and invoice both off, no completion email goes out.",
      },
    ],
  },
  {
    group: "Clients under this account",
    rows: [
      {
        key: "client_confirmation_whatsapp",
        icon: MessageCircle,
        label: "WhatsApp confirmations",
        hint: "The end client gets a WhatsApp when the job is booked with a partner, when it is rescheduled, and the evening before. Needs a partner assigned and the client's phone.",
      },
      {
        key: "client_feedback_whatsapp",
        icon: Star,
        label: "WhatsApp feedback request",
        hint: "The day after the job, the end client is asked how it went. Fixfy direct clients always get it; this switch is for clients of other accounts.",
      },
    ],
  },
  {
    group: "Payment",
    rows: [
      {
        key: "card_upfront",
        icon: CreditCard,
        label: "Card upfront",
        hint: "On: 50% deposit to book and the rest charged to the saved card at final check. Off: invoice after the job, due by the payment terms.",
      },
      {
        key: "overdue_reminders",
        icon: BellRing,
        label: "Overdue reminders",
        hint: "Emails on days 1, 3, 4 and 7 after an invoice is overdue, to the billing contact and the invoice copies. Only for invoices that were actually sent.",
      },
    ],
  },
];

export function AccountAutomations({
  account,
  canEdit,
  onSaved,
}: {
  account: Account;
  canEdit: boolean;
  /** Conta já salva, com a coluna nova. Quem chama sincroniza o próprio estado. */
  onSaved: (next: Account, changed: Partial<Flags>) => void;
}) {
  const [flags, setFlags] = useState<Flags>(() => readFlags(account));
  const [busy, setBusy] = useState<keyof Flags | null>(null);

  useEffect(() => {
    setFlags(readFlags(account));
  }, [account]);

  const toggle = async (key: keyof Flags) => {
    if (!canEdit || busy) return;
    const value = !flags[key];
    setFlags((f) => ({ ...f, [key]: value }));
    setBusy(key);
    try {
      const patch: Partial<Account> & Record<string, unknown> =
        key === "card_upfront" ? { collection_mode: value ? "card_upfront" : "invoice" } : { [key]: value };
      const next = await updateAccount(account.id, patch as Partial<Account>);
      onSaved(next, { [key]: value });
    } catch (e) {
      setFlags((f) => ({ ...f, [key]: !value }));
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(null);
    }
  };

  const bothEmailOff = !flags.email_include_report_on_final && !flags.email_include_invoice_on_final;

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-1.5">
        <h3 className="m-0 text-[14px] font-semibold text-text-primary">Automations</h3>
        <FixfyHintIcon text="What goes out by itself for this account. Each switch saves straight away." />
      </div>
      <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {ROWS.map((g) => (
          <div key={g.group} className="min-w-0">
            <p className="m-0 mb-1.5 text-[11px] font-medium text-text-tertiary">{g.group}</p>
            <div className="divide-y divide-border/60 rounded-lg border border-border">
              {g.rows.map((r) => {
                const on = flags[r.key];
                const Icon = r.icon;
                return (
                  <div key={r.key} className="flex items-center gap-2 px-2.5 py-2">
                    <Icon className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
                    <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-text-primary" title={r.label}>{r.label}</span>
                    <FixfyHintIcon text={r.hint} />
                    <button
                      type="button"
                      role="switch"
                      aria-checked={on}
                      aria-label={r.label}
                      disabled={!canEdit || busy !== null}
                      onClick={() => void toggle(r.key)}
                      className={cn(
                        "relative h-4 w-7 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                        on ? "bg-[var(--ok)]" : "bg-[var(--line-2)]",
                      )}
                    >
                      <span
                        className={cn(
                          "absolute left-0.5 top-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform",
                          on && "translate-x-3",
                        )}
                      />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      {bothEmailOff ? (
        <p className="m-0 mt-3 rounded-lg bg-[var(--warning-light)] px-2.5 py-1.5 text-[12px] text-[var(--warn-ink)]">
          Report and invoice are both off, so no completion email goes out for this account.
        </p>
      ) : null}
    </section>
  );
}
