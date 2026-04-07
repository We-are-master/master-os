/** Predefined expense categories for company bills (debit / operating costs). */
export const BILL_CATEGORY_OPTIONS = [
  { value: "debit", label: "Debit (financing / loan)" },
  { value: "subscriptions", label: "Subscriptions & software" },
  { value: "general", label: "General cost" },
  { value: "office", label: "Office & facilities" },
  { value: "marketing", label: "Marketing & advertising" },
  { value: "professional", label: "Professional fees (legal, accounting)" },
  { value: "utilities", label: "Utilities" },
  { value: "insurance", label: "Insurance" },
  { value: "travel", label: "Travel & transport" },
  { value: "equipment", label: "Equipment & tools" },
  { value: "payroll_related", label: "Payroll-related (non-salary)" },
  { value: "other", label: "Other (specify in description)" },
] as const;

export type BillCategoryValue = (typeof BILL_CATEGORY_OPTIONS)[number]["value"];

/** Categories for “standard” bills — excludes {@link BILL_CATEGORY_OPTIONS} entry `debit` (use Bill type = Debit). */
export const BILL_STANDARD_CATEGORY_OPTIONS = BILL_CATEGORY_OPTIONS.filter((o) => o.value !== "debit");

export function billCategoryLabel(value: string | null | undefined): string {
  if (!value?.trim()) return "—";
  const hit = BILL_CATEGORY_OPTIONS.find((o) => o.value === value);
  return hit?.label ?? value;
}
