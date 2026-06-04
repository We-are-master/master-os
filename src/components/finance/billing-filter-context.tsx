"use client";

import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_BILLING_CREATED_AT_FILTER,
  type BillingCreatedAtFilterValue,
} from "@/lib/billing-created-at-filter";

type BillingFilterContextValue = {
  filter: BillingCreatedAtFilterValue;
  setFilter: (next: BillingCreatedAtFilterValue) => void;
};

const BillingFilterContext = createContext<BillingFilterContextValue | null>(null);

type BillingActionsContextValue = {
  actions: ReactNode;
  setActions: (node: ReactNode) => void;
};

const BillingActionsContext = createContext<BillingActionsContextValue | null>(null);

export function BillingFilterProvider({ children }: { children: ReactNode }) {
  const [filter, setFilter] = useState<BillingCreatedAtFilterValue>(DEFAULT_BILLING_CREATED_AT_FILTER);
  const [actions, setActions] = useState<ReactNode>(null);

  const filterValue = useMemo(() => ({ filter, setFilter }), [filter]);
  const actionsValue = useMemo(() => ({ actions, setActions }), [actions, setActions]);

  return (
    <BillingFilterContext.Provider value={filterValue}>
      <BillingActionsContext.Provider value={actionsValue}>{children}</BillingActionsContext.Provider>
    </BillingFilterContext.Provider>
  );
}

export function useBillingCreatedAtFilter(): BillingFilterContextValue {
  const ctx = useContext(BillingFilterContext);
  if (!ctx) {
    throw new Error("useBillingCreatedAtFilter must be used within BillingFilterProvider");
  }
  return ctx;
}

export function useBillingHeaderActions(): ReactNode {
  const ctx = useContext(BillingActionsContext);
  return ctx?.actions ?? null;
}

/** Mount in each billing sub-page; buttons render in the shared layout header. */
export function BillingPageActions({ children }: { children: ReactNode }) {
  const setActions = useContext(BillingActionsContext)?.setActions;
  useLayoutEffect(() => {
    if (!setActions) return;
    setActions(children);
    return () => setActions(null);
  }, [children, setActions]);
  return null;
}
