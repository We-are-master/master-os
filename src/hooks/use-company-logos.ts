"use client";

import { useEffect, useState } from "react";
import { getCompanySettings } from "@/services/company";
import { setAppCurrencyCode } from "@/lib/utils";

export type CompanyLogosState = {
  loading: boolean;
  companyName: string;
  /** PDF / email logo — fallback for app if theme logos unset */
  logoUrl?: string;
  logoLightThemeUrl?: string;
  logoDarkThemeUrl?: string;
};

const empty: CompanyLogosState = {
  loading: true,
  companyName: "",
  logoUrl: undefined,
  logoLightThemeUrl: undefined,
  logoDarkThemeUrl: undefined,
};

/**
 * Loads `company_settings` logo fields for the app shell (sidebar, etc.).
 */
export function useCompanyLogos(): CompanyLogosState {
  const [state, setState] = useState<CompanyLogosState>(empty);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const s = await getCompanySettings();
        if (!alive) return;
        if (!s) {
          setAppCurrencyCode("GBP");
          setState({ loading: false, companyName: "", logoUrl: undefined, logoLightThemeUrl: undefined, logoDarkThemeUrl: undefined });
          return;
        }
        setAppCurrencyCode(s.currency ?? "GBP");
        setState({
          loading: false,
          companyName: s.company_name ?? "",
          logoUrl: s.logo_url ?? undefined,
          logoLightThemeUrl: s.logo_light_theme_url ?? undefined,
          logoDarkThemeUrl: s.logo_dark_theme_url ?? undefined,
        });
      } catch {
        if (!alive) return;
        setAppCurrencyCode("GBP");
        setState({ loading: false, companyName: "", logoUrl: undefined, logoLightThemeUrl: undefined, logoDarkThemeUrl: undefined });
      }
    };
    void load();
    const onRefresh = () => void load();
    window.addEventListener("master-os-company-settings", onRefresh);
    return () => {
      alive = false;
      window.removeEventListener("master-os-company-settings", onRefresh);
    };
  }, []);

  return state;
}

/** Pick image URL for current resolved theme with sensible fallbacks. */
export function resolveAppLogoUrl(
  resolved: "light" | "dark",
  logos: Pick<CompanyLogosState, "logoUrl" | "logoLightThemeUrl" | "logoDarkThemeUrl">
): string | undefined {
  if (resolved === "dark") {
    return logos.logoDarkThemeUrl || logos.logoLightThemeUrl || logos.logoUrl;
  }
  return logos.logoLightThemeUrl || logos.logoDarkThemeUrl || logos.logoUrl;
}
