"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getCompanySettings } from "@/services/company";
import {
  biddingSlaMsFromHours,
  parseFrontendSetup,
  type FrontendSetup,
  resolveBiddingSlaHours,
  resolveJobOnHoldPresets,
  resolveOfficeJobCancellationPresets,
  resolveAccessFees,
  resolveMarginThresholds,
  resolvePartnerDocumentRules,
  resolvePartnerPayoutStandardTerms,
  type AccessFees,
  type MarginThresholds,
} from "@/lib/frontend-setup";

export function useFrontendSetup() {
  const [loading, setLoading] = useState(true);
  const [setup, setSetup] = useState<FrontendSetup>(() => parseFrontendSetup(null));

  const load = useCallback(async () => {
    try {
      const row = await getCompanySettings();
      setSetup(parseFrontendSetup(row?.frontend_setup));
    } catch {
      setSetup(parseFrontendSetup(null));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const on = () => void load();
    window.addEventListener("master-os-company-settings", on);
    return () => window.removeEventListener("master-os-company-settings", on);
  }, [load]);

  const biddingSlaHours = resolveBiddingSlaHours(setup);
  const biddingSlaMs = useMemo(() => biddingSlaMsFromHours(biddingSlaHours), [biddingSlaHours]);
  const jobOnHoldPresets = useMemo(() => resolveJobOnHoldPresets(setup), [setup]);
  const officeCancellationPresets = useMemo(() => resolveOfficeJobCancellationPresets(setup), [setup]);
  const marginThresholds = useMemo<MarginThresholds>(() => resolveMarginThresholds(setup), [setup]);
  const accessFees = useMemo<AccessFees>(() => resolveAccessFees(setup), [setup]);
  const partnerDocumentRules = useMemo(() => resolvePartnerDocumentRules(setup), [setup]);
  const partnerPayoutStandardTerms = useMemo(() => resolvePartnerPayoutStandardTerms(setup), [setup]);

  return {
    loading,
    setup,
    biddingSlaHours,
    biddingSlaMs,
    jobOnHoldPresets,
    officeCancellationPresets,
    marginThresholds,
    accessFees,
    partnerDocumentRules,
    partnerPayoutStandardTerms,
    refetch: load,
  };
}
