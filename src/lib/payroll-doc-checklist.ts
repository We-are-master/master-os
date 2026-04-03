/** Required upload slots per employment type (keys in `payroll_document_files`). */

export const EMPLOYEE_PAYROLL_UPLOAD_KEYS = [
  "passport",
  "employment_contract",
  "right_to_work",
  "paye_payroll_setup",
  "service_agreement",
] as const;

export const SELF_EMPLOYED_PAYROLL_UPLOAD_KEYS = ["passport", "service_agreement", "self_bill_agreement"] as const;

export type PayrollDocumentFileMeta = { path: string; file_name: string };

export const PROFILE_PHOTO_DOC_KEY = "profile_photo" as const;

export const PAYROLL_UPLOAD_LABELS: Record<string, string> = {
  [PROFILE_PHOTO_DOC_KEY]: "Profile photo",
  passport: "Passport / photo ID",
  employment_contract: "Employment contract",
  right_to_work: "Right to work evidence",
  paye_payroll_setup: "PAYE / payroll (HMRC) setup",
  service_agreement: "Service agreement (signed)",
  self_bill_agreement: "Self-bill agreement",
  equity_agreement: "Equity agreement",
  /** Finance tab — employees (HMRC / payroll). */
  p60: "P60",
  p45: "P45",
  /** Latest payslip; use payslip_YYYY_MM for history rows in `payroll_document_files`. */
  payslip: "Payslip (latest)",
};

export const EQUITY_AGREEMENT_KEY = "equity_agreement" as const;

/** Required upload keys including optional equity agreement. */
export function payrollUploadKeysForRow(
  employmentType: PayrollEmploymentType | null | undefined,
  hasEquity: boolean,
): readonly string[] {
  const base = payrollUploadKeysForType(employmentType);
  if (!hasEquity) return base;
  if (base.length === 0) return [EQUITY_AGREEMENT_KEY];
  return [...base, EQUITY_AGREEMENT_KEY];
}

export type PayrollEmploymentType = "employee" | "self_employed";

export type PayrollPayFrequency = "weekly" | "biweekly" | "monthly";

export const PAYROLL_FREQUENCY_OPTIONS: { value: PayrollPayFrequency; label: string }[] = [
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Bi-weekly (every 2 weeks / quinzenal)" },
  { value: "monthly", label: "Monthly (mensal)" },
];

export const PAYROLL_COST_CATEGORIES: { value: string; label: string }[] = [
  { value: "Salary", label: "Salary" },
  { value: "Payroll", label: "Payroll" },
  { value: "Contractor", label: "Contractor fees" },
  { value: "Bonus", label: "Bonus" },
  { value: "Benefits", label: "Benefits" },
  { value: "Other", label: "Other" },
];

export function payrollUploadKeysForType(t: PayrollEmploymentType | null | undefined): readonly string[] {
  if (t === "employee") return EMPLOYEE_PAYROLL_UPLOAD_KEYS;
  if (t === "self_employed") return SELF_EMPLOYED_PAYROLL_UPLOAD_KEYS;
  return [];
}

function hasUploaded(meta: unknown): boolean {
  if (!meta || typeof meta !== "object") return false;
  const p = (meta as PayrollDocumentFileMeta).path;
  return typeof p === "string" && p.length > 0;
}

/** Completion from uploaded files (paths in DB). */
export function payrollDocsUploadCompletion(
  employmentType: PayrollEmploymentType | null | undefined,
  files: Record<string, PayrollDocumentFileMeta | null | undefined> | null | undefined,
  hasEquity = false,
): { done: number; total: number } {
  const keys = payrollUploadKeysForRow(employmentType, hasEquity);
  if (keys.length === 0) return { done: 0, total: 0 };
  const m = files ?? {};
  let done = 0;
  for (const k of keys) {
    if (hasUploaded(m[k])) done += 1;
  }
  return { done, total: keys.length };
}

/** Table: uploaded file OR legacy checkbox counts as done. */
export function payrollDocsRowCompletion(
  employmentType: PayrollEmploymentType | null | undefined,
  payroll_document_files: Record<string, PayrollDocumentFileMeta | null | undefined> | null | undefined,
  documents_on_file_legacy?: Record<string, boolean> | null,
  hasEquity = false,
): { done: number; total: number } {
  const keys = payrollUploadKeysForRow(employmentType, hasEquity);
  if (keys.length === 0) return { done: 0, total: 0 };
  const leg = documents_on_file_legacy ?? {};
  let done = 0;
  for (const k of keys) {
    if (hasUploaded(payroll_document_files?.[k]) || leg[k] === true) done += 1;
  }
  return { done, total: keys.length };
}

/** @deprecated use PAYROLL_UPLOAD_LABELS */
export const PAYROLL_DOC_LABELS = PAYROLL_UPLOAD_LABELS;
/** @deprecated use payrollUploadKeysForType */
export const payrollDocKeysForType = payrollUploadKeysForType;
/** @deprecated use payrollDocsRowCompletion */
export function payrollDocsCompletion(
  employmentType: PayrollEmploymentType | null | undefined,
  docs: Record<string, boolean | PayrollDocumentFileMeta | null | undefined> | null | undefined,
): { done: number; total: number } {
  if (!docs) return payrollDocsRowCompletion(employmentType, {}, null, false);
  const asFiles: Record<string, PayrollDocumentFileMeta | undefined> = {};
  const legacy: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(docs)) {
    if (v === true) legacy[k] = true;
    else if (v && typeof v === "object" && "path" in v) asFiles[k] = v as PayrollDocumentFileMeta;
  }
  return payrollDocsRowCompletion(employmentType, asFiles, legacy, false);
}
