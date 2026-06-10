import {
  EMPLOYEE_PAYROLL_UPLOAD_KEYS,
  EQUITY_AGREEMENT_KEY,
  PAYROLL_UPLOAD_LABELS,
  SELF_EMPLOYED_PAYROLL_UPLOAD_KEYS,
  type PayrollEmploymentType,
} from "@/lib/payroll-doc-checklist";

/** Per-document rule stored in `company_settings.frontend_setup.workforce_document_rules`. */
export type WorkforceDocRuleRow = {
  id: string;
  enabled: boolean;
  mandatory: boolean;
};

export type WorkforceDocumentRules = {
  employee: WorkforceDocRuleRow[];
  contractor: WorkforceDocRuleRow[];
};

export type WorkforceDocCatalogEntry = {
  id: string;
  name: string;
  description: string;
  group: "core" | "compliance" | "agreement" | "equity";
};

const EMPLOYEE_DOC_DESCRIPTIONS: Record<string, string> = {
  passport: "Photo ID for HR records",
  employment_contract: "Signed digitally on onboarding",
  right_to_work: "UK right to work evidence",
  paye_payroll_setup: "HMRC / PAYE registration",
  service_agreement: "Signed digitally on onboarding",
};

const CONTRACTOR_DOC_DESCRIPTIONS: Record<string, string> = {
  passport: "Photo ID for contractor records",
  service_agreement: "Signed digitally on onboarding",
  self_bill_agreement: "Self-billing agreement — signed digitally",
};

function catalogForKeys(
  keys: readonly string[],
  descriptions: Record<string, string>,
  defaultGroup: WorkforceDocCatalogEntry["group"],
): WorkforceDocCatalogEntry[] {
  return keys.map((id) => ({
    id,
    name: PAYROLL_UPLOAD_LABELS[id] ?? id,
    description: descriptions[id] ?? "Workforce document",
    group: id === EQUITY_AGREEMENT_KEY ? "equity" : defaultGroup,
  }));
}

export function getEmployeeDocumentCatalogForSetup(): WorkforceDocCatalogEntry[] {
  return catalogForKeys(EMPLOYEE_PAYROLL_UPLOAD_KEYS, EMPLOYEE_DOC_DESCRIPTIONS, "compliance");
}

export function getContractorDocumentCatalogForSetup(): WorkforceDocCatalogEntry[] {
  return catalogForKeys(SELF_EMPLOYED_PAYROLL_UPLOAD_KEYS, CONTRACTOR_DOC_DESCRIPTIONS, "core");
}

export function buildDefaultWorkforceDocumentRules(): WorkforceDocumentRules {
  const mk = (ids: readonly string[]): WorkforceDocRuleRow[] =>
    ids.map((id) => ({ id, enabled: true, mandatory: true }));
  return {
    employee: mk(EMPLOYEE_PAYROLL_UPLOAD_KEYS),
    contractor: mk(SELF_EMPLOYED_PAYROLL_UPLOAD_KEYS),
  };
}

export function mergeWorkforceDocumentRules(stored: unknown): WorkforceDocumentRules {
  const defaults = buildDefaultWorkforceDocumentRules();
  if (!stored || typeof stored !== "object") return defaults;
  const o = stored as { employee?: unknown; contractor?: unknown };

  const mergeSide = (
    side: "employee" | "contractor",
    catalog: WorkforceDocCatalogEntry[],
  ): WorkforceDocRuleRow[] => {
    const defaultById = new Map(defaults[side].map((r) => [r.id, r]));
    const storedById = new Map<string, WorkforceDocRuleRow>();
    const raw = o[side];
    if (Array.isArray(raw)) {
      for (const row of raw) {
        if (!row || typeof row !== "object") continue;
        const r = row as { id?: unknown; enabled?: unknown; mandatory?: unknown };
        if (typeof r.id !== "string" || !r.id.trim()) continue;
        const enabled = r.enabled !== false;
        storedById.set(r.id, {
          id: r.id,
          enabled,
          mandatory: enabled && r.mandatory !== false,
        });
      }
    }
    return catalog.map((entry) => {
      const storedRule = storedById.get(entry.id);
      if (storedRule) return storedRule;
      return defaultById.get(entry.id) ?? { id: entry.id, enabled: true, mandatory: true };
    });
  };

  return {
    employee: mergeSide("employee", getEmployeeDocumentCatalogForSetup()),
    contractor: mergeSide("contractor", getContractorDocumentCatalogForSetup()),
  };
}

export function resolveWorkforceDocRulesForType(
  rules: WorkforceDocumentRules | null | undefined,
  employmentType: PayrollEmploymentType | null | undefined,
): WorkforceDocRuleRow[] {
  if (!employmentType) return [];
  const merged = mergeWorkforceDocumentRules(rules);
  return employmentType === "employee" ? merged.employee : merged.contractor;
}

export function enabledWorkforceUploadKeys(
  rules: WorkforceDocumentRules | null | undefined,
  employmentType: PayrollEmploymentType | null | undefined,
  hasEquity: boolean,
): string[] {
  const sideRules = resolveWorkforceDocRulesForType(rules, employmentType);
  const keys = sideRules.filter((r) => r.enabled).map((r) => r.id);
  if (hasEquity && !keys.includes(EQUITY_AGREEMENT_KEY)) {
    keys.push(EQUITY_AGREEMENT_KEY);
  }
  return keys;
}

export function mandatoryWorkforceUploadKeys(
  rules: WorkforceDocumentRules | null | undefined,
  employmentType: PayrollEmploymentType | null | undefined,
  hasEquity: boolean,
): string[] {
  return enabledWorkforceUploadKeys(rules, employmentType, hasEquity).filter((id) => {
    if (id === EQUITY_AGREEMENT_KEY && hasEquity) return true;
    const sideRules = resolveWorkforceDocRulesForType(rules, employmentType);
    const rule = sideRules.find((r) => r.id === id);
    return rule?.mandatory ?? true;
  });
}

export function isWorkforceDocMandatory(
  rules: WorkforceDocumentRules | null | undefined,
  employmentType: PayrollEmploymentType | null | undefined,
  docId: string,
): boolean {
  if (docId === EQUITY_AGREEMENT_KEY) return true;
  const sideRules = resolveWorkforceDocRulesForType(rules, employmentType);
  const rule = sideRules.find((r) => r.id === docId);
  if (!rule || !rule.enabled) return false;
  return rule.mandatory;
}
