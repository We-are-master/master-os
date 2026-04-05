"use client";

import {
  createContext,
  useCallback,
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
  PRESET_OPTIONS,
} from "@/lib/dashboard-date-range";

/** Bump when default preset should reset for all users (e.g. default = All time). */
const PRESET_STORAGE_KEY = "master-os-dashboard-date-preset-v7";

function readStoredPreset(): DateRangePreset {
  if (typeof window === "undefined") return "all";
  try {
    const v = localStorage.getItem(PRESET_STORAGE_KEY);
    if (v && PRESET_OPTIONS.some((o) => o.id === v)) return v as DateRangePreset;
  } catch {
    /* ignore */
  }
  return "all";
}

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
  const [preset, setPresetState] = useState<DateRangePreset>(() => readStoredPreset());
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const setPreset = useCallback((p: DateRangePreset) => {
    setPresetState(p);
    try {
      localStorage.setItem(PRESET_STORAGE_KEY, p);
    } catch {
      /* ignore */
    }
  }, []);

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
