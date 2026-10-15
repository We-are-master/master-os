"use client";

import { useRef, useState, type ReactNode } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { getSupabase } from "@/services/base";
import { formatCurrencyPrecise } from "@/lib/utils";

type PaymentLike = {
  amount: number;
  payment_date: string;
  payment_method?: string | null;
  bank_reference?: string | null;
  note?: string | null;
  created_at?: string | null;
  created_by?: string | null;
};

type StripeDetail = {
  paidAtIso: string | null;
  cardBrand: string | null;
  cardLast4: string | null;
  feeGbp: number | null;
  netGbp: number | null;
  receiptUrl: string | null;
  customerEmail: string | null;
  refundedGbp: number | null;
  status: string | null;
};

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

const methodLabel = (m?: string | null) =>
  m === "stripe" ? "Stripe" : m === "bank_transfer" ? "Bank transfer" : m === "cash" ? "Cash" : m ? m : "Not set";

/**
 * Recebimento como link: ao passar o mouse, o relatório de onde veio, quando e
 * quem lançou. Stripe traz cartão, hora exata, taxa e recibo direto da Stripe.
 */
export function PaymentDetailHover({ payment, children }: { payment: PaymentLike; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [stripe, setStripe] = useState<StripeDetail | null>(null);
  const [stripeError, setStripeError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [byName, setByName] = useState<string | null>(null);
  const loaded = useRef(false);
  const anchor = useRef<HTMLSpanElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stripeRef = (payment.note ?? "").match(/\b(cs|pi)_[A-Za-z0-9_]+/)?.[0] ?? null;

  const load = async () => {
    if (loaded.current) return;
    loaded.current = true;
    if (payment.created_by) {
      void getSupabase()
        .from("profiles")
        .select("full_name")
        .eq("id", payment.created_by)
        .maybeSingle()
        .then(({ data }) => setByName((data as { full_name?: string | null } | null)?.full_name ?? null));
    }
    if (stripeRef) {
      setLoading(true);
      try {
        const res = await fetch(`/api/stripe/payment-detail?ref=${encodeURIComponent(stripeRef)}`);
        const body = await res.json();
        if (!res.ok) setStripeError(body?.error ?? "Could not reach Stripe");
        else setStripe(body as StripeDetail);
      } catch {
        setStripeError("Could not reach Stripe");
      } finally {
        setLoading(false);
      }
    }
  };

  const show = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    const r = anchor.current?.getBoundingClientRect();
    if (r) {
      const width = 288;
      setPos({ top: r.bottom + 6, left: Math.max(8, Math.min(window.innerWidth - width - 8, r.right - width)) });
    }
    setOpen(true);
    void load();
  };
  const hide = () => {
    hideTimer.current = setTimeout(() => setOpen(false), 120);
  };

  const rows: [string, ReactNode][] = [
    ["Source", stripeRef ? `Stripe · ${stripeRef.startsWith("cs_") ? "pay link" : "saved card"}` : methodLabel(payment.payment_method)],
    ["Amount", formatCurrencyPrecise(Math.abs(Number(payment.amount)))],
    ["Paid on", stripe?.paidAtIso ? when(stripe.paidAtIso) : payment.payment_date],
    ...(stripe?.cardLast4 ? ([["Card", `${(stripe.cardBrand ?? "card").toUpperCase()} •••• ${stripe.cardLast4}`]] as [string, ReactNode][]) : []),
    ...(stripe?.feeGbp != null ? ([["Stripe fee", `${formatCurrencyPrecise(stripe.feeGbp)} · net ${formatCurrencyPrecise(stripe.netGbp ?? 0)}`]] as [string, ReactNode][]) : []),
    ...(stripe?.refundedGbp ? ([["Refunded", formatCurrencyPrecise(stripe.refundedGbp)]] as [string, ReactNode][]) : []),
    ...(stripe?.customerEmail ? ([["Paid by", stripe.customerEmail]] as [string, ReactNode][]) : []),
    ...(payment.bank_reference ? ([["Reference", payment.bank_reference]] as [string, ReactNode][]) : []),
    ["Recorded", `${payment.created_at ? when(payment.created_at) : "—"} · ${stripeRef && !payment.created_by ? "automatic (Stripe)" : byName ?? (payment.created_by ? "…" : "system")}`],
    ...(payment.note ? ([["Note", payment.note]] as [string, ReactNode][]) : []),
  ];

  return (
    <span
      ref={anchor}
      className="relative inline"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      tabIndex={0}
    >
      <span className="cursor-help underline decoration-dotted decoration-text-tertiary underline-offset-2">{children}</span>
      {open ? (
        <span
          role="tooltip"
          onMouseEnter={show}
          onMouseLeave={hide}
          style={{ position: "fixed", top: pos.top, left: pos.left, width: 288 }}
          className="z-[80] block rounded-xl border border-border bg-card p-3 text-left shadow-lg"
        >
          <span className="mb-1.5 block text-[12px] font-semibold text-text-primary">Payment report</span>
          <span className="block space-y-1">
            {rows.map(([k, v]) => (
              <span key={k} className="flex gap-2 text-[11px] leading-snug">
                <span className="w-20 shrink-0 text-text-tertiary">{k}</span>
                <span className="min-w-0 break-words text-text-primary">{v}</span>
              </span>
            ))}
          </span>
          {loading ? (
            <span className="mt-2 flex items-center gap-1.5 text-[11px] text-text-tertiary">
              <Loader2 className="h-3 w-3 animate-spin" /> Checking Stripe
            </span>
          ) : null}
          {stripeError ? <span className="mt-2 block text-[11px] text-[var(--warn-ink)]">{stripeError}</span> : null}
          {stripe?.receiptUrl ? (
            <a
              href={stripe.receiptUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-[var(--info)] hover:underline"
            >
              Stripe receipt <ExternalLink className="h-3 w-3" />
            </a>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}
