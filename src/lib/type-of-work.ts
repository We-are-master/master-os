export const TYPE_OF_WORK_OPTIONS = [
  "Painter",
  "General Maintenance",
  "Plumber",
  "Electrician",
  "Builder",
  "Carpenter",
  "Cleaning",
  "EICR",
  "PAT EICR",
  "PAT Testing",
  "Gas Safety Certificate",
  "Fire Risk Assessment",
  "Fire Alarm Certificate",
  "Emergency Lighting Certificate",
  "Fire Extinguisher Service",
] as const;

export function withTypeOfWorkFallback(current?: string | null): string[] {
  const base = [...TYPE_OF_WORK_OPTIONS];
  const value = (current ?? "").trim();
  if (!value) return base;
  return base.includes(value as (typeof TYPE_OF_WORK_OPTIONS)[number]) ? base : [value, ...base];
}
