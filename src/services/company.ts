import { getSupabase } from "./base";
import type { CompanyBranding } from "@/lib/pdf/quote-template";

export interface CompanySettings {
  id: string;
  company_name: string;
  logo_url?: string;
  /** Sidebar / app chrome when theme is light */
  logo_light_theme_url?: string | null;
  /** Sidebar / app chrome when theme is dark */
  logo_dark_theme_url?: string | null;
  /** Browser tab icon (.ico / .png / .svg URL) */
  favicon_url?: string | null;
  address: string;
  phone: string;
  email: string;
  website?: string;
  vat_number?: string;
  vat_percent?: number;
  primary_color?: string;
  tagline?: string;
  quote_footer_notes?: string;
  invoice_footer_notes?: string;
  /** Admin: show Master Brain floating assistant */
  master_brain_enabled?: boolean;
  master_brain_manager_enabled?: boolean;
  master_brain_operator_enabled?: boolean;
  master_brain_manager_instructions?: string | null;
  master_brain_operator_instructions?: string | null;
  /** Admin: cron-driven morning/evening e-mails */
  daily_brief_enabled?: boolean;
  daily_brief_morning_time?: string;
  daily_brief_evening_time?: string;
  daily_brief_timezone?: string;
  daily_brief_emails?: string;
  /** ISO 4217 — KPIs and UI amounts (Settings → Preferences). */
  currency?: string | null;
  /** Fee applied when a partner cancels a job from the app (GBP). */
  partner_cancellation_fee_gbp?: number | null;
  /** Overview dashboard: monthly pipeline target (GBP), scaled to the selected period. */
  dashboard_sales_goal_monthly?: number | null;
  /**
   * Partner directory: requirement ids excluded from document compliance score (e.g. `public_liability`).
   * Configured in Settings → System (admin).
   */
  compliance_score_excluded_doc_ids?: string[] | null;
  updated_at: string;
}

export async function getCompanySettings(): Promise<CompanySettings | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("company_settings")
    .select("*")
    .limit(1)
    .single();
  if (error) return null;
  return data as CompanySettings;
}

export async function updateCompanySettings(updates: Partial<CompanySettings>): Promise<CompanySettings> {
  const supabase = getSupabase();
  const current = await getCompanySettings();
  if (!current) throw new Error("No company settings found");
  const { data, error } = await supabase
    .from("company_settings")
    .update(updates)
    .eq("id", current.id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as CompanySettings;
}

export function settingsToBranding(s: CompanySettings): CompanyBranding {
  return {
    companyName: s.company_name,
    logoUrl: s.logo_url ?? undefined,
    address: s.address,
    phone: s.phone,
    email: s.email,
    website: s.website ?? undefined,
    vatNumber: s.vat_number ?? undefined,
    primaryColor: s.primary_color ?? "#F97316",
    tagline: s.tagline ?? undefined,
  };
}
