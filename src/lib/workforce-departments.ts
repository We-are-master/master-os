/** Predefined departments for payroll pay line (Workforce UI). */

export const WORKFORCE_DEPARTMENTS = ["Operations", "Sales", "Marketing", "Finance", "IT"] as const;

export type WorkforceDepartment = (typeof WORKFORCE_DEPARTMENTS)[number];

export const WORKFORCE_DEPARTMENT_SELECT_OPTIONS = [
  { value: "", label: "— Select department" },
  ...WORKFORCE_DEPARTMENTS.map((d) => ({ value: d, label: d })),
  { value: "Other", label: "Other" },
];

export function buildPayLineDescription(
  department: string,
  roleTitle: string,
  otherFull: string
): string {
  if (department === "Other") return otherFull.trim();
  if (!department.trim()) return "";
  const role = roleTitle.trim();
  return role ? `${department.trim()} — ${role}` : department.trim();
}

export function parsePayLineDescription(desc: string): {
  department: string;
  roleTitle: string;
  otherFull: string;
} {
  const d = desc.trim();
  if (!d) return { department: "", roleTitle: "", otherFull: "" };
  const split = d.split(" — ");
  const first = split[0]?.trim() ?? "";
  if ((WORKFORCE_DEPARTMENTS as readonly string[]).includes(first)) {
    return {
      department: first,
      roleTitle: split.slice(1).join(" — ").trim(),
      otherFull: "",
    };
  }
  return { department: "Other", roleTitle: "", otherFull: d };
}
