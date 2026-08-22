"use client";

import { useCallback, useState } from "react";

/**
 * Whether a page shows its KPI strip. Hidden is the default: the numbers are a
 * check, not the work, and a page that opens on its list gets the operator to
 * the rows without scrolling past a wall of figures. The choice is per page and
 * remembered, so someone who wants the strip up keeps it up.
 */
export function useKpiVisibility(
  storageKey: string,
  opts?: {
    /** Pages whose numbers are the point (Accounts) can open with the strip up. */
    defaultVisible?: boolean;
  },
): {
  visible: boolean;
  toggle: () => void;
} {
  const fallback = opts?.defaultVisible ?? false;
  const [visible, setVisible] = useState<boolean>(() => {
    if (typeof window === "undefined") return fallback;
    try {
      const stored = window.localStorage.getItem(storageKey);
      return stored == null ? fallback : stored === "1";
    } catch {
      return fallback;
    }
  });

  const toggle = useCallback(() => {
    setVisible((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(storageKey, next ? "1" : "0");
      } catch {
        /* storage unavailable — the toggle just won't persist */
      }
      return next;
    });
  }, [storageKey]);

  return { visible, toggle };
}
