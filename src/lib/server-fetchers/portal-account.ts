import { getServerSupabase } from "@/lib/supabase/server-cached";

export interface PortalAccountSettings {
  id:             string;
  company_name:   string;
  contact_name:   string;
  email:          string;
  finance_email:  string | null;
  contact_number: string | null;
  address:        string | null;
  industry:       string;
  payment_terms:  string;
}

/**
 * Loads the editable account fields for the portal settings page.
 * Returns null if the account doesn't exist (caller should redirect).
 */
export async function fetchPortalAccount(accountId: string): Promise<PortalAccountSettings | null> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from("accounts")
    .select(`
      id, company_name, contact_name, email, finance_email,
      contact_number, address, industry, payment_terms
    `)
    .eq("id", accountId)
    .maybeSingle();

  if (error || !data) return null;
  return data as PortalAccountSettings;
}
