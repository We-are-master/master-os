import { getServerSupabase } from "@/lib/supabase/server-cached";
import type { AccountProperty, AccountPropertyDocument, AuditLog, Client } from "@/types/database";

export type AccountPropertyRequestRow = {
  id: string;
  reference: string;
  status: string;
  service_type: string;
  created_at: string;
};

export type AccountPropertyJobRow = {
  id: string;
  reference: string;
  title: string;
  status: string;
  partner_name: string | null;
  created_at: string;
};

export type PartnerComplianceRow = {
  id: string;
  company_name: string;
  compliance_score: number | null;
};

export type AccountPropertyDetailBundle = {
  property: AccountProperty;
  account: { id: string; company_name: string };
  primaryContact: Client | null;
  accountContacts: Client[];
  requests: AccountPropertyRequestRow[];
  jobs: AccountPropertyJobRow[];
  documents: AccountPropertyDocument[];
  audit: AuditLog[];
  partnerCompliance: PartnerComplianceRow[];
};

/**
 * Loads property + related rows for dashboard (staff) or portal (pass accountId to enforce scope).
 */
export async function fetchAccountPropertyDetailBundle(
  propertyId: string,
  options?: { accountId?: string },
): Promise<AccountPropertyDetailBundle | null> {
  const supabase = await getServerSupabase();
  const { data: propRaw, error: pErr } = await supabase
    .from("account_properties")
    .select("*")
    .eq("id", propertyId)
    .is("deleted_at", null)
    .maybeSingle();

  if (pErr || !propRaw) return null;
  const property = propRaw as AccountProperty;

  if (options?.accountId && property.account_id !== options.accountId) {
    return null;
  }

  const [{ data: account }, { data: contacts }, primaryRes] = await Promise.all([
    supabase.from("accounts").select("id, company_name").eq("id", property.account_id).maybeSingle(),
    supabase
      .from("clients")
      .select("*")
      .eq("source_account_id", property.account_id)
      .is("deleted_at", null)
      .order("full_name", { ascending: true }),
    property.primary_contact_id
      ? supabase.from("clients").select("*").eq("id", property.primary_contact_id).maybeSingle()
      : Promise.resolve({ data: null as Client | null, error: null }),
  ]);

  const accountRow = account as { id: string; company_name: string } | null;
  if (!accountRow) return null;

  const accountContacts = (contacts ?? []) as Client[];
  const primaryContact = (primaryRes as { data: Client | null }).data;

  const [{ data: requests }, { data: jobs }, { data: documents }, { data: audit }] = await Promise.all([
    supabase
      .from("service_requests")
      .select("id, reference, status, service_type, created_at")
      .eq("property_id", propertyId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("jobs")
      .select("id, reference, title, status, partner_name, created_at, partner_id")
      .eq("property_id", propertyId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("account_property_documents")
      .select("*")
      .eq("property_id", propertyId)
      .order("created_at", { ascending: false }),
    supabase
      .from("audit_logs")
      .select("*")
      .eq("entity_type", "property")
      .eq("entity_id", propertyId)
      .order("created_at", { ascending: false })
      .limit(80),
  ]);

  const jobRows = (jobs ?? []) as Array<AccountPropertyJobRow & { partner_id?: string | null }>;
  const partnerIds = [
    ...new Set(
      jobRows.map((j) => j.partner_id).filter((x): x is string => Boolean(x && String(x).trim())),
    ),
  ];

  let partnerCompliance: PartnerComplianceRow[] = [];
  if (partnerIds.length > 0) {
    const { data: parts } = await supabase
      .from("partners")
      .select("id, company_name, compliance_score")
      .in("id", partnerIds);
    partnerCompliance = ((parts ?? []) as PartnerComplianceRow[]) ?? [];
  }

  return {
    property,
    account: accountRow,
    primaryContact,
    accountContacts,
    requests: (requests ?? []) as AccountPropertyRequestRow[],
    jobs: jobRows.map(({ partner_id: _omit, ...j }) => j),
    documents: (documents ?? []) as AccountPropertyDocument[],
    audit: (audit ?? []) as AuditLog[],
    partnerCompliance,
  };
}
