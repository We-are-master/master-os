"use client";

import { useEffect, useMemo, useState } from "react";
import { listBusinessUnits } from "@/services/teams";
import { getClientIdsForBu } from "@/services/business-units";
import type { BusinessUnit } from "@/types/database";

interface UseBuFilterResult {
  /** All BUs loaded from the DB. */
  bus: BusinessUnit[];
  /** Currently-selected BU id, or null for "all". */
  selectedBuId: string | null;
  /** Setter for the current selection. */
  setSelectedBuId: (id: string | null) => void;
  /**
   * Whether the filter dropdown should render. Follows the product rule
   * "only show when there are 2+ BUs" so single-BU orgs don't see noise.
   */
  visible: boolean;
  /**
   * Set of client ids whose account belongs to the selected BU. Null when
   * no BU is selected (meaning "no filter"). Undefined while loading.
   */
  clientIdsInBu: Set<string> | null | undefined;
  /** True while the BU list or account-id set is being loaded. */
  loading: boolean;
}

export function useBuFilter(): UseBuFilterResult {
  const [bus, setBus] = useState<BusinessUnit[]>([]);
  const [selectedBuId, setSelectedBuId] = useState<string | null>(null);
  const [clientIds, setClientIds] = useState<Set<string> | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  // Load BU list on mount
  useEffect(() => {
    let cancelled = false;
    listBusinessUnits()
      .then((rows) => {
        if (!cancelled) setBus(rows);
      })
      .catch((err) => console.error("[useBuFilter] list error:", err))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Resolve client IDs whose account is in the selected BU
  useEffect(() => {
    if (!selectedBuId) {
      setClientIds(undefined);
      return;
    }
    let cancelled = false;
    getClientIdsForBu(selectedBuId)
      .then((ids) => {
        if (!cancelled) setClientIds(ids);
      })
      .catch((err) => console.error("[useBuFilter] clientIds error:", err));
    return () => {
      cancelled = true;
    };
  }, [selectedBuId]);

  const visible = useMemo(() => bus.length >= 2, [bus.length]);
  const clientIdsInBu = selectedBuId ? clientIds ?? undefined : null;

  return { bus, selectedBuId, setSelectedBuId, visible, clientIdsInBu, loading };
}
