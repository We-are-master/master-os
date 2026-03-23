"use client";

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  type DateRangePreset,
  type DashboardDateBounds,
  getBoundsForPreset,
  formatRangeHint,
} from "@/lib/dashboard-date-range";

interface DashboardDateRangeContextValue {
  preset: DateRangePreset;
  setPreset: (p: DateRangePreset) => void;
  customFrom: string;
  customTo: string;
  setCustomFrom: (v: string) => void;
  setCustomTo: (v: string) => void;
  /** null = no date filter */
  bounds: DashboardDateBounds | null;
  rangeLabel: string;
}

const Ctx = createContext<DashboardDateRangeContextValue | null>(null);

export function DashboardDateRangeProvider({ children }: { children: ReactNode }) {
  const [preset, setPreset] = useState<DateRangePreset>("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const bounds = useMemo(
    () => getBoundsForPreset(preset, customFrom, customTo),
    [preset, customFrom, customTo]
  );

  const rangeLabel = useMemo(() => formatRangeHint(bounds), [bounds]);

  const value = useMemo(
    () => ({
      preset,
      setPreset,
      customFrom,
      customTo,
      setCustomFrom,
      setCustomTo,
      bounds,
      rangeLabel,
    }),
    [preset, customFrom, customTo, bounds, rangeLabel]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDashboardDateRange(): DashboardDateRangeContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error("useDashboardDateRange must be used inside DashboardDateRangeProvider");
  }
  return ctx;
}

/** For widgets that may render outside the dashboard (returns null = all time). */
export function useDashboardDateRangeOptional(): DashboardDateRangeContextValue | null {
  return useContext(Ctx);
}
