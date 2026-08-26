"use client";

import { Crown, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDashboardDateRange } from "@/hooks/use-dashboard-date-range";
import { LiveIndicator } from "@/components/fx/primitives";
import { usePulseMoney } from "@/lib/pulse-currency";
import { DateRangeFilter } from "@/components/shared/date-range-filter";
import type { DateFilterMode, DateFilterValue } from "@/lib/date-range-filter";
import type { DateRangePreset } from "@/lib/dashboard-date-range";

type Props = {
  firstName: string;
  todaysJobsCount?: number;
  ceoMode: boolean;
  canSeeCeo: boolean;
  onToggleCeo: (v: boolean) => void;
};

/** Shared-filter ↔ dashboard-preset mapping. The provider keeps its broader preset
 * vocabulary (7d/30d/ytd/all) for legacy callers; this just bridges the 6 user-facing modes. */
const SHARED_TO_PRESET: Record<DateFilterMode, DateRangePreset> = {
  all: "all",
  today: "1d",
  yesterday: "yesterday",
  tomorrow: "tomorrow",
  week: "wtd",
  next_week: "next_week",
  month: "mtd",
  last_month: "last_month",
  next_month: "next_month",
  qtd: "qtd",
  custom: "custom",
};

const PRESET_TO_SHARED: Partial<Record<DateRangePreset, DateFilterMode>> = {
  all: "all",
  "1d": "today",
  yesterday: "yesterday",
  tomorrow: "tomorrow",
  wtd: "week",
  mtd: "month",
  last_month: "last_month",
  next_month: "next_month",
  qtd: "qtd",
  custom: "custom",
};

export function PulseHead({ firstName, todaysJobsCount, ceoMode, canSeeCeo, onToggleCeo }: Props) {
  const { preset, setPreset, customFrom, customTo, setCustomFrom, setCustomTo } = useDashboardDateRange();
  const greeting = getGreeting();
  const today = new Date();

  // Legacy presets (7d/30d/90d/ytd/all) fall through to "today" in the shared chip strip —
  // those callers still set them programmatically via the older toolbar, this UI just won't highlight one.
  const sharedValue: DateFilterValue = {
    mode: PRESET_TO_SHARED[preset] ?? "today",
    customFrom,
    customTo,
  };

  const applyShared = (next: DateFilterValue) => {
    setPreset(SHARED_TO_PRESET[next.mode]);
    if (next.mode === "custom") {
      setCustomFrom(next.customFrom ?? "");
      setCustomTo(next.customTo ?? "");
    }
  };

  return (
    <div className="flex items-end justify-between gap-6 flex-wrap">
      <div className="flex flex-col gap-1 min-w-0">
        <h1 className="text-[26px] font-semibold tracking-[-0.015em] leading-[1.2] text-text-primary m-0">
          {greeting}, {firstName}.
        </h1>
        <p className="text-[13px] text-fx-mute m-0">
          {formatLongDate(today)}
          {typeof todaysJobsCount === "number" && (
            <> · {todaysJobsCount} active job{todaysJobsCount === 1 ? "" : "s"} today.</>
          )}
        </p>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <DateRangeFilter value={sharedValue} onChange={applyShared} />
        {canSeeCeo && (
          <button
            type="button"
            onClick={() => onToggleCeo(!ceoMode)}
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-[7px] rounded-md text-[13px] font-medium border transition-colors",
              ceoMode
                ? "bg-fx-navy text-white border-fx-navy"
                : "bg-card text-text-secondary border-fx-line hover:bg-fx-paper",
            )}
            title="CEO financial dashboard"
          >
            <Crown className="h-3.5 w-3.5" />
            CEO
          </button>
        )}
        <CurrencyToggle />
        <button
          type="button"
          className="inline-flex h-[33px] w-[33px] items-center justify-center rounded-md border border-fx-line bg-card text-text-primary transition-colors hover:bg-fx-paper"
          title="Export"
          aria-label="Export"
        >
          <Download className="h-3.5 w-3.5" />
        </button>
        <LiveIndicator />
      </div>
    </div>
  );
}

/** Libra é a moeda do negócio; real é só a lente de leitura desta tela. */
function CurrencyToggle() {
  const { currency, toggle, rate, rateSource } = usePulseMoney();
  const title =
    currency === "GBP"
      ? `Ver em real (£1 = R$ ${rate.toFixed(2)}${rateSource === "fallback" ? ", cotação de referência" : ""})`
      : `Voltar para libra (£1 = R$ ${rate.toFixed(2)}${rateSource === "fallback" ? ", cotação de referência" : ""})`;
  return (
    <button
      type="button"
      onClick={toggle}
      title={title}
      aria-label={title}
      className={cn(
        "inline-flex h-[33px] w-[33px] items-center justify-center rounded-md border text-[13px] font-semibold transition-colors",
        currency === "BRL"
          ? "border-fx-navy bg-fx-navy text-white"
          : "border-fx-line bg-card text-text-primary hover:bg-fx-paper",
      )}
    >
      {currency === "GBP" ? "£" : "R$"}
    </button>
  );
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function formatLongDate(d: Date): string {
  return d.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}
