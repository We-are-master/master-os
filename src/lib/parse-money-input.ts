/**
 * Coerce a money-ish value (number or string) into a finite number.
 *
 * Tolerates UK/EU formatting: currency prefix, whitespace, "1,234.50" thousands,
 * or "177,60" with comma as decimal point.
 */
export function parseMoneyInput(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v !== "string") return 0;
  let s = v.trim().replace(/[£$€\s]/g, "");
  if (!s) return 0;
  if (s.includes(",") && s.includes(".")) {
    s = s.replace(/,/g, "");
  } else if (s.includes(",")) {
    s = s.replace(/,/g, ".");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}
