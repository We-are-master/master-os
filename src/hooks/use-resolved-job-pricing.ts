"use client";

import { useEffect, useState } from "react";
import { getSupabase } from "@/services/base";
import { getAccountServicePrice } from "@/services/account-service-prices";
import { getPartnerServicePrice } from "@/services/partner-service-prices";
import { resolveJobPricing, type ResolvedJobPricing } from "@/lib/job-pricing-resolver";
import type { CatalogService } from "@/types/database";

/**
 * Resolves auto-fill prices for the (account, partner, catalogService) triple
 * by combining the catalog row with optional account / partner overrides
 * (migs 159 + 160).
 *
 * Returns `pricing: null` while ANY of the inputs is missing or while the
 * fetch is in flight. Caller should refrain from auto-filling until the
 * value resolves to non-null.
 *
 * Re-runs whenever any of the three IDs change.
 */
export function useResolvedJobPricing(input: {
  accountId?: string | null;
  partnerId?: string | null;
  catalogServiceId?: string | null;
}): {
  pricing: ResolvedJobPricing | null;
  loading: boolean;
  catalog: CatalogService | null;
} {
  const [pricing, setPricing] = useState<ResolvedJobPricing | null>(null);
  const [loading, setLoading] = useState(false);
  const [catalog, setCatalog] = useState<CatalogService | null>(null);

  const accountId = input.accountId?.trim() || null;
  const partnerId = input.partnerId?.trim() || null;
  const catalogServiceId = input.catalogServiceId?.trim() || null;

  useEffect(() => {
    if (!catalogServiceId) {
      setPricing(null);
      setCatalog(null);
      return;
    }
    let cancelled = false;
    // Clear stale pricing immediately on triple change so consumer effects
    // (which look at `pricing`) don't apply a previous service's values to
    // the new triple. The next fetch fills it in.
    setPricing(null);
    setLoading(true);
    const supabase = getSupabase();

    (async () => {
      try {
        const { data: catRow, error: catErr } = await supabase
          .from("service_catalog")
          .select("*")
          .eq("id", catalogServiceId)
          .is("deleted_at", null)
          .maybeSingle();
        if (catErr) throw catErr;
        if (!catRow) {
          if (!cancelled) {
            setPricing(null);
            setCatalog(null);
          }
          return;
        }
        const catalogRow = catRow as CatalogService;

        const [accountOverride, partnerOverride] = await Promise.all([
          accountId ? getAccountServicePrice(accountId, catalogServiceId).catch(() => null) : Promise.resolve(null),
          partnerId ? getPartnerServicePrice(partnerId, catalogServiceId).catch(() => null) : Promise.resolve(null),
        ]);

        if (cancelled) return;
        const resolved = resolveJobPricing({
          catalog: catalogRow,
          accountOverride,
          partnerOverride,
        });
        setCatalog(catalogRow);
        setPricing(resolved);
      } catch {
        if (!cancelled) {
          setPricing(null);
          setCatalog(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [accountId, partnerId, catalogServiceId]);

  return { pricing, loading, catalog };
}
