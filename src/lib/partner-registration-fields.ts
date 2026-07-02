/** Partner registration field rules — stored in company_settings.frontend_setup.partner_registration_rules. */

export type PartnerRegistrationRuleRow = {
  id: string;
  visible: boolean;
  mandatory: boolean;
};

export type PartnerRegistrationFieldGroup = "profile" | "onboarding_step" | "agreement";

export type PartnerRegistrationFieldDef = {
  id: string;
  name: string;
  description: string;
  group: PartnerRegistrationFieldGroup;
  /** Cannot be hidden (account creation). */
  locked?: boolean;
};

export const PARTNER_REGISTRATION_FIELD_CATALOG: PartnerRegistrationFieldDef[] = [
  { id: "trades", name: "Trades / services", description: "What work the partner offers (service catalog).", group: "profile" },
  { id: "legal_type", name: "Business type", description: "Sole trader vs limited company.", group: "profile" },
  { id: "tax_id", name: "UTR / CRN", description: "Tax or company registration number.", group: "profile" },
  { id: "vat", name: "VAT details", description: "VAT registered status and number (limited companies).", group: "profile" },
  { id: "phone", name: "Phone number", description: "Contact number for dispatch and ops.", group: "profile" },
  { id: "address", name: "Business address", description: "Street address and postcode.", group: "profile" },
  {
    id: "account",
    name: "Account (name, email, company)",
    description: "Required to create the Trade Portal login.",
    group: "profile",
    locked: true,
  },
  { id: "coverage", name: "Service area", description: "Base postcode and travel radius.", group: "profile" },
  { id: "avatar", name: "Profile photo", description: "Partner avatar in the portal.", group: "profile" },
  { id: "documents", name: "Documents", description: "Upload step in /get-started and onboarding.", group: "onboarding_step" },
  { id: "agreements", name: "Agreements (e-sign)", description: "Service and self-bill contract signatures.", group: "agreement" },
  { id: "rate_card", name: "Rate card", description: "Per-service pricing in onboarding.", group: "onboarding_step" },
  { id: "bank_details", name: "Bank / payouts", description: "Payout bank details or Stripe Connect.", group: "onboarding_step" },
  { id: "payment", name: "Payment method", description: "Card on file after trial.", group: "onboarding_step" },
];

const OPTIONAL_BY_DEFAULT = new Set(["rate_card", "bank_details", "payment", "avatar"]);

export function getPartnerRegistrationCatalogForSetup(): PartnerRegistrationFieldDef[] {
  return [...PARTNER_REGISTRATION_FIELD_CATALOG];
}

export function buildDefaultPartnerRegistrationRules(): PartnerRegistrationRuleRow[] {
  return PARTNER_REGISTRATION_FIELD_CATALOG.map((f) => ({
    id: f.id,
    visible: true,
    mandatory: f.locked ? true : !OPTIONAL_BY_DEFAULT.has(f.id),
  }));
}

export function mergePartnerRegistrationRules(stored: unknown): PartnerRegistrationRuleRow[] {
  const defaults = buildDefaultPartnerRegistrationRules();
  if (!Array.isArray(stored)) return defaults;
  const storedById = new Map<string, PartnerRegistrationRuleRow>();
  for (const row of stored) {
    if (row == null || typeof row !== "object") continue;
    const o = row as { id?: unknown; visible?: unknown; mandatory?: unknown; enabled?: unknown };
    if (typeof o.id !== "string" || !o.id.trim()) continue;
    const id = o.id.trim();
    const locked = PARTNER_REGISTRATION_FIELD_CATALOG.find((c) => c.id === id)?.locked;
    const visible = locked ? true : o.visible !== undefined ? Boolean(o.visible) : o.enabled !== undefined ? Boolean(o.enabled) : true;
    storedById.set(id, {
      id,
      visible,
      mandatory: locked ? true : visible && Boolean(o.mandatory),
    });
  }
  return defaults.map((d) => {
    const merged = storedById.get(d.id) ?? d;
    if (PARTNER_REGISTRATION_FIELD_CATALOG.find((c) => c.id === d.id)?.locked) {
      return { id: d.id, visible: true, mandatory: true };
    }
    return merged;
  });
}

export function resolvePartnerRegistrationRule(
  id: string,
  rules?: PartnerRegistrationRuleRow[] | null,
): { visible: boolean; mandatory: boolean } {
  const merged = rules ?? buildDefaultPartnerRegistrationRules();
  const row = merged.find((r) => r.id === id);
  const locked = PARTNER_REGISTRATION_FIELD_CATALOG.find((c) => c.id === id)?.locked;
  if (locked) return { visible: true, mandatory: true };
  if (row) return { visible: row.visible, mandatory: row.mandatory && row.visible };
  const def = buildDefaultPartnerRegistrationRules().find((r) => r.id === id);
  if (def) return { visible: def.visible, mandatory: def.mandatory && def.visible };
  return { visible: false, mandatory: false };
}

export function isPartnerRegistrationFieldVisible(id: string, rules?: PartnerRegistrationRuleRow[] | null): boolean {
  return resolvePartnerRegistrationRule(id, rules).visible;
}

export function isPartnerRegistrationFieldMandatory(id: string, rules?: PartnerRegistrationRuleRow[] | null): boolean {
  return resolvePartnerRegistrationRule(id, rules).mandatory;
}

/** Profile completeness item id → registration rule id. */
export const PROFILE_ITEM_TO_REGISTRATION_ID: Record<string, string> = {
  email: "account",
  phone: "phone",
  address: "address",
  coverage: "coverage",
  tax_id: "tax_id",
  vat: "vat",
  identity: "account",
};
