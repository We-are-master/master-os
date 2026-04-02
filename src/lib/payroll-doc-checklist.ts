/** Keys stored in `payroll_internal_costs.documents_on_file` (JSON booleans). */

export const EMPLOYEE_PAYROLL_DOC_KEYS = [
  "service_agreement",
  "employment_contract",
  "right_to_work",
  "paye_payroll_setup",
] as const;

export const SELF_EMPLOYED_PAYROLL_DOC_KEYS = [
  "service_agreement",
  "consultancy_contract",
  "utr_self_bill_on_file",
  "invoice_payment_terms",
] as const;

export type EmployeePayrollDocKey = (typeof EMPLOYEE_PAYROLL_DOC_KEYS)[number];
export type SelfEmployedPayrollDocKey = (typeof SELF_EMPLOYED_PAYROLL_DOC_KEYS)[number];

export const PAYROLL_DOC_LABELS: Record<string, string> = {
  service_agreement: "Service agreement (signed)",
  employment_contract: "Written employment contract",
  right_to_work: "Right to work evidence",
  paye_payroll_setup: "PAYE / payroll authorisation (HMRC)",
  consultancy_contract: "Consultancy / contract for services",
  utr_self_bill_on_file: "UTR & self-bill agreement on file",
  invoice_payment_terms: "Invoice & payment terms agreed",
};

export type PayrollEmploymentType = "employee" | "self_employed";

export function payrollDocKeysForType(t: PayrollEmploymentType | null | undefined): readonly string[] {
  if (t === "employee") return EMPLOYEE_PAYROLL_DOC_KEYS;
  if (t === "self_employed") return SELF_EMPLOYED_PAYROLL_DOC_KEYS;
  return [];
}

export function payrollDocsCompletion(
  employmentType: PayrollEmploymentType | null | undefined,
  docs: Record<string, boolean> | null | undefined,
): { done: number; total: number } {
  const keys = payrollDocKeysForType(employmentType);
  if (keys.length === 0) return { done: 0, total: 0 };
  const m = docs ?? {};
  let done = 0;
  for (const k of keys) {
    if (m[k] === true) done += 1;
  }
  return { done, total: keys.length };
}
