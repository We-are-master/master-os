"use client";

import { CreditCard, ShieldCheck } from "lucide-react";
import { formatDate } from "@/lib/utils";

/**
 * Cartão salvo do cliente na ficha (15/10/2026).
 *
 * O cartão é guardado quando o cliente paga uma entrada pelo link do Stripe e aceita
 * guardar para o restante (Fase 0 de cobrança). Aqui só a bandeira, o final e a data:
 * o número fica no Stripe, nunca no OS.
 */
type CardFields = {
  card_brand?: string | null;
  card_last4?: string | null;
  card_saved_at?: string | null;
  card_consent_version?: string | null;
};

const BRAND_LABEL: Record<string, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "American Express",
  discover: "Discover",
  diners: "Diners Club",
  jcb: "JCB",
  unionpay: "UnionPay",
};

function brandLabel(brand: string | null | undefined): string {
  const b = String(brand ?? "").trim().toLowerCase();
  return BRAND_LABEL[b] ?? (b ? b.charAt(0).toUpperCase() + b.slice(1) : "Card");
}

export function ClientSavedCard({ client }: { client: CardFields }) {
  const last4 = String(client.card_last4 ?? "").trim();

  if (!last4) {
    return (
      <section className="rounded-xl border border-dashed border-border bg-surface-secondary px-4 py-3">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-tertiary text-text-tertiary">
            <CreditCard className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="m-0 text-[13px] font-semibold text-text-primary">No card on file</p>
            <p className="m-0 mt-0.5 text-[12px] text-text-tertiary">
              Saved when the client pays a deposit through the pay link and agrees to keep the card for the balance.
            </p>
          </div>
        </div>
      </section>
    );
  }

  const brand = brandLabel(client.card_brand);
  return (
    <section aria-label="Saved card" className="space-y-2">
      <p className="m-0 text-[12px] font-medium text-text-secondary">Saved card</p>
      <div className="flex flex-wrap items-center gap-4">
        {/* O cartão em miniatura: navy sólido, como os botões do OS. */}
        <div
          className="relative flex h-[104px] w-[168px] shrink-0 flex-col justify-between overflow-hidden rounded-xl bg-[#020040] p-3 text-white shadow-sm"
          role="img"
          aria-label={`${brand} ending ${last4}`}
        >
          <div className="flex items-center justify-between">
            <span className="h-5 w-7 rounded-[4px] bg-white/25" aria-hidden="true" />
            <span className="text-[11px] font-semibold tracking-wide">{brand}</span>
          </div>
          <p className="m-0 font-mono text-[15px] tracking-[0.18em] tabular-nums">•••• {last4}</p>
          <span className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-white/[0.06]" aria-hidden="true" />
        </div>
        <div className="min-w-0 space-y-1 text-[12px]">
          <p className="m-0 font-semibold text-text-primary">
            {brand} ending {last4}
          </p>
          {client.card_saved_at ? (
            <p className="m-0 text-text-secondary">Saved {formatDate(client.card_saved_at)}</p>
          ) : null}
          <p className="m-0 flex items-center gap-1 text-text-tertiary">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
            Kept by Stripe{client.card_consent_version ? ` · consent ${client.card_consent_version}` : ""}
          </p>
          <p className="m-0 text-text-tertiary">Used for the remaining balance when the job is approved.</p>
        </div>
      </div>
    </section>
  );
}
