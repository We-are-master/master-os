import type { PayrollInternalProfile } from "@/types/database";

export type ContractorEntityType = "individual" | "company";

export interface ContractorAgreementPerson {
  payee_name?: string | null;
  payroll_profile?: PayrollInternalProfile | Record<string, unknown> | null;
}

export const FIXFY_COMPANY_SIGNATORY_NAME = "Victor Souza";

export const CONTRACTOR_AGREEMENT_PLACEHOLDERS = {
  contractor_name: "{{contractor_name}}",
  tax_id: "{{tax_id}}",
  contractor_address: "{{contractor_address}}",
  country: "{{country}}",
  contractor_email: "{{contractor_email}}",
  contract_logo_html: "{{contract_logo_html}}",
  company_signature: "{{company_signature}}",
  company_signatory_name: "{{company_signatory_name}}",
  agreement_date: "{{agreement_date}}",
} as const;

export function formatContractAgreementDate(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/London",
  }).format(date);
}

export type ContractorAgreementRenderOptions = {
  agreementDate?: Date;
};

function asProfile(raw: ContractorAgreementPerson["payroll_profile"]): PayrollInternalProfile {
  if (!raw || typeof raw !== "object") return {};
  return raw as PayrollInternalProfile;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const UK_COUNTRY_ALIASES = new Set([
  "uk",
  "u.k.",
  "united kingdom",
  "great britain",
  "gb",
  "england",
  "scotland",
  "wales",
  "northern ireland",
]);

/** True when contractor operates from the UK (VAT / UTR rules apply). */
export function isUkWorkCountry(country: string | null | undefined): boolean {
  const normalized = country?.trim().toLowerCase() ?? "";
  if (!normalized) return false;
  if (UK_COUNTRY_ALIASES.has(normalized)) return true;
  return normalized.includes("united kingdom") || normalized === "britain";
}

export function buildContractorTaxId(profile: PayrollInternalProfile): string {
  const utr = profile.utr?.trim();
  const vat = profile.vat_number?.trim();
  const reg = profile.company_registration?.trim();
  if (profile.contractor_entity_type === "company") {
    const parts: string[] = [];
    if (reg) parts.push(reg);
    if (vat) parts.push(`VAT ${vat}`);
    if (utr) parts.push(`UTR ${utr}`);
    return parts.join(" · ") || "";
  }
  if (utr) return `UTR ${utr}`;
  if (vat) return `VAT ${vat}`;
  if (reg) return reg;
  return "";
}

/** Onboarding: country + address + one tax number (pre-filled from invite when possible). */
export function contractorFiscalComplete(profile: PayrollInternalProfile): boolean {
  const country = profile.country_of_operation?.trim();
  const address = profile.address?.trim();
  if (!country || !address) return false;
  return !!contractorTaxNumberFromProfile(profile);
}

/** Single tax field shown in admin drawer and invite for contractors. */
export function contractorTaxNumberFromProfile(profile: PayrollInternalProfile): string {
  return (
    profile.utr?.trim() ||
    profile.company_registration?.trim() ||
    profile.vat_number?.trim() ||
    ""
  );
}

/** Maps one tax input into the correct payroll_profile columns. */
export function applyContractorTaxNumberToProfile(
  profile: PayrollInternalProfile,
  taxNumber: string,
): PayrollInternalProfile {
  const value = taxNumber.trim();
  const next: PayrollInternalProfile = {
    ...profile,
    utr: undefined,
    vat_number: undefined,
    company_registration: undefined,
  };
  if (!value) return next;

  if (isUkWorkCountry(profile.country_of_operation)) {
    if (profile.contractor_entity_type === "company") {
      const normalized = value.replace(/^vat\s*/i, "").trim();
      if (/^gb[\dA-Z]/i.test(normalized)) {
        next.vat_number = normalized;
      } else {
        next.company_registration = value;
      }
    } else {
      next.utr = value.replace(/^utr\s*/i, "").trim();
    }
    return next;
  }

  next.company_registration = value;
  return next;
}

/**
 * Invite form: country + one tax number.
 * Country = where the contractor works, invoices from, and is tax-resident (not where Fixfy is based).
 */
export function contractorInviteFiscalComplete(profile: PayrollInternalProfile): boolean {
  const country = profile.country_of_operation?.trim();
  if (!country) return false;
  return !!contractorTaxNumberFromProfile(profile);
}

export function applyContractorAgreementPlaceholders(
  templateHtml: string,
  person: ContractorAgreementPerson,
  options: ContractorAgreementRenderOptions = {},
): string {
  const profile = asProfile(person.payroll_profile);
  const name = person.payee_name?.trim() || "—";
  const taxId = buildContractorTaxId(profile) || "—";
  const address = profile.address?.trim() || "—";
  const country = profile.country_of_operation?.trim() || "—";
  const email = profile.email?.trim() || "—";
  const agreementDate = formatContractAgreementDate(options.agreementDate ?? new Date());

  return templateHtml
    .split(CONTRACTOR_AGREEMENT_PLACEHOLDERS.contractor_name)
    .join(escapeHtml(name))
    .split(CONTRACTOR_AGREEMENT_PLACEHOLDERS.tax_id)
    .join(escapeHtml(taxId))
    .split(CONTRACTOR_AGREEMENT_PLACEHOLDERS.contractor_address)
    .join(escapeHtml(address))
    .split(CONTRACTOR_AGREEMENT_PLACEHOLDERS.country)
    .join(escapeHtml(country))
    .split(CONTRACTOR_AGREEMENT_PLACEHOLDERS.contractor_email)
    .join(escapeHtml(email))
    .split(CONTRACTOR_AGREEMENT_PLACEHOLDERS.company_signature)
    .join(escapeHtml(FIXFY_COMPANY_SIGNATORY_NAME))
    .split(CONTRACTOR_AGREEMENT_PLACEHOLDERS.company_signatory_name)
    .join(escapeHtml(FIXFY_COMPANY_SIGNATORY_NAME))
    .split(CONTRACTOR_AGREEMENT_PLACEHOLDERS.agreement_date)
    .join(escapeHtml(agreementDate));
}

export function injectContractorAgreementPlaceholders(rawHtml: string): string {
  const styleMatch = rawHtml.match(/<style>([\s\S]*?)<\/style>/i);
  const bodyMatch = rawHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const style = styleMatch?.[1]?.trim() ?? "";
  const body = bodyMatch?.[1]?.trim() ?? rawHtml;
  const withPlaceholders = body
    .replace(
      /<tr><td class="k">Full legal name \/ Trading name<\/td><td class="v"><\/td><\/tr>/,
      `<tr><td class="k">Full legal name / Trading name</td><td class="v">${CONTRACTOR_AGREEMENT_PLACEHOLDERS.contractor_name}</td></tr>`,
    )
    .replace(
      /<tr><td class="k">Registration \/ Tax ID \(if any\)<\/td><td class="v"><\/td><\/tr>/,
      `<tr><td class="k">Registration / Tax ID (if any)</td><td class="v">${CONTRACTOR_AGREEMENT_PLACEHOLDERS.tax_id}</td></tr>`,
    )
    .replace(
      /<tr><td class="k">Registered \/ Operating address<\/td><td class="v"><\/td><\/tr>/,
      `<tr><td class="k">Registered / Operating address</td><td class="v">${CONTRACTOR_AGREEMENT_PLACEHOLDERS.contractor_address}</td></tr>`,
    )
    .replace(
      /<tr><td class="k">Country of operation<\/td><td class="v"><\/td><\/tr>/,
      `<tr><td class="k">Country of operation</td><td class="v">${CONTRACTOR_AGREEMENT_PLACEHOLDERS.country}</td></tr>`,
    )
    .replace(
      /<tr><td class="k">Email<\/td><td class="v"><\/td><\/tr>/,
      `<tr><td class="k">Email</td><td class="v">${CONTRACTOR_AGREEMENT_PLACEHOLDERS.contractor_email}</td></tr>`,
    );
  return `<style>${style}</style>${withPlaceholders}`;
}
